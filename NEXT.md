在做: **M3 骨架轮做完了**（范围见 `docs/prd/M3.md` §3）。
      `pnpm check`：typecheck（现在含 apps/tui 与 apps/web）+ **16 道守卫** + **606 个测试** + L1 回放，全绿。

      这一轮交付的：
      - **Domi Protocol**（M3-001）：zod 方法表是唯一来源；握手不匹配就停，不降级；
        文档与 JSON Schema 由表生成，新守卫 `guard:protocol` 断言无 diff
      - **daemon**（M3-002 / M3-004）：core 与传输分离；断点续订（补发期间的新事件不重不乱序）；
        单实例锁；同会话串行、正忙回 `SESSION_BUSY`；`client-core-no-store` 守唯一写入者
      - **传输与进程**：Bun 原生 WebSocket（`docs/adr/012`）；`pnpm domid` 起独立进程，
        只监听 127.0.0.1、外站 Origin 一律 403（M3-006 AC-2 的默认值）
      - **DomiClient**（client-core）：握手、断线重连、按 seq 续订与去重，浏览器可跑
      - **Web 骨架**（M3-003）：`pnpm web`，React 19.3 + Vite 8.3（`docs/adr/013`）；
        能连、能列会话、能看事件流与轨迹、能提交
      - **`docs/parity-checklist.md`**：AC-1 的判据本身，十项里目前没有一项两端 e2e 齐全

      试一下：终端一 `pnpm domid`，终端二 `pnpm web`，浏览器开 http://127.0.0.1:5173

      2026-09-15 第一次真用 Web 端之后补的：
      - **网关 base_url**：`https://api.z.ai/api/anthropic`（Claude Code 写法，不带 /v1）现在也认；
        网关回非事件流 / 空流时，错误里写明请求地址与响应正文。改完之后请求已到达网关，
        剩下的 `[1305] overloaded` 是 z.ai 那边模型过载，不是 domi 的问题
      - **工具确认**：session.ask / answer / askDone 接通，Web 有确认框（默认拒绝）；
        之前 Web 发出的任何写文件、跑命令都被静默拒掉
      - **状态栏**：session.metrics，Web 与 TUI 同样五段
      - 打不开会话（比如 key 坏了）不再被说成「没有这个会话」

下一步: M3 下一轮（按 parity 清单表后的顺序）
        1. 协议补缺口：session.restore / branch / delete / switchModel；「本轮耗时」进 metrics（M1 遗留）
        2. TUI 改成 DomiClient 的客户端（现在 TUI 仍是进程内直接用 DomiSession）
        3. Playwright + parity e2e 逐行补；Tailwind / shadcn 随第一个复用组件引入
        4. M3-002 AC-3（kill -9 恢复）、M3-005、M3-006 认证与 `--connect`、MCP（ADR-011）
        5. 补 `docs/tasks/M3.md`——这一轮按 `docs/prd/M3.md` 的范围表直接做了，没有拆任务文件

        仍然只有你能做的：M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`（TASK-M2-003）、
        独立 QA（`docs/qa/PROMPT.md`）、M1 连续 5 个工作日 dogfooding

卡在: 没有卡住的决定。
      已知问题：`domi session restore <id>` 只打印「已恢复」，没有真正调用 restore（`packages/cli/src/run.ts`）。
      仍未验收的旧项照旧记在 `docs/qa/M1-reconciliation.md`。
