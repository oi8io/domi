# 快速开始

domi 是一个本地优先的 agent 运行时：对话、工具调用、权限决定全部记成一条只追加的事件流，
终端（TUI）、浏览器（Web）、Telegram 都只是这条事件流的不同视图。

## 1. 装好并配上模型

```sh
git clone <仓库地址> domi && cd domi
pnpm install && pnpm build     # 产物是 dist/domi 单二进制；开发时也可以 bun apps/tui/src/main.tsx
domi init > ~/.domi/config.yaml
export DOMI_API_KEY=sk-...     # 或者在 config.yaml 里写 model.api_key
domi doctor                    # 每条问题都带一条能直接粘贴的修复命令
```

用本地模型或网关（LiteLLM、OpenRouter、Ollama）时，`model.provider` 写 `openai-compatible`，再填 `base_url`。

## 2. 对话

```sh
domi                           # 进 TUI；第一次会在后台拉起 domid
```

对话里常用的命令：`/model` 换模型、`/compact` 压缩上下文、`/branch` 从某一条分出新会话、
`/ref <会话> [起-止]` 引用另一个会话的一段、`/soul` 看 Soul 待审阅的改动。

浏览器里打开 Web 端（`pnpm --filter @domi/web dev`），看到的是同一个 domid 里的同一批会话。

## 3. 权限

默认一律拒绝。`config.yaml` 的 `permissions.rules` 按能力放行，`decision` 是 `allow` / `ask` / `deny`：

```yaml
permissions:
  rules:
    - { name: read, capability: fs.read, decision: allow }
    - { name: write, capability: fs.write, decision: ask }
```

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

任务在 domid 里跑，关掉终端也继续；domid 被杀后重启会从上次完成的节点接着跑。
