# 027 Web 端引入 Tailwind v4 与 shadcn 基础件；主题由 CSS 变量驱动

- 日期：2026-09-17
- 状态：已采纳（`docs/prd/M8.md` 2026-09-17 拍板；落实 `docs/adr/013` 押后的 Tailwind / shadcn 决定）

**Context**：ADR-013 把 Tailwind 与 shadcn/ui 推到「第一个需要复用的交互组件出现时」。M8 的原型（`docs/ui-redesign/index.html`）
有 6 个视图、设置页 7 个 tab、下拉、开关、tab、折叠、筛选框，这个时点到了。用户同时要求「不引入新依赖，除了 shadcn 组件按需加」。

**Decision**：
- **引**：`tailwindcss` 与 `@tailwindcss/vite` 4.3.x（peer 已支持 Vite 8）；shadcn 生成组件所需的 `clsx` 2.1、`tailwind-merge` 3.x、
  `class-variance-authority` 0.7；`radix-ui` 1.x **只在某个组件确实需要**（Select、Switch、Tabs、Dialog、Popover）时引，
  且只用统一包 `radix-ui`，不散装 `@radix-ui/react-*`。shadcn 组件以源码形式放在 `apps/web/src/components/ui/`，不装 `shadcn` CLI 为依赖。
- **不引**：`lucide-react`（沿用原型的内联 SVG，收成 `icons.tsx`）；`next-themes`（主题是一个 nanostores atom + 一段 `<head>` 内联脚本防闪烁）；
  图表库（用量柱状图手写 SVG）；路由库（hash 路由 ~60 行）；`tw-animate-css`（原型只有一个 pulse 动画）。
- **Token**：`globals.css` 定义 `:root[data-theme=dark]` 与 `:root[data-theme=light]` 两套变量，名字与 HANDOFF §1 一一对应
  （`--bg` `--bg2` `--panel` … `--tool`，另加 `--accent-emphasis`）；Tailwind 用 `@theme inline` 把它们映射成 `bg-bg`、`text-ink`、`border-border` 等工具类；
  shadcn 组件期望的 `--background` `--foreground` `--primary` 等作为别名指向同一组变量，不维护第二份色板。
- **换色**：5 个 accent 色板各有深浅两套 `{accent, accentEmphasis}`；派生色用 `color-mix()` 从 `--accent` 算（hover、12%/8% 选中底、35%/30% 边框），
  所以换色只写两个变量。实心按钮底色用 `--accent-emphasis`，文字白色，对比度 ≥ 4.5:1 由测试断言（PRD-M8-001 AC-4）。
- **持久化**：深浅模式是「这台设备的偏好」，存浏览器 `localStorage`（读写包 try/catch，失败退回跟随系统）；**色板存 daemon 配置 `ui.accent`**，因为用户要 TUI 跟随 Web 选的主题色（2026-09-17 拍板）。色板与 token 的数据表在 `packages/client-core/src/tokens.ts`，Web 与 TUI 共用。

- **后端唯一新依赖**：`packages/config` 引 `yaml` 2.x，用于保留注释地回写 `config.yaml`（PRD-M8-011 AC-3，SPEC-M8 取舍-9）；读取仍可用 Bun 内置 YAML。

**不选的**：零依赖直接移植原型 CSS（用户明确要 ADR-013 的栈；原型 CSS 已有重复与冲突，照搬要先清理一遍，收益不大）；
Tailwind v3（v4 的 CSS-first 配置正好承接 CSS 变量 token，不需要 `tailwind.config.js`）；把深浅模式也存 daemon（远程连同一台 daemon 的不同设备、不同终端往往背景不同）。

**Consequences**：`apps/web` 多 5 个运行时依赖（radix 另计），体积预算在 TASK-M8-001 里量一次并记下数字；
`styles.css` 整体被 `globals.css` 取代；测试仍用 `react-dom/server`，Tailwind 类名不影响断言。
Mac 上需要重新 `pnpm install`，桌面端（Tauri）套的是同一份产物，无额外改动。
**触发重新决策的条件**：radix 引入的组件超过 8 个，或产物 gzip 后超过 250KB。
