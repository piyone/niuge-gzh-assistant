/**
 * 牛哥公众号助手 · 多平台同步适配器(在 background service worker 中运行)
 * 方案参考开源 wechatsync v2 (github.com/wechatsync/Wechatsync) 的平台适配器:
 * 复用浏览器内该平台的登录 Cookie,调用平台官方 Web API 把文章写入草稿箱。
 *
 * 依赖(importScripts 顺序):lib/marked.min.js → engine/sync-prepare.js → 本文件
 * 注意:平台 UI 改版可能导致接口失效;面板侧对每个平台都有失败原因展示与手动兜底。
 */
globalThis.MoPaiPlatforms = (() => {
  const P = globalThis.MoPaiSyncPrepare;

  // ---------------- 通用请求助手 ----------------

  async function rawFetch(url, options = {}, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const include = { credentials: 'include' };
  async function getJSON(url, opts = {}, timeoutMs) {
    const r = await rawFetch(url, { ...include, ...opts }, timeoutMs);
    return r.json();
  }
  async function getText(url, opts = {}, timeoutMs) {
    const r = await rawFetch(url, { ...include, ...opts }, timeoutMs);
    return r.text();
  }
  async function postJSON(url, body, opts = {}, timeoutMs) {
    const r = await rawFetch(url, {
      ...include, ...opts,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: JSON.stringify(body),
    }, timeoutMs);
    return r;
  }
  async function postForm(url, params, opts = {}, timeoutMs) {
    const r = await rawFetch(url, {
      ...include, ...opts,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
      body: new URLSearchParams(params).toString(),
    }, timeoutMs);
    return r;
  }
  async function postFormData(url, formData, opts = {}, timeoutMs) {
    const r = await rawFetch(url, { ...include, ...opts, method: 'POST', body: formData }, timeoutMs);
    return r;
  }
  async function downloadBlob(url) {
    const r = await rawFetch(url, { credentials: 'omit' }, 45000);
    if (!r.ok) throw new Error('图片下载失败: ' + url.slice(0, 80));
    return r.blob();
  }

  // ---------------- DNR 会话头规则(改写 Origin/Referer 等禁止头) ----------------

  let dnrSeq = 2000;
  async function withHeaderRules(rules, fn) {
    let base;
    if (chrome.declarativeNetRequest) {
      base = dnrSeq;
      dnrSeq += rules.length;
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          addRules: rules.map((r, i) => ({
            id: base + i,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: Object.entries(r.headers).map(([h, v]) => ({ header: h, operation: 'set', value: v })),
            },
            condition: { urlFilter: r.urlFilter, resourceTypes: ['xmlhttprequest'] },
          })),
        });
      } catch (e) { base = undefined; }
    }
    try {
      return await fn();
    } finally {
      if (base !== undefined) {
        try {
          await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: rules.map((_, i) => base + i),
          });
        } catch (e) { /* ignore */ }
      }
    }
  }

  async function getCookie(url, name) {
    try {
      if (!chrome.cookies) return null;
      const c = await chrome.cookies.get({ url, name });
      return c ? c.value : null;
    } catch (e) {
      return null;
    }
  }

  // ---------------- 图片转存(收集 → 逐个上传 → 全文替换,失败保留原链) ----------------

  function collectHtmlImages(html) {
    const out = [];
    const re = /<img[^>]+src="(https?:\/\/[^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null && out.length < 30) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }

  function collectMdImages(md) {
    const out = [];
    const re = /!\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)[^)]*\)/gi;
    let m;
    while ((m = re.exec(md)) !== null && out.length < 30) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }

  /** 依次上传并替换;单个失败保留原 URL(除非 dropFailed=true) */
  async function replaceImages(content, urls, skipRe, uploadFn, dropFailed) {
    for (const src of urls) {
      if (skipRe && skipRe.test(src)) continue;
      try {
        const newUrl = await uploadFn(src);
        if (newUrl && newUrl !== src) content = content.split(src).join(newUrl);
      } catch (e) {
        if (dropFailed) {
          content = content
            .replace(new RegExp(`<img[^>]+src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'gi'), '')
            .split(`[](${src})`).join('');
        }
      }
    }
    return content;
  }

  // ---------------- 雪球简化 HTML(参考 wechatsync XueqiuAdapter 的 remarkable 规则) ----------------

  function mdToXueqiuHtml(md) {
    let html = marked.parse(md || '');
    html = html
      .replace(/<h[1-6][^>]*>/gi, '<h4>').replace(/<\/h[1-6]>/gi, '</h4>')
      .replace(/<strong[^>]*>/gi, '<b>').replace(/<\/strong>/gi, '</b>')
      .replace(/<em[^>]*>/gi, '<i>').replace(/<\/em>/gi, '</i>')
      .replace(/<\/?(ul|ol)[^>]*>/gi, '')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '<p>$1</p>')
      .replace(/<hr[^>]*>/gi, '')
      .replace(/<img([^>]*)>/gi, '<img$1 class="ke_img">')
      .replace(/<p>\s*<\/p>/g, '')
      .replace(/\n{3,}/g, '\n\n');
    return html.trim();
  }

  // ---------------- 平台适配器 ----------------

  const PLATFORMS = {

    // ============ 知乎专栏(HTML) ============
    zhihu: {
      name: '知乎专栏', format: 'HTML', group: 'social',
      home: 'https://zhuanlan.zhihu.com/manage', note: '图片按 URL 自动转存知乎图床',
      async checkAuth() {
        const data = await getJSON('https://www.zhihu.com/api/v4/me', {
          headers: { 'x-requested-with': 'fetch' },
        });
        if (data && data.id) return { authenticated: true, username: data.name };
        return { authenticated: false };
      },
      async publish({ title, html }) {
        let content = html;
        // 知乎图片转存:urlencoded 表单提交图片 URL,服务端抓取
        const urls = collectHtmlImages(content);
        let uploaded = 0;
        for (const src of urls.filter((u) => !/zhimg\.com/i.test(u))) {
          try {
            const resp = await postForm('https://zhuanlan.zhihu.com/api/uploaded_images', { url: src, source: 'article' },
              { headers: { 'x-requested-with': 'fetch' } }, 45000);
            const data = await resp.json();
            if (data && data.src) { content = content.split(src).join(data.src); uploaded++; }
          } catch (e) { /* 保留原 URL */ }
        }
        content = P.transformZhihuHtml(content);

        const createResp = await postJSON('https://zhuanlan.zhihu.com/api/articles/drafts',
          P.buildZhihuDraftBody(title), { headers: { 'x-requested-with': 'fetch' } });
        const createText = await createResp.text();
        if (!createResp.ok) {
          if (createResp.status === 401 || createResp.status === 403) {
            return { ok: false, needLogin: true, error: '知乎未登录或登录态失效,请先在浏览器登录知乎' };
          }
          return { ok: false, error: `创建草稿失败: HTTP ${createResp.status} ${createText.slice(0, 120)}` };
        }
        let draft;
        try { draft = JSON.parse(createText); } catch (e) {
          return { ok: false, error: '创建草稿失败:响应非 JSON(可能未登录知乎)' };
        }
        if (!draft || !draft.id) return { ok: false, error: '创建草稿失败:无效响应' };

        const patchResp = await rawFetch(`https://zhuanlan.zhihu.com/api/articles/${draft.id}/draft`, {
          ...include,
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' },
          body: JSON.stringify(P.buildZhihuPatchBody(title, content)),
        });
        if (!patchResp.ok) {
          return { ok: false, error: `写入内容失败: HTTP ${patchResp.status}`, draftUrl: `https://zhuanlan.zhihu.com/p/${draft.id}/edit` };
        }
        return {
          ok: true,
          draftUrl: `https://zhuanlan.zhihu.com/p/${draft.id}/edit`,
          detail: `草稿已写入${uploaded ? `,转存图片 ${uploaded} 张` : ''}(知乎需手动发布)`,
        };
      },
    },

    // ============ 掘金(Markdown) ============
    juejin: {
      name: '掘金', format: 'Markdown', group: 'tech',
      home: 'https://juejin.cn/', note: '图片不转存,草稿内可手动替换',
      async checkAuth() {
        return withHeaderRules([
          { urlFilter: '*://api.juejin.cn/*', headers: { Origin: 'https://juejin.cn', Referer: 'https://juejin.cn/' } },
        ], async () => {
          const data = await getJSON('https://api.juejin.cn/user_api/v1/user/get');
          if (data && data.data && data.data.user_id) return { authenticated: true, username: data.data.user_name };
          return { authenticated: false };
        });
      },
      async publish({ title, markdown }) {
        return withHeaderRules([
          { urlFilter: '*://api.juejin.cn/*', headers: { Origin: 'https://juejin.cn', Referer: 'https://juejin.cn/' } },
        ], async () => {
          const csrfResp = await rawFetch('https://api.juejin.cn/user_api/v1/sys/token', {
            ...include, method: 'HEAD',
            headers: { 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.10' },
          });
          const ware = csrfResp.headers.get('x-ware-csrf-token');
          if (!ware) return { ok: false, needLogin: true, error: '获取掘金 CSRF token 失败(可能未登录掘金)' };
          const csrf = ware.split(',')[1];
          if (!csrf) return { ok: false, error: '掘金 CSRF token 格式异常' };

          const resp = await postJSON('https://api.juejin.cn/content_api/v1/article_draft/create',
            P.buildJuejinPayload(title, markdown),
            { headers: { 'x-secsdk-csrf-token': csrf } });
          const data = await resp.json();
          if (data.err_no && data.err_no !== 0) {
            return { ok: false, needLogin: /auth|login|登录/i.test(data.err_msg || ''), error: data.err_msg || `掘金错误码 ${data.err_no}` };
          }
          if (!data.data || !data.data.id) return { ok: false, error: '掘金返回无效:缺少草稿 id' };
          return {
            ok: true,
            draftUrl: `https://juejin.cn/editor/drafts/${data.data.id}`,
            detail: '草稿已创建(掘金需手动发布);图片未转存,如显示异常请在编辑器内重新上传',
          };
        });
      },
    },

    // ============ B 站专栏(HTML,图片必须转存) ============
    bilibili: {
      name: 'B站专栏', format: 'HTML', group: 'social',
      home: 'https://member.bilibili.com/platform/upload/text', note: '链接会被移除;图片自动转存 B 站图床',
      RULES: [{ urlFilter: '*://api.bilibili.com/*', headers: { Origin: 'https://member.bilibili.com', Referer: 'https://member.bilibili.com/' } }],
      SKIP: /hdslb\.com|bilibili\.com|biliimg\.com/i,
      async checkAuth() {
        return withHeaderRules(this.RULES, async () => {
          const data = await getJSON('https://api.bilibili.com/x/web-interface/nav?build=0&mobi_app=web');
          if (data.code === 0 && data.data && data.data.isLogin) {
            const csrf = await getCookie('https://www.bilibili.com/', 'bili_jct');
            return { authenticated: true, username: data.data.uname, csrf };
          }
          return { authenticated: false };
        });
      },
      async publish({ title, html, cover }) {
        return withHeaderRules(this.RULES, async () => {
          const auth = await this.checkAuth();
          if (!auth.authenticated) return { ok: false, needLogin: true, error: '请先登录 B 站' };
          const csrf = auth.csrf;
          if (!csrf) return { ok: false, error: '获取 B 站 CSRF token 失败,请刷新 B 站页面后重试' };

          // 封面:下载后转存 B 站图床(addupdate 的 cover 字段只认 B 站图床)
          let coverUrl = '';
          if (cover) {
            try {
              const blob = await downloadBlob(cover);
              const fd = new FormData();
              fd.append('binary', blob, 'cover.jpg');
              fd.append('csrf', csrf);
              const resp = await postFormData('https://api.bilibili.com/x/article/creative/article/upcover', fd);
              const data = await resp.json();
              if (data.code === 0 && data.data && data.data.url) coverUrl = data.data.url;
            } catch (e) { /* 封面失败不阻塞正文 */ }
          }

          let content = P.sanitizeRichHtml(html, { removeLinks: true });
          const urls = collectHtmlImages(content);
          content = await replaceImages(content, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('binary', blob, 'image.jpg');
            fd.append('csrf', csrf);
            const resp = await postFormData('https://api.bilibili.com/x/article/creative/article/upcover', fd);
            const data = await resp.json();
            if (data.code !== 0 || !data.data || !data.data.url) throw new Error(`图片上传失败(${data.code})`);
            return data.data.url;
          }, true); // 上传失败的图直接移除(B 站不收外链图)
          // 兜底:仍残留的外站图片整段移除
          content = content.replace(/<img[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi, (tag, src) =>
            this.SKIP.test(src) ? tag : '');

          const resp = await postForm('https://api.bilibili.com/x/article/creative/draft/addupdate', {
            tid: '4', title, content, csrf, save: '0', pgc_id: '0', cover: coverUrl,
          });
          const data = await resp.json();
          if (data.code !== 0 || !data.data || !data.data.aid) {
            return { ok: false, error: `保存草稿失败(code=${data.code}):${data.message || '未知'}` };
          }
          return {
            ok: true,
            draftUrl: `https://member.bilibili.com/platform/upload/text/edit?aid=${data.data.aid}`,
            detail: '草稿已写入(B 站需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 百家号(HTML) ============
    baijiahao: {
      name: '百家号', format: 'HTML', group: 'media',
      home: 'https://baijiahao.baidu.com/', note: '图片自动转存百度图床',
      RULES: [{ urlFilter: '*://baijiahao.baidu.com/*', headers: { Origin: 'https://baijiahao.baidu.com', Referer: 'https://baijiahao.baidu.com/' } }],
      SKIP: /baijiahao\.baidu\.com|bdstatic\.com|bcebos\.com/i,
      async checkAuth() {
        const data = await getJSON(`https://baijiahao.baidu.com/builder/app/appinfo?_=${Date.now()}`);
        if (data && data.errmsg === 'success' && data.data && data.data.user) {
          return { authenticated: true, username: data.data.user.name };
        }
        return { authenticated: false };
      },
      async publish({ title, html }) {
        return withHeaderRules(this.RULES, async () => {
          const auth = await this.checkAuth();
          if (!auth.authenticated) return { ok: false, needLogin: true, error: '请先登录百家号' };

          const editHtml = await getText('https://baijiahao.baidu.com/builder/rc/edit');
          const tokenMatch = editHtml.match(/window\.__BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)['"]/);
          if (!tokenMatch) return { ok: false, needLogin: true, error: '登录失效,请重新登录百家号' };
          const authToken = tokenMatch[1];

          let content = P.sanitizeRichHtml(html);
          const urls = collectHtmlImages(content);
          content = await replaceImages(content, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('media', blob, 'image.jpg');
            fd.append('type', 'image');
            fd.append('app_id', '1589639493090963');
            fd.append('is_waterlog', '1');
            fd.append('save_material', '1');
            fd.append('no_compress', '0');
            fd.append('article_type', 'news');
            const resp = await postFormData('https://baijiahao.baidu.com/pcui/picture/uploadproxy', fd);
            const data = await resp.json();
            if (!data.ret || !data.ret.https_url) throw new Error(data.errmsg || '图片上传失败');
            return data.ret.https_url;
          });

          const resp = await postForm('https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft', {
            title, content, feed_cat: '1', len: String(content.length),
            activity_list: JSON.stringify([{ id: 408, is_checked: 0 }]),
            source_reprinted_allow: '0', original_status: '0', original_handler_status: '1',
            isBeautify: 'false', subtitle: '', bjhtopic_id: '', bjhtopic_info: '', type: 'news',
          }, { headers: { token: authToken } });
          const text = await resp.text();
          let data;
          try { data = JSON.parse(text.replace(/^bjhdraft\(/, '').replace(/\)$/, '')); } catch (e) {
            return { ok: false, error: '百家号响应解析失败(可能登录失效)' };
          }
          if (!data.ret || !data.ret.article_id) return { ok: false, error: data.errmsg || '保存草稿失败' };
          return {
            ok: true,
            draftUrl: `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${data.ret.article_id}`,
            detail: '草稿已写入(百家号需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 微博头条文章(HTML) ============
    weibo: {
      name: '微博头条文章', format: 'HTML', group: 'social',
      home: 'https://card.weibo.com/article/v5/editor', note: '图片自动转存微博图床',
      RULES: [{ urlFilter: '*://card.weibo.com/*', headers: { Origin: 'https://card.weibo.com', Referer: 'https://card.weibo.com/article/v5/editor' } }],
      SKIP: /weibo\.com|sinaimg\.cn/i,
      async getUserConfig() {
        const html = await getText('https://card.weibo.com/article/v5/editor');
        const m = html.match(/config:\s*JSON\.parse\('(.+?)'\)/);
        if (!m) return null;
        try {
          const config = JSON.parse(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
          return config.uid ? { uid: String(config.uid), nick: config.nick || '' } : null;
        } catch (e) { return null; }
      },
      reqId(uid) {
        let b = btoa(`${uid}&${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        while (b.length < 43) b += chars.charAt(Math.floor(Math.random() * chars.length));
        return b.slice(0, 43);
      },
      async checkAuth() {
        const config = await this.getUserConfig();
        if (config && config.uid) return { authenticated: true, username: config.nick || String(config.uid) };
        return { authenticated: false };
      },
      async publish({ title, html, cover }) {
        return withHeaderRules(this.RULES, async () => {
          const config = await this.getUserConfig();
          if (!config) return { ok: false, needLogin: true, error: '请先登录微博' };
          const uid = config.uid;

          // 图片转存:异步提交 URL → 轮询拿 pid → 拼 sinaimg 大图地址(封面与正文共用)
          const uploadToWeibo = async (src) => {
            const reqId = this.reqId(uid);
            await postForm(`https://card.weibo.com/article/v5/aj/editor/plugins/asyncuploadimg?uid=${uid}&_rid=${reqId}`,
              { 'urls[0]': src }, { headers: { accept: 'application/json, text/plain, */*', 'SN-REQID': reqId } });
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 1000));
              const pidReqId = this.reqId(uid);
              const resp = await postForm(
                `https://card.weibo.com/article/v5/aj/editor/plugins/asyncimginfo?uid=${uid}&_rid=${pidReqId}`,
                { 'urls[0]': src }, { headers: { accept: 'application/json, text/plain, */*', 'SN-REQID': pidReqId } });
              const data = await resp.json();
              const item = data.data && data.data[0];
              if (item && item.task_status_code === 1 && item.pid) {
                return `https://wx3.sinaimg.cn/large/${item.pid}.jpg`;
              }
            }
            throw new Error('微博图片上传超时');
          };

          // 封面:转存微博图床后填入 cover 字段
          let coverUrl = '';
          if (cover && !this.SKIP.test(cover)) {
            try { coverUrl = await uploadToWeibo(cover); } catch (e) { /* 封面失败不阻塞正文 */ }
          }

          let content = P.sanitizeRichHtml(html).replace(/>\s+</g, '><');
          const urls = collectHtmlImages(content).slice(0, 12);
          content = await replaceImages(content, urls, this.SKIP, uploadToWeibo);

          const createReqId = this.reqId(uid);
          const createResp = await postForm(
            `https://card.weibo.com/article/v5/aj/editor/draft/create?uid=${uid}&_rid=${createReqId}`,
            {}, { headers: { accept: 'application/json, text/plain, */*', 'SN-REQID': createReqId } });
          const createData = await createResp.json();
          if (createData.code !== 100000 || !createData.data || !createData.data.id) {
            return { ok: false, needLogin: createData.code === 100003 || false, error: createData.msg || '创建草稿失败' };
          }
          const postId = createData.data.id;

          const saveReqId = this.reqId(uid);
          const saveResp = await postForm(
            `https://card.weibo.com/article/v5/aj/editor/draft/save?uid=${uid}&id=${postId}&_rid=${saveReqId}`,
            {
              id: postId, title, subtitle: '', type: '', status: '0', publish_at: '',
              error_msg: '', error_code: '0', collection: '[]', free_content: '',
              content, cover: coverUrl, summary: '', writer: '', extra: 'null', is_word: '0',
              article_recommend: '[]', follow_to_read: '1', isreward: '1',
              pay_setting: '{"ispay":0,"isvclub":0}', source: '0', action: '1',
              content_type: '0', save: '1',
            },
            { headers: { accept: 'application/json, text/plain, */*', 'SN-REQID': saveReqId } });
          const saveData = await saveResp.json();
          if (String(saveData.code) !== '100000') {
            return { ok: false, error: saveData.msg || `保存失败(错误码 ${saveData.code})` };
          }
          return {
            ok: true,
            draftUrl: `https://card.weibo.com/article/v5/editor#/draft/${postId}`,
            detail: '草稿已写入(微博需手动发布)',
          };
        });
      },
    },

    // ============ 搜狐号(HTML) ============
    sohu: {
      name: '搜狐号', format: 'HTML', group: 'media',
      home: 'https://mp.sohu.com/mpfe/v3/main/first/page?newsType=1', note: '图片自动转存搜狐图床',
      RULES: [{ urlFilter: '*://mp.sohu.com/*', headers: { Origin: 'https://mp.sohu.com', Referer: 'https://mp.sohu.com/' } }],
      SKIP: /sohu\.com/i,
      async getAccount() {
        const res = await getJSON(`https://mp.sohu.com/mpbp/bp/account/list?_=${Date.now()}`);
        if (!res || res.code !== 2000000 || !res.data || !res.data.data || !res.data.data[0] || !res.data.data[0].accounts) return null;
        const all = [];
        res.data.data.forEach((g) => { if (g.accounts) all.push(...g.accounts); });
        return all[0] || null;
      },
      async checkAuth() {
        const acc = await this.getAccount();
        if (!acc) return { authenticated: false };
        const spCm = (await getCookie('https://mp.sohu.com/', 'mp-cv')) || `100-${Date.now()}`;
        return { authenticated: true, username: acc.nickName, accountId: acc.id, spCm };
      },
      async publish({ title, html, cover }) {
        return withHeaderRules(this.RULES, async () => {
          const acc = await this.getAccount();
          if (!acc) return { ok: false, needLogin: true, error: '请先登录搜狐号' };
          const spCm = (await getCookie('https://mp.sohu.com/', 'mp-cv')) || `100-${Date.now()}`;
          const dvId = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

          const uploadToSohu = async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('file', blob, 'image.jpg');
            fd.append('accountId', acc.id);
            const resp = await postFormData(
              `https://mp.sohu.com/commons/front/outerUpload/image/file?accountId=${acc.id}`, fd);
            const data = await resp.json();
            if (!data.url) throw new Error(data.msg || '图片上传失败');
            return data.url;
          };

          // 封面:转存搜狐图床后填入 cover 字段
          let coverUrl = '';
          if (cover && !this.SKIP.test(cover)) {
            try { coverUrl = await uploadToSohu(cover); } catch (e) { /* 封面失败不阻塞正文 */ }
          }

          let content = P.sanitizeRichHtml(html);
          const urls = collectHtmlImages(content);
          content = await replaceImages(content, urls, this.SKIP, uploadToSohu);

          const resp = await postJSON(
            `https://mp.sohu.com/mpbp/bp/news/v4/news/draft/v2?accountId=${acc.id}`,
            {
              title, brief: '', content, channelId: 24, categoryId: -1, id: 0,
              userColumnId: 0, columnNewsIds: [], businessCode: 0, declareOriginal: false,
              cover: coverUrl, topicIds: [], isAd: 0, userLabels: '[]', reprint: false,
              customTags: '', infoResource: 0, sourceUrl: '', visibleToLoginedUsers: 0,
              attrIds: [], auto: true, accountId: Number(acc.id),
            },
            { headers: { 'X-Requested-With': 'XMLHttpRequest', 'dv-id': dvId, 'sp-cm': spCm } });
          const data = await resp.json();
          if (!data.success) return { ok: false, error: data.msg || '保存失败' };
          return {
            ok: true,
            draftUrl: `https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?spm=smmp.articlelist.0.0&contentStatus=2&id=${data.data}`,
            detail: '草稿已写入(搜狐号需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ CSDN(Markdown,签名 API) ============
    csdn: {
      name: 'CSDN', format: 'Markdown', group: 'tech',
      home: 'https://editor.csdn.net/md/', note: '图片自动转存(CSDN 图床)',
      RULES: [{ urlFilter: '*://bizapi.csdn.net/*', headers: { Origin: 'https://editor.csdn.net', Referer: 'https://editor.csdn.net/' } }],
      API_KEY: '203803574',
      API_SECRET: '9znpamsyl2c7cdrr9sas0le9vbc3r6ba',
      SKIP: /csdnimg\.cn|csdn\.net/i,
      async hmacSha256(message, secret) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
      },
      uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      },
      async sign(apiPath, method) {
        const nonce = this.uuid();
        const signStr = method === 'GET'
          ? `GET\n*/*\n\n\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`
          : `POST\n*/*\n\napplication/json\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`;
        const signature = await this.hmacSha256(signStr, this.API_SECRET);
        const headers = {
          accept: '*/*',
          'x-ca-key': this.API_KEY,
          'x-ca-nonce': nonce,
          'x-ca-signature': signature,
          'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
        };
        if (method !== 'GET') headers['content-type'] = 'application/json';
        return headers;
      },
      async checkAuth() {
        return withHeaderRules(this.RULES, async () => {
          const apiPath = '/blog-console-api/v3/editor/getBaseInfo';
          const headers = await this.sign(apiPath, 'GET');
          const data = await getJSON(`https://bizapi.csdn.net${apiPath}`, { headers });
          if (data.code === 200 && data.data && data.data.name) {
            return { authenticated: true, username: data.data.nickname || data.data.name };
          }
          return { authenticated: false };
        });
      },
      async publish({ title, html, markdown }) {
        return withHeaderRules(this.RULES, async () => {
          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const ext = (src.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
            const validExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg';
            const apiPath = '/resource-api/v1/image/direct/upload/signature';
            const headers = await this.sign(apiPath, 'POST');
            const resp = await postJSON(`https://bizapi.csdn.net${apiPath}`,
              { imageTemplate: '', appName: 'direct_blog_markdown', imageSuffix: validExt }, { headers });
            const sig = await resp.json();
            if (sig.code !== 200 || !sig.data) throw new Error('签名失败');
            const d = sig.data;
            const fd = new FormData();
            fd.append('key', d.filePath);
            fd.append('policy', d.policy);
            fd.append('signature', d.signature);
            fd.append('callbackBody', d.callbackBody);
            fd.append('callbackBodyType', d.callbackBodyType);
            fd.append('callbackUrl', d.callbackUrl);
            fd.append('AccessKeyId', d.accessId);
            const cp = d.customParam || {};
            fd.append('x:rtype', cp.rtype);
            fd.append('x:filePath', cp.filePath);
            fd.append('x:isAudit', String(cp.isAudit));
            fd.append('x:x-image-app', cp['x-image-app']);
            fd.append('x:type', cp.type);
            fd.append('x:x-image-suffix', cp['x-image-suffix']);
            fd.append('x:username', cp.username);
            fd.append('file', blob, `image.${validExt}`);
            const obsResp = await postFormData(d.host, fd);
            const obs = await obsResp.json();
            if (obs.code !== 200 || !obs.data || !obs.data.imageUrl) throw new Error('OBS 上传失败');
            return obs.data.imageUrl;
          });

          const apiPath = '/blog-console-api/v3/mdeditor/saveArticle';
          const headers = await this.sign(apiPath, 'POST');
          const resp = await postJSON(`https://bizapi.csdn.net${apiPath}`, {
            title,
            markdowncontent: md,
            content: P.sanitizeRichHtml(html),
            readType: 'public', level: 0, tags: '', status: 2, categories: '',
            type: 'original', original_link: '', authorized_status: false,
            not_auto_saved: '1', source: 'pc_mdeditor', cover_images: [],
            cover_type: 1, is_new: 1, vote_id: 0, resource_id: '', pubStatus: 'draft',
            creator_activity_id: '',
          }, { headers });
          const data = await resp.json();
          if (data.code !== 200 || !data.data || !data.data.id) {
            return { ok: false, needLogin: data.code === 401 || false, error: data.msg || data.message || '保存草稿失败' };
          }
          return {
            ok: true,
            draftUrl: `https://editor.csdn.net/md?articleId=${data.data.id}`,
            detail: '草稿已写入(CSDN 需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 思否 SegmentFault(Markdown) ============
    segmentfault: {
      name: '思否', format: 'Markdown', group: 'tech',
      home: 'https://segmentfault.com/user/draft', note: '图片自动转存思否图床',
      RULES: [{ urlFilter: '*://segmentfault.com/gateway/*', headers: { Origin: 'https://segmentfault.com', Referer: 'https://segmentfault.com/' } }],
      async checkAuth() {
        const html = await getText('https://segmentfault.com/user/settings');
        const m = html.match(/href="\/u\/([^"]+)"/);
        return m ? { authenticated: true, username: m[1] } : { authenticated: false };
      },
      async getToken() {
        const html = await getText('https://segmentfault.com/write');
        const m = html.match(/serverData":\s*\{\s*"Token"\s*:\s*"([^"]+)"/);
        if (m) return m[1];
        throw new Error('获取 session token 失败(可能未登录思否)');
      },
      async publish({ title, markdown }) {
        return withHeaderRules(this.RULES, async () => {
          const token = await this.getToken();
          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, /segmentfault\.com/i, async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('image', blob);
            const resp = await postFormData('https://segmentfault.com/gateway/image', fd, { headers: { token } });
            const text = await resp.text();
            if (text === 'Unauthorized') throw new Error('未授权');
            const data = JSON.parse(text);
            if (data && data.result) return data.result;
            if (Array.isArray(data) && data[0] === 0 && data[1]) {
              return String(data[1]).startsWith('http') ? data[1] : `https://image-static.segmentfault.com/${data[2]}`;
            }
            throw new Error('图片上传失败');
          });

          const resp = await postJSON('https://segmentfault.com/gateway/draft',
            { title, tags: [], text: md, object_id: '', type: 'article' },
            { headers: { token, accept: '*/*' } });
          const text = await resp.text();
          if (text === 'Unauthorized') return { ok: false, needLogin: true, error: '思否登录态失效' };
          let data;
          try { data = JSON.parse(text); } catch (e) { return { ok: false, error: '思否响应解析失败' }; }
          const draftId = (Array.isArray(data) ? data[1] && data[1].id : data.id);
          if (!draftId) return { ok: false, error: (Array.isArray(data) && data[1]) || '思否保存失败' };
          return {
            ok: true,
            draftUrl: `https://segmentfault.com/write?draftId=${draftId}`,
            detail: '草稿已写入(思否需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 博客园(Markdown) ============
    cnblogs: {
      name: '博客园', format: 'Markdown', group: 'tech',
      home: 'https://i.cnblogs.com/posts/edit', note: '图片自动转存博客园图床',
      RULES: [
        { urlFilter: '*://i.cnblogs.com/*', headers: { Origin: 'https://i.cnblogs.com', Referer: 'https://i.cnblogs.com/' } },
        { urlFilter: '*://upload.cnblogs.com/*', headers: { Origin: 'https://i.cnblogs.com', Referer: 'https://i.cnblogs.com/' } },
      ],
      SKIP: /cnblogs\.com/i,
      async checkAuth() {
        const text = await getText('https://home.cnblogs.com/user/CurrentUserInfo');
        const m = text.match(/href="\/u\/([^/]+)\/"/);
        if (!m) return { authenticated: false };
        const xsrf = await getCookie('https://i.cnblogs.com/', 'XSRF-TOKEN');
        return { authenticated: true, username: m[1], xsrf };
      },
      async publish({ title, markdown }) {
        return withHeaderRules(this.RULES, async () => {
          await getText('https://i.cnblogs.com/posts/edit'); // 触发设置 cookie
          let xsrf = await getCookie('https://i.cnblogs.com/', 'XSRF-TOKEN')
            || await getCookie('https://www.cnblogs.com/', 'XSRF-TOKEN');
          if (!xsrf) return { ok: false, needLogin: true, error: '获取博客园 XSRF-TOKEN 失败,请确认已登录博客园' };

          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('image', blob, 'image.png');
            fd.append('app', 'blog');
            fd.append('uploadType', 'Select');
            const resp = await postFormData('https://upload.cnblogs.com/v2/images/cors-upload', fd,
              { headers: { 'x-xsrf-token': xsrf } });
            const data = await resp.json();
            const imgUrl = data.data || data.url || data.imageUrl || data.src;
            if (!imgUrl || typeof imgUrl !== 'string') throw new Error('图片上传失败');
            return imgUrl;
          });

          const resp = await postJSON('https://i.cnblogs.com/api/posts', {
            id: null, postType: 2, accessPermission: 0, title, url: null,
            postBody: md, categoryIds: null, categories: null, collectionIds: [],
            inSiteCandidate: false, inSiteHome: false, siteCategoryId: null, blogTeamIds: null,
            isPublished: false, displayOnHomePage: false, isAllowComments: true,
            includeInMainSyndication: false, isPinned: false, showBodyWhenPinned: false,
            isOnlyForRegisterUser: false, isUpdateDateAdded: false, entryName: null,
            description: null, featuredImage: null, tags: null, password: null, publishAt: null,
            datePublished: new Date().toISOString(), dateUpdated: null, isMarkdown: true,
            isDraft: true, autoDesc: null, changePostType: false, blogId: 0, author: null,
            removeScript: false, clientInfo: null, changeCreatedTime: false,
            canChangeCreatedTime: false, isContributeToImpressiveBugActivity: false,
            usingEditorId: 5, sourceUrl: null,
          }, { headers: { 'x-xsrf-token': xsrf } });
          if (!resp.ok) {
            if (resp.status === 401 || resp.status === 403) {
              return { ok: false, needLogin: true, error: '未登录或登录已过期,请重新登录博客园' };
            }
            return { ok: false, error: `创建草稿失败: HTTP ${resp.status}` };
          }
          const data = await resp.json();
          if (!data.id) return { ok: false, error: data.error || '博客园创建草稿失败' };
          return {
            ok: true,
            draftUrl: `https://i.cnblogs.com/articles/edit;postId=${data.id}`,
            detail: '草稿已写入(博客园需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 开源中国(Markdown) ============
    oschina: {
      name: '开源中国', format: 'Markdown', group: 'tech',
      home: 'https://my.oschina.net', note: '图片自动转存',
      RULES: [{ urlFilter: '*://apiv1.oschina.net/oschinapi/*', headers: { Origin: 'https://my.oschina.net', Referer: 'https://my.oschina.net/' } }],
      SKIP: /oschina\.net/i,
      async checkAuth() {
        const data = await getJSON('https://apiv1.oschina.net/oschinapi/user/myDetails');
        if (data && data.success && data.result && data.result.userId) {
          return { authenticated: true, username: (data.result.userVo && data.result.userVo.name) || String(data.result.userId), userId: String(data.result.userId) };
        }
        return { authenticated: false };
      },
      async publish({ title, markdown }) {
        return withHeaderRules(this.RULES, async () => {
          const auth = await this.checkAuth();
          if (!auth.authenticated) return { ok: false, needLogin: true, error: '请先登录开源中国' };
          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('file', blob, 'image');
            const resp = await postFormData('https://apiv1.oschina.net/oschinapi/ai/creation/project/uploadDetail', fd);
            const data = await resp.json();
            if (!data.success || !data.result) throw new Error(data.message || '图片上传失败');
            return data.result;
          });
          const resp = await postJSON('https://apiv1.oschina.net/oschinapi/api/draft/save_draft', {
            title, user: Number(auth.userId), content: md, contentType: 1,
            catalog: 0, originUrl: '', privacy: true, disableComment: false,
          });
          const data = await resp.json();
          if (!data.success || !data.result || !data.result.id) {
            return { ok: false, error: data.message || '开源中国保存失败' };
          }
          return {
            ok: true,
            draftUrl: `https://my.oschina.net/u/${auth.userId}/blog/write/draft/${data.result.id}`,
            detail: '草稿已写入(开源中国需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 慕课手记(Markdown) ============
    imooc: {
      name: '慕课手记', format: 'Markdown', group: 'tech',
      home: 'https://www.imooc.com/article', note: '图片自动转存',
      RULES: [{ urlFilter: '*://www.imooc.com/article/*', headers: { Origin: 'https://www.imooc.com', Referer: 'https://www.imooc.com/' } }],
      SKIP: /imooc\.com/i,
      async checkAuth() {
        let text = await getText('https://www.imooc.com/u/card');
        text = text.replace('jsonpcallback(', '').replace(/\}\)\s*$/, '}');
        const result = JSON.parse(text);
        if (result.result !== 0) return { authenticated: false, reason: result.msg };
        return { authenticated: true, username: result.data.nickname || String(result.data.uid) };
      },
      async publish({ title, markdown }) {
        return withHeaderRules(this.RULES, async () => {
          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const filename = `${Date.now()}.jpg`;
            const fd = new FormData();
            fd.append('photo', blob, filename);
            fd.append('type', blob.type || 'image/jpeg');
            fd.append('id', 'WU_FILE_0');
            fd.append('name', filename);
            fd.append('size', String(blob.size));
            const resp = await postFormData('https://www.imooc.com/article/ajaxuploadimg', fd);
            const data = await resp.json();
            if (data.result !== 0) throw new Error(data.msg || '图片上传失败');
            let imgUrl = data.data.imgpath;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            return imgUrl;
          });
          const resp = await postForm('https://www.imooc.com/article/savedraft',
            { editor: '0', draft_id: '0', title, content: md });
          const data = await resp.json();
          if (!data.data) return { ok: false, error: '慕课手记保存失败(可能未登录)' };
          return {
            ok: true,
            draftUrl: `https://www.imooc.com/article/draft/id/${data.data}`,
            detail: '草稿已写入(慕课需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 雪球(Markdown → 简化 HTML) ============
    xueqiu: {
      name: '雪球', format: 'Markdown', group: 'media',
      home: 'https://mp.xueqiu.com/writeV2', note: '图片自动转存雪球图床',
      RULES: [{ urlFilter: '*://mp.xueqiu.com/xq/*', headers: { Origin: 'https://mp.xueqiu.com', Referer: 'https://mp.xueqiu.com/' } }],
      SKIP: /xueqiu\.com|imedao\.com/i,
      async checkAuth() {
        const html = await getText('https://mp.xueqiu.com/writeV2');
        const m = html.match(/window\.UOM_CURRENTUSER\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!m) return { authenticated: false };
        try {
          const state = JSON.parse(m[1]);
          if (state.currentUser && state.currentUser.id) {
            return { authenticated: true, username: state.currentUser.screen_name };
          }
        } catch (e) { /* ignore */ }
        return { authenticated: false };
      },
      async publish({ title, markdown, cover }) {
        return withHeaderRules(this.RULES, async () => {
          const auth = await this.checkAuth();
          if (!auth.authenticated) return { ok: false, needLogin: true, error: '请先登录雪球' };

          const uploadToXueqiu = async (src) => {
            const blob = await downloadBlob(src);
            const fd = new FormData();
            fd.append('file', blob, 'image.jpg');
            const resp = await postFormData('https://mp.xueqiu.com/xq/photo/upload.json', fd);
            const data = await resp.json();
            if (!data.url || !data.filename) throw new Error('图片上传失败');
            return data.url.startsWith('//') ? `https:${data.url}/${data.filename}` : `${data.url}/${data.filename}`;
          };

          let md = markdown || '';
          const urls = collectMdImages(md);
          md = await replaceImages(md, urls, this.SKIP, uploadToXueqiu);

          // 封面:转存雪球图床后填入 cover_pic
          let coverPic = '';
          if (cover && !this.SKIP.test(cover)) {
            try { coverPic = await uploadToXueqiu(cover); } catch (e) { /* 封面失败不阻塞正文 */ }
          }

          const content = mdToXueqiuHtml(md);
          const resp = await postForm('https://mp.xueqiu.com/xq/statuses/draft/save.json', {
            text: content, title, cover_pic: coverPic, flags: 'false', original_event: '',
            status_id: '', legal_user_visible: 'false', is_private: 'false',
          });
          const data = await resp.json();
          if (!data.id) return { ok: false, error: data.error_description || '雪球保存失败' };
          return {
            ok: true,
            draftUrl: `https://mp.xueqiu.com/write/draft/${data.id}`,
            detail: '草稿已写入(雪球需手动发布),图片已转存',
          };
        });
      },
    },

    // ============ 人人都是产品经理(HTML) ============
    woshipm: {
      name: '人人都是产品经理', format: 'HTML', group: 'media',
      home: 'https://www.woshipm.com/writing', note: '图片自动转存',
      RULES: [{ urlFilter: '*://www.woshipm.com/tensorflow/*', headers: { Origin: 'https://www.woshipm.com', Referer: 'https://www.woshipm.com/writing' } }],
      SKIP: /woshipm\.com/i,
      async checkAuth() {
        const page = await getText('https://www.woshipm.com/writing');
        const uidMatch = page.match(/var\s+userSettings\s*=\s*\{[^}]*"uid"\s*:\s*"(\d+)"/);
        if (!uidMatch) return { authenticated: false };
        const data = await getJSON(`https://www.woshipm.com/api2/user/profile?uid=${uidMatch[1]}`,
          { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (data.CODE === 200 && data.RESULT && data.RESULT.userInfoVo && data.RESULT.userInfoVo.uid) {
          const jltokenMatch = page.match(/"jltoken"\s*:\s*"([^"]+)"/);
          return {
            authenticated: true,
            username: data.RESULT.userInfoVo.nickName,
            jltoken: jltokenMatch ? jltokenMatch[1] : '',
          };
        }
        return { authenticated: false };
      },
      async publish({ title, html }) {
        return withHeaderRules(this.RULES, async () => {
          const auth = await this.checkAuth();
          if (!auth.authenticated) return { ok: false, needLogin: true, error: '请先登录人人都是产品经理' };
          let content = P.sanitizeRichHtml(html);
          const urls = collectHtmlImages(content);
          content = await replaceImages(content, urls, this.SKIP, async (src) => {
            const blob = await downloadBlob(src);
            const filename = (src.split('?')[0].split('/').pop() || 'image.png');
            const fd = new FormData();
            fd.append('action', 'wpuf_insert_image');
            fd.append('name', filename);
            fd.append('files', blob, filename);
            const headers = auth.jltoken ? { jlstar: `Bearer ${auth.jltoken}` } : {};
            const resp = await postFormData('https://www.woshipm.com/tensorflow/upyun/upload', fd, { headers });
            const data = await resp.json();
            if (data.data && data.data[0] && data.data[0].url) return data.data[0].url;
            throw new Error(data.error || '图片上传失败');
          });
          const resp = await postForm('https://www.woshipm.com/wp-admin/admin-ajax.php',
            { action: 'add_draft', post_title: title, post_content: content },
            { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          const text = await resp.text();
          let data;
          try { data = JSON.parse(text); } catch (e) { return { ok: false, error: '响应解析失败(可能未登录)' }; }
          if (!data.post_id) return { ok: false, error: data.error || '保存草稿失败' };
          return {
            ok: true,
            draftUrl: data.url || `https://www.woshipm.com/writing?pid=${data.post_id}`,
            detail: '草稿已写入(人人都是产品经理需手动发布),图片已转存',
          };
        });
      },
    },
  };

  return {
    PLATFORMS,
    get: (id) => PLATFORMS[id] || null,
    // 供测试使用
    _internal: { mdToXueqiuHtml, collectHtmlImages, collectMdImages, replaceImages, withHeaderRules, getCookie },
  };
})();
