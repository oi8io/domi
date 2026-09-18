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
      out.push({ ok: true, title: '插件沙箱', detail: p.sandbox, fix: null })
    } else if (p.allowUnsandboxed) {
      out.push({
        ok: false,
        title: '插件代码在没有沙箱的情况下运行',
        detail: '你打开了 plugins.allowUnsandboxed：插件能读写任何文件、访问任何网络。只在完全信任已装插件时这样做',
        fix: '$ sed -i.bak "s/allowUnsandboxed: true/allowUnsandboxed: false/" ~/.domi/config.yaml',
      })
    } else if (p.withCode > 0) {
      out.push({
        ok: false,
        title: '没有插件沙箱',
        detail: `这台机器没有 bwrap / sandbox-exec，${p.withCode} 个带代码的插件没有加载（docs/adr/023）`,
        fix: '$ sudo apt-get install -y bubblewrap',
      })
    }
  }

  if (input.inferredProviders && input.inferredProviders.length > 0) {
    out.push({
      ok: true,
      title: '按旧写法推断的 provider',
      detail:
        input.inferredProviders.map((p) => `${p.id} → ${p.vendor}（${p.protocol} 协议）`).join('；') +
        '。照常可用；想固定下来，在 Web「设置 › 模型供应商」里打开它保存一次，或在 config.yaml 里写上 vendor',
      fix: null,
    })
  }

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

  if (input.legacyConfig) {
    const { path, ignored } = input.legacyConfig
    const yamlPath = path.replace(/\.toml$/, '.yaml')
    out.push(
      ignored
        ? {
            ok: false,
            title: '旧的 TOML 配置被忽略了',
            detail: `已经有 YAML 配置，${path} 已被忽略（docs/adr/014）。确认 YAML 里该有的都有了，就可以删掉它。`,
            fix: `$ rm ${path}`,
          }
        : {
            ok: false,
            title: '还在用旧的 TOML 配置',
            detail: `${path} 现在还能读，但配置格式已改为 YAML（docs/adr/014），TOML 的支持会在 M4 去掉。`,
            fix: `$ domi init --from-toml > ${yamlPath}`,
          },
    )
  }

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

  if (input.ripgrep !== undefined) {
    // 没装 rg 不算问题：fs.grep 退回内置实现，只是慢（用户拍板：没装也能用，装了自动用）
    out.push({
      ok: true,
      title: '代码搜索',
      detail:
        input.ripgrep === null
          ? '内置实现（没找到 ripgrep；大仓库里会慢，装上后自动改用：brew install ripgrep / apt install ripgrep）'
          : `ripgrep（${input.ripgrep}）`,
      fix: null,
    })
  }

  out.push(
    input.baseUrl
      ? { ok: true, title: '自定义网关', detail: input.baseUrl, fix: null }
      : { ok: true, title: '模型端点', detail: `${input.provider} 官方端点`, fix: null },
  )

  if (input.ping) {
    out.push(
      input.ping.ok
        ? { ok: true, title: '连通性', detail: `${input.ping.detail}（${input.ping.ms}ms）`, fix: null }
        : {
            ok: false,
            title: '连不上模型端点',
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
