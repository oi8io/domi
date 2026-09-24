# domi

> 一个会积累"人格"的、你能看见它每一步在想什么的本地 Agent 运行时。

**早期开发中，暂不接受 PR。**

---

## 文档导航

### 先读这几份

| 文件 | 是什么 | 什么时候读 |
|---|---|---|
| [`PRD-VISION.md`](PRD-VISION.md) | 定位 + **12 条不变量** | **每次开工必读。这是唯一的跑偏判定依据** |
| [`AGENTS.md`](AGENTS.md) | AI 开工必读的硬规则 | AI 会话开始时 |
| [`NEXT.md`](NEXT.md) | 三行现状：在做什么 / 下一步 / 卡在哪 | 每次开工第一眼；**每次收工前更新** |
| [`HANDOFF.md`](HANDOFF.md) | 交接：现在在哪 / 下一步做什么 / 哪里会踩坑 | 第一次接手这个仓库时 |

### 设计与流程

| 文件 | 是什么 |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | 架构与路线图：三个不可逆决策、10 项需求的固化分层、技术选型、M0–M6 排期 |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md) | 工程规约：walking skeleton、三层测试金字塔、架构守卫、发布工程 |
| [`docs/PROCESS.md`](docs/PROCESS.md) | 研发流程：四角色环节、回写门、可追溯链、中断恢复机制 |

### 需求与执行

| 路径 | 是什么 | 产出角色 |
|---|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 全量 PRD，覆盖 M0–M13 | 产品专家 |
| `docs/prd/M{n}.md` | 单册 PRD——`SKETCH` 里程碑过**再批准门**时在此重写为 `COMMITTED` | 产品专家 |
| `docs/spec/M{n}.md` | 接口契约 + 取舍记录 | 架构师 |
| `docs/tasks/M{n}.md` | 任务清单 + 状态机 | 工程师 |
| `docs/qa/M{n}.md` | 对抗性验收报告 | 测试工程师（独立会话） |
| `docs/adr/` | 架构决策记录，10 行以内 | 任意环节 |
| `docs/templates/` | 上述四类文档的模板 | — |

---

## 可追溯链

```
INV-xx ──→ PRD-M{n}-xxx ──→ SPEC-M{n}-xxx ──→ TASK-M{n}-xxx ──→ TEST ──→ QA-AC
              ↑                                                            │
              └──────────────────── 回写门 ←────────────────────────────────┘
```

**这条链断在哪里，腐蚀就从哪里进来。** 每个里程碑收尾做一次 10 分钟对账：
拉一张四列表（PRD-ID / SPEC-ID / TASK-ID / QA 结论），看有没有空格。

---

## 当前进度

> 2026-09-24 · 十四个里程碑（M0–M13）的**功能全部落地**，剩下的是验证补齐与用户侧 DoD。接手请先读 [`HANDOFF.md`](HANDOFF.md)，最新进度看 [`NEXT.md`](NEXT.md)。

| 环节 | 状态 | 产出 |
|---|---|---|
| 产品专家 | ✅ 完成 | `docs/PRD.md` **v1.18**（101 条，M0–M13）· 各里程碑再批准材料在 `docs/prd/` |
| 架构师 | ✅ 完成 | `docs/spec/M0 / M1 / M2 / M6 … M13.md`，均带"触发重新决策的条件"· 27 份 ADR |
| 工程师 | ✅ 功能完成 | M0–M13 共 14 个任务文件；typecheck + lint + 22 道守卫 + **1511 个测试** + L1 回放全绿 |
| 测试工程师 | 🔵 进行中 | M0 / M1 / M7 / M8 / M9 / M10 已纳入 `check-ac-coverage` 强制范围（236 条 AC）；M11–M13 待进强制范围，M4 / M5 / M6 的「验证补齐」待做 |

**下一步**：M11–M13 进 AC 覆盖强制范围；M4 / M5 / M6 验证补齐。
只有用户能做的：各里程碑 DoD（M12 / M13 优先）、M8 逐屏截图走查、TUI fullscreen 真终端手测、桌面端与 macOS 沙箱的真机验证。详见 `NEXT.md`。

**2026-09-14 方向变更**：见 `docs/adr/003-revert-to-self-built-runtime.md`。
`docs/RECON-DSH.md` 的"收缩为 DSH 发行版"结论已作废，该文档降级为情报文档。

## 本地开发

```bash
pnpm install
pnpm check      # typecheck + 架构守卫(INV-02/INV-10) + bun test
```

