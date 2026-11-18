# 第三方组件与致谢

本项目打包了以下开源库,均为独立发行版,在此致谢并保留其许可声明:

| 组件 | 用途 | 许可协议 | 主页 |
|---|---|---|---|
| marked | Markdown → HTML 解析 | MIT | https://github.com/markedjs/marked |
| DOMPurify | HTML 消毒 | Apache-2.0 / MPL-2.0 双协议 | https://github.com/cure53/DOMPurify |
| highlight.js | 代码高亮 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| turndown + GFM 插件 | HTML → Markdown 转换(同步功能) | MIT | https://github.com/domchristie/turndown |

各库的完整许可文本可在其官方仓库查看;`lib/` 目录内的文件未做功能性修改。

## 方案参考

- [wechatsync](https://github.com/wechatsync/Wechatsync)(GPL-3.0):多平台同步功能的**方案与公开 API 端点**参考了该项目。本项目的平台适配器为独立实现(代码原创,未复制其源码),故本项目整体以 MIT 发布。如果你需要完整的同步方案实现,推荐直接使用 wechatsync。
- [doocs/md](https://github.com/doocs/md)、mdnice 等开源排版工具:内联样式兼容思路的参考。
- [no-ai-slop](https://github.com/) 提示词工程思路:AI 写文章的反 AI 腔规则来源。

## 商标与名称

「微信公众号」「微信」是腾讯公司的商标,本项目与腾讯公司无任何隶属或合作关系,仅供个人学习与研究使用。
