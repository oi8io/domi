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
import { tr } from '@domi/i18n'

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
  /** 自定义网关地址。拿不到官方 key 时这是主路径，不是边缘场景 */
  baseUrl?: string | undefined
  /** 旧格式配置（ADR-014 过渡期）。ignored = 同时有 YAML，这个 TOML 没被读 */
  legacyConfig?: { path: string; ignored: boolean } | undefined
  /** --ping 的结果；没跑就是 undefined */
  ping?: PingResult | undefined
  /** 插件沙箱（PRD-M6-003）。没给就不查 */
  plugins?: { sandbox: 'bwrap' | 'sandbox-exec' | 'none'; allowUnsandboxed: boolean; withCode: number } | undefined
  /** fs.grep 的后端（PRD-M7-001）：ripgrep 的路径，没装是 null。没给就不查 */
  ripgrep?: string | null | undefined
  /** 配置里没写 vendor、按键名推断出来的 provider（PRD-M9-002 AC-7）。只提示，不算问题 */
  inferredProviders?: Array<{ id: string; vendor: string; protocol: string }> | undefined
  /** 运行时护栏（PRD-M10-003）：config.loop 的 limits。没给就不查 */
  loop?: { maxToolCalls: number; maxArgParseRetries: number; maxWallClockMs: number } | undefined
}

export interface PingResult {
  ok: boolean
  ms: number
  detail: string
}

export function diagnose(input: DoctorInput): Finding[] {
  const out: Finding[] = []

  if (input.plugins) {
    const p = input.plugins
    if (p.sandbox !== 'none') {
      out.push({ ok: true, title: tr('cli.doctor.sandbox'), detail: p.sandbox, fix: null })
    } else if (p.allowUnsandboxed) {
      out.push({
        ok: false,
        title: tr('cli.doctor.unsandboxed'),
        detail: tr('cli.doctor.unsandboxedDetail'),
        fix: '$ sed -i.bak "s/allowUnsandboxed: true/allowUnsandboxed: false/" ~/.domi/config.yaml',
      })
    } else if (p.withCode > 0) {
      out.push({
        ok: false,
        title: tr('cli.doctor.noSandbox'),
        detail: tr('cli.doctor.noSandboxDetail', { withCode: p.withCode }),
        fix: '$ sudo apt-get install -y bubblewrap',
      })
    }
  }

  if (input.inferredProviders && input.inferredProviders.length > 0) {
    out.push({
      ok: true,
      title: tr('cli.doctor.inferred'),
      detail:
        input.inferredProviders
          .map((p) => tr('cli.doctor.inferredItem', { id: p.id, vendor: p.vendor, protocol: p.protocol }))
          .join(tr('core.listSepStrong')) + tr('cli.doctor.inferredHint'),
      fix: null,
    })
  }

  out.push(
    existsSync(input.configPath)
      ? { ok: true, title: tr('cli.doctor.config'), detail: input.configPath, fix: null }
      : {
          ok: false,
          title: tr('cli.doctor.noConfig'),
          detail: tr('cli.doctor.noConfigDetail', { configPath: input.configPath }),
          fix: `$ mkdir -p ${dirname(input.configPath)} && domi init > ${input.configPath}`,
        },
  )

  if (input.loop) {
    out.push({
      ok: true,
      title: tr('cli.doctor.loop'),
      detail: tr('cli.doctor.loopDetail', input.loop),
      fix: null,
    })
  }

  if (input.legacyConfig) {
    const { path, ignored } = input.legacyConfig
    const yamlPath = path.replace(/\.toml$/, '.yaml')
    out.push(
      ignored
        ? {
            ok: false,
            title: tr('cli.doctor.tomlIgnored'),
            detail: tr('cli.doctor.tomlIgnoredDetail', { path }),
            fix: `$ rm ${path}`,
          }
        : {
            ok: false,
            title: tr('cli.doctor.tomlInUse'),
            detail: tr('cli.doctor.tomlInUseDetail', { path }),
            fix: `$ domi init --from-toml > ${yamlPath}`,
          },
    )
  }

  out.push(
    input.hasCredential
      ? {
          ok: true,
          title: tr('cli.doctor.credential'),
          detail: tr('cli.doctor.credentialSet', { provider: input.provider }),
          fix: null,
        }
      : {
          ok: false,
          title: tr('cli.doctor.noCredential'),
          detail: tr('cli.doctor.needs', {
            provider: input.provider,
            join: input.credentialEnvNames.join(tr('common.or')),
          }),
          fix: tr('cli.doctor.exportKey', { v: input.credentialEnvNames[0] ?? 'DOMI_API_KEY' }),
        },
  )

  out.push(
    input.gitAvailable
      ? { ok: true, title: tr('cli.doctor.snapshots'), detail: tr('cli.doctor.snapshotsOk'), fix: null }
      : {
          ok: false,
          title: tr('cli.doctor.snapshotsOff'),
          detail: tr('cli.doctor.noGit'),
          fix: tr('cli.doctor.gitFix'),
        },
  )

  if (input.ripgrep !== undefined) {
    // 没装 rg 不算问题：fs.grep 退回内置实现，只是慢（用户拍板：没装也能用，装了自动用）
    out.push({
      ok: true,
      title: tr('cli.doctor.search'),
      detail:
        input.ripgrep === null ? tr('cli.doctor.builtinSearch') : tr('cli.doctor.ripgrep', { ripgrep: input.ripgrep }),
      fix: null,
    })
  }

  out.push(
    input.baseUrl
      ? { ok: true, title: tr('cli.doctor.gateway'), detail: input.baseUrl, fix: null }
      : {
          ok: true,
          title: tr('cli.doctor.endpoint'),
          detail: tr('cli.doctor.official', { provider: input.provider }),
          fix: null,
        },
  )

  if (input.ping) {
    out.push(
      input.ping.ok
        ? {
            ok: true,
            title: tr('cli.doctor.connectivity'),
            detail: tr('cli.doctor.pingDetail', { detail: input.ping.detail, ms: input.ping.ms }),
            fix: null,
          }
        : {
            ok: false,
            title: tr('cli.doctor.unreachable'),
            detail: input.ping.detail,
            // 不给「检查一下网络」这种废话：给一条能立刻看到真实响应的命令
            fix: input.baseUrl
              ? `$ curl -sS -o /dev/null -w '%{http_code}\\n' ${input.baseUrl}/messages -H 'x-api-key: '"$DOMI_API_KEY"`
              : "$ curl -sS -o /dev/null -w '%{http_code}\\n' https://api.anthropic.com/v1/messages -H 'x-api-key: '\"$ANTHROPIC_API_KEY\"",
          },
    )
  }

  let writable = true
  try {
    if (existsSync(input.dataDir)) accessSync(input.dataDir, constants.W_OK)
  } catch {
    writable = false
  }
  out.push(
    writable
      ? { ok: true, title: tr('cli.doctor.dataOk'), detail: input.dataDir, fix: null }
      : {
          ok: false,
          title: tr('cli.doctor.dataBad'),
          detail: tr('cli.doctor.dataBadDetail', { dataDir: input.dataDir }),
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
  lines.push(bad === 0 ? tr('cli.doctor.allGood') : tr('cli.doctor.problems', { bad }))
  return lines.join('\n')
}
