# M0 走查：读 → 改 → 测

> 对应 `PRD-M0` 的 DoD。自动化版本在 `packages/kernel/test/e2e-loop.spec.ts`（CI 里跑）。
> **本文件是给人在真终端里跑的那一份**——它验证的是自动化测不到的东西。

## 为什么还需要人跑一遍

CI 里的端到端测试用的是真 SQLite、真权限引擎、真文件系统、真子进程，
但**没有 TTY**。所以下面三件事只能人来确认，它们恰好也是 `docs/adr/001` 退路清单的判定点：

1. Ink 的 `useInput` 在真终端里能不能收到按键
2. 确认框的 y/n 是否真的拦住了写入
3. Ctrl+C 之后重启，最后一轮还在不在

## 准备

```bash
export ANTHROPIC_API_KEY=...      # 或 DOMI_API_KEY
mkdir -p /tmp/domi-demo && cd /tmp/domi-demo
cat > sum.js <<'JS'
export const sum = (a, b) => a - b
JS
cat > test.sh <<'SH'
#!/bin/sh
grep -q "a + b" sum.js && echo PASS || { echo FAIL; exit 1; }
SH
cat > ~/.domi/config.toml <<'TOML'
[model]
provider = "anthropic"
name = "claude-sonnet-4-5"

[[permissions.rules]]
name = "allow-read"
capability = "fs.read"
decision = "allow"

[[permissions.rules]]
name = "confirm-write"
capability = "fs.write"
decision = "ask"

[[permissions.rules]]
name = "confirm-shell"
capability = "shell.exec"
decision = "ask"
TOML
```

## 走查清单

在 `/tmp/domi-demo` 里启动 `domi`，输入：**「把 sum.js 的减号改成加号，然后跑 test.sh」**

| # | 观察点 | 期望 | 对应 |
|---|---|---|---|
| 1 | 回车之后 | 100ms 内出现 `⠋ 思考中` | PRD-M0-002 AC-1 |
| 2 | 模型输出 | 逐字流出来，不是整段跳出来 | PRD-M0-005 AC-1 |
| 3 | 读文件时 | 出现 `⚙ fs.read {"path":"sum.js"}` 一行 | PRD-M0-005 AC-1 |
| 4 | 要写文件时 | 弹确认框，**且框里能看到要写的内容**，不只是 "fs.write" | PRD-M0-003 AC-1 |
| 5 | **按 n** | 写入被拒，文件不变，模型换一种说法而不是报错崩掉 | PRD-M0-003 AC-2 |
| 6 | 重来一次，**按 y** | 文件真的改了，`cat sum.js` 能看到 `a + b` | PRD-M0-004 AC-2 |
| 7 | 跑测试时 | 再弹一次确认框，内容是完整命令行 | PRD-M0-003 AC-1 |
| 8 | 测试结果 | 屏幕上能看到 `PASS` | M0 DoD |
| 9 | 状态栏 | 显示 `provider/model · N tok (cache M) · K 次工具` | PRD-M0-005 AC-1 |
| 10 | **按回车（不按 y/n）** 在确认框上 | 等于拒绝，不是同意 | INV-03 的交互层延续 |
| 11 | **Ctrl+C** | 立刻退出，终端不残留渲染 | PRD-M0-005 AC-3 |
| 12 | 重启 `domi` 后查库 | 最后一轮的事件都在，seq 连续 | PRD-M0-001 AC-2 |
| 13 | 把终端拉窄到 40 列再跑一次 | 不错行、状态栏不被挤没 | PRD-M0-005 AC-4 |

## 判定

- **1–13 全过** → M0 DoD 达成，`docs/adr/001` 退路清单第 1 条解除，在 ADR 里把那条标注为「已验证」
- **第 1 或 4 或 10 条不过**（按键收不到） → 触发 ADR-001 退路第 1 条：
  先退到 readline 直读 stdin、Ink 只管渲染；仍不行则升级为重新评估 OpenTUI
- **第 11 条不过**（终端残留） → Ink 的 unmount 没收拾干净，退路见 ADR-001 第 2 条（降到 Ink 6 + React 18）

走查结果请写进 `docs/qa/M0.md`，不要只在脑子里过一遍。
