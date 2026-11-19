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

chrome.runtime.onInstalled.addListener(() => {
  getAccountsCached(true).catch(() => { /* 安装/更新后立即建菜单 */ });
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

/**
 * 从 mp 主页 HTML 的 window.wx.commonData 全局数据里解析账号元信息。
 * 参考 wechatsync v2 weixin.ts:token=t 字段,ticket/user_name/nick_name/head_img/time 同在,
 * 无需调用素材库接口(旧版 filepage 取 ticket_id 的流程已废弃,现返回 200009)。
 */
function parseMpHomeMeta(html) {
  if (!html) return null;
  const start = html.indexOf('commonData');
  if (start === -1) return null;
  const block = html.slice(start, start + 6000);
  const get = (re) => {
    const m = block.match(re);
    return m ? m[1] : '';
  };
  const token = get(/[{;]\s*t:\s*["'](\d{3,})["']/) || get(/token:\s*["'](\d{3,})["']/);
  if (!token) return null;
  let avatar = get(/head_img:\s*["']([^"']{6,})["']/);
  if (avatar.startsWith('http://')) avatar = avatar.replace('http://', 'https://');
  return {
    token,
    ticket: get(/ticket:\s*["']([^"']{6,})["']/),
    userName: get(/user_name:\s*["']([^"']{4,})["']/),
    nick: get(/nick_name:\s*["']([^"']{1,60})["']/),
    avatar,
    svrTime: get(/time:\s*["'](\d{9,})["']/) || String(Math.floor(Date.now() / 1000)),
  };
}

/** 抓主页,提取全部已登录账号(主页 commonData 为主;多账号切换 token 经页面中继逐个取元信息) */
async function listMpAccounts() {
  const resp = await fetchWithTimeout('https://mp.weixin.qq.com/', { credentials: 'include' }, 20000);
  const html = await resp.text();
  const primary = parseMpHomeMeta(html);
  const tokens = [...new Set([...html.matchAll(/(?<![a-zA-Z_])token=(\d{3,})/g)].map((m) => m[1]))];
  const accounts = [];
  if (primary) accounts.push(primary);
  // 多账号:主页/账号切换页会列出其他已登录账号的 token,逐个(最多 3 个)取各自主页解析元信息
  for (const tk of tokens.slice(0, 3)) {
    if (primary && tk === primary.token) continue;
    try {
      const h = await mpPageFetchText(`https://mp.weixin.qq.com/cgi-bin/home?t=home&token=${tk}&lang=zh_CN`);
      const m = parseMpHomeMeta(h);
      if (m && !accounts.some((a) => a.token === m.token)) accounts.push(m);
    } catch (e) { /* 中继失败时跳过该账号 */ }
  }
  return { accounts, html, url: resp.url, tokens };
}

/**
 * mp 后台 cgi 请求的"页面中继":微信对扩展后台发起的 cgi 请求一律返回 error 页(环境校验),
 * 但页面内的同源请求不会。因此复用(或后台新建)一个 mp 标签页,用 chrome.scripting
 * 在页面上下文里发 fetch——与真实用户操作完全同源,不会被拦。
 */
let mpTabPromise = null;
function ensureMpTab() {
  if (!mpTabPromise) {
    mpTabPromise = (async () => {
      const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
      if (tabs.length) return tabs[0].id;
      const tab = await chrome.tabs.create({ url: 'https://mp.weixin.qq.com/', active: false });
      await new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 15000); // 兜底,避免页面一直挂起
      });
      return tab.id;
    })().catch((e) => { mpTabPromise = null; throw e; });
  }
  return mpTabPromise;
}

/** 在 mp 页面上下文里 GET 文本 */
async function mpPageFetchText(url) {
  const tabId = await ensureMpTab();
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: (u) => fetch(u, { credentials: 'include' }).then((r) => r.text()),
    args: [url],
  });
  const out = res && res[0] && res[0].result;
  if (typeof out !== 'string') throw new Error('页面中继无返回(标签页可能刚打开,请重试)');
  return out;
}

/** 在 mp 页面上下文里 POST multipart 上传(SW↔页面用 base64 传图片) */
async function mpPageUpload(url, b64, mime, filename) {
  const tabId = await ensureMpTab();
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (u, data, m, name) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const form = new FormData();
      // 微信上传接口要求的 5 个元数据字段(与网页端手动上传一致)
      form.append('type', m);
      form.append('id', String(Date.now()));
      form.append('name', name);
      form.append('lastModifiedDate', new Date().toString());
      form.append('size', String(bytes.length));
      form.append('file', new Blob([bytes], { type: m }), name);
      const r = await fetch(u, { method: 'POST', body: form, credentials: 'include' });
      return r.text();
    },
    args: [url, b64, mime, filename],
  });
  const out = res && res[0] && res[0].result;
  if (typeof out !== 'string') throw new Error('上传中继无返回(标签页可能刚打开,请重试)');
  return out;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('图片编码失败'));
    fr.readAsDataURL(blob);
  });
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

