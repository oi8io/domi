import { Box, Text } from 'ink'

export function Prompt({ value, disabled }: { value: string; disabled: boolean }): React.ReactElement {
  return (
    <Box>
      <Text color={disabled ? 'gray' : 'green'}>{'❯ '}</Text>
      <Text>{value}</Text>
      {disabled ? null : <Text inverse> </Text>}
    </Box>
  )
}
