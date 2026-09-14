在做: 提前交付 **PRD-M2-008 · L1 确定性轨迹回放**（`packages/eval`）—— 这是「提测」真正跑得起来的东西。
      `pnpm check` = typecheck + 12 道守卫 + 379 个测试 + `pnpm eval`（回放），全绿。
      `domi eval record <sessionId>` 把真实会话导出成 fixture；`domi eval run` 回放，不联网不花钱，已进 CI。
      仓库里提交了一条示范 fixture，**新克隆下来第一条命令就能跑通**，不需要 API key。
下一步: **两件只能你做的事**
        1. M0 走查：真终端跑 `demos/m0-loop.md` 的 13 条（TASK-M0-021 还卡在 review）。
           已改成走 **Anthropic 兼容网关**（`provider = "anthropic"` + `base_url`），你手上的 key 能用。
           `domi doctor --ping` 会把失败分成「key 不对 / 网关没通 / 模型名错 / 超时」四类。
        2. M1 dogfooding：连续 5 个工作日用 domi 干真实活——M1 DoD 的判据，代码替不了（你说放后面）
        独立 QA 会话的提示词已备好：`docs/qa/PROMPT.md`（隔壁小哥或你直接贴进一个空会话即可）
卡在: M2 是 PROVISIONAL，其余条目进入前必须过再批准门。材料：`docs/prd/M2.md`。
      门上必须由你拍板的一条：**MCP SDK 版本**（v2 仍是 beta），三条路与代价见 `docs/adr/010`。
      M2-008 之所以先做，正因为它**不依赖**这条决定。
      两处 M1 的实话仍未补：cache 命中率与单二进制都没有真实产物（`docs/qa/M1-reconciliation.md`）。
