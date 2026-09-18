import type { AskSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/**
 * 回滚确认框的副作用提示 —— PRD-M1-011 AC-6。
 * 文案的真身在 @domi/checkpoint（REVERT_SIDE_EFFECT_NOTICE），
 * 但 apps 不许 import 那个包（INV-02），所以这里复制一份并用测试锁死两边一致。
 */
export const REVERT_NOTICE = () => tr('tui.revert.warning')

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
  const title = ask.form
    ? approval
      ? tr('web.confirm.awaitingApproval')
      : tr('web.confirm.needsInput')
    : tr('tui.confirm.permission')
  // 内嵌在对话流里的框（PRD-M8-014 AC-3）。回车 = 拒绝，所以高亮的是「拒绝」（INV-03）
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border('warn')} paddingX={1} marginLeft={2}>
      <Text {...t.fg('warn')} bold>
        {tr('tui.confirm.title', { title, capabilityId: ask.capabilityId })}
      </Text>
      <Text {...t.fg('ink2')}>{ask.detail}</Text>
      {needsWeb ? (
        <Text {...t.fg('mut')}>{tr('tui.confirm.formInWeb')}</Text>
      ) : (
        <Box marginTop={1}>
          <Text {...t.fg('warn')} inverse bold>
            {tr('tui.confirm.keyReject')}
          </Text>
          <Text>{'  '}</Text>
          <Text {...t.fg('ink2')}>{approval ? tr('tui.confirm.keyApprove') : tr('tui.confirm.keyAllow')}</Text>
          {ask.grantable === true && <Text {...t.fg('ink2')}>{tr('tui.confirm.keyAlways')}</Text>}
          <Text {...t.fg('mut2')}>{tr('tui.confirm.enterRejects')}</Text>
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
    files: tr('tui.revert.files'),
    conversation: tr('tui.revert.chat'),
    both: tr('tui.revert.both'),
  }[ask.scope]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
      <Text color="red">{tr('tui.revert.to', { toSeq: ask.toSeq })}</Text>
      <Text>{tr('tui.revert.scope', { scopeText, fileCount: ask.fileCount })}</Text>
      <Text dimColor>{REVERT_NOTICE()}</Text>
      <Text dimColor>{tr('tui.revert.keys')}</Text>
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
