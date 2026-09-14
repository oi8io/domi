/**
 * 启动前自检 —— PRD-M0-008 AC-3
 *
 * 缺凭据时：退出码 **2**、stderr 一句人话、**不打印堆栈**。
 * 堆栈对用户是噪音，而且 `at Object.<anonymous>` 这种行会让人以为是 bug 而不是配置问题。
 * 退出码用 2 而不是 1，是为了让脚本能区分"配置问题"和"运行失败"。
 */
import { ConfigParseError, loadConfigOrThrow, MissingCredentialError } from './load.ts'

export const EXIT_CONFIG_ERROR = 2

export interface PreflightIo {
  err(line: string): void
  exit(code: number): void
}

export function preflight(io: PreflightIo, opts: Parameters<typeof loadConfigOrThrow>[0] = {}): void {
  try {
    loadConfigOrThrow(opts)
  } catch (e) {
    if (e instanceof MissingCredentialError || e instanceof ConfigParseError) {
      io.err(e.message)
      io.exit(EXIT_CONFIG_ERROR)
      return
    }
    throw e
  }
}

/** 可执行入口：测试会真的 spawn 它，断言退出码与 stderr 内容 */
export function main(): void {
  preflight({
    err: (l) => {
      process.stderr.write(`${l}\n`)
    },
    exit: (c) => process.exit(c),
  })
}

if (import.meta.main) main()
