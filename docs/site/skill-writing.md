# Skill 编写

Skill 是**做事的方法说明**，不是代码。domi 不会执行 Skill 里的任何内容：模型读完之后，仍然一步一步调用工具，
每一步照常经过权限确认。

## 放在哪

- 自己用：`~/.domi/skills/<名字>/SKILL.md`，保存即生效
- 分享：做成 skill 型插件（`domi plugin scaffold skill <目录>`）
- 同名时：用户目录 > 插件 > 官方

## 格式

```markdown
---
name: release-check
description: 发版前检查——跑测试、看变更日志、确认版本号
requires_tools: [shell.exec, fs.read]
---

# 发版前检查

1. 跑 `bun test`，全绿才继续
2. 对比上个 tag 以来的提交，确认 CHANGELOG 覆盖了用户看得见的改动
3. 版本号不对、或测试失败时，停下来告诉用户
```

- `name`：小写字母、数字与 `-`
- `description`：**模型平时只看得到这一句**，写清楚「什么时候该用它」
- `requires_tools`：说明会用到哪些工具（不授予权限）

下面是 domi 解析 frontmatter 的规则，可以拿来检查自己的文件：

```ts run
import assert from 'node:assert/strict'

function parseSkill(text: string): { name: string; description: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error('开头缺少 --- 包起来的 frontmatter')
  const meta = Bun.YAML.parse(m[1] as string) as { name?: unknown; description?: unknown }
  if (typeof meta.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(meta.name)) throw new Error('name 不合法')
  if (typeof meta.description !== 'string' || meta.description === '') throw new Error('缺少 description')
  return { name: meta.name, description: meta.description, body: (m[2] as string).trim() }
}

const skill = parseSkill('---\nname: release-check\ndescription: 发版前检查\n---\n\n# 发版前检查\n1. 跑测试\n')
assert.equal(skill.name, 'release-check')
assert.ok(skill.body.startsWith('# 发版前检查'))
assert.throws(() => parseSkill('---\nname: Bad Name\ndescription: x\n---\n'), /name/)
```

## 写好一个 Skill

- 步骤写成可检查的动作（「跑 `bun test` 确认全绿」），不写口号（「保证质量」）
- **写清停下来问人的条件**——模型最容易出错的是不知道什么时候该问
- 不要放凭据、本机路径：Skill 可能被分享出去
