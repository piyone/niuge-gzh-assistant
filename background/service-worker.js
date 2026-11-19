/**
 * 牛哥公众号助手 · 后台 Service Worker
 * 职责:①代理 AI 校对请求(content script 有页面 CORS 限制,后台无);
 *      ②消息路由 → 多平台同步适配器(background/platforms.js,参考 wechatsync v2)。
 * 无状态设计:AI 限流(60s/次)由面板侧驱动分块节流,429 时返回 retryAfter 由面板倒计时重试。
 */
importScripts('../lib/marked.min.js', '../engine/ai.js', '../engine/sync-prepare.js', '../background/platforms.js');

// ---------------- 通用 fetch 助手 ----------------

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- AI 校对 ----------------

async function handleAiChunk(msg) {
  const settings = await getSettings();
  const ai = Object.assign({}, globalThis.MoPaiAI.AI_DEFAULTS, settings.ai || {});
  if (!ai.apiKey) return { ok: false, error: '未配置 API Key,请到插件设置页填写' };

  try {
    const resp = await fetchWithTimeout(ai.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ai.apiKey,
      },
      body: JSON.stringify({
        model: ai.model || globalThis.MoPaiAI.AI_DEFAULTS.model,
        messages: msg.messages,
        temperature: 0.2,
        max_tokens: Math.min(ai.maxTokens || 1024, 1024),
      }),
    }, 90000);

    if (resp.status === 429) {
      const ra = parseInt(resp.headers.get('Retry-After') || '60', 10);
      return { ok: false, rateLimited: true, retryAfter: isNaN(ra) ? 60 : Math.max(1, ra) };
    }
    if (resp.status === 401) return { ok: false, error: 'API Key 无效(401),请到设置页检查' };
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = j.error && j.error.message || ''; } catch (e) { /* ignore */ }
      return { ok: false, error: `AI 服务错误 ${resp.status}${detail ? ':' + detail : ''}` };
    }

    const data = await resp.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    return { ok: true, raw };
  } catch (e) {
    return { ok: false, error: '网络请求失败:' + (e.name === 'AbortError' ? '超时' : e.message) };
  }
}

// ---------------- 设置读取 ----------------

async function getSettings() {
  try {
    const d = await chrome.storage.local.get('mopai');
    return (d && d.mopai) || {};
  } catch (e) {
    return {};
  }
}

// ---------------- AI 连接测试(设置页「测试连接」按钮) ----------------

async function handleAiTest(msg) {
  const ai = Object.assign({}, globalThis.MoPaiAI.AI_DEFAULTS, (msg && msg.ai) || {});
  if (!ai.baseUrl) return { ok: false, error: '接口地址为空' };
  if (!ai.model) return { ok: false, error: '模型为空' };
  const start = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ai.apiKey) headers.Authorization = 'Bearer ' + ai.apiKey;
    const resp = await fetchWithTimeout(ai.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: ai.model,
        messages: [{ role: 'user', content: '回复:OK' }],
        max_tokens: 256,
      }),
    }, 25000);
    const latency = Date.now() - start;

    if (resp.status === 401) return { ok: false, error: 'API Key 无效(401)' };
    if (resp.status === 404) return { ok: false, error: '接口地址 404,请检查 URL(一般以 /v1/chat/completions 结尾)' };
    if (resp.status === 429) return { ok: false, error: '限流(429):地址与 Key 通常有效,稍后再试' };
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j.error && j.error.message) || j.message || ''; } catch (e) { /* ignore */ }
      return { ok: false, error: `HTTP ${resp.status}${detail ? ':' + detail.slice(0, 120) : ''}` };
    }

    const data = await resp.json();
    if (!data.choices || !data.choices.length) {
      return { ok: false, error: '响应缺少 choices,可能不是 OpenAI 兼容接口' };
    }
    const content = (data.choices[0].message && data.choices[0].message.content) || '';
    const reasoning = data.usage && data.usage.completion_tokens_details && data.usage.completion_tokens_details.reasoning_tokens;
    return {
      ok: true,
      latency,
      preview: content.trim().slice(0, 40),
      warning: !content.trim() && reasoning ? '模型把 token 花在推理上(思维链模型),校对结果可能被截断,建议换非推理模型' : '',
    };
  } catch (e) {
    return { ok: false, error: '网络失败:' + (e.name === 'AbortError' ? '超时' : e.message) };
  }
}

// ---------------- 右键菜单:采集图片到公众号素材库 ----------------
// 流程(与 wechatsync 微信适配器同款):主页拿 token → 素材列表拿 ticket_id →
// POST filetransfer?action=upload_material 带 cookie 上传 → 返回 cdn_url。
// 防盗链图:临时 DNR 会话规则把 Referer 伪装成图片所在页面。
// 多账号:mp 后台支持同浏览器多号同时登录,主页 token 去重后 >1 个时弹出选择器窗口。

