/**
 * cron 表达式 —— PRD-M8-007 AC-1 · SPEC-M8-007 取舍-7
 *
 * 5 段：分 时 日 月 周；支持 `*` `,` `-` `/`、月份与星期的英文缩写，周日写 0 或 7。
 * 不支持 `L` `W` `#` 与秒。日与周都限定时按 Vixie cron 的规矩取「或」。
 * 时区用 Intl 换算（不引依赖）：在 UTC 分钟上走，每一步看它在目标时区里是几月几日几点，按不匹配的那一级往前跳。
 */

export type CronField = 'minute' | 'hour' | 'day' | 'month' | 'weekday'

export class CronError extends Error {
  constructor(
    readonly field: CronField | 'tz' | 'expression',
    message: string,
  ) {
    super(message)
    this.name = 'CronError'
  }
}

const FIELD_LABEL: Record<CronField, string> = { minute: '分', hour: '时', day: '日', month: '月', weekday: '周' }
const SPEC: Array<{ field: CronField; min: number; max: number; names?: string[] }> = [
  { field: 'minute', min: 0, max: 59 },
  { field: 'hour', min: 0, max: 23 },
  { field: 'day', min: 1, max: 31 },
  {
    field: 'month',
    min: 1,
    max: 12,
    names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  },
  { field: 'weekday', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
]

export interface Cron {
  minute: Set<number>
  hour: Set<number>
  day: Set<number>
  month: Set<number>
  weekday: Set<number>
  /** 日 / 周是不是 `*`（决定两者取「与」还是「或」） */
  dayAny: boolean
  weekdayAny: boolean
}

function parseField(text: string, spec: (typeof SPEC)[number]): Set<number> {
  const { field, min, max, names } = spec
  const bad = (why: string): never => {
    throw new CronError(field, `第 ${SPEC.indexOf(spec) + 1} 段（${FIELD_LABEL[field]}）「${text}」${why}`)
  }
  const num = (s: string): number => {
    const i = names?.indexOf(s.toLowerCase()) ?? -1
    if (i >= 0) return i + (field === 'month' ? 1 : 0)
    if (!/^\d+$/.test(s)) return bad(`里的「${s}」不是数字`)
    const n = Number(s)
    if (n < min || n > max) return bad(`超出范围 ${min}-${max}`)
    return n
  }
  const out = new Set<number>()
  for (const part of text.split(',')) {
    if (part === '') bad('有空的一项')
    const [range, stepText, extra] = part.split('/')
    if (extra !== undefined) bad('里有多个 /')
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) bad(`的步长「${stepText}」要是正整数`)
      step = Number(stepText)
    }
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = field === 'weekday' ? 6 : max
    } else {
      const [a, b, more] = (range as string).split('-')
      if (more !== undefined) bad('的范围写法不对')
      lo = num(a as string)
      hi = b === undefined ? (stepText === undefined ? lo : field === 'weekday' ? 6 : max) : num(b)
      if (hi < lo) bad(`的范围 ${lo}-${hi} 反了`)
    }
    for (let v = lo; v <= hi; v += step) out.add(field === 'weekday' && v === 7 ? 0 : v)
  }
  return out
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5 || parts[0] === '') {
    throw new CronError('expression', `要 5 段（分 时 日 月 周），这里是 ${parts[0] === '' ? 0 : parts.length} 段`)
  }
  const sets = SPEC.map((s, i) => parseField(parts[i] as string, s))
  return {
    minute: sets[0] as Set<number>,
    hour: sets[1] as Set<number>,
    day: sets[2] as Set<number>,
    month: sets[3] as Set<number>,
    weekday: sets[4] as Set<number>,
    dayAny: parts[2] === '*',
    weekdayAny: parts[4] === '*',
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function checkTimeZone(tz: string): void {
  try {
    formatter(tz)
  } catch {
    throw new CronError('tz', `不认识的时区「${tz}」，例如 Asia/Shanghai、UTC`)
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

interface Local {
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
}

function local(t: number, tz: string): Local {
  const o: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(t)) o[p.type] = p.value
  return {
    month: Number(o.month),
    day: Number(o.day),
    weekday: WEEKDAY[o.weekday as string] ?? 0,
    hour: Number(o.hour) % 24,
    minute: Number(o.minute),
  }
}

function dayMatches(c: Cron, l: Local): boolean {
  if (!c.month.has(l.month)) return false
  const d = c.day.has(l.day)
  const w = c.weekday.has(l.weekday)
  if (c.dayAny || c.weekdayAny) return d && w
  return d || w
}

const MIN = 60_000
/** 搜索窗口：8 年（2 月 29 日遇上不闰的世纪年也够找到）。超过就算永远不触发 */
const HORIZON = 8 * 366 * 24 * 60 * MIN

/** 严格晚于 after 的下一个触发时刻（毫秒，整分）；找不到（例如 2 月 30 日）→ null */
export function nextRun(c: Cron, tz: string, after: number): number | null {
  let t = Math.floor(after / MIN) * MIN + MIN
  while (t - after <= HORIZON) {
    const l = local(t, tz)
    if (!dayMatches(c, l)) t += (24 * 60 - (l.hour * 60 + l.minute)) * MIN
    else if (!c.hour.has(l.hour)) t += (60 - l.minute) * MIN
    else if (!c.minute.has(l.minute)) t += MIN
    else return t
  }
  return null
}

/** 不晚于 at 的最近一个触发时刻；找不到 → null */
export function prevRun(c: Cron, tz: string, at: number): number | null {
  let t = Math.floor(at / MIN) * MIN
  while (at - t <= HORIZON) {
    const l = local(t, tz)
    if (!dayMatches(c, l)) t -= (l.hour * 60 + l.minute + 1) * MIN
    else if (!c.hour.has(l.hour)) t -= (l.minute + 1) * MIN
    else if (!c.minute.has(l.minute)) t -= MIN
    else return t
  }
  return null
}

/** 校验 + 算接下来几次（界面预览用） */
export function previewCron(expr: string, tz: string, from: number, count = 3): number[] {
  checkTimeZone(tz)
  const c = parseCron(expr)
  const out: number[] = []
  let t = from
  for (let i = 0; i < count; i++) {
    const n = nextRun(c, tz, t)
    if (n === null) break
    out.push(n)
    t = n
  }
  if (out.length === 0) throw new CronError('day', '这个时间表永远不会触发（比如 2 月 30 日）')
  return out
}
