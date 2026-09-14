/**
 * 凭据脱敏 —— SPEC-M0-009。
 *
 * **脱敏发生在事件写入边界，不是渲染层。**
 * 渲染层脱敏挡不住 `domi data export` 和日志文件（PRD-M0-008 AC-2 / INV-11）。
 *
 * 这些正则是**单点定义**：scripts/scan-secrets.ts 与运行时共用本文件。
 * 两处各写一份必然漂移——TASK-M0-019 接手时不要复制粘贴。
 */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI 系
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
]

export const REDACTED = '[REDACTED]'

export function redactString(s: string): string {
  let out = s
  for (const re of CREDENTIAL_PATTERNS) out = out.replace(new RegExp(re.source, re.flags), REDACTED)
  return out
}

/**
 * 事件正文的脱敏入口：**先序列化再脱敏**。
 *
 * 顺序不能反。先序列化有两个好处：
 *   1. 循环引用会在这里抛干净的 TypeError，而不是在深拷贝里爆栈；
 *      append 因此整批回滚（PRD-M0-001 AC-4）
 *   2. 无论凭据藏在哪一层的哪个字段，扫的都是同一段文本，不会漏结构
 * REDACTED 里没有引号和反斜杠，替换不会破坏 JSON。
 */
export function serializeRedacted(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError('事件无法序列化为 JSON')
  return redactString(json)
}
