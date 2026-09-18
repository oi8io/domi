import { tr } from '@domi/i18n'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/**
 * 输入行 —— PRD-M8-014 AC-5。Enter 发送；Ctrl+J / Alt+Enter 换行（支持 kitty 键盘协议的终端里 Shift+Enter 也行）。
 * 多行时第一行带提示符，后面的行缩进对齐。
 */
export function Prompt({ value, disabled }: { value: string; disabled: boolean }): React.ReactElement {
  const t = useTheme()
  const lines = value.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行号就是身份
        <Box key={i}>
          <Text {...t.fg(disabled ? 'mut2' : 'accent')} bold>
            {i === 0 ? '› ' : '  '}
          </Text>
          {value === '' ? (
            <Text {...t.fg('mut2')}>{disabled ? tr('web.session.busy') : tr('tui.prompt.placeholder')}</Text>
          ) : (
            <Text>{line}</Text>
          )}
          {!disabled && i === lines.length - 1 && <Text inverse> </Text>}
        </Box>
      ))}
    </Box>
  )
}

/** 按键 → 输入框动作。纯函数，测试直接调（Ink 的按键在无 TTY 环境里验不了，见 docs/adr/001） */
export function editAction(
  input: string,
  key: { return?: boolean; shift?: boolean; meta?: boolean; ctrl?: boolean; backspace?: boolean; delete?: boolean },
): { kind: 'submit' } | { kind: 'newline' } | { kind: 'backspace' } | { kind: 'insert'; text: string } | null {
  if (key.return) return key.shift || key.meta ? { kind: 'newline' } : { kind: 'submit' }
  // 传统终端里 Ctrl+J 就是 LF；开了 kitty 协议时它以 ctrl + j 的形式到达
  if (input === '\n' || (key.ctrl && input === 'j')) return { kind: 'newline' }
  if (key.backspace || key.delete) return { kind: 'backspace' }
  if (input && !key.ctrl && !key.meta) return { kind: 'insert', text: input.replace(/\r/g, '\n') }
  return null
}
