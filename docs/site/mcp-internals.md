# MCP 接入

> `packages/mcp` —— MCP hub（PRD-M2-001/009 · docs/adr/015）
> 对应 hermes 的 MCP 用户指南 + 部分 tools-runtime。domi 的立场：**MCP 是 Tool 的一种来源，不是与 Tool 并列的概念**。

## 定位

**协议本身交给 `@modelcontextprotocol/client`**（版本协商、MRTR、列表缓存都在 SDK 里）。`hub.ts` 只做 SDK 不管的事：

1. **每个 server 各自连、各自超时**，一个挂了不拖别的（AC-5）。
2. 工具以 **`mcp.<server>.<tool>`** 变成普通 Tool，走 domi 的权限路径（INV-03）——用户可以用 `mcp.github.*` 通配规则放行。
3. HTTP 出站过**白名单**（AC-6 · INV-11：用户数据不出本机，除非显式配置的模型 API；出站域名白名单测试）。
4. 二进制结果落 blob（`~/.domi/blobs`），事件里只留引用（M2-009 AC-2）。
5. **不调用已弃用的 sampling / roots / logging**（AC-4，`scripts/check-deprecated-mcp.ts` 守）。

## 连接与生命周期

- server 配置（stdio / http 两种传输）在 `config.yaml` 的 `mcp.servers`，加上插件声明的 server（`plugins?.mcpServers()`）。
- **先开门再连 server**：daemon 启动时连接可能要好几秒（每个 server 各自超时），不能让拉起 domid 的客户端一直等；会话每轮现取工具，连上之后自然就有了。
- 停用插件带的 MCP server 已经连上了的话，它的工具在 `extraTools` 里滤掉（启停即时生效，PRD-M8-012 AC-6）。
- server 向用户要输入（MCP elicitation）→ `onElicit`（daemon 里接 `ctx.elicit`，认识的端画表单；不给就一律 decline）。

## 工具 → 权限 → 事件

MCP 工具不特殊：`hub.tools()` 返回普通 `Tool` 数组，与内置工具、插件工具一起进 `ToolRunner`。权限规则按能力名匹配（`mcp.<server>.<tool>` 是 `CapabilityId`）；每次调用照常产生 `permission` 事件与 `tool.call` / `tool.result` 事件。**MCP 的输出是数据，不是指令**（INV-06，guardrail 提示词层 + 注入测试用例）。

## 配置参考

```yaml
mcp:
  servers:
    - name: github
      command: npx        # stdio 传输
      args: ["-y", "@modelcontextprotocol/server-github"]
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "..." }   # 或从 secrets 引用
    - name: remote
      url: https://mcp.example.com/mcp   # http 传输
  allowedHosts: [api.example.com]        # 出站白名单
  timeoutMs: 30000
```

## 相关

- MCP 工具怎么过权限：[工具与权限运行时](tools-runtime.md)。
- 插件声明的 MCP server：[插件运行时](plugins.md)。
- 测试：`packages/mcp/test/`（多 server 隔离、白名单、blob 落盘、elicitation）；`check-deprecated-mcp` 守卫。