const MP_UPLOAD_MENU = 'mopai-save-img';

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MP_UPLOAD_MENU,
        title: '采集图片到公众号素材库',
        contexts: ['image'],
      });
    });
  } catch (e) { /* ignore */ }
});

/** 系统通知(图标必须用扩展绝对 URL,SW 里相对路径会解析到 background/ 下导致下载失败) */
async function mpNotify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: String(message || '').slice(0, 200),
    });
    return true;
  } catch (e) {
    console.error('[collect] notification failed:', e);
    return false;
  }
}

/** 通知失败时的兜底:弹一个错误选择器窗,保证失败原因可见 */
function showCollectError(message) {
  chrome.windows.create({
    url: chrome.runtime.getURL('collector/collector.html') + '?err=' + encodeURIComponent(message),
    type: 'popup', width: 440, height: 340,
  }).catch(() => { /* ignore */ });
}

/** 通知或兜底窗口,二选一保证用户看得到结果 */
async function notifyOrWindow(title, message) {
  const ok = await mpNotify(title, message);
  if (!ok) showCollectError(title + ' — ' + message);
}

/** 抓主页,提取全部已登录账号(mp 多号登录会在页面里留多个 token) */
async function listMpAccounts() {
  const resp = await fetchWithTimeout('https://mp.weixin.qq.com/', { credentials: 'include' }, 20000);
  const html = await resp.text();
  const tokens = [...new Set((html.match(/token=(\d{3,})/g) || []).map((s) => s.slice(6)))];
  const nicks = [...html.matchAll(/nick_?name["']?\s*[:=]\s*["']([^"']{1,60})["']/g)].map((m) => m[1]);
  const avatars = [...html.matchAll(/head_?img["']?\s*[:=]\s*["']([^"']{6,})["']/g)].map((m) => m[1]);
  const accounts = tokens.map((token, i) => ({ token, nick: nicks[i] || '', avatar: avatars[i] || '' }));
  return { accounts, html, url: resp.url };
}

/** 从素材库列表接口取 ticket_id(与 wechatsync getTicketId 相同流程;兼容 JSON 与 HTML 两种响应) */
async function getMpTicketId(token) {
  const url = 'https://mp.weixin.qq.com/cgi-bin/filepage?action=get_all_materials&query_type=2&begincount=0&count=1' +
    `&token=${token}&lang=zh_CN&f=json&ajax=1&random=${Math.random()}`;
  const resp = await fetchWithTimeout(url, { credentials: 'include' }, 20000);
  const text = await resp.text();
  try {
    const data = JSON.parse(text);
    const item = data && data.data && data.data.file_item && data.data.file_item[0];
    if (item && item.ticket_id) return item.ticket_id;
  } catch (e) { /* HTML 响应,走正则兜底 */ }
  const m = text.match(/ticket_id["':=\s]{1,4}([A-Za-z0-9_%\-]{6,})/);
  return m ? m[1] : null;
}

/** 临时 Referer 伪装再抓图(防盗链),失败降级为直接抓 */
async function fetchImageBlob(srcUrl, pageUrl) {
  if (/^(blob:|chrome[^:]*:|moz-)/i.test(srcUrl)) throw new Error('不支持浏览器内部资源,请对普通图片链接使用');
  const referer = pageUrl || 'https://mp.weixin.qq.com/';
  const doFetch = () => fetchWithTimeout(srcUrl, { credentials: 'omit' }, 30000);
  let resp = null;
  try {
    if (chrome.declarativeNetRequest) {
      const ruleId = 70000 + (Date.now() % 20000);
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }] },
          condition: { regexFilter: srcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), resourceTypes: ['xmlhttprequest'] },
        }],
      });
      try { resp = await doFetch(); } finally {
        try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }); } catch (e) { /* ignore */ }
      }
    }
    if (!resp) resp = await doFetch();
  } catch (e) {
    resp = await doFetch(); // DNR 失败时直接试一次
  }
  if (!resp.ok) throw new Error(`图片下载失败(HTTP ${resp.status})`);
  const blob = await resp.blob();
  if (!blob.size) throw new Error('图片内容为空,可能被站点防盗链拦截');
  return blob;
}

function extForType(type) {
  const m = /image\/(png|jpeg|gif|webp|bmp)/.exec(type || '');
  return m ? '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]) : '.png';
}

