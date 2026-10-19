# 快速开始

> 第一次跑 domi：装好、配上模型、第一次对话、权限与长任务。想了解它是什么，先看[domi 是什么](intro.md)。

## 先说结论

- 下载一个二进制，一条命令跑起来：`domi` 进终端界面，第一次会自动启动后台服务。
- key 写进 `~/.domi/secrets.yaml` 或环境变量；`domi doctor` 每条问题都带修复命令。
- **没有规则的能力默认拒绝**；危险能力只有你亲手写了 `allow` 规则才放行。
- 任务在后台服务里跑，关掉终端也继续；重启后从上次完成的节点接着跑。
- 出问题了先跑 `domi doctor`——它给出能直接粘贴的修复命令。

## 1. 装好并配上模型

到 [Releases](https://github.com/oi8io/domi/releases/latest) 下载适合你电脑的包（`domi-<版本>-<系统>-<架构>.tar.gz`），解压后放进 `PATH`：

```sh
tar -xzf domi-*-darwin-arm64.tar.gz
mkdir -p ~/.local/bin && mv domi ~/.local/bin/
xattr -d com.apple.quarantine ~/.local/bin/domi   # 只有 macOS 要：二进制还没签名
```

想从源码构建：`git clone https://github.com/oi8io/domi && cd domi && pnpm install && pnpm build`，产物是 `dist/domi`。

然后生成配置、填 key、体检：

```sh
mkdir -p ~/.domi && domi init > ~/.domi/config.yaml
export DEEPSEEK_API_KEY=sk-...     # 或者把 key 写进 ~/.domi/secrets.yaml
domi doctor                        # 每条问题都带一条能直接粘贴的修复命令
```

key 写进 `~/.domi/secrets.yaml`（`providers.<id>.api_key`），或者用各家自己的环境变量（每家都认 `DOMI_<ID>_API_KEY`，厂商模板再加惯用名，例如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`）。

多家供应商、本地模型或网关（LiteLLM、OpenRouter、Ollama）写在 `providers` 下，每家一段：

```yaml
model:
  provider: deepseek        # 默认模型 = 一个 provider + 一个模型名
  name: deepseek-chat
providers:
  deepseek:
    vendor: deepseek        # 厂商模板给默认协议、地址与能力：openai / anthropic / deepseek / gemini / custom
  local:
    name: 本机 Ollama
    vendor: custom
    protocol: openai        # custom 要自己选协议
    base_url: http://localhost:11434/v1
    models: [qwen3:8b]      # 探测不到 /v1/models 时用这份清单
    enabled: true
```

这些在 Web「设置 › 模型供应商」里都能改；模型清单会按 `/v1/models` 自动探测，对话里按 provider 分组切换。

## 2. 对话

```sh
domi                           # 进终端界面；第一次会自动启动后台服务（domid）
```

对话里常用的命令：`/model` 换模型、`/mode <档位>` 切确认模式、`/compact` 压缩上下文、`/branch` 从某一条分出新会话、`/ref <会话> [起-止]` 引用另一个会话的一段、`/continue` 接着做计划里没做完的步骤、`/soul` 看 Soul 待审阅的改动。模型跑着的时候也能接着打字：回车是**补充**，排队、下一步送达；要停下这一轮，Web 点「停止」、TUI 按 `Esc`。

Web 端目前要从源码运行（仓库里 `pnpm web`），看到的是同一批会话。

TUI 默认是**全屏模式**（和 Claude Code 一样用终端的备用屏）：对话区自己滚动，输入框钉在底部。PgUp / PgDn 翻半屏，Ctrl+Home / Ctrl+End 到顶 / 到底，鼠标滚轮也能滚（`tui.mouse: false` 关掉，好让终端自己的鼠标选择可用）；往上翻着的时候来了新消息，底部会提示「N 条新消息」。要用终端自带的搜索或选择复制，按 **Ctrl+O** 把整段对话倒进终端的回滚区，按任意键回来。想要老样子（对话直接留在终端回滚里）：`tui.renderer: classic`，或临时 `DOMI_TUI_RENDERER=classic domi`。

界面语言：`ui.locale: auto | zh | en`（auto 跟系统，TUI 看 `LANG`，Web 看浏览器）。

## 3. 权限

没有规则的能力默认拒绝。`config.yaml` 的 `permissions.rules` 按能力放行，`decision` 是 `allow` / `ask` / `deny`：

```yaml
permissions:
  rules:
    - { name: read, capability: fs.read, decision: allow }
    - { name: write, capability: fs.write, decision: ask }
```

每个会话还有一个**确认模式**（`/mode`，Web 在输入框旁的下拉里）：

- `on-demand`（默认）：按上面的规则走；危险能力（写 / 删 / 移动文件、跑命令、联网、MCP 与插件工具）只有你亲手写了 `allow` 规则才放行，规则是 `ask` 就问；
- `always-ask`：没规则的普通能力也问你（没规则的危险能力仍然拒绝），危险能力即使规则 `allow` 也每次都问；
- `allow-all`：跳过所有确认，只剩你显式写的 `deny` 规则还拦。

下面这段就是 domi 里通配规则的匹配方式——`mcp.github.*` 管得到 `mcp.github.create_issue`，管不到 `mcp.githubx.y`：

```ts run
import assert from 'node:assert/strict'

function matches(pattern: string, capability: string): boolean {
  if (!pattern.endsWith('.*')) return pattern === capability
  const prefix = pattern.slice(0, -1)
  return prefix.length > 1 && capability.startsWith(prefix)
}

assert.equal(matches('mcp.github.*', 'mcp.github.create_issue'), true)
assert.equal(matches('mcp.github.*', 'mcp.githubx.y'), false)
assert.equal(matches('fs.read', 'fs.read'), true)
```

## 4. 长任务

```sh
domi task run docs/tasks-example.yaml --follow
```

任务在后台服务（domid）里跑，关掉终端也继续；后台服务被杀后重启会从上次完成的节点接着跑。

## 5. 出错了怎么办

| 情况 | domi 做什么 | 你要做什么 |
|---|---|---|
| 配置 / 环境有问题 | `domi doctor` 列出问题 + 修复命令 | 按提示粘贴命令 |
| 缺 API key | 对话提交时报 missing_credential | 补 secrets / 环境变量 |
| 能力被拒 | 默认拒绝，落权限事件 | 加 permissions.rules |
| TUI 全屏挂掉 | 写 tui-fallback，自动用 classic | 不用管 |
| 模型清单探测不到 | 用配置 models 兜底 | 在 providers 里写 models |

想深入：权限怎么判的见[工具与权限运行时](tools-runtime.md)；模型厂商怎么配见[配置与厂商](config.md)。
