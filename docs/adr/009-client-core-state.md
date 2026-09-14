# 009 三端共享状态用 nanostores

- 日期：2026-09-14
- 状态：已采纳

**Context**：`DESIGN.md` §5 写的是"`@domi/client-core` 包含协议客户端、事件订阅、状态 store（用 Zustand 或 nanostores，两端都能跑）"——**候选列了两个，没有选**。而 `TASK-M0-020` 要写 Ink TUI，它第一件事就是消费 `client-core` 的 store，所以这条挡在 M0 路上，必须现在定。

**Decision**：**nanostores 1.5.3** + `@nanostores/react`（渲染层才用后者）。

**决定因素是消费方的数量，不是 API 好不好用。** `client-core` 的消费方有四类，只有两类在 React 里：

| 消费方 | 是 React 吗 |
|---|---|
| Ink TUI（`apps/tui`） | ✅ |
| Web / Desktop（`apps/web`、Tauri 壳） | ✅ |
| Telegram 桥接（`apps/bridge-telegram`，PRD-M5-007） | ❌ 纯 Node 进程 |
| 单元测试与 L1 回放评估（PRD-M2-008） | ❌ 无渲染层 |

nanostores 的核心与框架解耦，React 绑定是单独的包；`client-core` 因此可以**完全不依赖 React**——这正好是 INV-02 想要的形状（三端零业务逻辑，业务在共享层）。Zustand 也有 `zustand/vanilla`，但那是在 React 库上补出来的出口；nanostores 从设计上就是这个方向。

次要理由：atom / computed / map 的粒度天然适合"事件流投影成若干独立视图"（transcript、状态栏、轨迹树各一个 atom），而不是一个大 store 对象。

**Consequences**：换来 `client-core` 的 `package.json` 里没有 react——这条可以由 dependency-cruiser 直接守住，变成机器可判的边界，而不是口头约定。代价是 nanostores 生态比 Zustand 小，遇到复杂派生状态时可能要自己写 computed 组合。

**触发重新决策的条件**：Web 端出现 nanostores 的 `computed` 难以表达、且需要细粒度重渲染控制的派生状态（典型是大列表的虚拟化 + 多维筛选）。届时的退路不是全量换库，而是**只在 `apps/web` 内部**加一层 Zustand，`client-core` 保持不变——因为真正要守的是"共享层不依赖框架"，不是"全项目只用一个状态库"。
