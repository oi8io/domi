/**
 * domi doctor —— PRD-M1-008 AC-4
 *
 * **每条问题必须带一条可直接复制执行的命令。**
 * 只说「检测到 X 有问题」等于把排查工作原样退回给用户——
 * 他本来就是因为搞不定才来跑 doctor 的。
 *
 * 命令行以 `$ ` 开头，AC 的断言正则就是认这个（`^\$ .+`）。
 */
import { accessSync, constants, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Finding {
  ok: boolean
  title: string
  detail: string
  /** 不为 null 时必须是一条能直接粘进终端跑的命令 */
  fix: string | null
}

export interface DoctorInput {
  configPath: string
  hasCredential: boolean
  credentialEnvNames: string[]
  dataDir: string
  gitAvailable: boolean
  provider: string
  model: string
}

export function diagnose(input: DoctorInput): Finding[] {
  const out: Finding[] = []

  out.push(
    existsSync(input.configPath)
      ? { ok: true, title: '配置文件', detail: input.configPath, fix: null }
      : {
          ok: false,
          title: '配置文件不存在',
          detail: `${input.configPath} 没找到。没有它也能跑（全部走环境变量），但建议建一个。`,
          fix: `$ mkdir -p ${dirname(input.configPath)} && domi init > ${input.configPath}`,
        },
  )

  out.push(
    input.hasCredential
      ? { ok: true, title: '模型凭据', detail: `已设置（${input.provider}）`, fix: null }
      : {
          ok: false,
          title: '没有模型凭据',
          detail: `${input.provider} 需要 ${input.credentialEnvNames.join(' 或 ')}。`,
          fix: `$ export ${input.credentialEnvNames[0]}=你的key`,
        },
  )

  out.push(
    input.gitAvailable
      ? { ok: true, title: '步级快照', detail: '可用（影子仓库）', fix: null }
      : {
          ok: false,
          title: '步级快照不可用',
          detail: '没找到 git，agent 改坏文件时无法一键回滚。domi 仍能跑，但没有安全网。',
          fix: '$ git --version   # 装上 git 后重启 domi',
        },
  )

  let writable = true
  try {
    if (existsSync(input.dataDir)) accessSync(input.dataDir, constants.W_OK)
  } catch {
    writable = false
  }
  out.push(
    writable
      ? { ok: true, title: '数据目录可写', detail: input.dataDir, fix: null }
      : {
          ok: false,
          title: '数据目录不可写',
          detail: `${input.dataDir} 写不进去，会话没法落盘。`,
          fix: `$ chmod u+w ${input.dataDir}`,
        },
  )

  return out
}

export function formatFindings(findings: readonly Finding[]): string {
  const lines: string[] = []
  for (const f of findings) {
    lines.push(`${f.ok ? '✓' : '✗'} ${f.title}`)
    lines.push(`  ${f.detail}`)
    if (f.fix) lines.push(`  ${f.fix}`)
    lines.push('')
  }
  const bad = findings.filter((f) => !f.ok).length
  lines.push(bad === 0 ? '一切正常。' : `${bad} 项需要处理，上面每条都给了可以直接粘贴执行的命令。`)
  return lines.join('\n')
}
