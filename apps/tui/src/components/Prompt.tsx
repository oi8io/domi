import { Box, Text } from 'ink'

/**
 * 输入行 —— PRD-M8-014 AC-5 · PRD-M9-005 AC-6 / AC-7。
 * 空的时候只有光标：不放占位文字、不放 `›`；按键说明在底部快捷键行。上下两条横线由外层的 Box 画。
 * Enter 发送；Shift+Enter（kitty 键盘协议）/ Ctrl+J / Alt+Enter 换行。忙的时候不显示光标（转圈在上面）。
 */
export function Prompt({ value, disabled }: { value: string; disabled: boolean }): React.ReactElement {
  const lines = value.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行号就是身份
        <Box key={i}>
          <Text>{line}</Text>
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
