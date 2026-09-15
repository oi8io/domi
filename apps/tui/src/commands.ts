/**
 * 输入框里的斜杠命令。只做「这行字是什么意思」，不做事——执行在 main.tsx 里，
 * 结果由事件自己显示在对话里（ctx.compact / model.switch），不另塞界面状态。
 * 单独成文件是为了能测：Ink 的按键在无 TTY 环境里验不了（docs/adr/001）
 */
export type SlashCommand =
  | { kind: 'submit'; text: string }
  | { kind: 'compact' }
  | { kind: 'model'; model: string; provider?: string }
  | { kind: 'branch'; atSeq: number }
  | { kind: 'invalid'; message: string }

/** lastSeq = 当前对话里最后一条的 seq；`/branch` 不带数字时从这里分 */
export function parseSlash(text: string, lastSeq: number): SlashCommand {
  const [cmd, ...rest] = text.split(/\s+/)
  switch (cmd) {
    case '/compact':
      return { kind: 'compact' } // PRD-M2-003 AC-1
    case '/model': // PRD-M1-002 · parity 第 10 项
      if (!rest[0]) return { kind: 'invalid', message: '用法：/model <模型名> [provider]' }
      return rest[1] ? { kind: 'model', model: rest[0], provider: rest[1] } : { kind: 'model', model: rest[0] }
    case '/branch': {
      // parity 第 7 项。常用的是不带数字；带数字时和 Web 端「分支」按钮是同一套视图编号
      const at = rest[0] === undefined ? lastSeq : Number(rest[0])
      if (!Number.isInteger(at) || at < 1) {
        return {
          kind: 'invalid',
          message: rest[0] === undefined ? '对话还是空的，没有可以分支的地方' : '用法：/branch [seq]',
        }
      }
      return { kind: 'branch', atSeq: at }
    }
    default:
      return { kind: 'submit', text }
  }
}
