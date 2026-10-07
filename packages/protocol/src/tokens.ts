/**
 * token 粗估的唯一口径（BUG-M14-001 · SPEC-M14-006 取舍-1）
 *
 * 不引 tokenizer（ADR-008）：本地分词与服务端计数天然对不齐，真值永远是 provider 返回的 usage。
 * 这个数只用于发送前的超长守卫、上下文分段、压缩前后对比这类「约」值。
 *
 * 口径：中日韩字符（含假名、谚文、全角标点与全角字符）每字 1 token，其余字符每 4 个 1 token，向上取整。
 * 原来的「字符数 / 4」对中文低估 3–4 倍——一个汉字在各家分词器里约 0.7–1.5 token，却只算 0.25。
 */
export function estimateTextTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (isCjk(c)) cjk++
    else if (c >= 0xdc00 && c <= 0xdfff) {
      // 代理对的后半：前半已经计过（扩展区汉字算 1，emoji 等按其余字符算）
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // 0xD840–0xD87F 是 CJK 扩展 B–F（U+20000–U+2FFFF）
      if (c >= 0xd840 && c <= 0xd87f) cjk++
      else other++
    } else other++
  }
  return Math.ceil(cjk + other / 4)
}

function isCjk(c: number): boolean {
  return (
    (c >= 0x3000 && c <= 0x30ff) || // CJK 标点、平假名、片假名
    (c >= 0x3100 && c <= 0x31ff) || // 注音、谚文兼容字母、片假名扩展
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展 A
    (c >= 0x4e00 && c <= 0x9fff) || // 基本区
    (c >= 0xac00 && c <= 0xd7af) || // 谚文音节
    (c >= 0xf900 && c <= 0xfaff) || // 兼容汉字
    (c >= 0xfe30 && c <= 0xfe4f) || // 竖排兼容标点
    (c >= 0xff00 && c <= 0xffef) // 全角 / 半角形式（，：（）等）
  )
}
