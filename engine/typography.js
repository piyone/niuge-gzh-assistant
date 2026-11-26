/**
 * 牛哥公众号助手 · 中文排版规范引擎
 * 针对公众号场景的纯 DOM 文字处理:盘古之白、全角标点修正、空行压缩、外链脚注化。
 * 所有函数只操作传入的 DOM 节点,不依赖 chrome API,便于测试复用。
 */
window.MoPaiTypo = (() => {
  const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
  const CJK_RE = new RegExp(`[${CJK}]`);

  const isCJK = (ch) => ch && CJK_RE.test(ch);

  /** 统计信息 */
  function analyzeText(input) {
    // 支持传字符串(调用方可先做隐藏节点剔除等预处理)
    const text = (typeof input === 'string' ? input : (input.innerText || input.textContent || '')).replace(/\u00a0/g, ' ');
    const cjk = (text.match(new RegExp(`[${CJK}]`, 'g')) || []).length;
    const latinWords = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)?/g) || []).length;
    const digits = (text.match(/\d+/g) || []).length;
    return {
      cjkChars: cjk,
      latinWords,
      numberGroups: digits,
      totalChars: text.replace(/\s/g, '').length,
      // 阅读时长:中文 400 字/分钟,英文 200 词/分钟,数字串按 2 词算
      readMinutes: Math.max(1, Math.round(cjk / 400 + latinWords / 200 + digits / 100)) || 1,
    };
  }

  /** 单个文本节点的中西文加空格(盘古之白) */
  function padSpacesInText(text) {
    let changed = 0;
    let out = text
      .replace(new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g'), (m, a, b) => { changed++; return a + ' ' + b; })
      .replace(new RegExp(`([A-Za-z0-9])([${CJK}])`, 'g'), (m, a, b) => { changed++; return a + ' ' + b; });
    return { text: out, changed };
  }

  /**
   * 半角标点 → 全角(仅当中文语境:前一字符是 CJK,且后一字符是 CJK/空白/文末)
   * 数字旁的 . 不动,避免破坏 3.14、v1.2 这类写法。
   */
  const PUNCT_MAP = { ',': ',', '.': '。', '!': '!', '?': '?', ':': ':', ';': ';' };
  function fixPunctInText(text) {
    let changed = 0;
    const out = Array.from(text).map((ch, i, arr) => {
      if (!(ch in PUNCT_MAP)) return ch;
      const prev = arr[i - 1];
      let j = i + 1;
      while (j < arr.length && /\s/.test(arr[j])) j++;
      const next = arr[j];
      if (!isCJK(prev)) return ch;
      if (next === undefined || isCJK(next)) { changed++; return PUNCT_MAP[ch]; }
      return ch;
    }).join('');
    return { text: out, changed };
  }

  /**
   * 省略号标准化:中文语境的 「。。。」/「...」 → 「……」
   * 保护:v1.2.3、URL(https://a.com/...)等数字/字母相邻的点不动。
   */
  function fixEllipsisInText(text) {
    let changed = 0;
    let out = text.replace(/。{2,}/g, () => { changed++; return '……'; });
    // 3 个以上半角点:仅当前后都不是字母/数字/点时才转换
    out = out.replace(/\.{3,}/g, (m, offset, full) => {
      const prev = full[offset - 1];
      const next = full[offset + m.length];
      const isWord = (c) => c && /[A-Za-z0-9.]/.test(c);
      if (isWord(prev) || isWord(next)) return m;
      changed++;
      return '……';
    });
    return { text: out, changed };
  }

  /**
   * 连续同标点收敛(仅中文语境):「!!!」→「!」「???」→「?」「,,」→「,」
   * 处理双引号/省略号以外的重复标点;默认关闭,由规则开关控制。
   */
  function collapsePunctInText(text) {
    let changed = 0;
    const out = text.replace(/([!?:;,,~])\1{1,}/g, (m, ch, offset, full) => {
      const prev = full[offset - 1];
      const next = full[offset + m.length];
      const isWord = (c) => c && /[A-Za-z0-9]/.test(c);
      // 英文语境(如 "what!!!" 结尾在字母后)不动
      if (isWord(prev) && !isCJK(prev)) return m;
      if (ch === ',' && (isWord(prev) || (next && /[0-9]/.test(next)))) return m;
      changed++;
      return ch;
    });
    return { text: out, changed };
  }

  /** 遍历文本节点;skipFn 返回 true 则跳过该元素子树(如 pre/code) */
  function walkTextNodes(root, fn, skipFn) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (skipFn && skipFn(p)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(fn);
  }

  const inPre = (el) => !!el.closest('pre, code, kbd, samp');

  /** 中西文空格 + 全角标点 + 省略号/连续标点(跳过代码块)。opts: {ellipsis:true, collapse:false} */
  function normalizeSpaces(root, opts) {
    const o = Object.assign({ ellipsis: true, collapse: false }, opts || {});
    let count = 0;
    let ellipsis = 0;
    let collapsed = 0;
    walkTextNodes(root, (node) => {
      let r = padSpacesInText(node.nodeValue);
      if (r.changed) { node.nodeValue = r.text; count += r.changed; }
      r = fixPunctInText(node.nodeValue);
      if (r.changed) { node.nodeValue = r.text; count += r.changed; }
      if (o.ellipsis) {
        r = fixEllipsisInText(node.nodeValue);
        if (r.changed) { node.nodeValue = r.text; count += r.changed; ellipsis += r.changed; }
      }
      if (o.collapse) {
        r = collapsePunctInText(node.nodeValue);
        if (r.changed) { node.nodeValue = r.text; count += r.changed; collapsed += r.changed; }
      }
    }, inPre);
    normalizeSpaces._last = { ellipsis, collapsed };
    return count;
  }

  /** 仅标点修正 */
  function normalizePunct(root) {
    let count = 0;
    walkTextNodes(root, (node) => {
      const r = fixPunctInText(node.nodeValue);
      if (r.changed) { node.nodeValue = r.text; count += r.changed; }
    }, inPre);
    return count;
  }

  /**
   * 压缩连续空段落:连续 ≥2 个"空 p"(仅空白或仅 <br>)压缩为 1 个。
   * 返回删除的空段数量。
   */
  function squeezeBlankParas2(root) {
    const isEmptyP = (el) =>
      el.tagName === 'P' && !el.querySelector('img,video,iframe,table') &&
      el.textContent.replace(/\u00a0|\s/g, '') === '';
    let removed = 0;
    // 文首/文末的空段全部删除(顶部空白的主要来源:正文开头残留的空 <p>)
    while (root.firstElementChild && isEmptyP(root.firstElementChild)) {
      root.firstElementChild.remove();
      removed++;
    }
    while (root.lastElementChild && isEmptyP(root.lastElementChild)) {
      root.lastElementChild.remove();
      removed++;
    }
    // 中间的连续空段只保留一个(分隔感),单个空段保留
    let run = 0;
    Array.from(root.children).forEach((el) => {
      const empty = isEmptyP(el);
      if (empty) {
        run++;
        if (run >= 2) { el.remove(); removed++; }
      } else {
        run = 0;
      }
    });
    return removed;
  }

  /**
   * 外链脚注化:公众号正文不允许外链,把非 mp.weixin.qq.com 的 <a> 转为
   * 「文本 + [n] 上标」,文末追加「引用链接」小节。返回 {count, refsHtml} 或 null。
   */
  function footnotify(root, opts) {
    const refs = [];
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      if (/mp\.weixin\.qq\.com/i.test(href)) return;
      refs.push({ text: (a.textContent || '').trim() || href, href });
      const n = refs.length;
      const sup = document.createElement('sup');
      sup.textContent = `[${n}]`;
      const label = document.createTextNode(a.textContent || href);
      a.replaceWith(label, sup);
    });
    if (!refs.length) return null;

    const v = opts && opts.vars ? opts.vars : {};
    const primary = v.primary || '#576b95';
    const secondary = v.secondary || '#888888';
    const sec = document.createElement('section');
    sec.setAttribute('data-mopai-refs', '1');
    sec.innerHTML =
      `<p style="margin:28px 0 10px;font-size:15px;font-weight:700;color:${primary};border-top:1px solid ${secondary}40;padding-top:16px;">引用链接</p>` +
      `<ol style="margin:0;padding-left:20px;font-size:13px;color:${secondary};line-height:1.8;">` +
      refs.map((r) => `<li style="margin:4px 0;word-break:break-all;">${escapeHtml(r.text)}:${escapeHtml(r.href)}</li>`).join('') +
      `</ol>`;
    root.appendChild(sec);
    return { count: refs.length };
  }

  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * 对已有富文本(编辑器内容)做全部规范处理。
   * opts: { padSpaces, punct, blank, footnote, ellipsis, collapse, vars }
   */
  /**
   * 小标题识别:把「整段加粗的短行」升级为 h3。
   * 公众号编辑器里用户常以加粗段落当小标题(非语义 h2/h3),格式刷无法套标题样式。
   * 规则:p 的可见内容全部加粗(strong/b 或 inline font-weight≥600)、
   * 文本 2~30 字、不以句读标点结尾(避免误伤强调句)。返回升级数量。
   */
  function promoteHeadings(root) {
    let count = 0;
    Array.from(root.querySelectorAll('p')).forEach((p) => {
      if (p.querySelector('img,video,iframe,table,a,blockquote')) return;
      const text = (p.textContent || '').replace(/\s+/g, '');
      if (!text || text.length < 2 || text.length > 30) return;
      if (/[。！？；，、：,.!?;:]$/.test(text)) return;
      let allBold = true;
      p.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          if (n.nodeValue.replace(/\s+/g, '')) allBold = false;
        } else if (n.nodeType === 1) {
          if (n.tagName === 'STRONG' || n.tagName === 'B') return;
          const w = (n.style && parseInt(n.style.fontWeight, 10)) || 400;
          if (w < 600) allBold = false;
        }
      });
      if (!allBold) return;
      const h = document.createElement('h3');
      h.innerHTML = p.innerHTML;
      p.replaceWith(h);
      count++;
    });
    return count;
  }

  function normalizeExisting(root, opts) {
    const o = Object.assign({
      padSpaces: true, punct: true, blank: true, footnote: true,
      ellipsis: true, collapse: false, headingDetect: true,
    }, opts);
    const report = { spaces: 0, blanks: 0, footnotes: 0, ellipsis: 0, collapsed: 0, headings: 0 };
    normalizeSpaces._last = { ellipsis: 0, collapsed: 0 };
    if (o.headingDetect !== false) report.headings = promoteHeadings(root);
    if (o.padSpaces) report.spaces = normalizeSpaces(root, { ellipsis: o.ellipsis, collapse: o.collapse });
    else if (o.punct) report.spaces = normalizePunct(root);
    report.ellipsis = normalizeSpaces._last ? normalizeSpaces._last.ellipsis : 0;
    report.collapsed = normalizeSpaces._last ? normalizeSpaces._last.collapsed : 0;
    if (o.blank) report.blanks = squeezeBlankParas2(root);
    if (o.footnote) {
      const r = footnotify(root, o);
      report.footnotes = r ? r.count : 0;
    }
    return report;
  }

  return { analyzeText, normalizeSpaces, normalizePunct, squeezeBlankParas2, footnotify, normalizeExisting, promoteHeadings, fixEllipsisInText, collapsePunctInText, CJK_RE };
})();
