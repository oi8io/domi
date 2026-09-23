# 028 代码块语法高亮用 lowlight（highlight.js 语法表）+ 自选语言子集，两端共用一份分词

- 日期：2026-09-23
- 状态：已采纳（用户 2026-09-23 拍板「做轻量高亮」，推翻 SPEC-M11 当时的「不引 highlight.js / shiki」）

**Context**：M11 的 Markdown 渲染两端都不做语法高亮；用户看了排版对齐原型的建议稿后要求加上，并要求 TUI 一起调。
约束：Web 首屏包不能因此变大（ADR-027 的 gzip 预算）；TUI 与 Web 要同一份分词、同一套配色；client-core 必须浏览器可用。

**Decision**：
- **引** `lowlight` 3.x（highlight.js 的语法表，输出 hast、不碰 DOM）与 `highlight.js` 11.x 的语言模块，只注册 15 种常用语言
  （typescript / javascript / json / bash / shell / python / go / rust / yaml / css / xml·html / diff / sql / markdown / ini·toml）及常用别名；
  **不用** `highlightAuto`——不认识的语言、没写语言不猜，按纯文本。
- 分词放 `@domi/client-core/highlight`（独立子路径），产出按行的 `{ text, kind }`，kind 收敛成 10 类；配色是 `tokens.ts` 的 `SYNTAX`
  （Primer 的语法色，主题底色本身就是 Primer；浅色注释从 #6e7781 调到 #59636e 以过 4.5:1）。
- Web 按需 `import()`，首屏与 SSR 先纯文本；TUI 同步调用，真彩色用 hex、16 色退到终端色名、NO_COLOR 不上色。
- 引擎放在 `highlight-engine.js` + 手写 `.d.ts`：highlight.js 的类型声明带 `/// <reference lib="dom" />`，被 tsc 读到会把 DOM 类型拉进整个工程
  （Bun 的 `Headers.entries` 当场报错）。
- **拒** shiki：要 wasm 与整套主题文件，包大、首帧慢，且配色要另维护一份。**拒** Prism：要操作 DOM 或自带 CSS 主题，TUI 用不上。

**Consequences**：
- 换来：两端代码块有同一套语法色，跟深浅主题与 Primer 底色协调；Web 首屏包不变，高亮器是单独的 chunk（2026-09-23 实测 gzip 24.5KB，
  首屏 start chunk gzip 203KB，仍在 ADR-027 的 250KB 以内）。
- 付出：多两个依赖；语言子集要维护（加语言 = 在 highlight-engine.js 里注册一个模块）；流式输出时代码块随每次增量重新分词（纯函数，量小）。
