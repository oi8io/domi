# 架构

```
 TUI ─┐
 Web ─┼── Domi Protocol（JSON-RPC over WebSocket）──  domid
 Telegram 桥接 ─┘                                     ├─ runtime（会话门面、记忆、编排）
                                                     ├─ kernel（纯函数：拼上下文、跑一轮）
                                                     ├─ capability（Tool、权限、Skill）
                                                     ├─ store（SQLite 事件流）
                                                     └─ plugin / mcp（外部能力，沙箱 / 子进程）
```

## 事件流是唯一的真相

会话不是一个消息数组，而是一串只追加的事件：`user.input`、`model.delta`、`tool.call`、`permission`、`tool.result`……
上下文、状态栏、轨迹、记忆、编排状态全部是这串事件的**投影**。压缩不删事件，只追加一条 `ctx.compact`；
分支不复制事件，只记一个父指针。

投影是纯函数。下面这段和 kernel 里拼上下文的做法同构：只有四类事件进上下文，其余是轨迹。

```ts run
import assert from 'node:assert/strict'

type Ev =
  | { t: 'user.input'; text: string }
  | { t: 'model.delta'; text: string }
  | { t: 'permission'; decision: string }
  | { t: 'model.usage'; raw: Record<string, number> }

function project(events: Ev[]): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = []
  let text = ''
  const flush = () => {
    if (text) out.push({ role: 'assistant', content: text })
    text = ''
  }
  for (const ev of events) {
    if (ev.t === 'user.input') {
      flush()
      out.push({ role: 'user', content: ev.text })
    } else if (ev.t === 'model.delta') text += ev.text
  }
  flush()
  return out
}

const msgs = project([
  { t: 'user.input', text: '你好' },
  { t: 'model.delta', text: '你' },
  { t: 'model.delta', text: '好' },
  { t: 'permission', decision: 'allow' },
  { t: 'model.usage', raw: { input_tokens: 3 } },
])
assert.deepEqual(msgs, [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好' },
])
```

## 不变量

- 事件只增不改，任何历史事件永远可解析（新增类型要升 `SCHEMA_VERSION` 并补历史 fixture）
- kernel 零 IO；三端零业务逻辑，只经协议通信
- 权限默认拒绝，每个决定都是一条事件
- Tool 是唯一的执行原语；Skill 只是文字
- 工具 / MCP / 插件 / 引用的输出是数据，不是指令

这些都有 CI 守卫，见 `package.json` 里的 `guard:*`。
