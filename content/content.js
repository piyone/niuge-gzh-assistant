/**
 * 牛哥 MoPai · 内容脚本
 * 在 mp.weixin.qq.com 注入悬浮球 + 功能面板:
 * 导入 Markdown / 一键规范排版 / 主题美化 / 发布前检查 / 数据统计 / 手机预览 / 快照防丢稿
 */
(() => {
  if (window.__MOPAI_LOADED__) return;
  window.__MOPAI_LOADED__ = true;

  // ---------------- 常量 ----------------

  // 违禁词/风险词库已独立为 engine/words.js(MoPaiWords):分类词库 + 正则规则 + 自定义词

  const SAMPLE_MD = `# 用牛哥,三分钟排完一篇图文

这是一段**正文**,演示牛哥的默认效果。中英文之间会自动加空格,比如 CSS 和 JavaScript 这些词。

> 引用块:公众号编辑器会剥离样式表,所以牛哥把全部样式写进内联 style,粘贴即所得。

## 核心功能

- **Markdown 导入**:粘贴即排版
- **中文排版规范**:盘古之白、全角标点、空行压缩
- **外链脚注化**:公众号不让点外链?自动转成文末[引用链接](https://github.com/)
- **发布前检查**:违禁词、外链、图片域名一目了然

## 代码高亮

\`\`\`js
const article = await mopai.render(md, { theme: 'elegant' });
await mopai.inject(article.html); // 直接注入公众号编辑器
\`\`\`

行内代码也很漂亮,比如 \`npm i\` 这样的命令。

| 功能 | 免装插件网页版 | 牛哥浏览器插件 |
| --- | --- | --- |
| 编辑器内直接排版 | 否 | 是 |
| 一键套主题 | 是 | 是 |
| 发布前检查 | 少数 | 是 |

![配图占位](https://mmbiz.qpic.cn/placeholder)

### 开始使用

1. 打开公众号后台图文编辑页
2. 点右侧牛哥悬浮球
3. 粘贴 Markdown,点「注入编辑器」`;

  const DEFAULT_SETTINGS = {
    theme: 'elegant',
    fontSize: 16, // 对齐微信编辑器正文默认字号
    lineHeight: 1.75, // 对齐微信编辑器默认行距
    letterSpacing: 0.5, // 正文字间距(px),0 = 紧凑
    imgRadius: 4, // 图片圆角(px),0 = 直角
    sidePad: 0, // 正文两侧边距(px),0 = 不加留白
    rules: { pad: true, punct: true, blank: true, footnote: true, ellipsis: true, collapse: false },
    customWords: [],
    fabEnabled: true,
    ai: null, // 合并 MoPaiAI.AI_DEFAULTS
    syncSelection: [], // 记住勾选的同步平台
    customTheme: { // 「自定义」主题的配色(牛哥绿起步)
      primary: '#07c160', strong: '#07c160', text: '#333333', secondary: '#8890a0',
      blockBg: '#f2f8f4', blockBar: '#07c160', inlineCodeText: '#1a7f55',
      border: '#e5e7eb', link: '#07c160', flavor: 'bar-h2',
    },
  };

  // ---------------- 存储 ----------------

  const clone = (o) => JSON.parse(JSON.stringify(o));

  async function loadSettings() {
    let s = clone(DEFAULT_SETTINGS);
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        const d = await chrome.storage.local.get('mopai');
        if (d && d.mopai) s = deepMerge(s, d.mopai);
        s.ai = deepMerge(window.MoPaiAI ? window.MoPaiAI.AI_DEFAULTS : {}, s.ai || {});
        return s;
      }
    } catch (e) { /* fallthrough */ }
    try {
      const raw = localStorage.getItem('mopai_settings');
      if (raw) s = deepMerge(s, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    s.ai = deepMerge(window.MoPaiAI ? window.MoPaiAI.AI_DEFAULTS : {}, s.ai || {});
    return s;
  }

  async function saveSettings() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ mopai: settings });
        return;
      }
    } catch (e) { /* fallthrough */ }
    localStorage.setItem('mopai_settings', JSON.stringify(settings));
  }

  function deepMerge(base, ext) {
    Object.keys(ext || {}).forEach((k) => {
      if (ext[k] && typeof ext[k] === 'object' && !Array.isArray(ext[k])) {
        base[k] = deepMerge(base[k] || {}, ext[k]);
      } else base[k] = ext[k];
    });
    return base;
  }

  /** 与「一键排版」一致的预处理选项(预览 / 复制兜底 / 实际注入共用,保证所见即所得) */
  function fmtNormalizeOptions() {
    return {
      padSpaces: settings.rules.pad,
      punct: true,
      blank: settings.rules.blank !== false,
      footnote: settings.rules.footnote !== false,
      ellipsis: settings.rules.ellipsis !== false,
      collapse: settings.rules.collapse === true,
      vars: window.MoPaiThemes.getTheme(settings.theme).vars,
    };
  }

  /** 主题相关覆盖项(预览 / 套主题共用) */
  function fmtThemeOverrides() {
    return { fontSize: settings.fontSize, lineHeight: settings.lineHeight, letterSpacing: settings.letterSpacing, imgRadius: settings.imgRadius, sidePad: settings.sidePad };
  }

  // ---------------- 编辑器定位与注入 ----------------

  function findEditor() {
    const isTitleEl = (el) => {
      const sig = ((el.id || '') + ' ' + (el.className || '')).toLowerCase().trim();
      return /js_title|appmsg-title|^title(\s|$)|rich_media_title|title-input|prose-title|jr-title/.test(sig);
    };

    // 收集全部候选:已知编辑器类名 + 通用 contenteditable(公众号新版编辑器标题也是 ProseMirror,必须按内容量区分)
    const pool = Array.from(
      document.querySelectorAll('.ProseMirror[contenteditable="true"], .ql-editor[contenteditable="true"], div[contenteditable="true"], body[contenteditable="true"]')
    );
    const cands = [];
    pool.forEach((el) => {
      const sig = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
      if (/mopai/.test(sig)) return;
      if (isTitleEl(el)) return; // 标题不算正文
      const rect = el.getBoundingClientRect();
      cands.push({ el, text: (el.textContent || '').trim().length, area: rect.width * rect.height });
    });
    // 去嵌套:保留最外层候选(内层是外层的子节点时丢弃,避免重复计分)
    const outer = cands.filter((c) => !cands.some((o) => o !== c && o.el.contains(c.el)));
    if (outer.length) {
      // 正文优先:文本量足够多的候选里选字数最多的;都很少(如刚新建的空文章)则选面积最大的
      const withText = outer.filter((c) => c.text >= 50);
      if (withText.length) return withText.sort((a, b) => b.text - a.text)[0].el;
      return outer.sort((a, b) => b.area - a.area)[0].el;
    }
    // 老版 ueditor iframe
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const b = f.contentDocument && f.contentDocument.body;
        if (b && (b.isContentEditable || b.getAttribute('contenteditable') === 'true')) return b;
      } catch (e) { /* 跨域忽略 */ }
    }
    return null;
  }

  function getEditorRoot() {
    const ed = findEditor();
    if (ed) {
      const wrap = document.createElement('div');
      wrap.innerHTML = ed.innerHTML;
      return wrap;
    }
    // 非编辑器场景:已发布的公众号文章页,直接抓取正文
    return getArticlePageRoot();
  }

  /** 已发布文章页抓取:#js_content / .rich_media_content,处理懒加载图片 */
  function getArticlePageRoot() {
    const el = document.querySelector('#js_content') || document.querySelector('.rich_media_content');
    if (!el) return null;
    const wrap = document.createElement('div');
    wrap.innerHTML = el.innerHTML;
    // 公众号文章页图片懒加载:src 可能是占位图,真实地址在 data-src
    wrap.querySelectorAll('img[data-src]').forEach((img) => {
      const real = img.getAttribute('data-src');
      if (real && real.startsWith('http') && !/^https?:/.test(img.getAttribute('src') || '')) {
        img.setAttribute('src', real);
      }
      img.removeAttribute('data-src');
    });
    wrap.querySelectorAll('img').forEach((img) => img.removeAttribute('loading'));
    return wrap;
  }

  /** 提取封面图:文章页用 msg_cdn_url / og:image / 封面节点;编辑页没有则返回 null(由正文首图兜底) */
  function getArticleCover() {
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content && og.content.startsWith('http')) return og.content;
    const m = (document.documentElement.innerHTML || '').match(/msg_cdn_url\s*=\s*['"]([^'"]+)['"]/);
    if (m && m[1]) return m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    const coverImg = document.querySelector('#js_cover img, img.rich_media_cover');
    if (coverImg && coverImg.src && coverImg.src.startsWith('http')) return coverImg.src;
    return null;
  }

  /** 从 HTML 里取第一张图作为封面兜底 */
  function firstImageOf(html) {
    const m = /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(html || '');
    return m ? m[1] : null;
  }

  /** 模拟 Ctrl/Cmd+A 键盘事件:ProseMirror 会拦截 keydown 并把内部选区设为全选 */
  function pressSelectAll(ed) {
    try {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
      ed.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a', code: 'KeyA', keyCode: 65, which: 65,
        bubbles: true, cancelable: true,
        ...(mac ? { metaKey: true } : { ctrlKey: true }),
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 模拟 Ctrl/Cmd+Z:让编辑器撤销上一次操作(粘贴内容重复时的自动回退) */
  function pressUndo(ed) {
    try {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
      ed.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', keyCode: 90, which: 90,
        bubbles: true, cancelable: true,
        ...(mac ? { metaKey: true } : { ctrlKey: true }),
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 在编辑器内全选内容(等价手动 Ctrl+A;兼容 iframe 内编辑器) */
  function selectAllInEditor(ed) {
    const doc = ed.ownerDocument || document;
    ed.focus();
    // 1) 键盘事件路径:ProseMirror 等编辑器拦截 keydown,内部选区直接变全选
    pressSelectAll(ed);
    // 2) DOM Range 全选(selectionchange 后会被同步为内部全选)
    try {
      const win = doc.defaultView || window;
      const sel = win.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把富文本 HTML 写入系统剪贴板(Async Clipboard API,需页面处于用户手势上下文);
   * 失败时降级 execCommand('copy')。返回是否成功。
   */
  async function copyRichHtml(html) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        return true;
      }
    } catch (e) { /* 降级 */ }
    try {
      const box = document.createElement('div');
      box.contentEditable = 'true';
      box.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap;';
      box.innerHTML = html;
      document.body.appendChild(box);
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      box.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把 HTML 注入编辑器:全选 → 等内部选区同步 → 合成 paste → execCommand → innerHTML 多级降级。
   * ProseMirror 的"DOM 选区 → 内部选区"同步是异步的(selectionchange),
   * 全选后必须等一拍再粘贴,否则内部选区还在光标处,粘贴会变成追加导致整篇重复。
   * 粘贴后做重复检测,疑似追加时模拟 Ctrl/Cmd+Z 撤销并用更长延迟重试一次。
   */
  async function injectHtml(html) {
    const ed = findEditor();
    if (!ed) return { ok: false, reason: '未找到编辑器' };
    const plainLen = (html.replace(/<[^>]+>/g, '').replace(/\s+/g, '') || '').length;

    const dispatchPaste = () => {
      try {
        const dt = new DataTransfer();
        dt.setData('text/html', html);
        dt.setData('text/plain', html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        ed.dispatchEvent(ev);
        return true;
      } catch (e) { return false; }
    };
    const editorTextLen = () => ((ed.innerText || '').replace(/\s+/g, '')).length;

    ed.focus();
    selectAllInEditor(ed);
    await new Promise((r) => setTimeout(r, 120)); // 等 PM 把全选同步成内部 AllSelection

    // 1) 合成 paste(ProseMirror 等现代编辑器的正规入口;全选状态下粘贴=整篇替换)
    if (dispatchPaste()) {
      await new Promise((r) => setTimeout(r, 180));
      if (plainLen && editorTextLen() > plainLen * 1.6) {
        // 疑似"追加"而非"替换":撤销本次粘贴,延长同步时间重试一次
        pressUndo(ed);
        await new Promise((r) => setTimeout(r, 150));
        selectAllInEditor(ed);
        await new Promise((r) => setTimeout(r, 300));
        dispatchPaste();
        await new Promise((r) => setTimeout(r, 180));
        if (editorTextLen() > plainLen * 1.6) return { ok: true, dup: true };
      }
      return { ok: true, via: 'paste' };
    }
    // 2) execCommand(必须用编辑器所在文档;iframe 编辑器在主文档上执行会失效)
    try {
      const doc = ed.ownerDocument || document;
      doc.execCommand('insertHTML', false, html);
      return { ok: true, via: 'execCommand' };
    } catch (e) { /* 降级 */ }
    // 3) 直接写 DOM
    ed.innerHTML = html;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return { ok: true, via: 'dom' };
  }

  async function saveSnapshot(html) {
    const snap = { html, ts: Date.now() };
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ mopai_snapshot: snap });
        return;
      }
    } catch (e) { /* fallthrough */ }
    try { localStorage.setItem('mopai_snapshot', JSON.stringify(snap)); } catch (e) { /* 内容过长忽略 */ }
  }

  async function loadSnapshot() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        const d = await chrome.storage.local.get('mopai_snapshot');
        return (d && d.mopai_snapshot) || null;
      }
    } catch (e) { /* fallthrough */ }
    try { return JSON.parse(localStorage.getItem('mopai_snapshot') || 'null'); } catch (e) { return null; }
  }

  // ---- 快照历史(自动防丢稿:最多保留 10 份) ----

  const SNAP_HIST_MAX = 10;

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
    return String(h);
  }

  async function getSnapHistory() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        const d = await chrome.storage.local.get('mopai_snap_hist');
        return (d && d.mopai_snap_hist) || [];
      }
    } catch (e) { /* fallthrough */ }
    try { return JSON.parse(localStorage.getItem('mopai_snap_hist') || '[]'); } catch (e) { return []; }
  }

  async function setSnapHistory(hist) {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ mopai_snap_hist: hist });
        return;
      }
    } catch (e) { /* fallthrough */ }
    try { localStorage.setItem('mopai_snap_hist', JSON.stringify(hist)); } catch (e) { /* 超限忽略 */ }
  }

  /** 内容有变化才入栈,内容相同去重 */
  async function pushSnapshotHistory(html) {
    if (!html || html.length < 20) return false;
    const sig = simpleHash(html);
    const hist = await getSnapHistory();
    if (hist.length && hist[0].sig === sig) return false;
    hist.unshift({ sig, html, ts: Date.now(), size: html.length });
    if (hist.length > SNAP_HIST_MAX) hist.length = SNAP_HIST_MAX;
    await setSnapHistory(hist);
    return true;
  }

  /** 自动快照:编辑页内每 90 秒检查一次,内容有变化才存 */
  setInterval(() => {
    if (!settings) return;
    const src = getEditorRoot();
    if (src) pushSnapshotHistory(src.innerHTML).catch(() => {});
  }, 90000);

  // ---------------- 工具 ----------------

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 与后台 service worker 通信(harness 环境无 chrome.runtime 时优雅降级) */
  function sendBg(type, payload) {
    return new Promise((resolve) => {
      try {
        if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
          return resolve({ ok: false, error: '此功能需要完整插件环境(请加载扩展后使用)' });
        }
        chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (resp) => {
          void chrome.runtime.lastError; // 显式读取,避免未检查告警
          resolve(resp || { ok: false, error: '后台无响应,请在扩展管理页重新加载插件' });
        });
      } catch (e) {
        resolve({ ok: false, error: '插件后台不可用:' + e.message });
      }
    });
  }

  /** 从编辑页或已发布文章页读取文章标题(标题输入框/文章标题 → 正文首个标题 → 页面标题) */
  function getArticleTitle() {
    const sels = [
      '#title', '.js_title',
      '#activity-name', '.rich_media_title', // 已发布文章页标题
      'textarea[placeholder*="标题"]',
      'div[contenteditable="true"][data-placeholder*="标题"]',
      'div[contenteditable="true"][placeholder*="标题"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el ? (el.value || el.textContent || '').trim() : '';
      if (t) return t.slice(0, 64);
    }
    const ed = findEditor();
    if (ed) {
      const h = ed.querySelector('h1,h2');
      const t = h ? h.textContent.trim() : '';
      if (t) return t.slice(0, 64);
    }
    return (document.title || '').replace(/_?微信公众平台.*$/, '').replace(/(微信公众号|平台)+$/, '').trim() || '未命名文章';
  }

  // ---------------- AI 配置状态(使用 AI 功能前的前置检测) ----------------

  /** 元素是否可见(过滤隐藏的旧版输入框,防止写进 display:none 的节点) */
  function isVisibleEl(el) {
    try {
      return !!(el.offsetParent || el.getClientRects().length);
    } catch (e) { return true; }
  }

  /** 定位公众号编辑页的标题输入元素 */
  function getTitleEl() {
    const sels = [
      '.title-input', // 新版编辑器标题框(ProseMirror)优先
      'div[contenteditable="true"][data-placeholder*="标题"]',
      'div[contenteditable="true"][placeholder*="标题"]',
      '#title', '.js_title',
      'textarea[placeholder*="标题"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisibleEl(el)) return el;
    }
    return null;
  }

  /**
   * 向可编辑元素写入纯文本(async)。与正文注入同款管线:
   * 聚焦 → 键盘全选(等 PM 内部同步) → 合成 paste → 回读验证,
   * 失败则撤销重试,再降级 execCommand insertText / textContent,每步都验证。
   */
  async function writeEditableText(el, text) {
    const isField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    const probe = text.slice(0, 12);
    const notify = () => {
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) { /* ignore */ }
    };
    const has = () => {
      const t = (el.innerText || el.textContent || el.value || '').replace(/\s+/g, '');
      return t.includes(probe.replace(/\s+/g, ''));
    };

    if (isField) {
      el.focus();
      el.value = text;
      notify();
      return true;
    }

    const dispatchPaste = () => {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        return true;
      } catch (e) { return false; }
    };

    // 1) 合成 paste(ProseMirror 认可的输入通道)
    try {
      el.focus();
      selectAllInEditor(el);
      await new Promise((r) => setTimeout(r, 150));
      if (dispatchPaste()) {
        await new Promise((r) => setTimeout(r, 180));
        if (has()) { notify(); return true; }
        // 疑似没替换成功:撤销本次,延长同步时间再试一次
        pressUndo(el);
        await new Promise((r) => setTimeout(r, 150));
        selectAllInEditor(el);
        await new Promise((r) => setTimeout(r, 300));
        dispatchPaste();
        await new Promise((r) => setTimeout(r, 180));
        if (has()) { notify(); return true; }
      }
    } catch (err) { /* 降级 */ }

    // 2) execCommand insertText
    try {
      el.focus();
      selectAllInEditor(el);
      await new Promise((r) => setTimeout(r, 120));
      if (document.execCommand('insertText', false, text)) {
        notify();
        await new Promise((r) => setTimeout(r, 80));
        if (has()) return true;
      }
    } catch (err) { /* 降级 */ }

    // 3) 直接写 textContent(老编辑器兜底)
    try {
      el.focus();
      el.textContent = text;
      notify();
      await new Promise((r) => setTimeout(r, 80));
      return has();
    } catch (err) { return false; }
  }

  /** 把 AI 生成的标题写进公众号标题框;返回是否成功 */
  async function setArticleTitle(text) {
    const el = getTitleEl();
    if (!el) return false;
    return writeEditableText(el, text);
  }

  /** 定位摘要输入框(发布设置侧栏);找不到返回 null */
  function getDigestEl() {
    const sels = [
      '#digest',
      'div[contenteditable="true"][data-placeholder*="摘要"]',
      'div[contenteditable="true"][placeholder*="摘要"]',
      'textarea[placeholder*="摘要"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisibleEl(el)) return el;
    }
    return null;
  }

  /** 把 AI 生成的摘要写进摘要框;返回是否成功 */
  async function setArticleDigest(text) {
    const el = getDigestEl();
    if (!el) return false;
    return writeEditableText(el, text);
  }

  function openOptionsPage() {
    // 设置页是扩展内部页面,内容脚本直接 window.open 会被 Chrome 拦截;
    // 走后台 Service Worker 调官方 openOptionsPage API 打开
    sendBg('mopai-open-options').catch(() => {});
  }

  /** 检测 AI 模型是否已配置好;返回 {ok, missing[], provider, model, host} */
  function getAiStatus() {
    const ai = (settings && settings.ai) || {};
    const provider = ai.provider || 'aitools';
    const missing = [];
    if (!ai.baseUrl) missing.push('接口地址');
    if (!ai.model) missing.push('模型');
    const keyless = provider === 'ollama'; // 本地服务无需 Key
    if (!ai.apiKey && !keyless) missing.push('API Key');
    let host = '';
    try { host = ai.baseUrl ? new URL(ai.baseUrl).host : ''; } catch (e) { host = ''; }
    return { ok: missing.length === 0, missing, provider, model: ai.model || '', host };
  }

  /** AI 功能页顶部的配置状态条:未配置 → 引导横幅;已配置 → 当前模型信息 */
  function aiStatusHtml(st) {
    if (!st.ok) {
      return `<div class="mopai-ai-banner">
        <div class="mopai-ai-banner-text">🤖 <b>使用 AI 功能前,请先配置 AI 模型</b><br>
        <span>缺少:${esc(st.missing.join('、'))} · 打开设置页选服务商、填 Key、点「测试连接」即可</span></div>
        <button class="mopai-btn primary" data-act="open-ai-settings">去设置</button>
      </div>`;
    }
    return `<div class="mopai-ai-status">🤖 当前模型:<b>${esc(st.model)}</b> @ ${esc(st.host || st.provider)}</div>`;
  }

  async function copyRich(html, plain) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain || ''], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch (e) { /* 降级 execCommand */ }
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = html;
    div.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    div.remove();
    return ok;
  }

  function toast(msg, type) {
    let t = document.querySelector('.mopai-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'mopai-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'mopai-toast show' + (type === 'err' ? ' err' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function debounce(fn, ms) {
    let h;
    return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  }

  // ---------------- 发布前检查 ----------------

  function runChecks(root) {
    const items = [];
    const add = (level, title, detail) => items.push({ level, title, detail });
    const text = (root.textContent || '').replace(/\u00a0/g, ' ');

    // 0. 标题(公众号编辑页的标题输入框)
    const title = getArticleTitle();
    if (!title || title === '未命名文章') {
      add('warn', '未检测到文章标题', '标题是信息流点击率的第一要素,请先填写');
    } else if (title.length > 64) {
      add('warn', `标题 ${title.length} 字,超过微信 64 字上限,发布时会被截断`, esc(title.slice(0, 40)) + '…');
    } else if (title.length > 30) {
      add('info', `标题 ${title.length} 字,手机信息流约显示 13~30 字`, '重要信息尽量放在前 13 字');
    } else {
      add('ok', `标题 ${title.length} 字,长度健康`);
    }

    // 1. 违禁词(分类词库 + 正则规则 + 自定义词)
    const hits = window.MoPaiWords ? window.MoPaiWords.scan(text, settings.customWords) : [];
    if (hits.length) {
      const high = hits.filter((h) => h.level === 'high').length;
      const catName = { extreme: '极限词', promise: '承诺', finance: '金融', medical: '医疗', engage: '导流', rush: '紧迫', custom: '自定义' };
      const lines = hits.slice(0, 8).map((h) =>
        `「${esc(h.word)}」(${esc(catName[h.cat] || h.cat)})…${esc(h.ctx)}…`).join('<br>');
      add(high ? 'warn' : 'info',
        `发现 ${hits.length} 处疑似风险词${high ? `(高危 ${high})` : ''}`, lines);
    } else {
      add('ok', '违禁词扫描通过', `未发现内置词库(${window.MoPaiWords ? window.MoPaiWords.TOTAL : 0} 词 + 正则规则 + 自定义)中的词`);
    }

    // 2. 外链
    const extLinks = [];
    const emptyLinks = [];
    root.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || /^javascript:/i.test(href)) {
        if ((a.textContent || '').trim()) emptyLinks.push(a.textContent.trim().slice(0, 12));
        return;
      }
      if (/^https?:\/\//i.test(href) && !/mp\.weixin\.qq\.com/i.test(href)) extLinks.push(href);
    });
    if (emptyLinks.length) {
      add('warn', `${emptyLinks.length} 个空链接(无 href 或 #),读者点击无响应`, '示例:' + esc(emptyLinks.slice(0, 3).join('、')));
    }
    if (extLinks.length) {
      add('warn', `${extLinks.length} 条外部链接,正文里读者点不开`, esc(extLinks.slice(0, 3).join('<br>')) + '<br>建议:排版 → 外链转脚注');
    } else if (!emptyLinks.length) {
      add('ok', '外链检查通过', '没有会让读者干着急的外部链接');
    }

    // 3. 图片防盗链风险
    const imgs = Array.from(root.querySelectorAll('img[src]'));
    const badImgs = imgs.filter((im) => {
      const src = im.getAttribute('src') || '';
      return /^https?:\/\//i.test(src) && !/mmbiz\.qpic\.cn|mp\.weixin\.qq\.com/i.test(src);
    });
    if (badImgs.length) {
      add('warn', `${badImgs.length} 张外站图片可能被微信拦截`, '微信编辑器粘贴时通常会自动转存;发布前请预览确认图片能显示');
    } else add('ok', '图片域名检查通过', imgs.length ? `共 ${imgs.length} 张图片` : '文中没有图片');

    // 4. 空段落
    let empties = 0;
    Array.from(root.children).forEach((el) => {
      if (el.tagName === 'P' && !el.querySelector('img,video,iframe') && !(el.textContent || '').replace(/\s|\u00a0/g, '')) empties++;
    });
    if (empties >= 3) add('info', `${empties} 个空段落`, '手机上会显得很散,可用「排版 → 压缩空行」');
    else add('ok', '空段落正常', empties ? `${empties} 个,可接受` : '没有空段落');

    // 5. 标题层级
    const h = { h1: 0, h2: 0, h3: 0 };
    root.querySelectorAll('h1,h2,h3').forEach((el) => h[el.tagName.toLowerCase()]++);
    if (h.h2 + h.h3 === 0) add('info', '没有小标题', '手机阅读场景下,2~4 个小标题能显著提升读完率');
    else add('ok', '标题结构', `H1×${h.h1} · H2×${h.h2} · H3×${h.h3}`);

    // 6. 超长段落
    const longPs = Array.from(root.querySelectorAll('p')).filter((p) => (p.textContent || '').length > 350);
    if (longPs.length) {
      add('info', `${longPs.length} 个段落超过 350 字`, '建议拆分,手机屏上一大段字很容易划走');
    } else add('ok', '段落长度健康', '没有超长段落');

    // 7. 空格对齐(手机端会错位)
    const alignSpaces = (text.match(/\u3000/g) || []).length + (text.match(/ {3,}/g) || []).length;
    if (alignSpaces > 0) {
      add('info', `${alignSpaces} 处连续空格/全角空格对齐`, '手机字体渲染下会错位,建议删掉用段落间距代替');
    } else add('ok', '空格对齐检查通过');

    // 8. 中英混排空格(检测原始状态)
    const junction = (text.match(new RegExp(`[\\u4e00-\\u9fff][A-Za-z0-9]|[A-Za-z0-9][\\u4e00-\\u9fff]`, 'g')) || []).length;
    if (junction > 4) add('info', `${junction} 处中西文之间没加空格`, '用「排版 → 一键规范」自动补齐');

    const st = window.MoPaiTypo.analyzeText(root);
    add(st.readMinutes >= 8 ? 'info' : 'ok', '篇幅', `约 ${st.cjkChars} 中文字,预计阅读 ${st.readMinutes} 分钟` + (st.readMinutes >= 8 ? '(偏长)' : ''));

    // 体检汇总
    const warn = items.filter((i) => i.level === 'warn').length;
    const info = items.filter((i) => i.level === 'info').length;
    const ok = items.length - warn - info;
    items.unshift({
      level: warn ? 'warn' : 'info',
      title: `体检汇总:${ok} 项通过 · ${info} 项建议 · ${warn} 项待处理`,
      detail: warn ? '建议先处理 ⚠️ 项再发布' : info ? '都是锦上添花的建议,可以发布' : '',
    });

    return items;
  }

  // ---------------- UI ----------------

  let settings = null;
  let panelEl = null;
  let fabEl = null;
  let previewSrc = 'editor'; // 'editor' | 'md'
  let lastMdHtml = '';

  const TABS = [
    ['import', '导入'], ['format', '排版'], ['ai', 'AI写'], ['check', '检查'],
    ['sync', '同步'], ['stats', '统计'], ['preview', '预览'],
  ];

  function ensureFab() {
    if (fabEl || !settings.fabEnabled) return;
    fabEl = document.createElement('div');
    fabEl.className = 'mopai-fab';
    fabEl.innerHTML = '<span>牛</span>';
    fabEl.title = '牛哥公众号助手';
    document.body.appendChild(fabEl);
    // 拖拽 + 点击
    let sx = 0, sy = 0, moved = false, dragging = false;
    fabEl.addEventListener('pointerdown', (e) => {
      sx = e.clientX; sy = e.clientY; moved = false; dragging = true;
      try { fabEl.setPointerCapture(e.pointerId); } catch (err) { /* 环境不支持则忽略 */ }
    });
    fabEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) {
        const curTop = parseFloat(getComputedStyle(fabEl).top);
        const base = isNaN(curTop) ? window.innerHeight * 0.45 : curTop;
        fabEl.style.top = Math.min(window.innerHeight - 60, Math.max(12, base + dy)) + 'px';
        sx = e.clientX; sy = e.clientY;
      }
    });
    fabEl.addEventListener('pointerup', () => {
      dragging = false;
      if (!moved) togglePanel();
    });
  }

  function togglePanel() {
    if (panelEl && panelEl.isConnected) {
      panelEl.remove();
      panelEl = null;
      fabEl.classList.remove('active');
      return;
    }
    buildPanel();
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'mopai-panel';
    panelEl.innerHTML = `
      <div class="mopai-head">
        <span class="mopai-logo">牛哥</span>
        <span class="mopai-sub">公众号一站式创作助手</span>
        <span class="mopai-head-actions">
          <button class="mopai-icon-btn" data-act="settings" title="设置">⚙</button>
          <button class="mopai-icon-btn" data-act="close" title="收起">×</button>
        </span>
      </div>
      <div class="mopai-tabs">${TABS.map(([id, label], i) =>
        `<button class="mopai-tab${i === 0 ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="mopai-body" id="mopai-body"></div>
    `;
    document.body.appendChild(panelEl);
    fabEl && fabEl.classList.add('active');

    panelEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.mopai-tab');
      if (tab) {
        panelEl.querySelectorAll('.mopai-tab').forEach((b) => b.classList.toggle('on', b === tab));
        renderTab(tab.dataset.tab);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'close') togglePanel();
      if (act && act.dataset.act === 'settings') openOptionsPage();
    });

    // 头部拖拽移动面板
    const head = panelEl.querySelector('.mopai-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const startX = e.clientX, startY = e.clientY;
      const rect = panelEl.getBoundingClientRect();
      const move = (ev) => {
        panelEl.style.left = Math.max(8, rect.left + ev.clientX - startX) + 'px';
        panelEl.style.top = Math.max(8, rect.top + ev.clientY - startY) + 'px';
        panelEl.style.right = 'auto';
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });

    renderTab('import');
  }

  function body() { return panelEl.querySelector('#mopai-body'); }

  /** 每个标签页渲染到全新子容器,避免重复绑定事件 */
  function pane(el) {
    const p = document.createElement('div');
    p.className = 'mopai-pane';
    el.innerHTML = '';
    el.appendChild(p);
    return p;
  }

  function editorMissingHint() {
    return `<div class="mopai-empty">没检测到图文编辑器。<br>请先打开「图文消息 → 新建图文」,再点此重试。<br><button class="mopai-btn ghost" data-act="retry-editor">重试检测</button></div>`;
  }

  async function renderTab(tab) {
    const el = body();
    if (!el) return;
    if (tab === 'import') return renderImport(el);
    if (tab === 'format') return renderFormat(el);
    if (tab === 'ai') return renderAi(el);
    if (tab === 'check') return renderCheck(el);
    if (tab === 'sync') return renderSync(el);
    if (tab === 'stats') return renderStats(el);
    if (tab === 'preview') return renderPreview(el);
  }

  // ----- Tab: 导入 -----

  function renderImport(el) {
    const p = pane(el);
    p.innerHTML = `
      <textarea class="mopai-md" id="mopai-md-input" placeholder="在这里粘贴 Markdown,右侧手机预览随时可看效果…"></textarea>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="inject-md">⬇ 注入编辑器</button>
        <button class="mopai-btn" data-act="copy-md">复制富文本</button>
        <button class="mopai-btn ghost" data-act="sample">示例</button>
        <button class="mopai-btn ghost" data-act="clear-md">清空</button>
      </div>
      <div class="mopai-report" id="mopai-md-report">输入 Markdown 后自动渲染预览</div>
      <div class="mopai-mini-preview" id="mopai-md-preview"></div>
    `;
    const ta = p.querySelector('#mopai-md-input');
    const preview = p.querySelector('#mopai-md-preview');
    const report = p.querySelector('#mopai-md-report');

    const doRender = debounce(() => {
      const md = ta.value.trim();
      if (!md) { preview.innerHTML = ''; report.textContent = '输入 Markdown 后自动渲染预览'; lastMdHtml = ''; return; }
      try {
        const r = window.MoPaiRender.renderMarkdown(md, settings.theme, {
          fontSize: settings.fontSize, lineHeight: settings.lineHeight, letterSpacing: settings.letterSpacing, imgRadius: settings.imgRadius, sidePad: settings.sidePad,
          padSpaces: settings.rules.pad, punct: settings.rules.punct,
          blank: settings.rules.blank, footnote: settings.rules.footnote,
          ellipsis: settings.rules.ellipsis !== false, collapse: settings.rules.collapse === true,
        });
        lastMdHtml = r.html;
        preview.innerHTML = `<div class="mopai-render-wrap">${r.html}</div>`;
        preview.style.fontFamily = window.MoPaiThemes.BASE_FONT;
        report.innerHTML = `✅ ${r.report.spaces || 0} 处排版修正${r.report.ellipsis ? `(${r.report.ellipsis} 省略号)` : ''} · ${r.report.footnotes || 0} 条外链转脚注 · ${r.report.highlighted || 0} 段代码高亮`;
      } catch (e) {
        report.textContent = '渲染失败:' + e.message;
      }
    }, 300);
    ta.addEventListener('input', doRender);

    p.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'sample') { ta.value = SAMPLE_MD; ta.dispatchEvent(new Event('input')); }
      if (act === 'clear-md') { ta.value = ''; ta.dispatchEvent(new Event('input')); }
      if (act === 'copy-md') {
        if (!lastMdHtml) return toast('先输入 Markdown', 'err');
        const ok = await copyRich(lastMdHtml, ta.value);
        toast(ok ? '已复制,去公众号编辑器 Ctrl/Cmd+V 粘贴' : '复制失败', ok ? undefined : 'err');
      }
      if (act === 'inject-md') {
        if (!lastMdHtml) return toast('先输入 Markdown', 'err');
        const cur = getEditorRoot();
        await saveSnapshot(cur ? cur.innerHTML : '');
        const r = await injectHtml(lastMdHtml);
        if (r.ok) {
          toast(r.via === 'paste' ? '已注入编辑器 ✅' : '已注入(兼容模式),请检查内容');
          lastMdHtml = '';
          ta.value = '';
          preview.innerHTML = '';
        } else {
          toast(r.reason + ',已复制到剪贴板,请手动粘贴', 'err');
          await copyRich(lastMdHtml, ta.value);
        }
      }
    });
  }

  // ----- Tab: 排版 -----

  function renderFormat(el) {
    const p = pane(el);
    const themes = window.MoPaiThemes.THEMES;
    p.innerHTML = `
      <div class="mopai-section-title">① 一键规范 · 文字与结构</div>
      <div class="mopai-cards">
        <button class="mopai-card-btn" data-act="fmt-all">✨ 一键规范排版<span>中英空格 · 全角标点 · 省略号 · 压缩空行 · 外链脚注 · 套主题</span></button>
        <div class="mopai-row">
          <button class="mopai-btn" data-act="fmt-space">🀄 空格+标点</button>
          <button class="mopai-btn" data-act="fmt-blank">🧹 压缩空行</button>
          <button class="mopai-btn" data-act="fmt-footnote">📎 外链脚注化</button>
        </div>
        <div class="mopai-row">
          <button class="mopai-btn" data-act="copy-rich">📋 复制排版结果</button>
          <span class="mopai-sub">注入不生效时的兜底:复制后到编辑器 Ctrl+A 再 Ctrl+V</span>
        </div>
      </div>
      <div class="mopai-report" id="mopai-fmt-report"></div>

      <div class="mopai-section-title">② 主题美化 · 视觉</div>
      <div class="mopai-theme-grid">${themes.map((t) => `
        <button class="mopai-theme-card${t.id === settings.theme ? ' on' : ''}" data-theme="${t.id}" title="${esc(t.desc)}">
          <span class="mopai-theme-dots"><i style="background:${t.vars.primary}"></i><i style="background:${t.vars.blockBar}"></i><i style="background:${t.vars.inlineCodeText}"></i></span>
          <b>${esc(t.name)}</b><small>${esc(t.desc)}</small>
        </button>`).join('')}
      </div>
      <div class="mopai-custom-box" id="mopai-custom-box"${settings.theme === 'custom' ? '' : ' hidden'}>
        <div class="mopai-custom-grid">
          ${[
            ['primary', '主色 · 标题/表头'], ['strong', '强调色 · 加粗'], ['text', '正文颜色'], ['secondary', '次要文字'],
            ['blockBg', '引用底色'], ['blockBar', '引用色条'], ['link', '链接颜色'], ['border', '分割线/边框'],
          ].map(([k, label]) => `
            <label class="mopai-color-item"><span>${label}</span>
              <input type="color" id="mopai-ct-${k}" value="${esc(settings.customTheme[k] || '#000000')}">
            </label>`).join('')}
        </div>
        <div class="mopai-slider-row"><label>标题风格</label>
          <select id="mopai-ct-flavor" class="mopai-select">
            <option value="bar-h2"${settings.customTheme.flavor === 'bar-h2' ? ' selected' : ''}>居中标题 + 底线</option>
            <option value="center-h1"${settings.customTheme.flavor === 'center-h1' ? ' selected' : ''}>居中主标题 + 主色</option>
            <option value="plain"${settings.customTheme.flavor === 'plain' ? ' selected' : ''}>极简左对齐(无色条)</option>
          </select>
        </div>
        <div class="mopai-report">颜色改动即时预览并自动保存;满意后点「套用主题到编辑器」写入正文</div>
      </div>
      <div class="mopai-slider-row"><label>字号 <b id="mopai-fs-val">${settings.fontSize}</b>px</label>
        <input type="range" id="mopai-fs" min="13" max="18" step="1" value="${settings.fontSize}"></div>
      <div class="mopai-slider-row"><label>行距 <b id="mopai-lh-val">${settings.lineHeight}</b></label>
        <input type="range" id="mopai-lh" min="150" max="300" step="25" value="${Math.round(settings.lineHeight * 100)}"></div>
      <div class="mopai-slider-row"><label>字间距 <b id="mopai-ls-val">${settings.letterSpacing}</b>px</label>
        <input type="range" id="mopai-ls" min="0" max="3" step="0.5" value="${settings.letterSpacing}"></div>
      <div class="mopai-slider-row"><label>图片圆角 <b id="mopai-ir-val">${settings.imgRadius}</b>px</label>
        <input type="range" id="mopai-ir" min="0" max="16" step="1" value="${settings.imgRadius}"></div>
      <div class="mopai-slider-row"><label>两侧边距 <b id="mopai-sp-val">${settings.sidePad}</b>px</label>
        <input type="range" id="mopai-sp" min="0" max="32" step="2" value="${settings.sidePad}"></div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="apply-theme">✅ 套用主题到编辑器</button>
        <button class="mopai-btn ghost" data-act="toggle-preview">📱 预览 开/关</button>
      </div>
      <div class="mopai-report" id="mopai-beauty-report">点主题卡片即时预览(不改编辑器),满意再套用</div>
      <div class="mopai-phone-wrap" id="mopai-preview-wrap"><div class="mopai-phone"><iframe id="mopai-beauty-iframe"></iframe></div></div>

      <div class="mopai-section-title">③ 防丢稿 · 快照</div>
      <div class="mopai-row">
        <button class="mopai-btn ghost" data-act="restore-snap">⏱ 恢复上次快照</button>
        <button class="mopai-btn ghost" data-act="toggle-hist">🕘 快照历史(自动留档)</button>
      </div>
      <div class="mopai-snap-list" id="mopai-snap-list" hidden></div>
    `;
    p.addEventListener('click', async (e) => {
      // 主题卡片(无 data-act,先于 act 分流处理)
      const card = e.target.closest('.mopai-theme-card');
      if (card) {
        settings.theme = card.dataset.theme;
        await saveSettings();
        p.querySelectorAll('.mopai-theme-card').forEach((c) => c.classList.toggle('on', c === card));
        const cbox = p.querySelector('#mopai-custom-box');
        if (cbox) cbox.hidden = settings.theme !== 'custom';
        refreshPreview();
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      const report = p.querySelector('#mopai-fmt-report');
      const src = getEditorRoot();
      if (!src && act !== 'restore-snap' && act !== 'toggle-hist' && act !== 'snap-restore' && act !== 'toggle-preview') { p.innerHTML = editorMissingHint(); bindRetry(p); return; }

      if (act === 'toggle-preview') {
        const wrapEl = p.querySelector('#mopai-preview-wrap');
        if (wrapEl) wrapEl.hidden = !wrapEl.hidden;
        return;
      }

      if (act === 'apply-theme') {
        const srcT = getEditorRoot();
        if (!srcT) return toast('未找到编辑器', 'err');
        await saveSnapshot(srcT.innerHTML);
        await pushSnapshotHistory(srcT.innerHTML);
        // 公众号编辑器是 ProseMirror 内核,直接改 DOM 会被其内部状态还原;
        // 必须走"克隆处理 → 全选粘贴整篇替换"的管线(injectHtml 已同步 PM 内部全选)
        const html = window.MoPaiRender.themeExisting(srcT, settings.theme, fmtThemeOverrides());
        await injectHtml(html);
        refreshPreview();
        toast(`已套用「${themeName()}」主题 ✅(注入前已存快照)`);
        return;
      }

      if (act === 'toggle-hist') {
        const listEl = p.querySelector('#mopai-snap-list');
        if (!listEl.hidden) { listEl.hidden = true; return; }
        const hist = await getSnapHistory();
        listEl.hidden = false;
        listEl.innerHTML = hist.length
          ? hist.map((s, i) => `
            <div class="mopai-snap-item">
              <span>${new Date(s.ts).toLocaleString()} · ${(s.size / 1024).toFixed(1)}KB${i === 0 ? ' · 最新' : ''}</span>
              <button class="mopai-btn" data-act="snap-restore" data-snap-restore="${i}">恢复</button>
            </div>`).join('')
          : '<div class="mopai-empty">还没有历史快照。编辑过程中每 90 秒会自动留档一份(最多 10 份)。</div>';
        return;
      }

      if (act === 'snap-restore') {
        const snapBtn = e.target.closest('[data-snap-restore]');
        const hist = await getSnapHistory();
        const snap = hist[parseInt(snapBtn.dataset.snapRestore, 10)];
        if (!snap) return toast('快照不存在', 'err');
        const cur = getEditorRoot();
        if (cur) await saveSnapshot(cur.innerHTML);
        const r = await injectHtml(snap.html);
        toast(r.ok ? '已从历史快照恢复 ✅' : '恢复失败', r.ok ? undefined : 'err');
        return;
      }

      if (act === 'restore-snap') {
        const snap = await loadSnapshot();
        if (!snap) return toast('还没有快照', 'err');
        const cur = getEditorRoot();
        if (cur) await saveSnapshot(cur.innerHTML);
        const r = await injectHtml(snap.html);
        toast(r.ok ? `已恢复 ${new Date(snap.ts).toLocaleTimeString()} 的快照` : '恢复失败', r.ok ? undefined : 'err');
        return;
      }

      if (act === 'copy-rich') {
        // 兜底路径:排版结果写入系统剪贴板,用户手动 Ctrl+V 粘贴(浏览器信任事件,ProseMirror 兼容性最好)
        const clone = src.cloneNode(true);
        window.MoPaiTypo.normalizeExisting(clone, fmtNormalizeOptions());
        window.MoPaiRender.themeExisting(clone, settings.theme, fmtThemeOverrides());
        const ok = await copyRichHtml(clone.innerHTML);
        toast(ok ? '排版结果已复制 ✅ 请到编辑器 Ctrl+V 粘贴(建议先 Ctrl+A 全选)' : '复制失败,请重试', ok ? undefined : 'err');
        return;
      }

      await saveSnapshot(src.innerHTML);
      await pushSnapshotHistory(src.innerHTML);
      const o = {
        padSpaces: act === 'fmt-all' || act === 'fmt-space' ? settings.rules.pad : false,
        punct: act === 'fmt-all' || act === 'fmt-space',
        blank: act === 'fmt-all' || act === 'fmt-blank',
        footnote: act === 'fmt-all' || act === 'fmt-footnote',
        ellipsis: act === 'fmt-all' || act === 'fmt-space' ? settings.rules.ellipsis !== false : false,
        collapse: act === 'fmt-all' && settings.rules.collapse === true,
        vars: window.MoPaiThemes.getTheme(settings.theme).vars,
      };
      // ProseMirror 内核不接受外部 DOM 直改(会被内部状态还原),
      // 故克隆 → 排版处理 → 全选粘贴整篇替换(injectHtml 内已用 execCommand('selectAll') 同步内部选区,不会重复)
      const rep = window.MoPaiTypo.normalizeExisting(src, o);
      if (act === 'fmt-all') {
        window.MoPaiRender.themeExisting(src, settings.theme, fmtThemeOverrides());
      }
      const r = await injectHtml(src.innerHTML);
      report.innerHTML = !r.ok
        ? '写入编辑器失败,请重试(快照已留档)'
        : r.dup
          ? '⚠️ 已写入,但检测到内容疑似重复——请点「恢复快照」回退后再试一次'
          : `✅ 排版成功:${rep.headings} 个小标题识别 · ${rep.spaces} 处文字规范 · ${rep.ellipsis} 处省略号 · ${rep.collapsed} 处标点收敛 · ${rep.blanks} 个空段清理 · ${rep.footnotes} 条外链脚注化`;
      toast(r.ok && !r.dup ? '排版成功 ✅' : r.dup ? '内容疑似重复,建议恢复快照后重试' : '写入失败', r.ok && !r.dup ? undefined : r.dup ? undefined : 'err');
    });

    // 主题预览与字号/行距联动
    const refreshPreview = () => {
      const iframe = p.querySelector('#mopai-beauty-iframe');
      if (!iframe) return;
      const srcP = getEditorRoot();
      if (!srcP) { iframe.srcdoc = '<body style="font-family:sans-serif;color:#999">打开图文编辑页后,这里预览当前主题效果</body>'; return; }
      // 预览必须走和「一键排版」完全相同的管线(先规范化再套主题),
      // 否则编辑器残留的空段/包装层会让预览与实际排版结果出现间距差异
      window.MoPaiTypo.normalizeExisting(srcP, fmtNormalizeOptions());
      iframe.srcdoc = window.MoPaiRender.previewDocument(srcP, settings.theme, fmtThemeOverrides());
    };
    refreshPreview();
    p.querySelector('#mopai-fs').addEventListener('input', async (e) => {
      settings.fontSize = +e.target.value;
      p.querySelector('#mopai-fs-val').textContent = e.target.value;
      await saveSettings(); refreshPreview();
    });
    p.querySelector('#mopai-lh').addEventListener('input', async (e) => {
      settings.lineHeight = +e.target.value / 100;
      p.querySelector('#mopai-lh-val').textContent = settings.lineHeight;
      await saveSettings(); refreshPreview();
    });
    p.querySelector('#mopai-ls').addEventListener('input', async (e) => {
      settings.letterSpacing = +e.target.value;
      p.querySelector('#mopai-ls-val').textContent = e.target.value;
      await saveSettings(); refreshPreview();
    });
    p.querySelector('#mopai-ir').addEventListener('input', async (e) => {
      settings.imgRadius = +e.target.value;
      p.querySelector('#mopai-ir-val').textContent = e.target.value;
      await saveSettings(); refreshPreview();
    });
    p.querySelector('#mopai-sp').addEventListener('input', async (e) => {
      settings.sidePad = +e.target.value;
      p.querySelector('#mopai-sp-val').textContent = e.target.value;
      await saveSettings(); refreshPreview();
    });

    // 自定义主题:颜色实时预览(input),收起取色器时持久化(change)
    const CUSTOM_KEYS = ['primary', 'strong', 'text', 'secondary', 'blockBg', 'blockBar', 'link', 'border'];
    CUSTOM_KEYS.forEach((k) => {
      const inp = p.querySelector(`#mopai-ct-${k}`);
      if (!inp) return;
      inp.addEventListener('input', () => {
        settings.customTheme[k] = inp.value;
        if (window.MoPaiThemes) window.MoPaiThemes.registerCustom(settings.customTheme);
        refreshPreview();
      });
      inp.addEventListener('change', async () => {
        settings.customTheme[k] = inp.value;
        if (window.MoPaiThemes) window.MoPaiThemes.registerCustom(settings.customTheme);
        await saveSettings();
      });
    });
    const flavorSel = p.querySelector('#mopai-ct-flavor');
    if (flavorSel) flavorSel.addEventListener('change', async () => {
      settings.customTheme.flavor = flavorSel.value;
      if (window.MoPaiThemes) window.MoPaiThemes.registerCustom(settings.customTheme);
      await saveSettings(); refreshPreview();
    });
  }

  function bindRetry(el) {
    el.querySelector('[data-act="retry-editor"]')?.addEventListener('click', () => renderTab(panelEl.querySelector('.mopai-tab.on').dataset.tab));
  }

  function themeName() {
    return window.MoPaiThemes.getTheme(settings.theme).name;
  }

  // ----- Tab: AI 校对 -----

  const AI_TYPE_META = {
    typo: { label: '错别字', cls: 'typo' },
    fluency: { label: '语句', cls: 'fluency' },
    punct: { label: '标点', cls: 'punct' },
  };

  let aiMode = 'article'; // article | title | summary(面板会话内记忆)
  let checkMode = 'proof'; // proof | rules | detect(「检查」页三个子功能,面板会话内记忆)

  function renderAi(el) {
    const p = pane(el);
    const st = getAiStatus();
    p.innerHTML = `
      ${aiStatusHtml(st)}
      <div class="mopai-ai-modes">
        <button class="mopai-ai-mode${aiMode === 'article' ? ' on' : ''}" data-ai-mode="article">🪄 写文章</button>
        <button class="mopai-ai-mode${aiMode === 'title' ? ' on' : ''}" data-ai-mode="title">✍️ 标题</button>
        <button class="mopai-ai-mode${aiMode === 'summary' ? ' on' : ''}" data-ai-mode="summary">📝 摘要</button>
      </div>
      <div id="mopai-ai-work"></div>
    `;
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="open-ai-settings"]')) { openOptionsPage(); return; }
      const modeBtn = e.target.closest('[data-ai-mode]');
      if (modeBtn && modeBtn.dataset.aiMode !== aiMode) {
        aiMode = modeBtn.dataset.aiMode;
        renderTab('ai'); // 整页重渲染,状态条也刷新
      }
    });
    renderAiMode(p);
  }

  function renderAiMode(p) {
    const work = p.querySelector('#mopai-ai-work');
    work.innerHTML = '';
    const q = document.createElement('div');
    work.appendChild(q);
    if (aiMode === 'title') renderTitleMode(q);
    else if (aiMode === 'summary') renderSummaryMode(q);
    else renderArticleMode(q);
  }

  /** 取编辑器纯文本(标题/摘要/校对共用) */
  function getEditorTextForAI() {
    const src = getEditorRoot();
    if (!src) return '';
    return (src.innerText || src.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  /** 带限流自动重试的单次 AI 调用(标题/摘要用) */
  async function aiChatOnce(messages, statusEl) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await sendBg('mopai-ai-chunk', { messages });
      if (res.ok) return res;
      if (res.rateLimited) {
        const wait = res.retryAfter || 60;
        for (let s = wait; s > 0; s--) {
          if (statusEl) statusEl.textContent = `接口限流,${s}s 后自动重试…`;
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }
      return res;
    }
    return { ok: false, error: '连续多次限流,请稍后再试' };
  }

  // ----- AI 校对(现位于「检查」标签) -----

  function renderProofMode(q) {
    const st = getAiStatus();
    q.innerHTML = `
      ${aiStatusHtml(st)}
      <div class="mopai-report">AI 校对检查 <b>错别字、语句不通顺、标点误用</b>。长文自动分段连续校对,建议先「排版 → 一键规范」再校对。</div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="ai-run" ${st.ok ? '' : 'disabled title="请先配置 AI 模型"'}>🔍 开始 AI 校对</button>
        <button class="mopai-btn ghost" data-act="ai-stop" hidden>■ 停止</button>
        <button class="mopai-btn ghost" data-act="ai-apply-all" hidden>✔ 全部应用</button>
      </div>
      <div class="mopai-progress" id="mopai-ai-progress" hidden>
        <div class="mopai-progress-bar"><i id="mopai-ai-bar"></i></div>
        <span id="mopai-ai-status">准备中…</span>
      </div>
      <div class="mopai-report" id="mopai-ai-summary" hidden></div>
      <div class="mopai-ai-list" id="mopai-ai-list"></div>
    `;

    const prog = q.querySelector('#mopai-ai-progress');
    const bar = q.querySelector('#mopai-ai-bar');
    const statusEl = q.querySelector('#mopai-ai-status');
    const summary = q.querySelector('#mopai-ai-summary');
    const list = q.querySelector('#mopai-ai-list');
    const stopBtn = q.querySelector('[data-act="ai-stop"]');
    const applyAllBtn = q.querySelector('[data-act="ai-apply-all"]');
    let issues = [];

    const renderIssues = () => {
      if (!issues.length) { list.innerHTML = '<div class="mopai-empty">没有发现需要修改的地方 ✅</div>'; return; }
      list.innerHTML = issues.map((it, i) => {
        const meta = AI_TYPE_META[it.type] || AI_TYPE_META.fluency;
        return `<div class="mopai-ai-item">
          <span class="mopai-ai-badge ${meta.cls}">${meta.label}</span>
          <div class="mopai-ai-body">
            <div class="mopai-ai-diff"><s>${esc(it.original)}</s> → <b>${esc(it.suggestion)}</b></div>
            ${it.reason ? `<div class="mopai-ai-reason">${esc(it.reason)}</div>` : ''}
          </div>
          ${it.applied
            ? '<span class="mopai-ai-done">已应用</span>'
            : `<span class="mopai-ai-actions"><button class="mopai-btn" data-ai-apply="${i}">应用</button></span>`}
        </div>`;
      }).join('');
      applyAllBtn.hidden = issues.every((it) => it.applied);
    };

    const countdown = async (sec, label) => {
      for (let s = sec; s > 0; s--) {
        statusEl.textContent = `${label} ${s}s`;
        if (stopBtn && !stopBtn.hidden) await new Promise((r) => setTimeout(r, 1000));
        else return false;
      }
      return true;
    };

    const run = async () => {
      const st = getAiStatus();
      if (!st.ok) {
        toast('请先到设置页配置 AI 模型:' + st.missing.join('、'), 'err');
        openOptionsPage();
        return;
      }
      const src = getEditorRoot();
      if (!src) { q.innerHTML = editorMissingHint(); bindRetry(q); return; }
      const text = getEditorTextForAI();
      if (text.length < 10) return toast('正文太短,无需校对', 'err');

      const chunks = window.MoPaiAI.chunkArticle(text);
      issues = [];
      prog.hidden = false;
      stopBtn.hidden = false;
      summary.hidden = true;
      list.innerHTML = '';
      let cancelled = false;
      stopBtn.onclick = () => { cancelled = true; stopBtn.hidden = true; statusEl.textContent = '已停止'; };

      for (let ci = 0; ci < chunks.length; ci++) {
        bar.style.width = Math.round((ci / chunks.length) * 100) + '%';
        statusEl.textContent = `校对第 ${ci + 1}/${chunks.length} 段…`;

        let attempt = 0, res = null;
        while (attempt < 3) {
          res = await sendBg('mopai-ai-chunk', { messages: window.MoPaiAI.buildMessages(chunks[ci]) });
          if (res.ok) break;
          if (res.rateLimited) {
            if (!(await countdown(res.retryAfter || 60, '平台限流,等待'))) { cancelled = true; break; }
            attempt++;
            continue;
          }
          break;
        }
        if (cancelled) break;
        if (!res.ok) {
          statusEl.textContent = '出错';
          stopBtn.hidden = true;
          list.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(res.error || '未知错误')}${chunks.length > 1 ? '(已完成的段落结果保留)' : ''}</div>`;
          return;
        }
        const parsed = window.MoPaiAI.parseAiResponse(res.raw);
        if (parsed.error) {
          list.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(parsed.error)}</div>`;
          if (chunks.length === 1) { statusEl.textContent = '完成(解析失败)'; stopBtn.hidden = true; return; }
        }
        // 硬过滤:original 在正文中逐字找不到的(模型幻觉)直接丢弃,不展示
        const fullText = (getEditorRoot() ? getEditorRoot().innerText || '' : '').replace(/\u00a0/g, ' ');
        const kept = parsed.issues.filter((it) => it.original && fullText.includes(it.original));
        issues = issues.concat(kept);
        // 非最后一段:短间隔续跑,避免请求重叠;仅当服务端返回 429 时才按其指示倒计时
        if (ci < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      bar.style.width = '100%';
      statusEl.textContent = '完成';
      stopBtn.hidden = true;
      setTimeout(() => { prog.hidden = true; }, 1500);
      summary.hidden = false;
      summary.innerHTML = `共 ${chunks.length} 段 · 发现 <b>${issues.length}</b> 处问题`;
      renderIssues();
    };

    const applyOne = async (idx) => {
      const it = issues[idx];
      if (!it || it.applied) return;
      const cur = getEditorRoot();
      if (!cur) return toast('未找到编辑器', 'err');
      await saveSnapshot(cur.innerHTML);
      const r = window.MoPaiAI.applyIssueToRoot(cur, it);
      if (r === 'applied') {
        injectHtml(cur.innerHTML);
        it.applied = true;
        renderIssues();
        toast('已替换 ✅(可「排版 → 恢复快照」回滚)');
      } else if (r === 'cross-node') {
        toast('该片段横跨多个样式节点,请手动修改', 'err');
      } else {
        toast('在正文中没找到该片段,可能已被修改', 'err');
        it.applied = true;
        renderIssues();
      }
    };

    q.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ai-run"]')) run();
      if (e.target.closest('[data-act="ai-apply-all"]')) {
        const cur = getEditorRoot();
        if (!cur) return toast('未找到编辑器', 'err');
        saveSnapshot(cur.innerHTML).then(async () => {
          const r = window.MoPaiAI.applyIssues(cur, issues);
          await injectHtml(cur.innerHTML);
          renderIssues();
          toast(`已应用 ${r.applied} 处${r.cross ? `,${r.cross} 处跨节点需手动` : ''}${r.missed ? `,${r.missed} 处未找到` : ''}`);
        });
      }
      const applyBtn = e.target.closest('[data-ai-apply]');
      if (applyBtn) applyOne(parseInt(applyBtn.dataset.aiApply, 10));
    });
  }

  // ----- AI 子模式 ② 标题 / ③ 摘要 -----

  // 标题/摘要生成结果的面板级缓存:切 tab、关面板再打开都不丢,刷新页面才重置
  const AI_CACHE = { titles: [], summary: '' };
  // AI 生成中的加载动画(旋转圈 + 三条跳动圆点)
  const AI_LOADING_HTML = '<div class="mopai-ai-loading"><span class="mopai-spinner"></span>AI 正在思考<span class="mopai-dots"><i></i><i></i><i></i></span></div>';

  function renderTitleMode(q) {
    const st = getAiStatus();
    q.innerHTML = `
      <div class="mopai-report">基于正文生成 <b>5 种风格</b>候选标题(悬念好奇 / 数字干货 / 痛点共鸣 / 观点态度 / 场景故事),每条 ≤30 字并避开极限词,一键填入公众号标题框。</div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="title-run" ${st.ok ? '' : 'disabled title="请先配置 AI 模型"'}>✍️ 生成候选标题</button>
        <span class="mopai-ai-gen-status" id="mopai-title-status"></span>
      </div>
      <div class="mopai-title-list" id="mopai-title-list"><div class="mopai-empty">还没有生成。点上方按钮,基于当前正文一键生成。</div></div>
    `;
    const statusEl = q.querySelector('#mopai-title-status');
    const list = q.querySelector('#mopai-title-list');
    let titles = AI_CACHE.titles.slice();

    const renderList = () => {
      list.innerHTML = titles.map((t, i) => {
        const len = t.title.length;
        const lenCls = len <= 16 ? 'good' : len <= 30 ? 'ok' : 'bad';
        return `<div class="mopai-title-item">
          <span class="mopai-title-style">${esc(t.style)}</span>
          <div class="mopai-title-body"><div>${esc(t.title)}</div><small>${len} 字${lenCls === 'bad' ? ' · 超过 30 字,信息流可能截断' : ''}</small></div>
          <button class="mopai-btn" data-title-apply="${i}">采用</button>
        </div>`;
      }).join('');
    };
    if (titles.length) renderList(); // 切 tab 回来直接恢复上次结果

    const run = async () => {
      if (!getAiStatus().ok) { toast('请先到设置页配置 AI 模型', 'err'); openOptionsPage(); return; }
      const body = getEditorTextForAI();
      if (body.length < 20) return toast('正文太短,先写点内容再生成标题', 'err');
      list.innerHTML = AI_LOADING_HTML;
      statusEl.textContent = '';
      const msgs = window.MoPaiAI.buildTitleMessages(getArticleTitle(), body.slice(0, 3200));
      const res = await aiChatOnce(msgs, statusEl);
      if (!res.ok) { list.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(res.error)}</div>`; return; }
      let parsed = window.MoPaiAI.parseTitles(res.raw);
      if (parsed.error || !parsed.titles.length) {
        // 首次解析失败自动重试一次(强化输出格式要求,免手点第二次)
        statusEl.textContent = 'AI 正在重新生成…';
        const res2 = await aiChatOnce([...msgs, {
          role: 'user',
          content: '上一次输出无法解析。请严格只输出 JSON 数组 [{"style":"...","title":"..."}],共 5 条,不要任何解释、思考过程或代码围栏。',
        }], statusEl);
        if (res2.ok) parsed = window.MoPaiAI.parseTitles(res2.raw);
      }
      if (parsed.error || !parsed.titles.length) {
        list.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(parsed.error || '解析失败')}</div>`;
        return;
      }
      titles = parsed.titles;
      AI_CACHE.titles = titles;
      statusEl.textContent = ''; // 清掉「自动重试…」等过程提示
      renderList();
    };

    q.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="title-run"]')) { await run(); return; }
      const btn = e.target.closest('[data-title-apply]');
      if (btn) {
        const t = titles[parseInt(btn.dataset.titleApply, 10)];
        if (!t) return;
        if (await setArticleTitle(t.title)) {
          toast('已填入公众号标题框 ✅');
        } else {
          await copyRich(t.title, t.title);
          toast('标题框写入失败,已复制到剪贴板,请手动粘贴', 'err');
        }
      }
    });
  }

  // ----- AI 子模式 ③ 摘要 -----

  function renderSummaryMode(q) {
    const st = getAiStatus();
    q.innerHTML = `
      <div class="mopai-report">为文章生成 <b>60~110 字</b>「摘要」,用于会话卡片与转发展示。生成后可复制,或直接填入编辑器摘要框。</div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="summary-run" ${st.ok ? '' : 'disabled title="请先配置 AI 模型"'}>📝 生成摘要</button>
        <span class="mopai-ai-gen-status" id="mopai-summary-status"></span>
      </div>
      <div id="mopai-summary-wrap"><div class="mopai-empty">还没有生成。点上方按钮,基于当前正文一键生成。</div></div>
    `;
    const statusEl = q.querySelector('#mopai-summary-status');
    const wrap = q.querySelector('#mopai-summary-wrap');
    let summary = AI_CACHE.summary || '';

    const renderSummaryCard = () => {
      const len = summary.length;
      const lenCls = len >= 60 && len <= 110 ? 'good' : len <= 120 ? 'ok' : 'bad';
      wrap.innerHTML = `<div class="mopai-summary-card">
        <div class="mopai-summary-text">${esc(summary)}</div>
        <div class="mopai-summary-meta"><span class="${lenCls}">${len} 字 · 建议 60~110(微信上限 120)</span></div>
        <div class="mopai-row">
          <button class="mopai-btn" data-act="summary-fill">填入摘要框</button>
          <button class="mopai-btn ghost" data-act="summary-copy">复制</button>
        </div>
      </div>`;
    };
    if (summary) renderSummaryCard(); // 切 tab 回来直接恢复上次结果

    const run = async () => {
      if (!getAiStatus().ok) { toast('请先到设置页配置 AI 模型', 'err'); openOptionsPage(); return; }
      const body = getEditorTextForAI();
      if (body.length < 30) return toast('正文太短,先写点内容再生成摘要', 'err');
      wrap.innerHTML = AI_LOADING_HTML;
      statusEl.textContent = '';
      const msgs = window.MoPaiAI.buildSummaryMessages(body.slice(0, 3200));
      const res = await aiChatOnce(msgs, statusEl);
      if (!res.ok) { wrap.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(res.error)}</div>`; return; }
      let parsed = window.MoPaiAI.parseSummary(res.raw);
      if (parsed.error) {
        // 首次解析失败自动重试一次(强化输出格式要求,免手点第二次)
        statusEl.textContent = 'AI 正在重新生成…';
        const res2 = await aiChatOnce([...msgs, {
          role: 'user',
          content: '上一次输出无法解析。请严格只输出 JSON {"summary":"..."},单段 60~110 字,不要任何解释、思考过程或代码围栏。',
        }], statusEl);
        if (res2.ok) parsed = window.MoPaiAI.parseSummary(res2.raw);
      }
      if (parsed.error) { wrap.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(parsed.error)}</div>`; return; }
      summary = parsed.summary;
      AI_CACHE.summary = summary;
      statusEl.textContent = ''; // 清掉「自动重试…」等过程提示
      renderSummaryCard();
    };

    q.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="summary-run"]')) { await run(); return; }
      if (e.target.closest('[data-act="summary-fill"]')) {
        if (!summary) return;
        if (await setArticleDigest(summary)) toast('已填入摘要框 ✅');
        else { await copyRich(summary, summary); toast('摘要框写入失败,已复制到剪贴板,请手动粘贴', 'err'); }
        return;
      }
      if (e.target.closest('[data-act="summary-copy"]')) {
        if (!summary) return;
        const ok = await copyRich(summary, summary);
        toast(ok ? '摘要已复制' : '复制失败', ok ? undefined : 'err');
      }
    });
  }

  // ----- AI 子模式 ① 写文章 -----

  function renderArticleMode(q) {
    const st = getAiStatus();
    q.innerHTML = `
      <label class="mopai-field-label">① 选题(必填,越具体越好)</label>
      <textarea class="mopai-md" id="mopai-article-topic" style="min-height:60px" placeholder="一句话说清楚要写什么&#10;例:新媒体人如何用 AI 把排版时间从一小时压到三分钟"></textarea>
      <div class="mopai-chip-row">
        <span>试试:</span>
        <button class="mopai-chip-link" data-topic="新媒体人如何用 AI 把排版时间从一小时压到三分钟">AI 提效</button>
        <button class="mopai-chip-link" data-topic="普通人开始副业搞钱的 5 个真实步骤">副业起步</button>
        <button class="mopai-chip-link" data-topic="为什么你存的钱总是不知不觉就花掉了">消费心理</button>
        <button class="mopai-chip-link" data-topic="30 岁前值得养成的 6 个职场习惯">职场习惯</button>
      </div>
      <div class="mopai-article-form-row">
        <div class="mopai-field">
          <label class="mopai-field-label">② 风格</label>
          <div class="mopai-chip-row" id="mopai-article-style">
            <button type="button" class="mopai-chip-link mopai-chip-option mopai-chip-on" data-value="干货教程">干货教程</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="观点评论">观点评论</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="故事案例">故事案例</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="清单盘点">清单盘点</button>
          </div>
        </div>
        <div class="mopai-field">
          <label class="mopai-field-label">③ 目标读者</label>
          <div class="mopai-chip-row" id="mopai-article-audience">
            <button type="button" class="mopai-chip-link mopai-chip-option mopai-chip-on" data-value="">不限</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="职场人群">职场人群</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="新媒体运营">新媒体运营</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="学生党">学生党</button>
            <button type="button" class="mopai-chip-link mopai-chip-option" data-value="家庭人群">家庭人群</button>
          </div>
        </div>
      </div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="article-run" ${st.ok ? '' : 'disabled title="请先配置 AI 模型"'}>🪄 生成初稿</button>
        <button class="mopai-btn" data-act="article-continue" hidden>➕ 继续写</button>
        <button class="mopai-btn ghost" data-act="article-clear" hidden>🗑 清空</button>
        <span class="mopai-ai-gen-status" id="mopai-article-status"></span>
      </div>
      <div class="mopai-report">初稿约 700~900 字 ·「继续写」每次追加一段 · 长文自动连续生成</div>
      <div id="mopai-article-wrap">
        <div class="mopai-article-empty">
          <div class="mopai-article-empty-icon">🪄</div>
          <div>三步出稿:<b>填选题</b> → 点「生成初稿」→ <b>插入编辑器</b>继续打磨</div>
        </div>
      </div>
    `;
    const statusEl = q.querySelector('#mopai-article-status');
    const wrap = q.querySelector('#mopai-article-wrap');
    const topicEl = q.querySelector('#mopai-article-topic');
    const continueBtn = q.querySelector('[data-act="article-continue"]');
    let article = '';
    let topic = '';
    let continueCount = 0;
    let busy = false;

    // 风格/读者胶囊标签:单选高亮
    q.querySelectorAll('.mopai-chip-row').forEach((row) => {
      row.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.mopai-chip-option');
        if (!btn) return;
        row.querySelectorAll('.mopai-chip-option').forEach((b) => b.classList.remove('mopai-chip-on'));
        btn.classList.add('mopai-chip-on');
      });
    });

    const setBusy = (b) => {
      busy = b;
      const canUse = getAiStatus().ok;
      [['article-run', canUse], ['article-continue', canUse && !!article], ['article-clear', true]].forEach(([act, enabled]) => {
        const btn = q.querySelector(`[data-act="${act}"]`);
        if (btn) btn.disabled = b ? true : !enabled;
      });
    };

    const showEmpty = () => {
      wrap.style.fontFamily = '';
      wrap.innerHTML = `
        <div class="mopai-article-empty">
          <div class="mopai-article-empty-icon">🪄</div>
          <div>三步出稿:<b>填选题</b> → 点「生成初稿」→ <b>插入编辑器</b>继续打磨</div>
        </div>`;
    };

    const showError = (msg) => {
      wrap.style.fontFamily = '';
      wrap.innerHTML = `<div class="mopai-ai-item err">❌ ${esc(msg)}</div>`;
    };

    const showLoading = (msg) => {
      wrap.style.fontFamily = '';
      wrap.innerHTML = `
        <div class="mopai-article-loading">
          <div class="mopai-loading-dots"><i></i><i></i><i></i></div>
          <div>${esc(msg)}</div>
        </div>`;
    };

    const renderResult = () => {
      let rendered;
      try {
        rendered = window.MoPaiRender.renderMarkdown(article, settings.theme, { footnote: false, ...fmtThemeOverrides() }).html;
      } catch (e) {
        rendered = esc(article);
      }
      const words = article.replace(/\s/g, '').length;
      wrap.style.fontFamily = window.MoPaiThemes.BASE_FONT;
      wrap.innerHTML = `
        <div class="mopai-article-head">
          <span>📝 草稿 · 约 <b>${words}</b> 字${continueCount ? ` · 已续写 ${continueCount} 段` : ''}</span>
          <span class="mopai-article-head-btns">
            <button class="mopai-btn ghost" data-act="article-rerun">🔄 重写</button>
            <button class="mopai-btn ghost" data-act="article-discard" title="丢弃草稿">🗑</button>
          </span>
        </div>
        <div class="mopai-article-preview"><div class="mopai-render-wrap">${rendered}</div></div>
        <div class="mopai-article-actions">
          <button class="mopai-btn primary" data-act="article-insert">⬇ 插入编辑器(追加)</button>
          <button class="mopai-btn" data-act="article-replace">替换编辑器内容</button>
          <button class="mopai-btn ghost" data-act="article-copy">复制 Markdown</button>
        </div>
        <div class="mopai-article-note">插入 / 替换前已自动存快照,误操作可在「排版 → 快照历史」找回</div>
      `;
    };

    const gen = async (isContinue) => {
      if (busy) return;
      if (!getAiStatus().ok) { toast('请先到设置页配置 AI 模型', 'err'); openOptionsPage(); return; }
      if (!isContinue) {
        topic = topicEl.value.trim();
        if (topic.length < 4) return toast('选题太短,写具体一点', 'err');
        article = '';
        continueCount = 0;
      } else if (!article) return;
      setBusy(true);
      showLoading(isContinue ? '正在续写下一段并拼接…' : '正在生成初稿,约 10~20 秒…');
      statusEl.textContent = '';
      try {
        const msgs = isContinue
          ? window.MoPaiAI.buildContinueMessages(article.slice(-1500), topic)
          : window.MoPaiAI.buildArticleMessages(topic,
              (q.querySelector('#mopai-article-style .mopai-chip-on') || {}).dataset?.value || '干货教程',
              (q.querySelector('#mopai-article-audience .mopai-chip-on') || {}).dataset?.value || '');
        const res = await aiChatOnce(msgs, statusEl);
        if (!res.ok) return showError(res.error);
        const parsed = window.MoPaiAI.parseArticle(res.raw);
        if (parsed.error) return showError(parsed.error);
        article = isContinue ? article + '\n\n' + parsed.text : parsed.text;
        if (isContinue) continueCount++;
        statusEl.textContent = `完成 · 当前约 ${article.replace(/\s/g, '').length} 字`;
        continueBtn.hidden = false;
        q.querySelector('[data-act="article-clear"]').hidden = false;
        renderResult();
      } finally {
        setBusy(false);
      }
    };

    q.addEventListener('click', async (e) => {
      // 仅响应「试试」建议 chip(带 data-topic);风格/读者胶囊虽复用样式类,但无 data-topic,不会误入此分支
      const chip = e.target.closest('.mopai-chip-link[data-topic]');
      if (chip) { topicEl.value = chip.dataset.topic; topicEl.focus(); return; }
      if (e.target.closest('[data-act="article-run"]')) { await gen(false); return; }
      if (e.target.closest('[data-act="article-continue"]')) { await gen(true); return; }
      if (e.target.closest('[data-act="article-rerun"]')) { await gen(false); return; }
      if (e.target.closest('[data-act="article-clear"]') || e.target.closest('[data-act="article-discard"]')) {
        article = '';
        continueCount = 0;
        continueBtn.hidden = true;
        q.querySelector('[data-act="article-clear"]').hidden = true;
        statusEl.textContent = '';
        showEmpty();
        return;
      }
      if (e.target.closest('[data-act="article-copy"]')) {
        if (!article) return;
        const ok = await copyRich(article, article);
        toast(ok ? 'Markdown 已复制' : '复制失败', ok ? undefined : 'err');
        return;
      }
      if (e.target.closest('[data-act="article-insert"]') || e.target.closest('[data-act="article-replace"]')) {
        if (!article) return;
        const replace = !!e.target.closest('[data-act="article-replace"]');
        const cur = getEditorRoot();
        if (!cur && !replace) return toast('未找到编辑器', 'err');
        setBusy(true);
        try {
          await saveSnapshot(cur ? cur.innerHTML : '');
          await pushSnapshotHistory(cur ? cur.innerHTML : '');
          const r = window.MoPaiRender.renderMarkdown(article, settings.theme, { footnote: false, ...fmtThemeOverrides() });
          if (replace) {
            await injectHtml(r.html);
          } else {
            const merged = document.createElement('div');
            merged.innerHTML = cur.innerHTML + r.html;
            await injectHtml(merged.innerHTML);
          }
          toast(replace ? '已替换编辑器内容 ✅(原内容已存快照)' : '已追加到编辑器 ✅(原内容已存快照)');
        } finally {
          setBusy(false);
        }
      }
    });
  }

  // ----- Tab: 多平台同步 -----

  const SYNC_PLATFORMS = [
    { id: 'zhihu', name: '知乎专栏', format: 'HTML', group: 'social', note: '图片按 URL 自动转存' },
    { id: 'bilibili', name: 'B站专栏', format: 'HTML', group: 'social', note: '链接移除;图片转存B站图床' },
    { id: 'weibo', name: '微博头条文章', format: 'HTML', group: 'social', note: '图片转存微博图床' },
    { id: 'baijiahao', name: '百家号', format: 'HTML', group: 'media', note: '图片转存百度图床' },
    { id: 'sohu', name: '搜狐号', format: 'HTML', group: 'media', note: '图片转存搜狐图床' },
    { id: 'xueqiu', name: '雪球', format: 'Markdown', group: 'media', note: '图片转存雪球图床' },
    { id: 'woshipm', name: '人人都是产品经理', format: 'HTML', group: 'media', note: '图片转存' },
    { id: 'csdn', name: 'CSDN', format: 'Markdown', group: 'tech', note: '图片转存CSDN图床' },
    { id: 'juejin', name: '掘金', format: 'Markdown', group: 'tech', note: '图片不转存,草稿内可替换' },
    { id: 'segmentfault', name: '思否', format: 'Markdown', group: 'tech', note: '图片转存' },
    { id: 'cnblogs', name: '博客园', format: 'Markdown', group: 'tech', note: '图片转存' },
    { id: 'oschina', name: '开源中国', format: 'Markdown', group: 'tech', note: '图片转存' },
    { id: 'imooc', name: '慕课手记', format: 'Markdown', group: 'tech', note: '图片转存' },
  ];
  const SYNC_GROUPS = [['social', '社交 · 社区'], ['media', '资讯 · 垂直'], ['tech', '技术社区']];

  function renderSync(el) {
    const p = pane(el);
    const sel = settings.syncSelection || [];
    const chips = (gid) => SYNC_PLATFORMS.filter((x) => x.group === gid).map((pl) => `
      <label class="mopai-chip${sel.includes(pl.id) ? ' on' : ''}" title="${esc(pl.note)}">
        <input type="checkbox" data-platform="${pl.id}" ${sel.includes(pl.id) ? 'checked' : ''}>
        <span class="mopai-chip-name">${esc(pl.name)}</span>
        <span class="mopai-chip-fmt" data-auth="${pl.id}">…</span>
      </label>`).join('');

    p.innerHTML = `
      <label class="mopai-label">文章标题</label>
      <input class="mopai-input" id="mopai-sync-title" value="${esc(getArticleTitle())}">
      <div class="mopai-report">同步 = 用浏览器里各平台的登录态调官方接口,把文章<b>批量写入草稿箱</b>(方案参考开源 wechatsync)。发布仍需到各平台手动确认。打开本页会<b>自动检测全部平台</b>的登录态,结果显示在各平台卡片右侧(✅/❌)。</div>
      ${SYNC_GROUPS.map(([gid, gname]) => `
        <div class="mopai-sync-group">
          <div class="mopai-sync-group-head"><b>${gname}</b>
            <button class="mopai-btn ghost" data-act="sel-group" data-group="${gid}">全选</button>
          </div>
          <div class="mopai-chip-grid">${chips(gid)}</div>
        </div>`).join('')}
      <div class="mopai-row">
        <button class="mopai-btn ghost" data-act="sel-all">全选所有平台</button>
        <button class="mopai-btn ghost" data-act="sel-none">清空</button>
        <button class="mopai-btn ghost" data-act="auth-selected">🔍 检测登录(勾选)</button>
        <button class="mopai-btn primary" data-act="pub-selected">🚀 一键同步</button>
      </div>
      <div class="mopai-report" id="mopai-sync-progress" hidden></div>
      <div class="mopai-sync-results" id="mopai-sync-results"></div>
      <div class="mopai-row">
        <button class="mopai-btn ghost" data-act="copy-md">复制 Markdown</button>
        <button class="mopai-btn ghost" data-act="copy-html">复制富文本</button>
      </div>
    `;

    const resultsEl = p.querySelector('#mopai-sync-results');
    const progressEl = p.querySelector('#mopai-sync-progress');
    const state = {}; // platformId -> {status:'pending|running|ok|err', msg, url}

    const selectedIds = () =>
      Array.from(p.querySelectorAll('.mopai-chip input:checked')).map((c) => c.dataset.platform);

    const saveSelection = async () => {
      settings.syncSelection = selectedIds();
      await saveSettings();
    };

    const renderResults = () => {
      const ids = selectedIds();
      const list = Object.keys(state).length ? Object.keys(state) : ids;
      resultsEl.innerHTML = list.length ? list.map((id) => {
        const pl = SYNC_PLATFORMS.find((x) => x.id === id);
        const st = state[id] || { status: 'idle' };
        const icon = { idle: '⏸', pending: '⏳', running: '🔄', ok: '✅', err: '❌' }[st.status] || '';
        const link = st.status === 'ok' && st.url
          ? ` <a href="${esc(st.url)}" target="_blank" style="color:#2b5bff">打开草稿 →</a>` : '';
        const body = st.status === 'ok'
          ? esc(st.msg || '') + link
          : st.status === 'err' ? esc(st.msg || '失败') : '';
        return `<div class="mopai-sync-result ${st.status}"><b>${icon} ${esc(pl.name)}</b><span>${body}</span></div>`;
      }).join('') : '';
    };

    // 登录态显示在平台卡片右侧徽标:data-auth="平台id"
    const setBadge = (id, st, extra) => {
      const el = p.querySelector(`[data-auth="${id}"]`);
      if (!el) return;
      if (st === 'running') { el.textContent = '🔄'; }
      else if (st === 'ok') { el.textContent = '✅'; if (extra) el.title = `已登录:${extra}`; }
      else if (st === 'err') { el.textContent = '❌ 未登录'; el.title = extra || '请先在浏览器登录该平台'; }
      else { el.textContent = '…'; el.title = ''; }
    };

    const checkOneAuth = async (id) => {
      setBadge(id, 'running');
      const r = await sendBg('mopai-sync-auth', { platform: id });
      if (r && r.authenticated) {
        setBadge(id, 'ok', r.username || '');
        return true;
      }
      setBadge(id, 'err', r && r.reason ? r.reason : '');
      return false;
    };

    const runAuthCheck = (ids) => {
      progressEl.hidden = false;
      progressEl.textContent = `检测登录 ${ids.length} 个平台…`;
      return Promise.all(ids.map(checkOneAuth)).finally(() => { progressEl.hidden = true; });
    };

    // 进入同步页时自动检测全部平台登录态(并行请求,无需先勾选)
    runAuthCheck(SYNC_PLATFORMS.map((x) => x.id));

    const prepareContent = () => {
      const src = getEditorRoot();
      if (!src) return null;
      const html = src.innerHTML;
      const markdown = window.MoPaiSyncPrepare.htmlToMarkdown(html, window.TurndownService, window.turndownPluginGfm) || '';
      const titleEl = p.querySelector('#mopai-sync-title');
      return {
        html, markdown,
        title: titleEl && titleEl.value.trim() ? titleEl.value.trim() : getArticleTitle(),
        cover: getArticleCover() || firstImageOf(html),
      };
    };

    p.addEventListener('change', (e) => {
      if (e.target.matches('.mopai-chip input')) {
        e.target.closest('.mopai-chip').classList.toggle('on', e.target.checked);
        saveSelection();
      }
    });

    p.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'sel-group' || act === 'sel-all' || act === 'sel-none') {
        p.querySelectorAll('.mopai-chip input').forEach((c) => {
          if (act === 'sel-all') c.checked = true;
          else if (act === 'sel-none') c.checked = false;
          else c.checked = SYNC_PLATFORMS.find((x) => x.id === c.dataset.platform).group === btn.dataset.group;
          c.closest('.mopai-chip').classList.toggle('on', c.checked);
        });
        await saveSelection();
        renderResults();
        return;
      }

      if (act === 'copy-md') {
        const c = prepareContent();
        if (!c) return toast('未找到编辑器', 'err');
        const ok = await copyRich(c.markdown, c.markdown);
        toast(ok ? 'Markdown 已复制' : '复制失败', ok ? undefined : 'err');
        return;
      }
      if (act === 'copy-html') {
        const c = prepareContent();
        if (!c) return toast('未找到编辑器', 'err');
        const ok = await copyRich(c.html, c.markdown);
        toast(ok ? '富文本已复制,可到目标平台编辑器粘贴' : '复制失败', ok ? undefined : 'err');
        return;
      }

      const ids = selectedIds();
      if (!ids.length) return toast('先勾选要操作的平台', 'err');
      const c = prepareContent();
      if (!c) {
        progressEl.hidden = false;
        progressEl.innerHTML = '❌ 未找到文章内容。请在<b>图文编辑页</b>或<b>已发布的公众号文章页</b>(mp.weixin.qq.com/s/...)打开面板重试。';
        return;
      }

      if (act === 'auth-selected') {
        await runAuthCheck(ids);
        return;
      }

      if (act === 'pub-selected') {
        progressEl.hidden = false;
        for (let i = 0; i < ids.length; i++) {
          const pl = SYNC_PLATFORMS.find((x) => x.id === ids[i]);
          progressEl.textContent = `同步 ${pl.name} ${i + 1}/${ids.length}…(图片转存可能较慢)`;
          state[ids[i]] = { status: 'running' };
          renderResults();
          const r = await sendBg('mopai-sync-publish', { platform: ids[i], title: c.title, html: c.html, markdown: c.markdown, cover: c.cover });
          if (r && r.ok) {
            state[ids[i]] = { status: 'ok', msg: r.detail || '草稿已写入', url: r.draftUrl };
          } else {
            state[ids[i]] = { status: 'err', msg: (r && r.error) || '同步失败' };
          }
          renderResults();
        }
        const okCount = Object.values(state).filter((s) => s.status === 'ok').length;
        progressEl.hidden = true;
        toast(`批量同步完成:${okCount}/${ids.length} 个平台成功`);
      }
    });
  }



  // ----- Tab: 检查(AI 校对 + 规则体检) -----

  function renderCheck(el) {
    const p = pane(el);
    // 与「AI 写」一致的一行模式切换:三个功能各自独立占屏,省去纵向三分区
    p.innerHTML = `
      <div class="mopai-ai-modes">
        <button class="mopai-ai-mode${checkMode === 'proof' ? ' on' : ''}" data-check-mode="proof">🔍 AI 校对</button>
        <button class="mopai-ai-mode${checkMode === 'rules' ? ' on' : ''}" data-check-mode="rules">📋 规则体检</button>
        <button class="mopai-ai-mode${checkMode === 'detect' ? ' on' : ''}" data-check-mode="detect">🤖 AI 检测</button>
      </div>
      <div id="mopai-check-work"></div>
    `;
    p.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-check-mode]');
      if (modeBtn && modeBtn.dataset.checkMode !== checkMode) {
        checkMode = modeBtn.dataset.checkMode;
        renderTab('check');
      }
    });
    const work = p.querySelector('#mopai-check-work');
    const q = document.createElement('div');
    work.appendChild(q);
    if (checkMode === 'rules') renderRulesMode(q);
    else if (checkMode === 'detect') renderDetectMode(q);
    else renderProofMode(q);
  }

  function renderRulesMode(q) {
    q.innerHTML = `
      <div class="mopai-report">本地即时检查 <b>违禁词、外链、图片域名、文章结构</b>,无需配置 AI,发布前最后一道保险。</div>
      <button class="mopai-btn primary" data-act="run-check">🔍 运行发布前检查</button>
      <div class="mopai-check-list" id="mopai-check-list"></div>
    `;
    const list = q.querySelector('#mopai-check-list');
    const doCheck = () => {
      const src = getEditorRoot();
      if (!src) { q.innerHTML = editorMissingHint(); bindRetry(q); return; }
      const items = runChecks(src);
      const icon = { ok: '✅', warn: '⚠️', info: '💡' };
      list.innerHTML = items.map((it) => `
        <div class="mopai-check-item ${it.level}">
          <div class="mopai-check-title">${icon[it.level]} ${esc(it.title)}</div>
          ${it.detail ? `<div class="mopai-check-detail">${it.detail}</div>` : ''}
        </div>`).join('');
    };
    q.addEventListener('click', (e) => { if (e.target.closest('[data-act="run-check"]')) doCheck(); });
    doCheck();
  }

  function renderDetectMode(q) {
    q.innerHTML = `
      <div class="mopai-report">识别 AI 生成痕迹,降低文章被平台判定为 AI 内容的风险。</div>
      <div class="mopai-row">
        <button class="mopai-btn primary" data-act="open-ai-detect">🤖 打开腾讯朱雀 AI 检测</button>
        <button class="mopai-btn" data-act="copy-for-detect">📋 复制全文</button>
      </div>
      <div class="mopai-hint">打开朱雀检测页 → 点「复制全文」→ 粘贴到检测框即可分析 AI 痕迹与疑似段落。检测在腾讯页面完成,本插件不采集任何内容。</div>
    `;
    q.querySelector('[data-act="open-ai-detect"]').addEventListener('click', () => {
      window.open('https://matrix.tencent.com/ai-detect/ai_gen', '_blank');
    });
    q.querySelector('[data-act="copy-for-detect"]').addEventListener('click', async () => {
      const text = getEditorTextForAI();
      if (!text) return toast('未找到编辑器内容', 'err');
      try {
        await navigator.clipboard.writeText(text);
        toast('全文已复制,去朱雀检测页粘贴即可');
      } catch (err) {
        toast('复制失败,请手动全选复制', 'err');
      }
    });
  }

  // ----- Tab: 统计 -----

  async function renderStats(el) {
    const p = pane(el);
    const src = getEditorRoot();
    if (!src) { p.innerHTML = editorMissingHint(); bindRetry(p); return; }
    const st = window.MoPaiTypo.analyzeText(src);
    const imgs = src.querySelectorAll('img').length;
    const links = src.querySelectorAll('a[href]').length;
    const paras = Math.max(src.querySelectorAll('p').length, 1);
    const snap = await loadSnapshot();
    p.innerHTML = `
      <div class="mopai-stat-grid">
        <div class="mopai-stat"><b>${st.cjkChars}</b><span>中文字数</span></div>
        <div class="mopai-stat"><b>${st.latinWords}</b><span>英文单词</span></div>
        <div class="mopai-stat"><b>${st.readMinutes}′</b><span>预计阅读</span></div>
        <div class="mopai-stat"><b>${paras}</b><span>段落</span></div>
        <div class="mopai-stat"><b>${imgs}</b><span>图片</span></div>
        <div class="mopai-stat"><b>${links}</b><span>链接</span></div>
      </div>
      <div class="mopai-report">平均每段 ${Math.round(st.cjkChars / paras)} 字${Math.round(st.cjkChars / paras) > 200 ? ',略长' : ',节奏不错'}</div>
      <div class="mopai-report">上次快照:${snap ? new Date(snap.ts).toLocaleString() : '暂无'}</div>
      <button class="mopai-btn ghost" data-act="restore-snap">⏱ 恢复快照</button>
    `;
    p.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="restore-snap"]')) {
        const s = await loadSnapshot();
        if (!s) return toast('还没有快照', 'err');
        const cur = getEditorRoot();
        if (cur) await saveSnapshot(cur.innerHTML);
        await injectHtml(s.html);
        toast('已恢复快照 ✅');
      }
    });
  }

  // ----- Tab: 预览 -----

  function renderPreview(el) {
    const p = pane(el);
    p.innerHTML = `
      <div class="mopai-row">
        <button class="mopai-btn ${previewSrc === 'editor' ? 'primary' : ''}" data-act="pv-editor">编辑器内容</button>
        <button class="mopai-btn ${previewSrc === 'md' ? 'primary' : ''}" data-act="pv-md">Markdown 渲染结果</button>
      </div>
      <div class="mopai-report">375px 手机宽度实时预览,当前主题「${esc(themeName())}」</div>
      <div class="mopai-phone-wrap tall"><div class="mopai-phone"><iframe id="mopai-pv-iframe"></iframe></div></div>
    `;
    const iframe = p.querySelector('#mopai-pv-iframe');
    const refresh = () => {
      if (previewSrc === 'md' && lastMdHtml) {
        iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px 16px;font-family:' + window.MoPaiThemes.BASE_FONT + '}</style></head><body>' + lastMdHtml + '</body></html>';
      } else {
        const src = getEditorRoot();
        if (!src) { iframe.srcdoc = '<body style="font-family:sans-serif;color:#999;padding:16px">打开图文编辑页后可预览</body>'; return; }
        // 与「一键排版」管线保持一致,保证预览与实际排版结果一致
        window.MoPaiTypo.normalizeExisting(src, fmtNormalizeOptions());
        iframe.srcdoc = window.MoPaiRender.previewDocument(src, settings.theme, fmtThemeOverrides());
      }
    };
    p.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'pv-editor') { previewSrc = 'editor'; await renderTab('preview'); }
      if (act === 'pv-md') { previewSrc = 'md'; await renderTab('preview'); }
    });
    refresh();
  }

  // ---------------- 启动 ----------------

  (async () => {
    settings = await loadSettings();
    if (window.MoPaiThemes && window.MoPaiThemes.registerCustom) {
      window.MoPaiThemes.registerCustom(settings.customTheme); // 用户自定义配色注入主题系统
    }
    if (settings.fabEnabled) ensureFab();

    // 设置页修改后实时同步到面板(不用刷新编辑器页面)
    try {
      if (window.chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || !changes.mopai) return;
          const next = deepMerge(clone(DEFAULT_SETTINGS), changes.mopai.newValue || {});
          next.ai = deepMerge(window.MoPaiAI ? window.MoPaiAI.AI_DEFAULTS : {}, next.ai || {});
          settings = next;
          if (window.MoPaiThemes && window.MoPaiThemes.registerCustom) {
            window.MoPaiThemes.registerCustom(settings.customTheme);
          }
        });
      }
    } catch (e) { /* 忽略 */ }
  })();

  // 供测试页调用
  window.MoPaiContent = {
    mount: async () => { settings = await loadSettings(); ensureFab(); },
    findEditor, injectHtml, getEditorRoot, runChecks, getAiStatus,
    getSettings: () => settings,
    setSettings: (s) => { settings = deepMerge(settings, s); saveSettings(); },
  };
})();
