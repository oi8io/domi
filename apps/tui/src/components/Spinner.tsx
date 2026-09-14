import { Text } from 'ink'
import { useEffect, useState } from 'react'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * 自己写而不是引 ink-spinner：一个数组加一个 setInterval，
 * 引库的收益不抵一个要跟版本的依赖（ADR-008 的同一条判断标准）。
 */
export function Spinner({ label = '思考中' }: { label?: string }): React.ReactElement {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80)
    return () => clearInterval(t)
  }, [])
  return <Text color="cyan">{`${FRAMES[i]} ${label}`}</Text>
}
