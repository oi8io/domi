/**
 * PRD-M0-008 AC-2 · 事件流与 fixture 里扫不出凭据（INV-11）
 *
 * 与运行时**共用同一份正则**（packages/store/src/redact.ts）。
 * 两处各写一份的话必然漂移：运行时脱敏了 5 类，扫描只认 4 类，
 * 漏掉的那一类会安静地躺在仓库里。
 *
 * 用法：bun run scripts/scan-secrets.ts [扫描目录...]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { CREDENTIAL_PATTERNS } from '@domi/store'

const SCAN_EXT = new Set(['.jsonl', '.json', '.md', '.yaml', '.yml', '.toml', '.txt', '.log'])

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'node_modules' || name.startsWith('.git')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (SCAN_EXT.has(extname(name))) out.push(p)
    }
  }
  walk(root)
  return out
}

const targets = process.argv.slice(2)
const roots = targets.length > 0 ? targets : ['fixtures']
const files = roots.flatMap(collect)

let hits = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const re of CREDENTIAL_PATTERNS) {
    const m = text.match(new RegExp(re.source, re.flags))
    if (m) {
      console.error(`[INV-11] ${f} 命中凭据模式：${m[0].slice(0, 8)}…（共 ${m.length} 处）`)
      hits += m.length
    }
  }
}

if (hits > 0) {
  console.error(`\n[scan-secrets] ${hits} 处疑似凭据，扫描了 ${files.length} 个文件`)
  process.exit(1)
}
console.log(`[scan-secrets] OK —— ${files.length} 个文件，无凭据模式命中`)
