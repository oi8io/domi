# bench —— 真实数据的落脚点

这里的文件**不是测试**，是**趋势记录**。区别很重要：

- 测试给 pass/fail，进 CI 门禁，失败就必须修
- 这里的数字依赖第三方服务的非确定性行为（缓存命中、延迟），
  做成 pass/fail 只会训练出「红了就忽略」的习惯（PRD §0.4）

所以它们的判据是「**低于阈值时要人来看一眼**」，不是「构建失败」。

## cache-hit.jsonl —— PRD-M1-004 AC-2

一行一次运行。产出方式：

```bash
pnpm bench:cache            # 只打印计划，不发请求、不花钱
pnpm bench:cache --yes      # 真跑 10 轮（会花钱）
```

**这个脚本不进 CI**（INV-08），由 `scripts/check-ci-no-live-calls.ts` 机器守着。

每行的字段：

| 字段 | 含义 |
|---|---|
| `hitRate` | 第二轮起的命中率。**低于 0.8 要人工判定**，不是 fail |
| `ac1` | AC-1 判据：第二轮起每一轮 `cache_read` 都 > 0 |
| `savedTokens` | 这次运行总共从缓存里读到的 token 数 |
| `prefixChars` | 当时的稳定前缀长度——命中率异常时第一个要看的数 |
| `rounds_detail` | 每轮的原始数字，provider 字段名**不做归一**（ADR-004） |

## 读数注意

provider 对可缓存前缀有**最小长度**（Anthropic ≈1024 token）。
M1 的内置提示词层加起来只有约 35 token，**必然测出 0**——
这不说明前缀不稳定（那由 `prompt/layering.spec.ts` 的 AC-3 单测管）。
等 M2 把工具 schema、技能说明、记忆摘要放进前缀之后，这个数字才有意义。

**不要为了让数字好看去给提示词灌水。**
