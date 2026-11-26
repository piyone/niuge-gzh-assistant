/**
 * 牛哥公众号助手 · AI 校对引擎(纯函数,无 chrome 依赖)
 * 分块、提示词构建、响应解析、错误应用。
 * 平台限制:请求体 ≤16KB、max_tokens ≤1024 → 分块 ≤1600 字(粒度小,模型才能覆盖全文,每块最多 12 条问题)。 */
globalThis.MoPaiAI = (() => {
  const CHUNK_LIMIT = 1600;

  /** 按段落分块:每块 ≤ CHUNK_LIMIT 字,优先在段落边界切分 */
  function chunkArticle(text, limit) {
    const max = limit || CHUNK_LIMIT;
    const clean = (text || '').replace(/\u00a0/g, ' ').trim();
    if (!clean) return [];
    if (clean.length <= max) return [clean];

    const paras = clean.split(/\n{2,}/);
    const chunks = [];
    let buf = '';
    for (const p of paras) {
      // 单段超长:按句号硬切
      if (p.length > max) {
        if (buf) { chunks.push(buf.trim()); buf = ''; }
        const sentences = p.split(/(?<=[。!?:;」』])/);
        let sbuf = '';
        for (const s of sentences) {
          if ((sbuf + s).length > max) {
            if (sbuf) chunks.push(sbuf.trim());
            if (s.length > max) {
              // 一句话都超长,按字符硬切
              for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
              sbuf = '';
            } else sbuf = s;
          } else sbuf += s;
        }
        if (sbuf.trim()) buf = sbuf;
        continue;
      }
      if ((buf + '\n\n' + p).trim().length > max) {
        if (buf) chunks.push(buf.trim());
        buf = p;
      } else {
        buf = buf ? buf + '\n\n' + p : p;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  function buildMessages(chunk) {
    const system = '你是严谨的中文校对编辑。只检查两类错误,宁缺毋滥:\n' +
      '1. typo:仅限错别字(音近/形近)、词语重复、明显多字漏字。产品型号、序列号、版本号、人名、缩写、中英数字混排(如 smart 精灵 #2 BRABUS 版)即使看起来奇怪也不是错误;\n' +
      '2. fluency:仅限明显语病(搭配错误、成分残缺)。口语化表达、语气词(吧/啊/哈)、反问、感叹、短句风格都是作者风格,不是语病,禁止改写。\n' +
      '禁止事项(违反即无效):\n' +
      '- 禁止报告任何标点问题:不检查句号/逗号有无,禁止建议增删标点或空格;标题、列表条目、以符号开头的短行不带句号是正常写法;\n' +
      '- 禁止改写整句或调整语序;\n- 禁止把正确但少见的写法当错误;\n- 禁止提出润色、风格、更通顺类的建议。\n' +
      '硬性规则:\n- original 必须是原文中【逐字连续出现】的片段,长度不超过 20 字;\n' +
      '- suggestion 与 original 的差异必须很小(只改动错处本身);\n- reason 不超过 15 字;\n' +
      '- 没有确定错误必须输出 []。宁可漏报,不可误报。\n' +
      '只输出 JSON 数组,不要任何解释或 markdown 代码围栏。' +
      '格式:[{"type":"typo","original":"...","suggestion":"...","reason":"..."}]';
    return [
      { role: 'system', content: system },
      { role: 'user', content: '文章片段:\n' + chunk },
    ];
  }

  /**
   * 解析模型响应。容错:markdown 围栏、前后缀文本、单对象而非数组。
   * 返回 {issues:[...], error?:string}
   */
  function parseAiResponse(raw) {
    if (!raw || !raw.trim()) return { issues: [], error: '模型返回为空' };
    let text = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let arr = null;
    try { arr = JSON.parse(text); } catch (e) { /* 尝试截取 */ }
    if (arr !== null && !Array.isArray(arr)) {
      // 允许 {"issues":[...]} 或单个 issue 对象
      if (Array.isArray(arr.issues)) arr = arr.issues;
      else if (arr.type && arr.original) arr = [arr];
      else arr = null;
    }
    if (arr === null) {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end > start) {
        try { arr = JSON.parse(text.slice(start, end + 1)); } catch (e) { /* 放弃 */ }
      }
    }
    if (arr === null) {
      // 可能是单个对象
      const s2 = text.indexOf('{');
      const e2 = text.lastIndexOf('}');
      if (s2 !== -1 && e2 > s2) {
        try {
          const obj = JSON.parse(text.slice(s2, e2 + 1));
          if (Array.isArray(obj.issues)) arr = obj.issues;
          else if (obj.type && obj.original) arr = [obj];
        } catch (e) { /* 放弃 */ }
      }
    }
    if (arr === null) return { issues: [], error: '无法解析模型输出(可能被截断),请重试' };
    if (!Array.isArray(arr)) return { issues: [], error: '模型输出格式异常' };

    const valid = [];
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const original = String(it.original || '').trim();
      const suggestion = String(it.suggestion || '').trim();
      if (!original || !suggestion) continue;
      if (original === suggestion) continue;
      if (original.length > 40) continue;
      // 双重过滤:模型仍返回标点类问题,或建议只是增删标点/空白(差异不涉及文字)时一律丢弃
      const bare = (s) => s.replace(/[\s\u3000。.,,、;:!!??…「」『』"'"'()()《》<>【】[\]—·•△▲●○■□#/\\]/g, '');
      if (bare(original) === bare(suggestion)) continue;
      if (it.type === 'punct') continue;
      valid.push({
        type: ['typo', 'fluency'].includes(it.type) ? it.type : 'fluency',
        original,
        suggestion,
        reason: String(it.reason || '').slice(0, 40),
        applied: false,
      });
    }
    return { issues: valid.slice(0, 12) };
  }

  /**
   * 把一条修改应用到 DOM 树:在文本节点中精确匹配 original 并替换首个出现。
   * 返回 'applied' | 'cross-node' | 'not-found'
   */
  function applyIssueToRoot(root, issue) {
    const original = issue.original;
    if (!original) return 'not-found';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    // 1) 单节点精确匹配
    for (const node of nodes) {
      const idx = node.nodeValue.indexOf(original);
      if (idx !== -1) {
        node.nodeValue = node.nodeValue.slice(0, idx) + issue.suggestion + node.nodeValue.slice(idx + original.length);
        return 'applied';
      }
    }
    // 2) 跨节点:检查是否连续出现在相邻文本节点中(只标记,不做替换)
    const full = nodes.map((n) => n.nodeValue).join('\u0001');
    if (full.replace(/\u0001/g, '').includes(original)) return 'cross-node';
    return 'not-found';
  }

  /** 批量应用,返回统计 */
  function applyIssues(root, issues) {
    let applied = 0, cross = 0, missed = 0;
    issues.forEach((it) => {
      if (it.applied) return;
      const r = applyIssueToRoot(root, it);
      if (r === 'applied') { it.applied = true; applied++; }
      else if (r === 'cross-node') { it.crossNode = true; cross++; }
      else missed++;
    });
    return { applied, cross, missed };
  }

  /** AI 服务配置默认值(key 由用户在设置页自行填写,不做任何预填) */
  const AI_DEFAULTS = {
    apiKey: '',
    baseUrl: '',
    // 注意:glm-4.7-flash 为思维链模型,推理 token 会吃满 max_tokens=1024 导致 JSON 被截断,
    // 故默认用非推理的 glm-4-flash(实测结构化输出稳定);如换模型请避开 thinking 系列。
    model: 'zhipu/glm-4-flash',
    maxTokens: 1024,
  };

  // ---------------- AI 标题生成 ----------------

  /** 剥离推理模型的 <think> 思考块与围栏,只留正文(否则 JSON 提取会被思考内容带偏) */
  function stripThink(raw) {
    return String(raw || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*/gi, '') // 未闭合的 think 块也剥掉
      .trim();
  }

  function buildTitleMessages(currentTitle, body) {
    const system = '你是资深微信公众号标题专家,熟悉信息流点击场景。基于给定文章内容生成 5 个候选标题,' +
      '风格依次为:悬念好奇、数字干货、痛点共鸣、观点态度、场景故事。\n' +
      '硬性要求:\n- 每条不超过 30 字,信息量前置(前 13 字必须抓人);\n' +
      '- 不使用「最」「第一」「全网第一」等广告法极限词;\n- 不夸大失实,必须与内容强相关。\n' +
      '只输出 JSON 数组,格式 [{"style":"悬念好奇","title":"..."}],共 5 条。不要解释、不要代码围栏。';
    return [
      { role: 'system', content: system },
      { role: 'user', content: `当前标题(可能为空):${currentTitle || '(无)'}\n\n文章内容:\n${body}` },
    ];
  }

  /** 容错解析标题列表。返回 {titles:[{style,title}], error?} */
  function parseTitles(raw) {
    if (!raw || !raw.trim()) return { titles: [], error: '模型返回为空' };
    let text = stripThink(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let arr = null;
    try { arr = JSON.parse(text); } catch (e) { /* 截取 */ }
    if (arr === null) {
      const s = text.indexOf('[');
      const e2 = text.lastIndexOf(']');
      if (s !== -1 && e2 > s) {
        try { arr = JSON.parse(text.slice(s, e2 + 1)); } catch (err) { /* 放弃 */ }
      }
    }
    // 兼容 {"titles":[...]} 对象包裹
    if (arr && !Array.isArray(arr) && Array.isArray(arr.titles)) arr = arr.titles;
    // 兼容 ["标题1","标题2"] 纯字符串数组
    if (Array.isArray(arr) && arr.length && typeof arr[0] === 'string') {
      arr = arr.map((t) => ({ title: t }));
    }
    if (arr === null) {
      // 最后兜底:直接从文本里抓 "title":"..." 键值对
      const pairs = [...text.matchAll(/"(?:title|text)"\s*:\s*"([^"]{4,40})"/g)].map((m) => ({ title: m[1] }));
      if (pairs.length >= 2) arr = pairs;
    }
    if (arr === null || arr === undefined) return { titles: [], error: '无法解析模型输出,请重试' };
    if (!Array.isArray(arr)) return { titles: [], error: '模型输出格式异常' };

    const out = [];
    const seen = new Set();
    for (const it of arr) {
      const title = String((it && (it.title || it.text)) || '').trim();
      if (title.length < 4 || title.length > 40) continue;
      if (seen.has(title)) continue;
      seen.add(title);
      out.push({ style: String((it && it.style) || '').trim().slice(0, 8) || '候选', title });
      if (out.length >= 6) break;
    }
    if (!out.length) return { titles: [], error: '模型没有给出有效标题,请重试' };
    return { titles: out };
  }

  // ---------------- AI 摘要生成 ----------------

  function buildSummaryMessages(body) {
    const system = '你是公众号编辑。请为文章写一段「摘要」,用于会话卡片与转发场景展示。\n' +
      '要求:60~110 字;概括文章核心内容与读者价值;口语化但专业;不用极限词;不要以「本文」开头;单段。\n' +
      '只输出 JSON:{"summary":"..."} 不要解释、不要代码围栏。';
    return [
      { role: 'system', content: system },
      { role: 'user', content: `文章内容:\n${body}` },
    ];
  }

  /** 容错解析摘要。返回 {summary, error?} */
  function parseSummary(raw) {
    if (!raw || !raw.trim()) return { summary: '', error: '模型返回为空' };
    let text = stripThink(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    // JSON 路径
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) { /* 截取 */ }
    if (obj === null) {
      const s = text.indexOf('{');
      const e2 = text.lastIndexOf('}');
      if (s !== -1 && e2 > s) {
        try { obj = JSON.parse(text.slice(s, e2 + 1)); } catch (err) { /* 放弃 */ }
      }
    }
    if (obj && typeof obj === 'object') {
      let su = String(obj.summary || obj.text || '').trim();
      if (su.length < 10) return { summary: '', error: '摘要长度异常,请重试' };
      if (su.length > 120) {
        // 微信摘要上限 120 字:按句读边界截到 ≤110,避免展示时被硬截断
        const cut = su.slice(0, 110);
        const m = cut.match(/[\u3002\uff01\uff1f\uff1b\uff0c\u2026][^\u3002\uff01\uff1f\uff1b\uff0c\u2026]*$/);
        su = (m ? cut.slice(0, cut.length - m[0].length) : cut).replace(/[\u3002\uff01\uff1f\uff1b\uff0c\u2026]+$/, '') + '……';
      }
      return { summary: su };
    }
    // 纯文本回退:模型没按 JSON 输出但内容像摘要
    if (text.length >= 20 && text.length <= 300 && !/^[\[{]/.test(text)) {
      return { summary: text.replace(/^["']|["']$/g, '') };
    }
    return { summary: '', error: '无法解析模型输出,请重试' };
  }

  // ---------------- AI 写文章 ----------------

  function buildArticleMessages(topic, style, audience) {
    const system = '你是一位资深公众号作者,给手机读者写文章。写得像一个有经验的真人在跟读者聊天,严防"AI 腔"。\n' +
      `- 选题:${topic};风格:${style || '干货教程'};目标读者:${audience || '不限'}\n` +
      '结构与格式:\n' +
      '- 输出 Markdown 正文;不要一级标题(#),直接从引子段落开始;用 ## 做小标题(2~4 个)\n' +
      '- 段落短(每段 2~4 行),多用"你/我"的对话口吻;句长要有变化,别每句都差不多长\n' +
      '- 本次写 700~900 字后自然收尾\n' +
      '内容要求:\n' +
      '- 观点开门见山,第一段就进入正题\n' +
      '- 具体压倒抽象:多用数字、场景、真实案例;禁止编造数据和引用\n' +
      '- 每句话都要有信息量;删掉搬到任何文章里都成立的万能句\n' +
      'AI 腔禁令(写完逐条自查,违反即重写):\n' +
      '- 禁用套话开场:在…的时代/随着…的发展/众所周知/让我们一起/让我们来看\n' +
      '- 禁用"不是A,而是B""不仅…更…""看似…实则…"等二元对比套路\n' +
      '- 禁用词:赋能、抓手、闭环、底层逻辑、颠覆、革命性、毋庸置疑、值得一提、深耕、沉淀、总而言之、综上所述\n' +
      '- 禁止排比三连、整段对仗、每段结构雷同;禁止"首先/其次/最后"式行文\n' +
      '- 禁止结尾升华、喊口号、总结陈词;用最后一个具体观点或行动建议收尾\n' +
      '- 破折号最多用 1 次;标题不带 emoji;除关键结论外不要到处加粗\n' +
      '- 广告法极限词(最/第一/绝对/全网第一)一律不用\n' +
      '直接输出 Markdown 正文,不要解释、不要代码围栏。';
    return [
      { role: 'system', content: system },
      { role: 'user', content: `选题:${topic}` },
    ];
  }

  function buildContinueMessages(prevTail, topic) {
    const system = '你在续写一篇公众号文章(Markdown 正文)。已写部分的结尾如下。\n' +
      '要求:\n' +
      '- 自然衔接继续写,不要重复已有内容;不要重新起标题、不要总结致谢\n' +
      '- 保持前文的口吻和节奏,像一个真人继续说下去\n' +
      '- 沿用同样的 AI 腔禁令:不用套话、"不是A而是B"句式、排比三连、升华结尾;具体压倒抽象,每句有信息量\n' +
      '- 可用 ## 新增一个小标题;再写 600~800 字后停在一个自然段落\n' +
      '直接输出 Markdown 正文,不要解释、不要代码围栏。';
    return [
      { role: 'system', content: system },
      { role: 'user', content: `选题:${topic}\n\n已写结尾:\n${prevTail}` },
    ];
  }

  /** 解析文章正文:去外层围栏与寒暄前缀,校验长度。返回 {text, error?} */
  function parseArticle(raw) {
    if (!raw || !raw.trim()) return { text: '', error: '模型返回为空' };
    let text = raw.trim();
    text = text.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    // 去常见寒暄前缀(首行很短且含"以下是/好的"等)
    const firstLineEnd = text.indexOf('\n');
    if (firstLineEnd !== -1) {
      const head = text.slice(0, firstLineEnd);
      if (head.length < 30 && /以下是|好的[,:、]?|这是/.test(head)) text = text.slice(firstLineEnd).trim();
    }
    if (text.length < 100) return { text: '', error: '生成内容过短(可能被限流或截断),请重试' };
    return { text };
  }

  return { chunkArticle, buildMessages, parseAiResponse, applyIssueToRoot, applyIssues, buildTitleMessages, parseTitles, buildSummaryMessages, parseSummary, buildArticleMessages, buildContinueMessages, parseArticle, AI_DEFAULTS, CHUNK_LIMIT };
})();
