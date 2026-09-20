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

**拿不到 Anthropic 官方 key 也能跑。** 只要网关说的是 Anthropic 协议，
`provider: anthropic` + `base_url` 指到网关即可——能力矩阵认的是**协议**，不是域名。
（本地模型填任意别的 provider 名字，按 openai-compatible 处理；要用工具的话打开 `capabilities.toolCall`。）

```bash
# 走自建网关 / 兼容端点
export DEEPSEEK_API_KEY=你的兼容key

mkdir -p /tmp/domi-demo && cd /tmp/domi-demo
cat > sum.js <<'JS'
export const sum = (a, b) => a - b
JS
cat > test.sh <<'SH'
#!/bin/sh
grep -q "a + b" sum.js && echo PASS || { echo FAIL; exit 1; }
SH

mkdir -p ~/.domi && cat > ~/.domi/config.yaml <<'YAML'
model:
  provider: anthropic                     # 说的是协议，不是域名
  name: GLM-4.7-Flash                # 网关上的模型名，按你的网关填
  # base_url: https://你的网关            # base_url 只写配置文件；带不带 /v1 都行

permissions:
  rules:
    - name: allow-read
      capability: fs.read
      decision: allow
    - name: confirm-write
      capability: fs.write
      decision: ask
    - name: confirm-shell
      capability: shell.exec
      decision: ask
YAML
```

**先跑一次自检**，它会把三种失败区分开——这一步能省掉大部分「为什么连不上」的猜测：

```bash
domi doctor --ping
```

| 它说 | 意思 | 下一步 |
|---|---|---|
| `端点通了，但 key 不被接受` | 网关在，key 不对 | 换 key |
| `模型名 "xxx" 找不到` | 网关和 key 都对 | 问网关要模型名清单 |
| `连不上 https://…` | DNS / 网络 / 地址写错 | 报告里给了一条 curl，直接粘 |
| `端点接受了请求但什么都没返回` | 多半还是模型名 | 同上 |

**key 里不要混进全角字符或空格**——`domi` 会当场拦下并说清楚，
但如果你在别处遇到一句看不懂的 `Headers` 报错，八成就是这个。

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
