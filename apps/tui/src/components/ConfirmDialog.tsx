import type { AskSnapshot } from '@domi/client-core'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/**
 * 回滚确认框的副作用提示 —— PRD-M1-011 AC-6。
 * 文案的真身在 @domi/checkpoint（REVERT_SIDE_EFFECT_NOTICE），
 * 但 apps 不许 import 那个包（INV-02），所以这里复制一份并用测试锁死两边一致。
 */
export const REVERT_NOTICE =
  '注意：回滚只还原文件。已执行的 shell 命令、已发出的网络请求、已 push 的 commit 都不会被撤销。'

export interface RevertAsk {
  toSeq: number
  scope: 'files' | 'conversation' | 'both'
  fileCount: number
}

export const CONFIRM_FOCUS_ID = 'domi-confirm'

/**
 * PRD-M0-003 AC-1：确认框必须显示**完整的待执行内容**（写入的 diff / 待执行的命令行）。
 * 只显示能力名（"要执行 shell.exec，同意吗"）等于让用户闭着眼点同意——
 * 那样这道权限就成了摆设。
 */
export function ConfirmDialog({ ask }: { ask: AskSnapshot }): React.ReactElement {
  const t = useTheme()
  const needsWeb = ask.form !== undefined && formNeedsWeb(ask.form.schema)
  const approval = (ask.form?.schema as Record<string, unknown> | undefined)?.[TUI_ACCEPT_EMPTY] === true
  const title = ask.form ? (approval ? '等你审批' : '需要你提供信息') : '权限请求'
  // 内嵌在对话流里的框（PRD-M8-014 AC-3）。回车 = 拒绝，所以高亮的是「拒绝」（INV-03）
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border('warn')} paddingX={1} marginLeft={2}>
      <Text {...t.fg('warn')} bold>{`🔑 ${title}：${ask.capabilityId}`}</Text>
      <Text {...t.fg('ink2')}>{ask.detail}</Text>
      {needsWeb ? (
        <Text {...t.fg('mut')}>这个请求要填表：请在 Web 端（pnpm web）回答；n 拒绝</Text>
      ) : (
        <Box marginTop={1}>
          <Text {...t.fg('warn')} inverse bold>
            {' n 拒绝 '}
          </Text>
          <Text>{'  '}</Text>
          <Text {...t.fg('ink2')}>{approval ? ' y 批准 ' : ' y 允许 '}</Text>
          <Text {...t.fg('mut2')}>{'   Enter = 拒绝'}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * 回滚确认 —— PRD-M1-011 AC-6。
 * 必须明示快照**不覆盖**的范围：用户以为「回滚 = 时光机」才是真正危险的。
 */
export function RevertDialog({ ask }: { ask: RevertAsk }): React.ReactElement {
  const scopeText = {
    files: '只还原文件',
    conversation: '只作废对话',
    both: '还原文件并作废对话',
  }[ask.scope]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
      <Text color="red">{`回滚到第 ${ask.toSeq} 步`}</Text>
      <Text>{`${scopeText} · 影响 ${ask.fileCount} 个文件`}</Text>
      <Text dimColor>{REVERT_NOTICE}</Text>
      <Text dimColor>y 确认回滚 / n 取消（默认取消）</Text>
    </Box>
  )
}

/** 终端里答不了的表单（多于一个字段，或不是布尔） */
/** 表单 schema 上的标记：终端里直接同意时用空内容（字段都是可选的） */
export const TUI_ACCEPT_EMPTY = 'x-domi-accept-empty'

export function formNeedsWeb(schema: unknown): boolean {
  // 表单里全是可选项（例如计划审批的「意见」「转长任务」）：终端里 y 就是「按默认值同意」
  if ((schema as Record<string, unknown> | null)?.[TUI_ACCEPT_EMPTY] === true) return false
  const props = Object.values((schema as { properties?: Record<string, { type?: string }> })?.properties ?? {})
  return !(props.length === 0 || (props.length === 1 && props[0]?.type === 'boolean'))
}
