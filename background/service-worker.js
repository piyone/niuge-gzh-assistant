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
