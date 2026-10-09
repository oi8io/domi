# 030 移除 Telegram 桥接

- 日期：2026-10-09
- 状态：已采纳（用户 2026-10-09 拍板「把整块功能干掉」；依据调研 RECON-BRIDGE，存于 claude.ai 项目文档）
- 取代：`docs/adr/021` 的「Telegram 桥接」一段（通知与桌面端两段不变）
- 修改：`PRD-VISION.md` §4（v1.2 → v1.3）；`docs/PRD.md` v1.23 回写（PRD-M5-007 AC-1…AC-6、PRD-M8-012 AC-1 / AC-3 划掉，追加 PRD-M8-012 AC-8）

**Context**：`apps/bridge-telegram` 是按「只接一个平台」写的：编排、配对、出站格式和 grammY 都塞在一个 app 里，
接 WhatsApp、微信只能每个平台复制一份。对照 OpenClaw、Hermes Agent、pi-chat 三家的源码（RECON-BRIDGE），
正确的形状是「平台无关的核心 + 每个平台一个适配器 + 能力声明与降级」，现有代码要改的比留下的多。
另外它从 M5 交付起就没有测试（`bridge/telegram.spec` 一直挂在 TASK-M5-008 的验证待办里），
配对码也可以被暴力猜中（6 位数字、输错不作废、没有次数限制）。

**Decision**：整块移除，不做迁移——
- 删除 `apps/bridge-telegram`、`apps/tui/src/bridge-cli.ts`、`domi bridge` 命令、配置键 `bridge.telegram`、
  守卫 `guard:bridge`（`scripts/check-bridge-payload.ts`）与它在 typecheck / i18n 扫描 / depcruise 里的接线、全部 `bridge.*` 文案；
- Web 设置页的「通讯工具」占位 tab 一起删（PRD-M8-012 AC-8），旧地址 `#/settings/messaging` 落回「通用」；
- **协议不动**：`session.answer` 的 `channel`、`permission` 事件的 `channel`、`audit.record` 都是端无关的通用字段，
  历史事件里 `channel:'telegram'` 照常解析（INV-01）；
- 已有 `config.yaml` 里残留的 `bridge:` 段被配置解析静默丢弃（根对象不是 strict），不会报错。

**Consequences**：少了约 600 行代码、一个运行时依赖（grammY）和一道守卫；人不在电脑前时，只剩 `notify`（系统通知、webhook）。
以后要重新接聊天平台，按 RECON-BRIDGE 的方案从头立项：`packages/bridge-core`（平台无关，唯一依赖 client-core 的地方）
+ `packages/bridge-<平台>`（只依赖 core 的适配器接口，结构上拿不到事件与工具参数，INV-11 由依赖边界保证）
+ 一个进程挂多个适配器；第二个平台跑通后再冻结接口。
