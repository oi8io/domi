<!-- LOGO -->

# domi

[English](README.md) · **中文**

**domi 是一个通用 AI Agent，正在向 personal Agent 进化。**

把复杂的事交给它：它先做计划，再一步步把活编排着做完。你随时可以打断它，停下的活能接着做。每一步都看得见，做完了也能回头查。

![domi 的 Web 界面](docs/site/web/assets/web-real.png)

## 它能帮你做什么

适用场景包括但不限于：

- **编程**：读代码、改代码、跑测试。大一点的任务放在单独的工作区里做，你看过改动再带回原仓库。
- **设计**：整理需求、写设计说明、做页面原型。
- **办公**：整理资料、批量处理文件、写报告。接上 MCP 服务或 Skill，能用上更多工具。
- **定时的活**：按时间表自动跑，比如每天早上汇总一遍。
- **长任务**：关掉终端也接着跑；中途停了，回来接着做。

## 为什么用 domi

- **会计划，懂编排**：先列计划再动手。复杂任务拆成几步，按先后依赖排好再执行。
- **可中断，可恢复**：模型干活时你可以补充要求，也可以随时叫停。出错停下后，计划和已经做完的部分都还在，点「继续」（或输入 `/continue`）就接着做。
- **可跟踪，可追溯**：每一步想了什么、调了什么工具、你批准了什么，都有记录。做的时候看进度，做完能回放。
- **可以定义人格，越来越懂你**：domi 的人格是一份你能直接读、直接改的文档。它在和你的相处中慢慢学习，每条新学到的东西你都可以接受或否决。
- **数据仅存本地，隐私无忧**：会话、记忆、人格都存在你自己的电脑上，只发给你配置的模型。写文件、跑命令、联网这类操作，你放行了它才能做。
- **模型随你选**：OpenAI、Anthropic、DeepSeek、Gemini，本地模型（Ollama），或者网关（LiteLLM、OpenRouter）。对话中途也能换。

## 安装

> 目前需要会用终端。支持 macOS 和 Linux；Windows 请用 WSL。

到 [Releases](https://github.com/oi8io/domi/releases/latest) 下载适合你电脑的包：

| 系统 | 文件 |
|---|---|
| macOS（Apple 芯片） | `domi-<版本>-darwin-arm64.tar.gz` |
| macOS（Intel） | `domi-<版本>-darwin-x64.tar.gz` |
| Linux（x86_64） | `domi-<版本>-linux-x64.tar.gz` |
| Linux（ARM64） | `domi-<版本>-linux-arm64.tar.gz` |

解压后把 `domi` 放进 `PATH` 里的目录：

```sh
tar -xzf domi-*-darwin-arm64.tar.gz
mkdir -p ~/.local/bin && mv domi ~/.local/bin/
```

macOS 上的二进制还没有签名，第一次运行前要解除隔离：

```sh
xattr -d com.apple.quarantine ~/.local/bin/domi
```

## 开始用

```sh
mkdir -p ~/.domi && domi init > ~/.domi/config.yaml   # 生成配置
export DEEPSEEK_API_KEY=sk-...                          # 或者把 key 写进 ~/.domi/secrets.yaml
domi doctor                                             # 体检；每条问题都带一条修复命令
domi                                                    # 开始对话
```

进去之后直接说你要做什么。几个常用操作：

| 想做什么 | 怎么做 |
|---|---|
| 模型干活时补充要求 | 接着打字，回车 |
| 停下这一轮 | `Esc` |
| 接着做没做完的步骤 | `/continue` |
| 换模型 | `/model` |
| 调整要不要每次问你 | `/mode` |
| 看 domi 新学到了什么 | `/soul` |

`/` 能列出全部命令，`?` 看快捷键。Web 和桌面端目前要从源码运行，见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

## 文档

- [domi 是什么](docs/site/docs/intro.md) · [快速开始](docs/site/docs/quickstart.md) · [配置与模型](docs/site/docs/config.md)
- 扩展：[插件](docs/site/docs/plugin-dev.md) · [Skill](docs/site/docs/skill-writing.md) · [MCP](docs/site/docs/mcp-internals.md)
- 参与开发：[`DEVELOPMENT.md`](DEVELOPMENT.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE)
