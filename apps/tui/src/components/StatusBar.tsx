import { type ConnectionState, formatElapsed, formatTokens, type StatusSnapshot, VERIFY_LABEL } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Box, Text } from 'ink'
import { type Tone, useTheme } from '../theme.ts'

/**
 * 状态栏 —— PRD-M1-007 · PRD-M8-014 AC-4。
 *
 * 它只**显示**指标，一个都不自己算：数字全部来自 client-core 的投影，
 * 而投影又全部来自事件流。AC-3 的判据（删掉本文件 kernel 测试仍绿）
 * 守的就是这条——见 packages/kernel/test/metrics-independence.spec.ts。
 */
export const CONTEXT_COLOR = {
  ok: 'gray',
  warn: 'yellow',
  danger: 'red',
} as const

const CONTEXT_TONE: Record<keyof typeof CONTEXT_COLOR, Tone> = { ok: 'mut', warn: 'warn', danger: 'bad' }

export const VERIFY_COLOR = { unverified: 'yellow', verified: 'green', failed: 'red' } as const
const VERIFY_TONE: Record<keyof typeof VERIFY_COLOR, Tone> = { unverified: 'warn', verified: 'ok', failed: 'bad' }

const CONN_LABEL = (): Record<ConnectionState, string> => ({
  idle: tr('web.conn.offline'),
  connecting: tr('tui.conn.connecting'),
  open: tr('web.conn.connected'),
  reconnecting: tr('tui.conn.reconnecting'),
  incompatible: tr('tui.conn.incompatible'),
  closed: tr('web.conn.closed'),
})

export function StatusBar({
  status,
  connection,
}: {
  status: StatusSnapshot
  connection?: ConnectionState
}): React.ReactElement {
  const t = useTheme()
  const m = status.metrics
  const tokens = m === null ? '— tok' : formatTokens(m.tokens)
  const cost = m === null ? '—' : m.cost
  const pct = m?.contextPercent ?? 0
  const level = m?.contextLevel ?? 'ok'
  const val = t.fg('ink2')
  const sep = <Text {...t.fg('mut2')}>{'  '}</Text>
  const pace = [
    m?.turns === undefined ? null : `${m.turns} turns`,
    m?.steps === undefined ? null : `${m.steps} steps`,
    m?.tokPerSec === undefined || m.tokPerSec === null ? null : `${m.tokPerSec} tok/s`,
  ].filter((x) => x !== null)

  // 用一个 Text 包起来而不是并排的 Box：40 列下 Box 的 flex 会把
  // 「ctx N%」甩到另一段去，读起来像两条信息。整体折行才是对的
  return (
    <Box>
      <Text {...t.fg('mut')}>
        {connection !== undefined && (
          <>
            <Text {...t.fg(connection === 'open' ? 'ok' : 'warn')}>●</Text>
            <Text {...val}>{` ${CONN_LABEL()[connection]}`}</Text>
            {sep}
          </>
        )}
        {`${status.provider}/${status.model}`}
        {sep}
        {pace.length > 0 && (
          <>
            <Text {...val}>{pace.join(' · ')}</Text>
            {sep}
          </>
        )}
        <Text {...val}>{tokens}</Text>
        {m?.cacheHitPercent !== undefined && m.cacheHitPercent !== null ? ` · Cache ${m.cacheHitPercent}%` : ''}
        {` · ${cost}`}
        {sep}
        {m?.turnMs === undefined ? '' : tr('tui.status.turn', { formatElapsed: formatElapsed(m.turnMs) })}
        {tr('web.status.toolCalls', { toolCalls: status.toolCalls })}
        {sep}
        <Text {...t.fg(CONTEXT_TONE[level])}>{`ctx ${pct}%`}</Text>
        {sep}
        {m?.verify !== undefined && m.verify !== 'clean' ? (
          <Text {...t.fg(VERIFY_TONE[m.verify])}>{` · ${VERIFY_LABEL[m.verify]}`}</Text>
        ) : (
          ''
        )}
        {status.busy ? (
          <>
            {sep}
            <Text {...t.fg('accent')}>{tr('tui.status.running')}</Text>
          </>
        ) : (
          ''
        )}
      </Text>
    </Box>
  )
}