/**
 * webp/avif 等微信不支持的格式先转成 png(createImageBitmap 支持解码几乎所有网页图片格式);
 * jpg/png/gif 原样直传,避免转码损耗。
 */
async function normalizeImageBlob(blob) {
  if (/^image\/(jpeg|png|gif)$/.test(blob.type || '')) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return out.size ? out : blob;
  } catch (e) {
    return blob; // 解码失败就让服务器嗅探(与 wechatsync 行为一致)
  }
}

/** 上传到公众号素材库(经页面中继同源上传),返回 {ok, url} 或 {ok:false, error, detail}
 * 参考 wechatsync v2:文件名一律 <时间戳>.jpg(接口对扩展名敏感,webp/avif 名会被 ret=200039 拒),
 * ticket_id 参数填 user_name,ticket 参数填 commonData.ticket,svr_time 用主页服务器时间。 */
async function uploadToMaterial(meta, blob) {
  const seq = Date.now();
  const url = 'https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1' +
    `&ticket_id=${encodeURIComponent(meta.userName)}&ticket=${encodeURIComponent(meta.ticket || '')}` +
    `&svr_time=${meta.svrTime}&token=${meta.token}&lang=zh_CN&seq=${seq}&t=${Math.random()}`;
  const b64 = await blobToBase64(blob);
  const text = await mpPageUpload(url, b64, blob.type || 'image/jpeg', seq + '.jpg');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  if (!data) return { ok: false, error: '上传接口返回了非 JSON 响应(可能登录态失效,请重新登录公众号)', detail: text.slice(0, 300) };
  const ret = data && data.base_resp && data.base_resp.ret;
  const errMsg = (data && data.base_resp && data.base_resp.err_msg) || '';
  if (ret !== 0 || (errMsg && errMsg !== 'ok')) {
    const reason = ret === -3 ? '(登录态过期或 token 与账号不匹配,请重新登录)' : ret === 200013 ? '(频率限制,稍后再试)' : '';
    return { ok: false, error: `上传被拒(ret=${ret}${errMsg ? ' ' + errMsg : ''})${reason}`, detail: text.slice(0, 300) };
  }
  const cdn = data.cdn_url || data.content || (data.data && data.data.content);
  if (!cdn) return { ok: false, error: '上传成功但未返回图片地址', detail: text.slice(0, 300) };
  return { ok: true, url: cdn };
}

/** 单账号完整采集链路 */
async function uploadWithAccount(acc, srcUrl, pageUrl) {
  try {
    let meta = acc;
    const blob = await normalizeImageBlob(await fetchImageBlob(srcUrl, pageUrl));
    // 元信息缺失(如旧缓存):经页面中继重新拉该账号主页解析
    if (!meta.ticket || !meta.userName) {
      const h = await mpPageFetchText(`https://mp.weixin.qq.com/cgi-bin/home?t=home&token=${meta.token}&lang=zh_CN`);
      const m = parseMpHomeMeta(h);
      if (!m) throw new Error('主页缺少 ticket/user_name 字段,页面结构可能已变化,请反馈');
      meta = m;
    }
    const r = await uploadToMaterial(meta, blob);
    return r;
  } catch (e) {
    return { ok: false, error: e.message || '采集失败', detail: '' };
  }
}

