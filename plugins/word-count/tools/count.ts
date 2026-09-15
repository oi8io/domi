/**
 * 官方示例插件（tool 型）。跑在沙箱里：文件只能经 ctx.readFile 读，且只能读 manifest 里声明的 *.md / *.txt。
 */
export interface Ctx {
  readFile(path: string): Promise<string>
}

export interface Counts {
  path: string
  lines: number
  words: number
  chars: number
}

/** 中日韩字符一个算一个词，其余按空白切 */
export function count(text: string): Omit<Counts, 'path'> {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu)?.length ?? 0
  const latin = text
    .replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return { lines: text === '' ? 0 : text.split('\n').length, words: cjk + latin, chars: [...text].length }
}

export default {
  async execute(args: { paths?: unknown }, ctx: Ctx) {
    if (!Array.isArray(args.paths) || args.paths.length === 0) throw new Error('paths 要是一个非空数组')
    const out: Array<Counts | { path: string; error: string }> = []
    for (const p of args.paths.slice(0, 50)) {
      const path = String(p)
      try {
        out.push({ path, ...count(await ctx.readFile(path)) })
      } catch (e) {
        out.push({ path, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return { files: out }
  },
}
