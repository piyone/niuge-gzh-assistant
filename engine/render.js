/**
 * 牛哥公众号助手 · 渲染管线
 * Markdown → (marked 解析) → (DOMPurify 消毒) → (中文排版规范)
 *         → (代码高亮) → (主题内联样式) → 公众号可直接粘贴的富文本 HTML
 */
window.MoPaiRender = (() => {
  const hasLibs = () =>
    typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined';

  const DEFAULTS = { padSpaces: true, punct: true, blank: true, footnote: true, highlight: true, ellipsis: true, collapse: false };

  function ensureMarkedOptions() {
    if (marked.setOptions) {
      marked.setOptions({ gfm: true, breaks: true });
    }
  }

  /** 在 detached 节点上做代码高亮,并把 hljs class 转为行内 color */
  function highlightCode(root, vars) {
    if (typeof hljs === 'undefined') return 0;
    let count = 0;
    root.querySelectorAll('pre code').forEach((code) => {
      const langM = (code.className || '').match(/language-([\w+-]+)/);
      const lang = langM ? langM[1] : null;
      const src = code.textContent;
      let html = null;
      try {
        if (lang && hljs.getLanguage(lang)) {
          html = hljs.highlight(src, { language: lang, ignoreIllegals: true }).value;
        } else if (src.length > 24) {
          const auto = hljs.highlightAuto(src);
          if (auto.relevance > 4) html = auto.value;
        }
      } catch (e) { /* 高亮失败则保持纯文本 */ }
      if (html !== null) {
        code.innerHTML = html;
        count++;
      }
    });
    return count;
  }

  /** 对 detached div 应用完整渲染管线;返回 {root, html, report} */
  function renderMarkdown(md, themeId, overrides) {
    if (!hasLibs()) throw new Error('依赖库未加载');
    ensureMarkedOptions();
    const opts = Object.assign({}, DEFAULTS, overrides || {});
    const theme = window.MoPaiThemes.getTheme(themeId);
    const vars = theme.vars;
    const styleOpts = {
      fontSize: (overrides && overrides.fontSize) || 15,
      lineHeight: (overrides && overrides.lineHeight) || 1.8,
      imgRadius: typeof (overrides && overrides.imgRadius) === 'number' ? overrides.imgRadius : 4,
      flavor: theme.flavor,
    };
    const styleMap = window.MoPaiThemes.makeStyleMap(vars, styleOpts);

    const raw = marked.parse(md || '');
    const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['style', 'target'], FORBID_TAGS: ['style'] });

    const root = document.createElement('div');
    root.innerHTML = clean;

    const report = {};
    if (opts.highlight) report.highlighted = highlightCode(root, vars);

    // 排版规范(复用内容处理逻辑)
    const typo = window.MoPaiTypo;
    if (opts.padSpaces) {
      report.spaces = typo.normalizeSpaces(root, { ellipsis: opts.ellipsis !== false, collapse: opts.collapse === true });
      report.ellipsis = typo.normalizeSpaces._last ? typo.normalizeSpaces._last.ellipsis : 0;
    } else if (opts.punct) {
      report.spaces = typo.normalizePunct(root);
    }
    if (opts.blank) report.blanks = typo.squeezeBlankParas2(root);
    if (opts.footnote) {
      const fr = typo.footnotify(root, { vars });
      report.footnotes = fr ? fr.count : 0;
    }

    // 微信兼容适配(代码块空格保护 + 任务列表字符化)
    report.codeSpaces = protectCodeSpaces(root);
    report.tasks = adaptTaskLists(root);

    // 主题内联样式
    window.MoPaiThemes._currentTokens = window.MoPaiThemes.tokensFor(vars);
    window.MoPaiThemes.applyTheme(root, styleMap);
    applySidePad(root, opts && opts.sidePad);

    return { root, html: root.innerHTML, report, styleMap, vars, theme };
  }

  /**
   * 微信适配①:代码块缩进空格保护。
   * 微信编辑器会把连续普通空格合并成一个,代码缩进全乱;
   * 把每行行首空格替换为不可断空格 \u00A0(微信不会合并)。
   * 只动文本节点,不破坏 hljs 高亮的 span 结构。
   */
  function protectCodeSpaces(root) {
    let count = 0;
    root.querySelectorAll('pre').forEach((pre) => {
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((n) => {
        if (/(^|\n)( +)/.test(n.nodeValue)) {
          n.nodeValue = n.nodeValue.replace(/(^|\n)( +)/g, (m, br, sp) => br + '\u00A0'.repeat(sp.length));
          count++;
        }
      });
    });
    return count;
  }

  /**
   * 微信适配②:任务列表转换。
   * 微信不支持 <input type="checkbox">(表单元素被过滤),
   * GFM 任务列表渲染出的 checkbox 替换为 ☑/☐ Unicode 字符;
   * 兼容处理字面量 "[x] "/"[ ] " 开头的列表项。
   */
  function adaptTaskLists(root) {
    let count = 0;
    root.querySelectorAll('li').forEach((li) => {
      const input = li.querySelector(':scope > input[type="checkbox"], :scope input[type="checkbox"]');
      if (input) {
        const span = document.createElement('span');
        span.textContent = input.checked ? '☑ ' : '☐ ';
        input.replaceWith(span);
        count++;
        return;
      }
      const first = li.firstChild;
      if (first && first.nodeType === 3 && /^\[( |x|X)\]\s*/.test(first.nodeValue)) {
        const done = /^\[[xX]\]/.test(first.nodeValue);
        first.nodeValue = first.nodeValue.replace(/^\[( |x|X)\]\s*/, done ? '☑ ' : '☐ ');
        count++;
      }
    });
    return count;
  }

  /**
   * 两侧边距:给根级每个块级元素加水平留白,让整篇文章左右留白统一。
   * 只处理根的直接子元素,嵌套元素(li 内的 p 等)不重复加。
   * 带左侧色条/底纹的块(色条标题、引用块)必须用 margin 缩进:
   * border 画在 padding 外侧,若用 padding 缩进,色条会悬在正文左缘之外,与正文不对齐。
   */
  function applySidePad(root, px) {
    const pad = parseInt(px, 10) || 0;
    if (pad <= 0) return;
    Array.from(root.children).forEach((el) => {
      if (el.closest('[data-mopai-refs]')) return;
      if (parseFloat(el.style.borderLeftWidth) > 0) {
        el.style.marginLeft = pad + 'px';
        el.style.marginRight = pad + 'px';
      } else {
        el.style.paddingLeft = pad + 'px';
        el.style.paddingRight = pad + 'px';
      }
    });
  }

  /** 对编辑器已有内容做「套主题」(只加内联样式,不动文字) */
  function themeExisting(root, themeId, overrides) {
    const theme = window.MoPaiThemes.getTheme(themeId);
    const styleMap = window.MoPaiThemes.makeStyleMap(theme.vars, {
      fontSize: (overrides && overrides.fontSize) || 15,
      lineHeight: (overrides && overrides.lineHeight) || 1.8,
      imgRadius: typeof (overrides && overrides.imgRadius) === 'number' ? overrides.imgRadius : 4,
      flavor: theme.flavor,
    });
    window.MoPaiThemes._currentTokens = window.MoPaiThemes.tokensFor(theme.vars);
    protectCodeSpaces(root);
    adaptTaskLists(root);
    window.MoPaiThemes.applyTheme(root, styleMap);
    applySidePad(root, overrides && overrides.sidePad);
    return root.innerHTML;
  }

  /** 预览用:克隆节点套主题后输出完整 HTML 文档 */
  function previewDocument(sourceNode, themeId, overrides) {
    const clone = sourceNode.cloneNode(true);
    themeExisting(clone, themeId, overrides);
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{margin:0;padding:14px 16px 32px;background:#fff;font-family:' + window.MoPaiThemes.BASE_FONT + ';-webkit-font-smoothing:antialiased;}</style>' +
      '</head><body>' + clone.innerHTML + '</body></html>';
  }

  return { renderMarkdown, themeExisting, previewDocument, protectCodeSpaces, adaptTaskLists, DEFAULTS };
})();
