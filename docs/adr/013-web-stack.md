# 013 Web 端技术栈：React 19.3 + Vite 8，Tailwind / shadcn 推到 parity 轮

- 日期：2026-09-15
- 状态：已采纳（补 `docs/adr/010` 押后清单中的「Web 技术栈细节」）

**Context**：`DESIGN.md` §5 写的是 React + Vite + Tailwind + shadcn/ui，版本押到 M3。这一轮 Web 只做骨架（`docs/prd/M3.md` §3）：能连上、能看到事件流与轨迹。

**Decision**：
- **React 19.3 + react-dom 19.3**：与 TUI（Ink 7 + React 19.3）同一个大版本，`client-core` 的 atom 两端用同一个 `@nanostores/react` 消费（`docs/adr/009`）。
- **Vite 8.3 + @vitejs/plugin-react 6.1**：只做开发服务器与打包。开发服务器只监听 `127.0.0.1`（与 daemon 同一个立场，INV-11）。
- **Tailwind 与 shadcn/ui 这一轮不引**。骨架只有三个区域（侧栏、事件流、输入框），一份 ~80 行的原生 CSS（含深色模式）够用；
  在还没有真实组件需求时引入设计系统，会先写出一批要推倒的样式。进入 parity 轮、第一个需要复用的交互组件（确认框、状态栏）出现时再引，届时版本在那条 ADR 里钉。
- **Playwright 这一轮不引**：parity e2e 不在本轮范围。本轮 Web 的测试用 `react-dom/server` 渲染成字符串断言，不起浏览器。
- daemon 地址由页面参数 `?daemon=ws://…` 给，默认 `ws://127.0.0.1:7437`，不在构建期写死——桌面端（Tauri）套同一份产物时要能改。

**Consequences**：换来一个依赖很少、能跑能测的骨架，`pnpm typecheck` 同时覆盖 `apps/web`。代价是样式层以后要迁一次到 Tailwind；因为现在的样式只有一份 CSS 文件、没有被任何组件抽象依赖，这次迁移的面是可控的。
