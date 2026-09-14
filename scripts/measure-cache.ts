/**
 * prompt cache 命中率实测 —— PRD-M1-004 AC-1 / AC-2
 *
 * ⚠️ **这个脚本会发真实模型请求、会花钱**（标记：INV-08-LIVE）。所以它：
 *   - 不进 CI（INV-08：真实 LLM 调用不进门禁），`pnpm check` 不会碰它
 *   - 必须显式加 `--yes` 才真的跑
 *   - 默认只跑 10 轮最小对话，单次成本在几分钱量级
 *
 * 它要回答的是一个**代码回答不了**的问题：前缀 byte 级稳定（AC-3，已有单测）
 * 只是命中的**必要**条件。provider 到底认不认这个前缀、缓存写入有没有生效、
 * TTL 够不够长，只有真打一次才知道。
 *
 * 结果按 AC-2 追加进 `bench/cache-hit.jsonl`（趋势文件，一行一次运行）。
 * **低于 80% 不是 fail**，是"要人来看一眼"——命中率依赖 provider 的非确定性行为，
 * 把它做成 pass/fail 门槛只会让人学会忽略它（PRD §0.4）。
 *
 * 用法：
 *   bun run scripts/measure-cache.ts            只打印计划，不发请求
 *   bun run scripts/measure-cache.ts --yes      真跑（会花钱）
 *   bun run scripts/measure-cache.ts --yes --rounds 4
 */
import { appendFileSync, mkdirSync } from 'node:fs'
// scripts/ 不是一个包，走相对路径引源码 —— 和 scripts/make-demo-fixture.ts 一致
import { credentialEnvNames, loadConfig } from '../packages/config/src/index.ts'
import { createProvider } from '../packages/model/src/index.ts'
import { approxTokens, assemble, BUILTIN_LAYERS } from '../packages/prompt/src/index.ts'
import type { ModelMessages } from '../packages/protocol/src/index.ts'

const BENCH_FILE = 'bench/cache-hit.jsonl'
const WARN_BELOW = 0.8

/** 十轮标准会话：内容不重要，**前缀稳定**才重要。每轮只追加一句短的用户消息 */
const TURNS = [
  '用一句话说说这个项目是干什么的。',
  '再用一句话说说它的事件流为什么是 append-only。',
  '一句话：为什么 kernel 不许 import store？',
  '一句话：什么是 prompt cache 的稳定前缀？',
  '一句话：影子仓库为什么放在工作区外面？',
  '一句话：为什么评估要用事件流回放而不是新埋点？',
  '一句话：权限为什么默认拒绝？',
  '一句话：为什么守卫必须先证明自己会红？',
  '一句话：单二进制解决了什么问题？',
  '一句话：为什么真实模型调用不进 CI？',
]

interface RoundResult {
  round: number
  cacheRead: number
  cacheWrite: number
  inputTokens: number
  hit: boolean
  ms: number
}

/** provider 的字段名各不相同，且**不做归一**（ADR-004 原样透传），所以这里按已知别名去捞 */
function pick(raw: Record<string, unknown>, keys: readonly string[]): number {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'number') return v
  }
  return 0
}

