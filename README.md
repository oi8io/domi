<!-- LOGO -->

# domi

**English** · [中文](README.zh-CN.md)

**domi is a general-purpose AI agent, evolving into your personal agent.**

Hand it something complex. It makes a plan first, then works through the steps in order. You can interrupt it at any time, and it picks up where it stopped. You see every step as it happens, and you can look back at all of them later.

![The domi web interface](docs/site/web/assets/web-real.png)

## What it can do for you

Including, but not limited to:

- **Coding**: read code, change code, run tests. Larger tasks run in a separate workspace; you review the changes before they go back into your repo.
- **Design**: sort out requirements, write design notes, build page prototypes.
- **Office work**: organize material, process files in bulk, write reports. Add MCP servers or Skills to reach more tools.
- **Scheduled jobs**: run on a timetable, for example a summary every morning.
- **Long tasks**: keep running after you close the terminal; if they stop, they resume where they left off.

## Why domi

- **Plans and orchestrates**: it writes a plan before it acts. It splits a complex task into steps and runs them in dependency order.
- **Interrupt and resume**: add instructions while it works, or stop it at any time. When it stops on an error, the plan and the finished work stay; click Continue (or type `/continue`) and it carries on.
- **Track and trace**: every thought, tool call and approval is recorded. Watch progress live, replay it afterwards.
- **Define its personality; it gets to know you**: domi's personality is a document you can read and edit. It learns from working with you, and you accept or reject each thing it learns.
- **Your data stays on your machine**: sessions, memory and personality live on your computer and go only to the model you configure. Writing files, running commands and network access need your permission.
- **Bring your own model**: OpenAI, Anthropic, DeepSeek, Gemini, local models (Ollama), or gateways (LiteLLM, OpenRouter). Switch mid-conversation.

## Install

> For now you need to be comfortable with a terminal. macOS and Linux are supported; on Windows, use WSL.

Download the package for your machine from [Releases](https://github.com/oi8io/domi/releases/latest):

| System | File |
|---|---|
| macOS (Apple silicon) | `domi-<version>-darwin-arm64.tar.gz` |
| macOS (Intel) | `domi-<version>-darwin-x64.tar.gz` |
| Linux (x86_64) | `domi-<version>-linux-x64.tar.gz` |
| Linux (ARM64) | `domi-<version>-linux-arm64.tar.gz` |

Unpack it and put `domi` in a directory on your `PATH`:

```sh
tar -xzf domi-*-darwin-arm64.tar.gz
mkdir -p ~/.local/bin && mv domi ~/.local/bin/
```

The macOS binaries are not signed yet. Remove the quarantine flag before the first run:

```sh
xattr -d com.apple.quarantine ~/.local/bin/domi
```

## Get started

```sh
mkdir -p ~/.domi && domi init > ~/.domi/config.yaml   # create the config
export DEEPSEEK_API_KEY=sk-...                          # or put the key in ~/.domi/secrets.yaml
domi doctor                                             # health check; every problem comes with a fix command
domi                                                    # start a conversation
```

Then just say what you want done. Common actions:

| To do this | Use |
|---|---|
| Add instructions while it works | Keep typing, press Enter |
| Stop the current turn | `Esc` |
| Continue unfinished steps | `/continue` |
| Switch model | `/model` |
| Choose how often it asks you | `/mode` |
| See what domi has learned | `/soul` |

`/` lists all commands; `?` shows the shortcuts. The web and desktop apps currently run from source; see [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Docs

The docs are in Chinese for now.

- [What is domi](docs/site/docs/intro.md) · [Quick start](docs/site/docs/quickstart.md) · [Config and models](docs/site/docs/config.md)
- Extend: [Plugins](docs/site/docs/plugin-dev.md) · [Skills](docs/site/docs/skill-writing.md) · [MCP](docs/site/docs/mcp-internals.md)
- Develop: [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

## License

[MIT](LICENSE)
