/**
 * 牛哥公众号助手 · 主题系统
 * 公众号编辑器会剥离 <style> 标签和 class,因此所有样式必须内联。
 * 每个主题 = 一组变量 vars + 由 makeStyleMap 生成的「选择器 → 内联 CSS」映射。
 */
window.MoPaiThemes = (() => {
  const BASE_FONT = '-apple-system-font,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei",Arial,sans-serif';

  const THEMES = [
    {
      id: 'elegant', name: '雅蓝', desc: '微信官方蓝,稳重大方',
      vars: {
        primary: '#576b95', text: '#3f3f3f', secondary: '#8890a0',
        blockBg: '#f6f8fa', blockBar: '#576b95', strong: '#3f3f3f',
        codeBg: '#282c34', codeText: '#abb2bf', inlineCodeBg: 'rgba(87,107,149,.12)',
        inlineCodeText: '#c0392b', border: '#e5e7eb', link: '#576b95',
      },
      flavor: 'bar-h2',
    },
    {
      id: 'tech', name: '科技蓝', desc: '高对比,适合技术号',
      vars: {
        primary: '#2f7bf6', text: '#333333', secondary: '#7a8499',
        blockBg: '#f0f6ff', blockBar: '#2f7bf6', strong: '#2f7bf6',
        codeBg: '#1e1e2e', codeText: '#cdd6f4', inlineCodeBg: 'rgba(47,123,246,.12)',
        inlineCodeText: '#d63384', border: '#dde5f0', link: '#2f7bf6',
      },
      flavor: 'bar-h2',
    },
    {
      id: 'warm', name: '暖橙', desc: '亲和力强,适合生活方式号',
      vars: {
        primary: '#f2711c', text: '#4a4038', secondary: '#a08d7d',
        blockBg: '#fdf5ef', blockBar: '#f2711c', strong: '#e2580b',
        codeBg: '#2d241d', codeText: '#e8d8c8', inlineCodeBg: 'rgba(242,113,28,.13)',
        inlineCodeText: '#c0392b', border: '#ecdfd3', link: '#e2580b',
      },
      flavor: 'center-h1',
    },
    {
      id: 'forest', name: '青竹', desc: '清新绿色,知识科普向',
      vars: {
        primary: '#2ba471', text: '#333d38', secondary: '#7d8b83',
        blockBg: '#f0f9f4', blockBar: '#2ba471', strong: '#21835b',
        codeBg: '#1d2b25', codeText: '#b8d8c8', inlineCodeBg: 'rgba(43,164,113,.13)',
        inlineCodeText: '#1a7f55', border: '#d8e8df', link: '#21835b',
      },
      flavor: 'bar-h2',
    },
    {
      id: 'mono', name: '极简黑白', desc: '无彩色,内容为王',
      vars: {
        primary: '#333333', text: '#333333', secondary: '#999999',
        blockBg: '#fafafa', blockBar: '#333333', strong: '#000000',
        codeBg: '#f4f4f4', codeText: '#333333', inlineCodeBg: '#efefef',
        inlineCodeText: '#c7254e', border: '#dddddd', link: '#333333',
      },
      flavor: 'plain',
    },
    {
      id: 'sakura', name: '樱粉', desc: '柔和粉色,情感生活向',
      vars: {
        primary: '#e8608a', text: '#463a40', secondary: '#a08792',
        blockBg: '#fdf3f6', blockBar: '#e8608a', strong: '#d94f7c',
        codeBg: '#2b2226', codeText: '#e8ccd6', inlineCodeBg: 'rgba(232,96,138,.12)',
        inlineCodeText: '#c2255c', border: '#f0dde4', link: '#d94f7c',
      },
      flavor: 'center-h1',
    },
    {
      id: 'custom', name: '自定义', desc: '随心配色,排版页可调',
      vars: {
        primary: '#07c160', text: '#333333', secondary: '#8890a0',
        blockBg: '#f2f8f4', blockBar: '#07c160', strong: '#07c160',
        codeBg: '#282c34', codeText: '#abb2bf', inlineCodeBg: 'rgba(7,193,96,.12)',
        inlineCodeText: '#1a7f55', border: '#e5e7eb', link: '#07c160',
      },
      flavor: 'bar-h2',
    },
  ];

  // 代码高亮 token 配色(暗色底 / 浅色底两套)
  const TOKENS_DARK = {
    keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#7f848e',
    title: '#61afef', attr: '#d19a66', literal: '#56b6c2', built_in: '#e5c07b',
    type: '#e5c07b', tag: '#e06c75', name: '#e06c75', variable: '#e06c75',
    property: '#56b6c2', meta: '#61afef', symbol: '#56b6c2', addition: '#98c379', deletion: '#e06c75',
  };
  const TOKENS_LIGHT = {
    keyword: '#d73a49', string: '#032f62', number: '#005cc5', comment: '#6a737d',
    title: '#6f42c1', attr: '#005cc5', literal: '#005cc5', built_in: '#e36209',
    type: '#22863a', tag: '#22863a', name: '#22863a', variable: '#e36209',
    property: '#005cc5', meta: '#6f42c1', symbol: '#005cc2', addition: '#22863a', deletion: '#b31d28',
  };

  function tokensFor(vars) {
    return vars.codeBg === '#f4f4f4' ? TOKENS_LIGHT : TOKENS_DARK;
  }

  /**
   * 生成「选择器 → 内联 CSS」映射
   * @param vars 主题变量
   * @param o 覆盖项 {fontSize, lineHeight, h1Style, strongColor...}
   */
  function makeStyleMap(vars, o) {
    o = o || {};
    const fs = o.fontSize || 15;
    const lh = o.lineHeight || 1.8;
    const ls = typeof o.letterSpacing === 'number' ? o.letterSpacing : 0.5; // 正文字间距(px)
    const imgRadius = typeof o.imgRadius === 'number' ? o.imgRadius : 4; // 图片圆角,0 = 直角
    const pGap = o.paraGap > 0 ? o.paraGap : Math.round(fs * (lh - 0.55)); // 段落间距:0 = 随字号行距联动
    const flavor = o.flavor || 'bar-h2';
    const v = vars;
    const map = {};

    // 一级标题:三种风味
    if (flavor === 'center-h1') {
      map['h1'] = `text-align:center;margin:42px 0 26px;font-size:${fs + 7}px;font-weight:700;color:${v.primary};letter-spacing:1px;`;
    } else if (flavor === 'plain') {
      map['h1'] = `text-align:left;margin:42px 0 24px;font-size:${fs + 7}px;font-weight:700;color:${v.text};padding-bottom:12px;border-bottom:1px solid ${v.border};`;
    } else {
      map['h1'] = `text-align:center;margin:42px 0 26px;font-size:${fs + 7}px;font-weight:700;color:${v.text};padding-bottom:12px;border-bottom:1px solid ${v.border};`;
    }
    // 二级标题:左侧色条(plain 主题改为仅加粗)
    map['h2'] = flavor === 'plain'
      ? `margin:34px 0 18px;font-size:${fs + 4}px;font-weight:700;color:${v.text};`
      : `margin:34px 0 18px;font-size:${fs + 4}px;font-weight:700;color:${v.text};border-left:4px solid ${v.primary};padding-left:12px;line-height:1.4;`;
    map['h3'] = `margin:28px 0 14px;font-size:${fs + 2}px;font-weight:700;color:${v.text};`;
    map['h4'] = `margin:24px 0 12px;font-size:${fs}px;font-weight:700;color:${v.secondary};`;
    map['h5'] = `margin:20px 0 10px;font-size:${fs}px;font-weight:700;color:${v.secondary};`;
    map['h6'] = `margin:20px 0 10px;font-size:${fs - 1}px;font-weight:700;color:${v.secondary};`;

    map['p'] = `margin:${pGap}px 0;font-size:${fs}px;line-height:${lh};color:${v.text};letter-spacing:${ls}px;text-align:justify;word-break:break-word;`;
    map['blockquote'] = `border-left:3px solid ${v.blockBar};background:${v.blockBg};padding:12px 16px;margin:${pGap + 4}px 0;border-radius:0 4px 4px 0;`;
    map['blockquote p'] = `margin:6px 0;font-size:${fs - 1}px;line-height:${lh};color:${v.secondary};letter-spacing:${ls}px;text-align:justify;`;
    map['blockquote h1,blockquote h2,blockquote h3,blockquote h4'] = `margin:8px 0;font-size:${fs}px;`;

    map['ul'] = `margin:${pGap}px 0;padding-left:1.6em;`;
    map['ol'] = `margin:${pGap}px 0;padding-left:1.6em;`;
    map['li'] = `margin:7px 0;font-size:${fs}px;line-height:${lh};color:${v.text};letter-spacing:${ls}px;text-align:justify;`;
    map['li p'] = `margin:4px 0;`;

    map['img'] = `display:block;margin:${Math.round(pGap / 2)}px auto;max-width:100%;border-radius:${imgRadius}px;box-shadow:0 3px 10px rgba(0,0,0,.12);`;
    map['a'] = `color:${v.link};text-decoration:none;word-break:break-all;`;
    map['hr'] = `border:none;border-top:1px solid ${v.border};margin:32px auto;width:88%;`;

    map['table'] = `width:100%;border-collapse:collapse;margin:${pGap}px 0;font-size:${fs - 1}px;`;
    map['thead th'] = `background:${v.primary};color:#ffffff;border:1px solid ${v.primary};padding:8px 12px;font-weight:600;text-align:left;`;
    map['tbody td'] = `border:1px solid ${v.border};padding:8px 12px;color:${v.text};`;
    map['tbody tr:nth-child(2n) td'] = `background:${v.blockBg};`;

    map['pre'] = `background:${v.codeBg};color:${v.codeText};padding:14px 16px;border-radius:6px;font-size:13px;line-height:1.65;margin:${pGap}px 0;white-space:pre-wrap;word-break:break-word;font-family:Menlo,Consolas,"Courier New",monospace;`;
    map['pre code'] = `background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;white-space:inherit;`;
    map['code'] = `background:${v.inlineCodeBg};color:${v.inlineCodeText};padding:2px 6px;border-radius:3px;font-size:87%;font-family:Menlo,Consolas,"Courier New",monospace;word-break:break-word;`;
    // pre 里的 code 上面的规则会被 pre code 覆盖,但 cssText 是整体替换,按查询顺序处理即可

    map['strong'] = `font-weight:700;color:${v.strong};`;
    map['b'] = `font-weight:700;color:${v.strong};`;
    map['em'] = `font-style:italic;color:${v.secondary};`;
    map['del'] = `color:${v.secondary};text-decoration:line-through;`;
    map['figure'] = `margin:${pGap}px 0;text-align:center;`;
    map['figcaption'] = `display:block;text-align:center;font-size:12px;color:${v.secondary};margin-top:6px;`;

    // 微信编辑器的内容大量使用 section/span/font 包装并残留旧模板内联样式,
    // 格式刷时必须清掉,否则新主题与旧样式混搭。span 清空 = 继承父级主题样式。
    // section 是微信编辑器原生段落容器,必须带上字号/行距/字间距,
    // 否则直接躺在 section 里的文字吃不到这些滑杆设置(此前行距"不生效"的根因)。
    map['section'] = `margin:0;padding:0;font-size:${fs}px;line-height:${lh};letter-spacing:${ls}px;`;
    map['span'] = ``;
    map['font'] = ``;
    map['u'] = ``;

    return map;
  };

  /**
   * 把样式映射应用到 DOM 树(整体替换元素 inline style,「格式刷」语义)。
   * 对 code 特殊处理:在 pre 内用 pre code 样式,否则用行内 code 样式。
   */
  function applyTheme(root, styleMap) {
    Object.keys(styleMap).forEach((sel) => {
      let els;
      try { els = root.querySelectorAll(sel); } catch (e) { return; }
      els.forEach((el) => {
        // pre 内的 code 不吃行内 code 样式;pre 内的 span 是高亮配色,保留
        if (el.tagName === 'CODE' && el.closest('pre') && sel === 'code') return;
        if (el.tagName === 'SPAN' && el.closest('pre')) return;
        // 引用链接小节保持专属样式,不参与格式刷
        if (el.closest('[data-mopai-refs]')) return;
        el.style.cssText = styleMap[sel];
      });
    });
    // 代码高亮 token 内联
    const preCode = root.querySelectorAll('pre code');
    preCode.forEach((code) => {
      const palette = (window.MoPaiThemes && window.MoPaiThemes._currentTokens) || TOKENS_DARK;
      code.querySelectorAll('[class]').forEach((sp) => {
        const m = (sp.className || '').match(/hljs-([a-z_]+)/);
        if (m && palette[m[1]]) sp.style.color = palette[m[1]];
      });
    });
    // 首个可见元素的上边距清零:标题类自带 margin-top,紧贴正文顶部时会出现一段空白
    if (root.firstElementChild && !root.firstElementChild.closest('[data-mopai-refs]')) {
      root.firstElementChild.style.marginTop = '0';
    }
  }

  function getTheme(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0];
  }

  /**
   * 用用户设置覆盖「自定义」主题(vars 扁平对象或 {vars, flavor} 均可)。
   * 只覆盖合法的颜色键,未提供的键保留当前值。
   */
  function registerCustom(partial) {
    const t = getTheme('custom');
    if (!partial) return t;
    const v = partial.vars || partial;
    Object.keys(t.vars).forEach((k) => {
      if (typeof v[k] === 'string' && v[k]) t.vars[k] = v[k];
    });
    if (typeof partial.flavor === 'string' && partial.flavor) t.flavor = partial.flavor;
    return t;
  }

  return { THEMES, makeStyleMap, applyTheme, getTheme, registerCustom, tokensFor, BASE_FONT, _currentTokens: TOKENS_DARK };
})();
