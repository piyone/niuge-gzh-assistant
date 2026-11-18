/**
 * 牛哥公众号助手 · 违禁词/风险词库引擎(纯函数,无 chrome 依赖)
 * 分类词库(高危=广告法红线 / 中危=诱导与导流) + 正则规则,发布前扫描用。
 * 词库覆盖:广告法极限词、绝对化承诺、金融投资、医疗功效、诱导互动、紧迫诱导。
 */
globalThis.MoPaiWords = (() => {
  const CATEGORIES = [
    {
      id: 'extreme', name: '广告法极限词', level: 'high',
      words: [
        '最好', '最佳', '最优秀', '最低', '最低价', '最便宜', '最先进', '最科学', '最健康',
        '最顶级', '最顶尖', '最完美', '最出色', '最强', '最大', '最高级', '最奢华', '最实用',
        '最优秀', '最优', '最权威', '最专业', '最高端', '最舒适', '最实惠', '最流行', '最受欢迎',
        '第一品牌', '全网第一', '销量第一', '行业第一', '中国第一', '全国第一', '排名第一',
        'NO.1', 'no.1', 'TOP1', 'top1', 'TOP 1',
        '唯一', '首个', '首家', '首选', '独家', '独有', '独创', '独占',
        '顶级', '顶尖', '极品', '绝佳', '绝对', '绝无仅有', '史无前例', '万能', '完美',
        '百分之百', '百分百', '100%', '纯天然', '零添加', '0添加', '全天然',
        '国家级', '世界级', '宇宙级', '全球领先', '全国领先', '领先世界', '销量冠军',
        '全网最低', '全网最全', '史上最低', '史上最全', '史上最', '前所未有',
        '驰名商标', '国家免检', '免检产品', '权威认证', '独家授权', '全网独家',
        '至尊', '极致', '王者', '霸主', '无与伦比', '举世无双', '空前绝后', '登峰造极',
        '全球第一', '世界第一', '销量之王', '爆款之王', '稳居榜首', '全网爆卖',
      ],
    },
    {
      id: 'promise', name: '绝对化承诺', level: 'high',
      words: [
        '永久', '永远有效', '终身', '彻底', '根治', '治愈', '包治百病', '药到病除',
        '立竿见影', '无效退款', '无效包退', '包过', '保过', '押题命中率',
        '保证赚钱', '保证有效', '保证通过', '彻底解决', '一劳永逸',
        '稳过', '必过', '必赚', '必涨', '包赚', '零失败', '万无一失',
        '一步到位', '永久免费', '终身免费', '绝不反弹', '全程保障',
      ],
    },
    {
      id: 'finance', name: '金融投资风险', level: 'high',
      words: [
        '保本保息', '零风险', '无风险', '高收益', '本金保障', '稳赚不赔', '稳赚',
        '翻倍', '躺赚', '暴富', '财务自由', '躺平赚钱', '睡后收入翻倍',
        '保本', '保收益', '稳赢', '躺赢', '暴利', '财富密码', '零亏损', '高回报',
      ],
    },
    {
      id: 'medical', name: '医疗功效', level: 'high',
      words: [
        '包治', '痊愈', '治愈率', '特效药', '秘方', '偏方治大病', '消炎杀菌',
        '祛斑减肥', '丰胸', '增高', '生发', '壮阳',
        '抗癌', '抗肿瘤', '降血压', '降血糖', '降血脂', '降三高', '排毒',
        '抗衰老', '祛疤', '祛痘', '白发变黑', '视力恢复', '近视治愈', '神药',
      ],
    },
    {
      id: 'engage', name: '诱导互动/导流', level: 'mid',
      words: [
        '秒杀', '全民免单', '点击领奖', '点击领取', '中奖率', '免费领取',
        '关注后回复', '扫码关注', '添加微信', '加微信', '私聊我', '私信我',
        '加群', '进群领取', '转发领取', '分享领取', '转发朋友圈',
        '长按识别', '扫描二维码', '扫码进群', '加我微信', '加vx', '加V',
        '集赞', '转发抽奖', '点赞返现', '关注领取', '免费领', '0元领', '0元购',
      ],
    },
    {
      id: 'rush', name: '紧迫诱导', level: 'mid',
      words: [
        '最后一天', '仅此一天', '仅限今天', '错过再等一年', '末班车', '手慢无',
        '限时抢购', '抢疯了', '马上涨价', '即将售罄',
        '先到先得', '过时不候', '售完即止', '疯抢', '最后召集', '最后一波',
        '倒计时', '秒杀价', '最后名额', '错过没有',
      ],
    },
  ];

  /** 正则规则:覆盖组合形态(与显式词库互补,命中后按 category 展示) */
  const REGEX_RULES = [
    { re: /(?:全网|全国|全球|中国|行业|历史)(?:销量|排名|评分)?第一/g, cat: 'extreme', level: 'high' },
    { re: /(?:零|0|无)(?:风险|门槛|成本|添加|抵押|亏损)/g, cat: 'extreme', level: 'high' },
    { re: /(?:百分之)?100%(?:纯|有效|成功|正规|正品|通过)?/g, cat: 'extreme', level: 'high' },
    { re: /(?:最|超)强(?:攻略|教程|指南|总结)/g, cat: 'extreme', level: 'mid' },
    { re: /(?:日|月|年)(?:入|赚)\s*[0-9]+[万kKwW]?/g, cat: 'finance', level: 'high' },
    { re: /(?:彻底|完全|永久)(?:解决|根除|告别|摆脱|根治|治愈|消除)/g, cat: 'promise', level: 'mid' },
    { re: /仅剩\s*[0-9]+\s*(?:件|份|个|名|名额|套|天|小时)/g, cat: 'rush', level: 'mid' },
    { re: /(?:加|添加|私)\s*(?:微信|vx|VX|wx|WX|V信|威信)/g, cat: 'engage', level: 'mid' },
    { re: /(?:扫码|长按识别|扫描)(?:二维码|关注|进群|入群)/g, cat: 'engage', level: 'mid' },
    { re: /(?:免费|0元|零元)(?:领|领取|送|送出|拿|获取|试|体验)/g, cat: 'engage', level: 'mid' },
    { re: /(?:三天|3天|7天|一周|一个月|30天)(?:学会|精通|掌握|见效|上手|拿证)/g, cat: 'promise', level: 'mid' },
    { re: /(?:包|保)(?:过|过审|上岸|拿证)/g, cat: 'promise', level: 'high' },
  ];

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 扫描文本。返回 [{word, cat, level, index, ctx}]
   * 去重(同一位置同一词只报一次),高危优先,总数上限 40。
   */
  function scan(text, customWords) {
    const hits = [];
    const seen = new Set();
    const src = (text || '').replace(/\u00a0/g, ' ');
    const push = (word, cat, level, index) => {
      const key = word.toLowerCase() + '@' + index;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push({
        word, cat, level, index,
        ctx: src.slice(Math.max(0, index - 12), index + word.length + 12).replace(/\s+/g, ' '),
      });
    };

    // 分类词库
    CATEGORIES.forEach((c) => {
      c.words.forEach((raw) => {
        const w = raw.toLowerCase();
        let idx = src.toLowerCase().indexOf(w);
        while (idx !== -1 && hits.length < 60) {
          push(src.slice(idx, idx + raw.length), c.id, c.level, idx);
          idx = src.toLowerCase().indexOf(w, idx + w.length);
        }
      });
    });

    // 自定义词(中危)
    (customWords || []).forEach((w) => {
      if (!w || !w.trim()) return;
      const word = w.trim();
      let idx = src.toLowerCase().indexOf(word.toLowerCase());
      while (idx !== -1 && hits.length < 60) {
        push(src.slice(idx, idx + word.length), 'custom', 'mid', idx);
        idx = src.toLowerCase().indexOf(word.toLowerCase(), idx + word.length);
      }
    });

    // 正则规则
    REGEX_RULES.forEach((r) => {
      let m;
      const re = new RegExp(r.re.source, 'gi');
      while ((m = re.exec(src)) !== null && hits.length < 60) {
        push(m[0], r.cat, r.level, m.index);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });

    // 去掉互相包含的重复(如词库「全网第一」与正则命中同一段)
    const cleaned = [];
    hits.sort((a, b) => a.index - b.index || b.word.length - a.word.length);
    let lastEnd = -1;
    hits.forEach((h) => {
      if (h.index < lastEnd) return; // 与已收录片段重叠
      cleaned.push(h);
      lastEnd = h.index + h.word.length;
    });

    cleaned.sort((a, b) => (a.level === b.level ? a.index - b.index : a.level === 'high' ? -1 : 1));
    return cleaned.slice(0, 40);
  }

  const TOTAL = CATEGORIES.reduce((n, c) => n + c.words.length, 0);

  return { CATEGORIES, REGEX_RULES, scan, TOTAL };
})();
