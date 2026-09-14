/**
 * 测试渲染器 —— PRD-M0-005 AC-4 要在 40/60/80/200 四种宽度下比对 golden 快照，
 * 而 ink-testing-library 的宽度写死在 100，所以这里用 ink 自己的 render + 假 stdout。
 *
 * 取最后一帧的做法：ink 每次都写整帧。去掉 ANSI 之后，**最后一个有可见内容的 chunk**
 * 就是当前画面——不能直接取最后一个 chunk，收尾时 ink 会单独写一条「显示光标」的转义。
 */
import { Writable } from 'node:stream'
import { render } from 'ink'
import type { ReactElement } from 'react'

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列本来就是控制字符
const CSI = /\u001B\[[0-9;?]*[A-Za-z]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC 同上
const OSC = /\u001B\][^\u0007]*\u0007/g

function strip(s: string): string {
  return s.replace(OSC, '').replace(CSI, '')
}

class FrameSink extends Writable {
  frames: string[] = []
  readonly rows = 40
  readonly isTTY = true
  constructor(readonly columns: number) {
    super()
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.frames.push(String(chunk))
    cb()
  }
  lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const text = strip(this.frames[i] ?? '')
      if (text.trim() !== '') {
        return text
          .split('\n')
          .map((l) => l.replace(/\s+$/, ''))
          .join('\n')
          .replace(/^\n+|\n+$/g, '')
      }
    }
    return ''
  }
}

export interface Harness {
  lastFrame(): string
  frames(): string[]
  rerender(tree: ReactElement): void
  unmount(): void
  flush(): Promise<void>
  /**
   * 等到画面满足条件为止，返回等了多久。
   * ink 自带 32ms 节流，所以「渲染出来了没」必须轮询而不是 sleep 一个固定值——
   * sleep 短了会假红，sleep 长了就测不出 PRD-M0-002 AC-1 的 100ms 上限。
   */
  waitFor(pred: (frame: string) => boolean, timeoutMs?: number): Promise<number>
}

export function renderAt(columns: number, tree: ReactElement): Harness {
  const sink = new FrameSink(columns)
  const app = render(tree, { stdout: sink as never, patchConsole: false, exitOnCtrlC: false })
  return {
    lastFrame: () => sink.lastFrame(),
    frames: () => sink.frames,
    rerender: (t) => app.rerender(t),
    unmount: () => app.unmount(),
    flush: async () => {
      await new Promise((r) => setTimeout(r, 50))
    },
    waitFor: async (pred, timeoutMs = 1000) => {
      const t0 = performance.now()
      for (;;) {
        if (pred(sink.lastFrame())) return performance.now() - t0
        if (performance.now() - t0 > timeoutMs) {
          throw new Error(`等了 ${timeoutMs}ms 画面仍不满足条件。当前画面：\n${sink.lastFrame()}`)
        }
        await new Promise((r) => setTimeout(r, 4))
      }
    },
  }
}
