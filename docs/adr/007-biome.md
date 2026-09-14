# 007 Lint 与格式化用 Biome，不用 ESLint + Prettier

- 日期：2026-09-14
- 状态：已采纳

**Context**：`ENGINEERING.md` 定了测试策略与三道架构防线，但没定代码风格工具。业余项目里风格争论最容易消耗意志力，越早钉死越好。

**Decision**：**Biome 2.5.13**，一个二进制同时管 lint 与 format，接进 `pnpm lint` / `pnpm guard` / CI。配置向现有代码风格对齐（2 空格、120 列、单引号、按需分号、尾逗号），避免一次性产生巨大 diff。

两条项目特有的规则调整，都写明了理由：
- `suspicious/noConsole`：**`scripts/**` 下关闭**。那些是 CLI 守卫脚本，`console` 就是它们的输出通道，不是遗留的调试语句
- `suspicious/noTemplateCurlyInString`：**`*.spec.ts` 下关闭**。`append-only-guard.spec.ts` 里的 `` `UPDATE ${t}` `` 是**故意**写成字符串的违规 fixture，规则在这里是误报

**Consequences**：换来零配置争论、单二进制（无 native 依赖，与 ADR-001 选 Ink 时看重的是同一件事）、以及毫秒级的全仓检查。付出的是 ESLint 生态里那些没有 Biome 对应实现的规则——目前没有用到的。

**触发重新决策的条件**：需要一条 Biome 没有、且只能靠 ESLint 插件实现的项目特有规则（例如"禁止在 kernel 里 import 具体实现"这类——但那条已经由 dependency-cruiser 守，不是 lint 的活）。
