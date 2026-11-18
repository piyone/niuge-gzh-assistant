# 牛哥公众号助手(浏览器插件)

在**公众号后台编辑器页面内**直接完成排版、校对、多平台分发,不用切换到任何第三方网站。

![版本](https://img.shields.io/badge/version-1.7.27-blue) ![协议](https://img.shields.io/badge/license-MIT-green)

## 📦 安装(Chrome / Edge / Arc 等 Chromium 浏览器)

1. 下载本仓库(页面右上角 Code → Download ZIP 解压,或 `git clone`)
2. 打开 `chrome://extensions`(Edge 为 `edge://extensions`)
3. 右上角开启「开发者模式」
4. 点「加载已解压的扩展程序」,选择本仓库的 `niuge-gzh-assistant` 目录
5. 打开 [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 图文消息 → 新建图文,页面右侧出现「牛」字悬浮球即安装成功

> - 仅支持 Chromium 内核浏览器;Firefox / Safari 不支持(MV3 的 DNR 会话规则用法不同)
> - **更新版本**:下载新版后覆盖目录,回到扩展管理页点该插件卡片上的「刷新」按钮即可
> - **卸载**:扩展管理页点「移除」;所有数据(API Key、快照、词库)只存本机,卸载即清除
> - 大版本升级浏览器可能提示权限变更,属于正常现象(同步功能需要各平台站点权限)

## ⚡ 快速上手(第一次使用)

1. **配置 AI(可选但推荐)**:悬浮球 → 面板右上角「设置」→ 选择 AI 服务商预设 → 填入你的 API Key → 点「测试连接」看到延迟即成功。不用 AI 功能可跳过,排版/检查/同步全部离线可用
2. **写一篇文章测试**:在编辑器里随便打几段话 → 悬浮球 → 「排版」→ 点「一键规范」和主题卡片 → 手机预览满意后点「套用」
3. **试试 AI 创作**:「AI写」页填一个选题 → 生成初稿 → 插入编辑器 → 生成标题点「采用」
4. **发布前**:「检查」页跑一次规则体检 + AI 校对;要分发就到「同步」页勾选平台点「一键同步」

## 🚀 七个标签页

- **排版**(三区块一站式):
  - **① 一键规范**:中英空格、全角标点、省略号标准化(。。。/... → ……)、连续标点收敛(可选)、压缩空行、外链脚注化,全部可单独执行
  - **② 主题美化**:6 套主题(雅蓝/科技蓝/暖橙/青竹/极简黑白/樱粉)+ 字号行距滑杆,点卡片即刻手机预览(可开关),满意再「套用」
  - **③ 防丢稿**:恢复上次快照 + 快照历史(每 90 秒自动留档)

- **导入**:粘贴 Markdown → 实时渲染预览 → 「注入编辑器」直达(或「复制富文本」手动 Ctrl+V,效果一致)
- **AI写**(生成类 AI 功能都在这里):
  - **🪄 写文章**:输入选题 + 风格(干货/观点/故事/清单)+ 目标读者 → 生成 Markdown 草稿(约 700~900 字),「继续写」追加段落,一键「插入编辑器(追加)/ 替换编辑器内容」(改前自动存快照)或复制 Markdown
  - **✍️ 标题**:基于正文生成 **5 种风格候选标题**(悬念好奇 / 数字干货 / 痛点共鸣 / 观点态度 / 场景故事),每条 ≤30 字并避开极限词,标注字数,一键「采用」填入公众号标题框(找不到标题框时自动复制)
  - **📝 摘要**:生成 **60~110 字**会话卡片摘要,一键「填入摘要框」或复制
- **检查**(把关类功能都在这里,双区块):
  - **① AI 校对**:检查错别字 / 语句不通顺 / 标点误用,逐条或一键应用(需配置 AI 模型)
  - **② 规则体检**:本地即时、无需 AI——**体检汇总**(通过/建议/待处理计数)+ 文章标题(缺失/超 64 字/信息流截断)、**违禁词分类扫描**(6 类 + 正则组合规则)、外部链接、空链接、图片防盗链域名、空段落、标题层级、超长段落、空格对齐、中西文空格、篇幅预警
- **同步**:勾选平台 → 一键批量把文章写入 **13 个平台** 的草稿箱(方案参考开源 wechatsync,复用浏览器登录态;发布仍需到平台手动确认);另提供「复制 Markdown / 复制富文本」兜底
- **统计**:中文字数、英文词数、预计阅读时长、段落节奏、快照信息
- **预览**:375px 手机宽度还原读者视角

## ⌨️ 典型工作流

```
方式一(AI 代写):「AI写」填选题 → 生成初稿 → 继续写 → 插入编辑器
        → 「AI写」生成标题采用、摘要填入
方式二(自己写):编辑器写完(或贴 Markdown)
  → 「排版」:一键规范 + 套主题
  → 「检查」:AI 校对逐条应用 + 违禁词/外链/图片体检
  → 「同步」:知乎/掘金等一键写草稿
  → 「预览」:手机视角过一遍
  → 回公众号后台正常群发
```

任何一步改坏了:「排版 → 恢复上次快照」一键回滚;**每 90 秒还会自动留档一份历史快照**(最多 10 份,内容有变化才存),「排版 → 快照历史」可按时间点恢复——误删大段内容也能找回。

## 🤖 AI 模型配置(设置页)

- **9 个服务商预设一键切换**:aitools.cfd / DeepSeek / 智谱开放平台 / 月之暗面 Kimi / 通义千问 / 硅基流动 / OpenRouter / Ollama 本地 / 自定义 OpenAI 兼容——选中即自动填接口地址与常用模型,API Key 全部由用户自行填写、仅存本机(chrome.storage.local,不上云)
- **API Key 按服务商分别记忆**:多个服务商的 Key 同时保存,随时切换不丢失;密码框显示,一键显隐
- **🔌 测试连接**:真实调用一次接口验证 Key 与模型——成功显示延迟与返回内容;401/404/429 分别给出针对性提示;检测到思维链模型(推理 token 吃满上限)会给出换模型警告
- 模型支持下拉候选 + 手动输入;任何 OpenAI 兼容接口都能接
- **使用前配置提示**:AI 功能页面自动检测配置状态——未配置时显示引导横幅(标注缺失项 + 「去设置」直达按钮,运行按钮禁用),配置好横幅自动消失并显示当前模型;设置页修改后**实时同步**到公众号编辑器面板,无需刷新
- 校对时面板自动按平台限流分段倒计时(每分钟 1 次),详见下方「AI 校对说明」

## 🤖 AI 校对说明

- 接口平台(aitools.cfd)限流:**每密钥每 60 秒 1 次请求**、单请求体 ≤16KB、max_tokens ≤1024
- 插件自动应对:文章按段落分块(≤3200 字/块),≤3200 字一步到位;长文分段校对,段间自动倒计时重试,429 时按 `Retry-After` 等待
- 默认模型 `zhipu/glm-4-flash`(非推理型,结构化 JSON 输出稳定,实测精确抓出错别字);⚠️ 不要换成 `glm-4.7-flash` 等 thinking 模型——推理 token 会吃满 max_tokens 导致结果被截断(测试连接功能会主动检测并提醒)
- 「应用」修改 = 精确字符串替换,改前自动存快照可回滚;跨样式节点的片段会提示手动修改
- **API Key 由用户在设置页自行填写**(仅存本机 chrome.storage.local,不上传、不预填)。⚠️ 密钥是敏感信息:不要把配置过的浏览器配置文件分享给他人;若泄露请到对应平台重新生成并在设置页替换

## 🔄 多平台同步说明(v1.2,13 个平台)

| 分组 | 平台 | 内容格式 | 图片 | 实现(均参考 wechatsync v2 适配器) |
|---|---|---|---|---|
| 社交·社区 | 知乎专栏 | HTML | 按 URL 转存知乎图床 | `zhuanlan.zhihu.com/api/articles/drafts` + PATCH |
| 社交·社区 | B站专栏 | HTML(链接移除) | 下载→FormData 转 B 站图床(外站图会被移除) | `api.bilibili.com/x/article/creative/draft/addupdate`(cookie bili_jct CSRF) |
| 社交·社区 | 微博头条文章 | HTML | 异步上传→轮询转微博图床 | `card.weibo.com/article/v5/aj/editor/draft/create+save`(SN-REQID) |
| 资讯·垂直 | 百家号 | HTML | FormData 转百度图床 | 编辑页提取 `__BJH__INIT__AUTH__` token + JSONP save |
| 资讯·垂直 | 搜狐号 | HTML | FormData 转搜狐图床 | 子账号列表 + `news/draft/v2`(dv-id/sp-cm 头) |
| 资讯·垂直 | 雪球 | Markdown→简化 HTML | FormData 转雪球图床 | `xq/statuses/draft/save.json`(UOM_CURRENTUSER 解析) |
| 资讯·垂直 | 人人都是产品经理 | HTML | FormData 转又拍云 | WordPress `admin-ajax.php` add_draft(jltoken) |
| 技术社区 | CSDN | Markdown | 签名→华为云 OBS | `bizapi.csdn.net` HMAC-SHA256 签名 API |
| 技术社区 | 掘金 | Markdown | 暂不转存(草稿内可替换) | `article_draft/create`(CSRF token + DNR Origin) |
| 技术社区 | 思否 | Markdown | FormData 转思否图床 | `gateway/draft`(serverData Token) |
| 技术社区 | 博客园 | Markdown | FormData 转 cnblogs 图床 | `i.cnblogs.com/api/posts`(XSRF-TOKEN cookie) |
| 技术社区 | 开源中国 | Markdown | FormData 转存 | `draft/save_draft` |
| 技术社区 | 慕课手记 | Markdown | FormData 转存 | `article/savedraft` |

- 前提:浏览器内已登录对应平台账号;勾选后先「检测登录」可批量确认
- 同步 = **写入草稿箱**,不会自动发表;勾选记忆在本地,下次打开保持
- 平台 UI 改版导致接口失效时,面板会逐平台给出失败原因与「复制 Markdown / 复制富文本」手动兜底
- 需要 Origin/Referer/cookie 等浏览器禁止头的平台,经 `declarativeNetRequest` 会话规则动态注入(请求前加、请求后删)

## 🛠 技术要点

- **Manifest V3**,无构建步骤,纯静态文件;后台 Service Worker(`importScripts` 复用引擎)
- 渲染管线:`marked`(GFM+breaks)→ `DOMPurify` 消毒 → 中文排版规范(代码块/版本号/网址豁免,省略号与标点收敛可开关)→ `highlight.js` 高亮 token 内联化 → 主题样式全量写入 `style` 属性
- 违禁词:`engine/words.js` 独立词库引擎——6 类 224 词 + 12 条正则组合规则 + 设置页自定义词,位置重叠去重、高危优先
- 防丢稿:注入/排版前强制快照(单份)+ 90 秒间隔内容 hash 变更检测自动留档(滚动 10 份,chrome.storage.local)
- **编辑器注入三级降级**:合成 `ClipboardEvent('paste')` → `execCommand('insertHTML')` → 直接写 DOM + input 事件
- AI 请求经后台 SW 代理(规避页面 CORS);平台同步复用浏览器 Cookie,掘金经 `declarativeNetRequest` 会话规则注入 Origin/Referer
- 引擎函数全部纯函数化(`engine/`),无 chrome 依赖,jsdom 可测

## 📁 目录结构

```
niuge-gzh-assistant/
├── manifest.json          # MV3 清单(v1.1:后台 worker、DNR、多站点权限)
├── background/
│   └── service-worker.js  # AI 请求代理 + 知乎/掘金适配器
├── engine/                # 纯函数排版引擎(无 chrome 依赖,可独立测试)
│   ├── typography.js      #   盘古之白/标点/省略号/标点收敛/空行/脚注化/统计
│   ├── words.js           #   违禁词引擎:6 类分类词库 + 正则规则 + 自定义词
│   ├── themes.js          #   6 套主题 → 内联样式映射
│   ├── ai.js              #   AI 引擎:校对分块/标题/摘要/写文章 提示词与解析
│   ├── sync-prepare.js    #   同步:知乎 HTML 转换/掘金 payload/HTML→MD
│   └── render.js          #   Markdown 全管线 + 预览文档生成
├── content/               # 悬浮球 + 八标签面板(注入 mp.weixin.qq.com)
├── popup/ options/        # 工具栏弹窗与设置页(AI 配置/违禁词/规则)
├── lib/                   # marked / DOMPurify / highlight.js / turndown(+GFM)
├── test/                  # harness.html 浏览器测试台 + 示例文章
└── demo/preview.html      # 六主题静态预览(双击即看,无需安装)
```

## ✅ 质量验证

- `test/harness.html`:完整加载插件全部脚本(含 chrome API shim 与模拟公众号编辑器)的浏览器测试台
- 218 项 jsdom 断言(基线 43 + v1.1 校对 37 + v1.2 平台同步 29 + v1.3 四功能加强 30 + v1.4 AI 配置 20 + v1.4.1 配置提示 14 + v1.5 AI 标题摘要 30 + v1.6 AI 写文章/信息架构 15)全过,覆盖:排版规范(含省略号/版本号/网址保护、标点收敛开关)、分类词库扫描与去重、新检查项与体检汇总、快照历史与恢复、AI 分块/解析容错、标题/摘要/写文章解析容错与 mock 全流程(生成→采用→填入→插入编辑器)、检查页双区块(AI 校对+规则体检)、后台连接测试处理器(mock 服务器测成功/401/404/网络失败路径)、服务商预设切换与 Key 记忆、AI 配置前置检测横幅与实时同步、雪球简化 HTML 转换、CSDN HMAC 签名、13 平台元信息与批量流程降级
- AI 接口真实连通性已实测(glm-4-flash 正确输出校对 JSON)

## ❓ FAQ

**API Key 安全吗?**
Key 仅存本机 `chrome.storage.local`,不上传任何服务器;AI 请求经浏览器后台 Service Worker 直连你选择的服务商。不要分享配置过 Key 的浏览器配置文件。

**同步需要什么权限?为什么要点这么多站点?**
同步 = 用你浏览器里已登录的平台账号调用该平台自己的草稿接口,所以需要对应站点的权限。所有请求都由你的浏览器直接发出,本项目无任何中转服务器。

**同步失败怎么办?**
平台改版会导致接口失效,面板会逐平台显示失败原因;任何时候都可以用「复制 Markdown / 复制富文本」手动兜底。

**AI 校对/写作为什么提示模型输出异常?**
优先使用非推理模型(默认 `glm-4-flash`);thinking 类推理模型的思考 token 会吃满 max_tokens 导致 JSON 截断,「测试连接」会主动检测并提醒。

## ⚠️ 免责声明

- 本项目仅供**个人学习与研究**使用,请遵守各平台的服务协议与内容规范,勿用于任何违规用途
- 多平台同步基于各平台公开/半公开的草稿接口实现,**平台改版可能导致功能失效**,作者不承诺持续维护所有适配器
- 使用本插件产生的一切后果(包括但不限于账号限流、内容审核问题)由使用者自行承担
- 「微信」「公众号」为腾讯公司商标,本项目与腾讯无任何关联

## 📄 许可与致谢

本项目基于 [MIT](LICENSE) 协议开源。打包的开源库与方案参考见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)——特别感谢 [wechatsync](https://github.com/wechatsync/Wechatsync)、[doocs/md](https://github.com/doocs/md)、[marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/DOMPurify)、[highlight.js](https://github.com/highlightjs/highlight.js)、[turndown](https://github.com/domchristie/turndown)。

## 🗺 路线图

- [x] ~~违禁词检测 / 中文排版规范 / 发布前检查 / 防丢稿快照~~(v1.0)
- [x] ~~AI 校对 / 多平台同步(知乎、掘金)~~(v1.1)
- [x] ~~多平台同步扩展至 13 个平台(批量勾选 + 图片转存)~~(v1.2)
- [x] ~~四大空白功能加强:分类词库扩容 / 省略号与标点收敛 / 检查项 11 个 + 体检汇总 / 自动快照历史~~(v1.3)
- [x] ~~AI 模型配置:9 服务商预设、按商记忆 Key、一键测试连接~~(v1.4)
- [x] ~~AI 功能使用前配置提示(横幅引导 + 设置实时同步)~~(v1.4.1)
- [x] ~~AI 标题(5 风格候选一键采用)+ AI 摘要(一键填入摘要框)~~(v1.5)
- [x] ~~AI 写文章(选题→初稿→继续写→插入编辑器)+ 信息架构调整:AI写/检查 分离~~(v1.6)
- [ ] 完读率体检:开头钩子检测、加粗密度、节奏点提示(推荐流时代差异化)
- [ ] 更多平台:语雀(需知识库选择 UX)、豆瓣、51CTO、头条号(wechatsync v2 未覆盖,需逆向)
- [ ] 自定义主题 CSS 编辑器(企业品牌模板)
- [ ] MCP / CLI:把排版引擎暴露给 AI Agent 调用
