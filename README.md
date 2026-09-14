# domi

> 一个会积累"人格"的、你能看见它每一步在想什么的本地 Agent 运行时。

**早期开发中，暂不接受 PR。**

---

## 文档导航

### 先读这三份

| 文件 | 是什么 | 什么时候读 |
|---|---|---|
| [`PRD-VISION.md`](PRD-VISION.md) | 定位 + **12 条不变量** | **每次开工必读。这是唯一的跑偏判定依据** |
| [`AGENTS.md`](AGENTS.md) | AI 开工必读的硬规则 | AI 会话开始时 |
| [`NEXT.md`](NEXT.md) | 三行现状：在做什么 / 下一步 / 卡在哪 | 每次开工第一眼；**每次收工前更新** |

### 设计与流程

| 文件 | 是什么 |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | 架构与路线图：三个不可逆决策、10 项需求的固化分层、技术选型、M0–M6 排期 |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md) | 工程规约：walking skeleton、三层测试金字塔、架构守卫、发布工程 |
| [`docs/PROCESS.md`](docs/PROCESS.md) | 研发流程：四角色环节、回写门、可追溯链、中断恢复机制 |

### 需求与执行

| 路径 | 是什么 | 产出角色 |
|---|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 全量 PRD，45 条需求，覆盖 M0–M6 | 产品专家 |
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

| 环节 | 状态 | 产出 |
|---|---|---|
| 产品专家 | ✅ 完成 | `docs/PRD.md` **v1.2**（45 条审计版 + 5 条 v1.2 新增，共 50 条） |
| 架构师 | ✅ 完成 | `docs/spec/M0.md`（取舍记录 9 条，均带"触发重新决策的条件"） |
| 工程师 | 🔵 进行中 | `docs/tasks/M0.md` 22 个任务 · **19 done、1 dropped** · 只剩 TUI 两个 + DoD 走查 |
| 测试工程师 | — | M0 完成后另开独立会话 |

**2026-09-14 方向变更**：见 `docs/adr/003-revert-to-self-built-runtime.md`。
`docs/RECON-DSH.md` 的"收缩为 DSH 发行版"结论已作废，该文档降级为情报文档。

**M0 开工第一件事**：PRD-M0-007 的 TUI spike（Bun + OpenTUI 验证）。**截至 2026-09-14 仍未执行，TUI 框架留白悬着。**
（原第二个 spike「`buildContext` 5 万事件压测」已由 `docs/adr/005` 降级为可选，策略改为运行期选项。）

## 本地开发

```bash
pnpm install
pnpm check      # typecheck + 架构守卫(INV-02/INV-10) + bun test
```

