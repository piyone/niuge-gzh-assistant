/**
 * 牛哥公众号助手 · 多平台同步预处理(纯函数)
 * 知乎/掘金适配参数参考 wechatsync v2 (packages/core/src/adapters/platforms) 开源实现。
 * 被 content script(配合 turndown)与 background service worker(importScripts)共用。
 */
globalThis.MoPaiSyncPrepare = (() => {
  /** 去掉 style/class/id/data-*(知乎 Draft.js 编辑器不认这些),保留代码语言标记 class="language-x" */
  function stripInlineStyles(html) {
    return html
      .replace(/\s*style="[^"]*"/gi, '')
      .replace(/\s*class="(?!language-[\w+-]+"|hljs\s+language-)[^"]*"/gi, '')
      .replace(/\s*id="[^"]*"/gi, '')
      .replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '')
      .replace(/<(section|span|font|article)([^>]*)>/gi, '<div$2>')
      .replace(/<\/(section|span|font|article)>/gi, '</div>')
      .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '');
  }

  /** 知乎:img 需要 figure 包裹;代码块用 <pre lang="x"> */
  function zhihuFiguresAndCode(html) {
    let out = html;
    if (!/<figure[\s>]/i.test(out)) {
      out = out.replace(/<img([^>]+)src="([^"]+)"([^>]*)>/gi, '<figure><img$1src="$2"$3></figure>');
    }
    out = out.replace(/<pre><code class="(?:hljs\s+)?language-([\w+-]+)"[^>]*>/gi, '<pre lang="$1"><code>');
    return out;
  }

  /** 知乎:table 转换为 Draft.js 可识别的 data-draft-node 格式(参考 wechatsync transformTables) */
  function zhihuTables(html) {
    let result = html.replace(/<figure[^>]*>\s*(<table[\s\S]*?<\/table>)\s*<\/figure>/gi, '$1');
    result = result.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableContent) => {
      const theadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
      const tbodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

      let headerRows = '';
      let bodyRows = '';

      if (theadMatch) {
        headerRows = theadMatch[1].replace(/<td([^>]*)>/gi, '<th$1>').replace(/<\/td>/gi, '</th>');
      }
      if (tbodyMatch) {
        bodyRows = tbodyMatch[1];
      } else {
        bodyRows = tableContent
          .replace(/<thead[^>]*>[\s\S]*?<\/thead>/gi, '')
          .replace(/<\/?tbody[^>]*>/gi, '');
      }
      if (!theadMatch) {
        const firstRowMatch = bodyRows.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
        if (firstRowMatch && /<th[^>]*>/i.test(firstRowMatch[1]) && !/<td[^>]*>/i.test(firstRowMatch[1])) {
          headerRows = firstRowMatch[0];
          bodyRows = bodyRows.replace(firstRowMatch[0], '');
        }
      }
      return '<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody>' +
        headerRows + bodyRows + '</tbody></table>';
    });
    return result;
  }

  /** 知乎文章 HTML 完整转换管线 */
  function transformZhihuHtml(html) {
    return zhihuTables(zhihuFiguresAndCode(stripInlineStyles(html || '')));
  }

  /** 掘金草稿 create 接口请求体(markdown 格式) */
  function buildJuejinPayload(title, markdown) {
    return {
      brief_content: '',
      category_id: '0',
      cover_image: '',
      edit_type: 10,
      html_content: 'deprecated',
      link_url: '',
      mark_content: markdown || '',
      tag_ids: [],
      title: title || '未命名文章',
    };
  }

  /** 知乎建草稿/更新草稿请求体 */
  function buildZhihuDraftBody(title) {
    return { title: title || '未命名文章', content: '', delta_time: 0 };
  }
  function buildZhihuPatchBody(title, html) {
    return { title: title || '未命名文章', content: html || '' };
  }

  /**
   * HTML → Markdown(turndown + GFM 插件,须在 content script 环境调用)
   * 先剥掉我们主题的内联样式与 hljs token,再转换。
   */
  function htmlToMarkdown(html, TurndownServiceCtor, gfmPlugin) {
    if (typeof TurndownServiceCtor !== 'function') return null;
    const pre = (html || '')
      .replace(/\s*style="[^"]*"/gi, '')
      .replace(/\s*class="hljs[^"]*"/gi, '')
      .replace(/\s*class="language-([\w+-]+)"/gi, ' class="language-$1"');
    const svc = new TurndownServiceCtor({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
      br: '\n',
    });
    if (gfmPlugin) {
      // turndown-plugin-gfm 导出 {gfm, tables, strikethrough, taskListItems};gfm 是四合一
      if (gfmPlugin.gfm) svc.use([gfmPlugin.gfm, gfmPlugin.tables, gfmPlugin.strikethrough, gfmPlugin.taskListItems].filter(Boolean));
      else svc.use(gfmPlugin);
    }
    let md = svc.turndown(pre);
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
  }

  /**
   * 富 HTML 平台通用清洗:去 style/script 块与注释;可选把链接降级为纯文本。
   * 各平台的编辑器对 <style>/script 一律不收,链接部分平台(B站等)会移除。
   */
  function sanitizeRichHtml(html, opts) {
    let out = html || '';
    out = out
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    if (opts && opts.removeLinks) {
      out = out
        .replace(/<a\b[^>]*>/gi, '<span>')
        .replace(/<\/a\s*>/gi, '</span>');
    }
    return out.trim();
  }

  return {
    stripInlineStyles,
    transformZhihuHtml,
    buildJuejinPayload,
    buildZhihuDraftBody,
    buildZhihuPatchBody,
    htmlToMarkdown,
    sanitizeRichHtml,
  };
})();