/** 上传到公众号素材库,返回 {ok, url} 或 {ok:false, error, detail} */
async function uploadToMaterial(token, ticketId, blob, filename) {
  const form = new FormData();
  form.append('file', blob, filename);
  const url = 'https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1' +
    `&ticket_id=${encodeURIComponent(ticketId)}&svr_time=${Math.floor(Date.now() / 1000)}&token=${token}&lang=zh_CN&seq=${Date.now()}`;
  const resp = await fetchWithTimeout(url, { method: 'POST', body: form, credentials: 'include' }, 60000);
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  if (!data) return { ok: false, error: '上传接口返回了非 JSON 响应(可能登录态失效,请重新登录公众号)', detail: text.slice(0, 300) };
  const ret = data && data.base_resp && data.base_resp.ret;
  if (ret !== 0) {
    const reason = ret === -3 ? '(登录态过期或 token 与账号不匹配,请重新登录)' : ret === 200013 ? '(频率限制,稍后再试)' : '';
    return { ok: false, error: `上传被拒(ret=${ret})${reason}`, detail: text.slice(0, 300) };
  }
  const cdn = data.content || (data.data && data.data.content);
  if (!cdn) return { ok: false, error: '上传成功但未返回图片地址', detail: text.slice(0, 300) };
  return { ok: true, url: cdn };
}

/** 单账号完整采集链路 */
async function uploadWithToken(token, srcUrl, pageUrl) {
  try {
    const blob = await fetchImageBlob(srcUrl, pageUrl);
    const ticketId = await getMpTicketId(token);
    if (!ticketId) return { ok: false, error: '获取上传票据失败:素材库可能为空,请先在公众号后台上传过一张图片' };
    const r = await uploadToMaterial(token, ticketId, blob, 'mopai_' + Date.now() + extForType(blob.type));
    return r;
  } catch (e) {
    return { ok: false, error: e.message || '采集失败', detail: '' };
  }
}

/** 右键菜单入口:每次都弹选择窗(账号确认 + 过程可见),早期错误用通知兜底 */
async function collectImage(info) {
  const srcUrl = info.srcUrl;
  if (!srcUrl) { await notifyOrWindow('采集失败', '未获取到图片地址'); return; }
  const params = '?src=' + encodeURIComponent(srcUrl) + '&page=' + encodeURIComponent(info.pageUrl || '');
  chrome.windows.create({
    url: chrome.runtime.getURL('collector/collector.html') + params,
    type: 'popup', width: 440, height: 660,
  }).catch(() => { /* ignore */ });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MP_UPLOAD_MENU) collectImage(info);
});

// 选择器窗口的消息入口
async function handleCollectInfo() {
  try {
    const { accounts, html, url } = await listMpAccounts();
    // 诊断信息:帮助定位"检测不到账号/上传失败"——含最终 URL、token 列表、页面内 token= 附近片段
    const idx = html.indexOf('token=');
    const diag = {
      finalUrl: url,
      htmlLen: html.length,
      tokens: accounts.map((a) => a.token),
      nicks: accounts.map((a) => a.nick),
      snippet: idx >= 0 ? html.slice(Math.max(0, idx - 120), idx + 300) : '(页面中没有 token=)',
    };
    return { ok: true, accounts, diag };
  } catch (e) {
    return { ok: false, error: e.message || '检测登录态失败' };
  }
}

async function handleCollectUpload(msg) {
  if (!msg.token || !msg.srcUrl) return { ok: false, error: '参数缺失' };
  return uploadWithToken(msg.token, msg.srcUrl, msg.pageUrl);
}

// ---------------- 消息路由 ----------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('mopai-')) return false;

  (async () => {
    try {
      switch (msg.type) {
        case 'mopai-open-options':
          // 内容脚本无法直接打开扩展内部页面(会被 Chrome 拦截),由后台代开
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        case 'mopai-ai-chunk':
          sendResponse(await handleAiChunk(msg));
          break;
        case 'mopai-ai-test':
          sendResponse(await handleAiTest(msg));
          break;
        case 'mopai-collect-info':
          sendResponse(await handleCollectInfo());
          break;
        case 'mopai-collect-upload':
          sendResponse(await handleCollectUpload(msg));
          break;
        case 'mopai-sync-auth': {
          const pl = globalThis.MoPaiPlatforms.get(msg.platform);
          sendResponse(pl ? await pl.checkAuth() : { authenticated: false, reason: '未知平台' });
          break;
        }
        case 'mopai-sync-publish': {
          const pl = globalThis.MoPaiPlatforms.get(msg.platform);
          sendResponse(pl
            ? await pl.publish({ title: msg.title, html: msg.html, markdown: msg.markdown, cover: msg.cover })
            : { ok: false, error: '未知平台' });
          break;
        }
        default:
          sendResponse({ ok: false, error: '未知消息类型' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || '后台处理失败' });
    }
  })();

  return true; // 异步 sendResponse
});

console.log('[MoPai] background service worker ready,', Object.keys(globalThis.MoPaiPlatforms.PLATFORMS).length, '个平台适配器已加载');
