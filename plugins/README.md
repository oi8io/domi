# 官方示例插件

| 插件 | 类型 | 说明 |
|---|---|---|
| `word-count` | tool + UI | 沙箱里跑的工具；只读 `*.md` / `*.txt` |
| `git-workflow` | skill | 一份 SKILL.md |
| `mcp-filesystem` | MCP 包装 | 官方 filesystem server，只开放 `./docs` |

安装：`domi plugin install plugins/<名字>`。写自己的插件：`domi plugin scaffold <tool|skill|mcp> <目录>`，详见 `docs/site/plugin-dev.md`。
