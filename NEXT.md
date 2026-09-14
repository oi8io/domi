在做: M2 里**不依赖再批准门**的四条已经做完（M2-008 回放、M2-002 确定性清理、M2-005 轨迹显示、M2-007 schema 迁移），
      加上把「提测」需要的东西补齐 —— `pnpm check` 一条命令跑完全部：
      typecheck + **15 道守卫** + **460 个测试** + L1 轨迹回放；另有 `pnpm smoke` 跑单二进制冒烟。
      - **L1 回放**（PRD-M2-008）：`domi eval record <id>` 录真实会话，`domi eval run` 回放，不联网不花钱、已进 CI。
        仓库里带一条示范 fixture，**新克隆下来不需要 key 就能跑通**。
      - **单二进制**（补 M1-008）：`pnpm smoke` 在 `env -i` 干净环境（无 PATH / 无 NODE_* / 无凭据）跑十条断言，全过；
        四平台产物由 CI 的 binaries job 出。冒烟当场抓到一个真 bug：第一次运行没凭据时看不到四步引导，已修。
      - **cache bench**（补 M1-004）：`pnpm bench:cache` 默认只打印计划不花钱，`--yes` 才真跑。
      - **INV-08 第一次有了机器守卫**：CI 里跑会花钱的脚本、或出现模型凭据环境变量，直接红。
      - **schema 迁移**（PRD-M2-007）：`domi migrate` 先备份再迁移，失败**byte 级还原**；
        迁移 SQL 由白名单守卫扫描，改或删既有字段直接红——那类破坏不会在测试里露面。
      - **轨迹显示**（PRD-M2-005，新包 `packages/trace`）：`domi trace <id>` 打印树，
        `--html` 导出**单文件 HTML**——里面一行 JS 都没有，折叠靠原生 `<details>`，
        所以「无外部请求」是结构上不可能违反的，不是靠测试盯着。顺带还上了 M2-008 AC-4 欠的跳转锚点。
      - **确定性清理**（PRD-M2-002，新包 `packages/memory`）：去重 / 截断 / 清已解决的错误 / 砍堆栈，
        全程不花钱不掷骰子。十条标准 fixture 平均削减 59.8%（门槛 15%）。
        配置里写 `strategy = "clean"` 就能用；**加这个策略 kernel 一行没改**，测试直接断言这件事。
        事件 schema 3 → 4（新增 `ctx.cleanup`），旧事件照常解析。
下一步: **只剩两件我做不了的事**
        1. M0 走查：真终端跑 `demos/m0-loop.md` 的 13 条（TASK-M0-021 卡在 review）。
           已改成走 **Anthropic 兼容网关**（`provider = "anthropic"` + `base_url`），你手上的 key 能用；
           `domi doctor --ping` 把失败分成「key 不对 / 网关没通 / 模型名错 / 超时」四类。
        2. `pnpm bench:cache --yes` 跑一次（TASK-M2-003 卡在 review）——AC-1/AC-2 的判据是真实数字。
           **预期是 0%**：M1 稳定前缀只有约 35 token，低于 provider 的最小可缓存长度，脚本会先警告你这件事。
        3. （你说放后面）M1 dogfooding 连续 5 个工作日 —— M1 DoD 的判据，代码替不了。
        独立 QA 会话的提示词：`docs/qa/PROMPT.md`，贴进一个空会话即可，不需要我参与。
卡在: M2 其余条目要过再批准门（`docs/prd/M2.md`），门上必须你拍板的是 **MCP SDK 版本**（v2 仍是 beta，见 `docs/adr/010`）。
      M2-008 先做正因为它不依赖这条决定。
      仍未验收：M1-008 AC-1（`npx domi` 需要真发布到 npm）、M1-004 AC-1/AC-2（等上面那次真实运行）。
      实话都记在 `docs/qa/M1-reconciliation.md`，原文没删。
