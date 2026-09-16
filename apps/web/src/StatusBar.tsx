/**
 * 状态栏 —— PRD-M1-007，与 TUI 显示同样的几段、同样的格式（formatTokens 在 client-core）。
 * 一个数都不自己算：指标由 runtime 算好，经 session.metrics 推过来。
 */
import { formatElapsed, formatTokens, type StatusSnapshot, VERIFY_LABEL } from '@domi/client-core'

export function StatusBar({ status }: { status: StatusSnapshot }) {
  const m = status.metrics
  const level = m?.contextLevel ?? 'ok'
  return (
    <div className="statusbar">
      <span>{status.model === '' ? '—' : `${status.provider}/${status.model}`}</span>
      <span>{m === null ? '— tok' : formatTokens(m.tokens)}</span>
      <span>{m === null ? '—' : m.cost}</span>
      {m?.turnMs !== undefined && <span>本轮 {formatElapsed(m.turnMs)}</span>}
      <span>{status.toolCalls} 次工具</span>
      {m?.mode === 'plan' && <span className="mode-plan">计划模式</span>}
      {m?.verify !== undefined && m.verify !== 'clean' && (
        <span className={`verify verify-${m.verify}`}>{VERIFY_LABEL[m.verify]}</span>
      )}
      <span className={`ctx ctx-${level}`}>ctx {m?.contextPercent ?? 0}%</span>
      {status.busy && <span className="running">运行中</span>}
    </div>
  )
}
