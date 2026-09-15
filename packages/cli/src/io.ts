/** 命令的输入输出。单独一个文件：run.ts 与各子命令都要用它，放在 run.ts 里会成环 */
export interface Io {
  out(s: string): void
  err(s: string): void
  /** 交互式提问。没有终端时不给——需要人拍板的命令据此拒绝，而不是替人答 */
  ask?(question: string): Promise<string>
}
