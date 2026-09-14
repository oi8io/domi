# 001 TUI 框架选 Ink（Bun 运行时）

- 日期：2026-09-14
- 状态：已采纳

**Context**：`DESIGN.md` §5 原选 OpenTUI，理由是"渲染性能显著优于 Ink，对高频流式输出是刚需"，Ink 作兜底，并要求 M0 做一次 spike。本次重新裁决时提出的理由是"Ink star 数更多"——**这个理由不成立**：`PRD-VISION.md` §3 明确把 star 数列为滞后指标而非目标，且它推不出任何"触发重新决策的条件"，所以它是表态不是决策。更关键的是，star 数说的是 Ink 在 **Node** 生态里的成熟度，而本项目跑在 **Bun** 上，两者的交集恰恰是 star 数完全不覆盖的地方。

因此把 spike 从"OpenTUI vs Ink 性能对比"重新界定为"**Ink 在 Bun 上能不能跑，以及它和 domi 的架构是否契合**"。

## 实测-渲染帧耗时P95

场景：40 行历史 + 持续增长的 assistant 流式段 + 状态栏，100×40 终端，模拟模型流式输出。

| 口径 | Bun 1.4.2 | Node 22.23.2 |
|---|---|---|
| 仅 reconcile + Yoga 布局，P50 | **0.032 ms** | 0.301 ms |
| 仅 reconcile + Yoga 布局，**P95** | **0.135 ms** | 0.455 ms |
| 端到端（含 Ink 节流后真正写 ANSI），P50 | **2.796 ms** | — |
| 端到端，**P95** | **4.576 ms** | — |
| 端到端，P99 | 6.282 ms | — |
| 300 帧总墙钟 | 857 ms | — |
| 300 次 rerender 实际产生的 stdout 写入次数 | **82** | — |

**读法**：Ink 自带 32ms 节流，把 300 次 rerender 合并成 82 次写出——也就是说"高频流式输出"这个场景里，真正的瓶颈是节流器而不是 reconciler。按端到端 P95 4.6ms 算，余量在 200 帧/秒量级；而模型流式输出的实际速率是每秒几十个 token。**当初选 OpenTUI 的性能理由，在数字面前不成立。**

## 实测-native模块兼容清单

| 项 | 结果 |
|---|---|
| ink 版本 | 7.1.1 |
| react 版本 | 19.3.0 |
| 依赖闭包大小 | 37 个包 |
| **含 native / node-gyp 依赖** | **0 个** |
| `ink-testing-library` 在 Bun 下 | ✅ 可用，`lastFrame()` 正常返回 |
| ANSI 转义实际写出 | ✅ 已验证 |
| stdin raw mode + `useInput` | ⚠️ **未验证**，见下 |

零 native 依赖这一条有分量：`DESIGN.md` §5 把"部分 native 模块兼容性"列为 Bun 的主要风险，Ink 对这块风险面的增量是 0。

`useInput` 在沙箱里用 `PassThrough` 假 stdin 收不到按键——但 **Node 下表现完全相同**，所以这是测试环境没有真 TTY 导致的，不是 Bun 的问题。它仍然是一项未验证的能力，处理方式见「若不通的退路」。

## 结论

**选 Ink。但理由不是 star 数，是架构契合与模块复用。** 四条：

1. **三端共用一套心智（INV-02 的直接受益）**。`DESIGN.md` §5 的共享层设计是 `@domi/client-core` 放协议客户端与状态 store，TUI 和 Web 只写渲染。Ink 是 React，Web 也是 React——`client-core` 的 hooks 写一次两端都能用，状态层不必为 TUI 另做一份适配。
2. **M2 的轨迹面板要的是交互，不是帧率**。RECON §2-A 标定的真空是"终端里的可导航轨迹面板"——树形展开、跳转、定位。这类界面吃的是焦点管理与可测性，不是渲染吞吐。而吞吐恰恰是 OpenTUI 唯一明显的优势项。
3. **`PRD-M0-005` AC-4 要求 40/60/80/200 四种宽度 golden 快照 diff 为 0**，这是硬 AC。`ink-testing-library` 已实测在 Bun 下可用；OpenTUI 的测试渲染器成熟度未知，押错会在 M0 第一天就卡住一条 AC。
4. **「引用优先」第一类的现成生态**（`PRD-VISION.md` §6）：ink-text-input / ink-select-input / ink-spinner / ink-table 等可直接用，省下的是确认框、选择器、状态指示这些 M0/M1 必写的零件。

OpenTUI 真正会赢的场景是全屏、高帧率、多区域同时动画的界面。domi 的 TUI 是"滚动 transcript + 状态栏 + 树形面板"，不是那种东西。

## 若不通的退路

按风险从高到低，每条都写明怎么判定"不通"以及退到哪里：

1. **`useInput` / raw mode 在真实终端下不工作**（唯一未验证项，挡 `PRD-M0-005` AC-2 的 y/n 确认）。
   判定：`TASK-M0-021` 在真终端里跑 `demos/m0-loop.md`，按 y/n 无反应。
   退路：先用 readline 直接读 stdin 做确认框，Ink 只负责渲染；仍不行则本条升级为重新评估 OpenTUI 的触发条件。
2. **Ink 7 + React 19 出现 reconciler 层的 bug**。
   判定：golden 快照在同一输入下不稳定，或 unmount 后终端状态残留。
   退路：降到 Ink 6 + React 18（两者都是被大量使用过的组合），代价是 `client-core` 的 React 版本要跟着降。
3. **端到端 P95 在真实使用中超过 16ms**（即掉到 60fps 以下，人眼可感）。
   判定：`TASK-M0-022` 的 DoD 走查中出现可见卡顿。
   退路：先关掉不必要的重渲染区域（历史区虚拟化），仍不行再评估 OpenTUI——**此时才需要那次对比 spike**。

**本 ADR 不撤销 OpenTUI 这个选项，只是把它推后到上面三个条件之一触发时。**