/** 右键二级菜单:有账号时直选账号上传;无账号时「检测账号并上传…」兜底 */
const MP_COLLECT_ROOT = 'mopai-collect-root';
const MP_COLLECT_AUTO = 'mopai-collect-auto';

/** 重建右键菜单:有已知账号时只显示各账号子项;没有任何账号才显示「检测账号并上传…」兜底 */
function rebuildCollectMenu(accounts) {
  try {
    chrome.contextMenus.removeAll(() => {
      const list = (accounts || []).filter((a) => a && a.token);
      chrome.contextMenus.create({
        id: MP_COLLECT_ROOT,
        title: '采集图片到公众号素材库',
        contexts: ['image'],
      });
      if (!list.length) {
        chrome.contextMenus.create({
          id: MP_COLLECT_AUTO,
          parentId: MP_COLLECT_ROOT,
          title: '检测账号并上传…',
          contexts: ['image'],
        });
        return;
      }
      list.forEach((acc, i) => {
        chrome.contextMenus.create({
          id: MP_COLLECT_ROOT + '-' + i,
          parentId: MP_COLLECT_ROOT,
          title: `上传到「${acc.nick || '公众号'}」`,
          contexts: ['image'],
        });
      });
    });
  } catch (e) { /* ignore */ }
}

/** 账号缓存:SW 启动即拉一次(节流 5 分钟),菜单子项直接展示账号;选择账号后离线上传 */
let accCache = { accounts: [], ts: 0 };
async function getAccountsCached(force) {
  if (!force && accCache.accounts.length && Date.now() - accCache.ts < 5 * 60000) return accCache.accounts;
  try {
    const { accounts } = await listMpAccounts();
    accCache = { accounts: accounts.filter((a) => a && a.token), ts: Date.now() };
    await chrome.storage.local.set({ mopai_mp_accounts: accCache.accounts });
    rebuildCollectMenu(accCache.accounts);
    return accCache.accounts;
  } catch (e) {
    if (!accCache.accounts.length) {
      try {
        const st = await chrome.storage.local.get('mopai_mp_accounts');
        accCache.accounts = st.mopai_mp_accounts || [];
      } catch (e2) { /* ignore */ }
    }
    accCache.ts = Date.now();
    rebuildCollectMenu(accCache.accounts);
    return accCache.accounts;
  }
}
getAccountsCached().catch(() => { /* SW 唤醒即预热账号缓存与菜单 */ });

/** 页面内进度提示:右侧悬浮卡片(spinner/成功/失败),完成后自动消失。
 * 用 Web Animations API 做旋转(页面 CSP 禁 <style> 内联动画也不受影响)。 */
function pageCollectToast(state, text, detail) {
  const ID = '__mopai_collect_toast';
  let box = document.getElementById(ID);
  if (!box) {
    box = document.createElement('div');
    box.id = ID;
    box.style.cssText = 'position:fixed;z-index:2147483647;right:20px;top:20px;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:14px 18px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#333;max-width:320px;display:flex;gap:12px;align-items:center;transition:opacity .35s;';
    (document.body || document.documentElement).appendChild(box);
  } else {
    box.style.opacity = '1';
    if (box._timer) { clearTimeout(box._timer); box._timer = null; }
  }
  box.textContent = '';
  const icon = document.createElement('span');
  icon.style.cssText = 'flex:none;width:20px;height:20px;display:flex;align-items:center;justify-content:center;';
  box.appendChild(icon);
  if (state === 'loading') {
    const spin = document.createElement('span');
    spin.style.cssText = 'width:18px;height:18px;border-radius:50%;border:2px solid #d1d5db;border-top-color:#07c160;display:block;';
    spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity });
    icon.appendChild(spin);
  } else {
    icon.textContent = state === 'success' ? '✅' : '❌';
    icon.style.fontSize = '17px';
  }
  const body = document.createElement('div');
  body.style.cssText = 'min-width:0;';
  const main = document.createElement('div');
  main.style.cssText = 'font-weight:600;';
  main.textContent = text;
  body.appendChild(main);
  if (detail) {
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#9ca3af;font-size:12px;margin-top:3px;word-break:break-all;max-height:64px;overflow:hidden;';
    sub.textContent = detail;
    body.appendChild(sub);
  }
  box.appendChild(body);
  if (state !== 'loading') {
    box._timer = setTimeout(() => {
      box.style.opacity = '0';
      setTimeout(() => box.remove(), 400);
    }, state === 'success' ? 2600 : 5000);
  }
}