const CACHE_READ = ['cache_read_input_tokens', 'cachedPromptTokens', 'cached_tokens', 'cacheReadInputTokens']
const CACHE_WRITE = ['cache_creation_input_tokens', 'cacheWriteInputTokens', 'cache_creation_tokens']
const INPUT = ['input_tokens', 'promptTokens', 'prompt_tokens', 'inputTokens']

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const go = argv.includes('--yes')
  const roundsArg = argv.indexOf('--rounds')
  const rounds = roundsArg >= 0 ? Number(argv[roundsArg + 1]) : TURNS.length

  const cfg = loadConfig()
  const provider = cfg.model.provider
  const model = cfg.model.name
  const key = credentialEnvNames(provider)
    .map((n) => process.env[n])
    .find((v) => v !== undefined && v !== '')

  const prompt = assemble(BUILTIN_LAYERS, { cwd: process.cwd(), model })
  console.log('[measure-cache] 计划')
  console.log(`  provider/model : ${provider}/${model}`)
  console.log(`  base_url       : ${cfg.model.baseUrl ?? '(默认)'}`)
  console.log(`  稳定前缀       : ${prompt.prefixText.length} 字符 / 前 ${prompt.prefixLayerCount} 层`)
  console.log(`  轮数           : ${rounds}`)
  console.log(`  结果写入       : ${BENCH_FILE}`)

  // provider 对**可缓存前缀有最小长度**：Anthropic 是 1024 token（haiku 2048），
  // OpenAI 是 1024。前缀没到这个数，命中率必然是 0——
  // 这跟前缀稳不稳一点关系都没有，是把测量结果读错的头号原因。
  const prefixTokens = approxTokens(prompt.prefixText)
  if (prefixTokens < 1024) {
    console.warn(
      `\n⚠️ 稳定前缀只有约 ${prefixTokens} token，**低于 provider 的最小可缓存长度（约 1024）**。` +
        '\n   这一轮测出来的命中率必然是 0，而且这不说明前缀不稳定（AC-3 的单测管那个）。' +
        '\n   正确的读法是：M1 的内置层本来就短，要等 M2 把工具 schema、技能说明、记忆摘要' +
        '\n   放进前缀之后再测才有意义。**不要为了让这个数字好看去给提示词灌水。**',
    )
  }

  if (!go) {
    console.log('\n没有 --yes，**不发任何请求**就退出。这个脚本会花钱，所以默认什么都不做。')
    console.log('要真跑：bun run scripts/measure-cache.ts --yes')
    return 0
  }
  if (key === undefined) {
    console.error(`\n没有凭据：需要 ${credentialEnvNames(provider).join(' 或 ')}`)
    return 2
  }

  const p = createProvider({ provider, name: model, apiKey: key, baseUrl: cfg.model.baseUrl })
  const messages: ModelMessages = [...prompt.messages]
  const results: RoundResult[] = []

  for (let i = 0; i < rounds; i++) {
    const turn = TURNS[i % TURNS.length]
    if (turn === undefined) break
    messages.push({ role: 'user', content: turn })

    const t0 = Date.now()
    let raw: Record<string, unknown> = {}
    let text = ''
    for await (const ev of p.generate({ model, messages }, AbortSignal.timeout(60_000))) {
      if (ev.type === 'delta') text += ev.text
      if (ev.type === 'usage') raw = ev.raw
      if (ev.type === 'error') {
        console.error(`  第 ${i + 1} 轮失败：${ev.message}`)
        return 1
      }
    }
    messages.push({ role: 'assistant', content: text })

    const r: RoundResult = {
      round: i + 1,
      cacheRead: pick(raw, CACHE_READ),
      cacheWrite: pick(raw, CACHE_WRITE),
      inputTokens: pick(raw, INPUT),
      hit: pick(raw, CACHE_READ) > 0,
      ms: Date.now() - t0,
    }
    results.push(r)
    console.log(
      `  第 ${r.round} 轮  cache_read=${r.cacheRead}  cache_write=${r.cacheWrite}  input=${r.inputTokens}  ${r.ms}ms`,
    )
  }

  // AC-1 的判据是「**从第二轮起** cache_read > 0」，第一轮本来就没得可读
  const after = results.slice(1)
  const hits = after.filter((r) => r.hit).length
  const rate = after.length === 0 ? 0 : hits / after.length
  const savedTokens = results.reduce((s, r) => s + r.cacheRead, 0)

  mkdirSync('bench', { recursive: true })
  const line = {
    at: new Date().toISOString(),
    provider,
    model,
    baseUrl: cfg.model.baseUrl ?? null,
    rounds: results.length,
    hitRate: Number(rate.toFixed(3)),
    ac1: after.length > 0 && after.every((r) => r.hit),
    savedTokens,
    prefixChars: prompt.prefixText.length,
    rounds_detail: results,
  }
  appendFileSync(BENCH_FILE, `${JSON.stringify(line)}\n`, 'utf8')

  console.log(`\n  AC-1（第二轮起 cache_read > 0）：${line.ac1 ? '通过' : '未通过'}`)
  console.log(`  命中率：${(rate * 100).toFixed(1)}%（${hits}/${after.length}）· 省下 ${savedTokens} tokens`)
  console.log(`  已追加到 ${BENCH_FILE}`)

  if (rate < WARN_BELOW) {
    console.warn(
      `\n⚠️ 命中率低于 ${WARN_BELOW * 100}%，需要人工判定（AC-2 明确说这**不是** pass/fail 门槛）。` +
        '\n先看两件事：前缀里是不是混进了会变的内容（`domi prompt dump` 看边界），' +
        '\n以及这个网关认不认 provider 的 cache 控制字段——很多兼容网关直接把它吞了。',
    )
  }
  return 0
}

if (import.meta.main) process.exit(await main())
