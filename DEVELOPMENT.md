# domi 开发者入口

> 给改 domi 本身的人和 AI 会话看。想了解 domi 是什么、怎么用，看 [README](README.md)（[中文](README.zh-CN.md)）。

## 恢复流程

新会话、隔了几天再开工，都按这个顺序来（见 `docs/PROCESS.md`）：

```
1. 读 NEXT.md                      （30 秒）
2. git log --oneline -20           （30 秒）
3. 读当前 TASK 的"笔记"字段         （1 分钟）
4. bun test 确认 main 是绿的        （1 分钟）
5. 开工
```

AI 会话另外先读 [`AGENTS.md`](AGENTS.md)。

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
| [`docs/site/docs/index.md`](docs/site/docs/index.md) | **开发者文档站**：架构导图、各子系统内部机制、扩展指南（加工具 / 加模型 / 插件 / Skill）、贡献指南 |

### 需求与执行

| 路径 | 是什么 | 产出角色 |
|---|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 全量 PRD | 产品专家 |
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

现状只在 [`NEXT.md`](NEXT.md) 里维护（在做什么 / 下一步 / 卡在哪），这里不再抄一份。第一次接手先读 [`HANDOFF.md`](HANDOFF.md)。

## 本地开发

```bash
pnpm install
pnpm check      # typecheck + 架构守卫(INV-02/INV-10) + bun test
```

构建单二进制：`pnpm build`（本机）或 `pnpm build:all`（四个平台，产物在 `dist/`）。Web 端开发：`pnpm web`。

参与规矩见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