/** 在目标页面显示进度;注入失败(受限页面/无标签页)时返回 false 由系统通知兜底 */
async function showCollectToast(tabId, state, text, detail) {
  try {
    if (!tabId) throw new Error('no tab');
    await chrome.scripting.executeScript({ target: { tabId }, func: pageCollectToast, args: [state, text, detail || ''] });
    return true;
  } catch (e) {
    return false;
  }
}

/** 执行一次采集:页面圆圈进度 → 上传 → 成功/失败提示后自动消失 */
async function doCollect(acc, srcUrl, pageUrl, tabId) {
  const name = acc.nick || '我的公众号';
  const shown = await showCollectToast(tabId, 'loading', `正在采集到「${name}」素材库…`);
  const r = await uploadWithAccount(acc, srcUrl, pageUrl);
  if (r.ok) {
    const ok = shown ? await showCollectToast(tabId, 'success', `已采集到「${name}」素材库`) : false;
    if (!ok) await mpNotify('采集成功', `图片已上传到「${name}」素材库`);
    getAccountsCached(true).catch(() => { /* 后台刷新缓存 */ });
  } else {
    const ok = shown ? await showCollectToast(tabId, 'error', '采集失败:' + r.error, r.detail) : false;
    if (!ok) await mpNotify('采集失败', r.error);
    getAccountsCached(true).catch(() => { /* 刷新账号,让下次菜单准确 */ });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!String(info.menuItemId).startsWith(MP_COLLECT_ROOT) && info.menuItemId !== MP_COLLECT_AUTO) return;
  const srcUrl = info.srcUrl;
  const tabId = (tab && tab.id) || undefined;
  if (!srcUrl) { mpNotify('采集失败', '未获取到图片地址'); return; }
  if (info.menuItemId === MP_COLLECT_AUTO) {
    (async () => {
      try {
        const accounts = await getAccountsCached(true);
        if (accounts.length === 1) return void doCollect(accounts[0], srcUrl, info.pageUrl, tabId);
        if (accounts.length > 1) {
          // 多号且未点具体账号:打开选择窗兜底
          const params = '?src=' + encodeURIComponent(srcUrl) + '&page=' + encodeURIComponent(info.pageUrl || '');
          chrome.windows.create({ url: chrome.runtime.getURL('collector/collector.html') + params, type: 'popup', width: 440, height: 660 }).catch(() => { /* ignore */ });
          return;
        }
        await mpNotify('未检测到公众号登录', '请先在浏览器登录 mp.weixin.qq.com 后重试');
      } catch (e) {
        await mpNotify('检测账号失败', e.message || '');
      }
    })();
    return;
  }
  // 二级菜单里点的具体账号
  const idx = Number(String(info.menuItemId).split('-').pop());
  const acc = accCache.accounts[idx];
  if (!acc) { mpNotify('账号信息过期', '请右键重试,或先用「检测账号并上传」刷新'); return; }
  doCollect(acc, srcUrl, info.pageUrl, tabId);
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
  if (!msg.account || !msg.account.token || !msg.srcUrl) return { ok: false, error: '参数缺失' };
  return uploadWithAccount(msg.account, msg.srcUrl, msg.pageUrl);
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
