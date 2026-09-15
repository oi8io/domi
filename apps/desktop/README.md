# domi 桌面端（PRD-M5-005 · docs/adr/021）

Tauri 2.11 的一层壳：窗口里就是 `apps/web` 的构建产物，Rust 侧只有启动与更新检查（AC-3：没有业务代码）。

- 需要 Rust 工具链（`rustup`）。构建：`pnpm --filter @domi/desktop build`
- 桌面端**不自己拉起 domid**：先在终端里运行一次 `domi`（ADR-021 的取舍）
- 自动更新：`tauri.conf.json` 的 `plugins.updater.endpoints` 指向发布清单，`pubkey` 换成你自己的签名公钥
  （`npx @tauri-apps/cli signer generate`）。私钥只放在发布机器上
- `scripts/check-desktop-size.ts` 守着这个目录：TS + Rust 总行数 < 500，且不依赖 kernel / store

⚠️ 本仓库的开发机上没有 Rust，下面这些还没有验证过（TASK-M5-008）：三平台构建、冒烟、更新集成测试。
