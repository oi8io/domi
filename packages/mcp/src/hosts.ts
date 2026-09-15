/**
 * HTTP MCP server 的出站白名单 —— PRD-M2-001 AC-6 · INV-11
 *
 * 只对 domi 自己发出的请求有效（HTTP 传输）。stdio server 是子进程，它自己的网络 domi 管不到，
 * 见 docs/adr/015 的 Consequences。
 */
export class HostNotAllowedError extends Error {
  constructor(readonly host: string) {
    super(`主机 ${host} 不在 mcp.allowedHosts 里，拒绝连接（INV-11）。需要的话在 ~/.domi/config.yaml 里加上它`)
    this.name = 'HostNotAllowedError'
  }
}

/** `example.com` 精确匹配；`*.example.com` 匹配子域（不含 example.com 本身）；单独的 `*` 不认 */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase()
  return patterns.some((raw) => {
    const p = raw.toLowerCase()
    if (p.startsWith('*.')) return p.length > 2 && h.endsWith(p.slice(1))
    return p !== '*' && h === p
  })
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const MAX_REDIRECTS = 5

/**
 * 包一层 fetch：每一跳都查白名单，重定向由这里手动跟——
 * 让底层自动跟的话，一个 307 就能把请求带到白名单外面去。
 */
export function guardedFetch(
  base: FetchFn,
  allowed: readonly string[],
  onDenied?: (err: HostNotAllowedError) => void,
): FetchFn {
  return async (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input))
    let currentInit: RequestInit | undefined = init
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!hostAllowed(url.hostname, allowed)) {
        const err = new HostNotAllowedError(url.hostname)
        onDenied?.(err)
        throw err
      }
      const res = await base(hop === 0 && input instanceof Request ? input : url, {
        ...currentInit,
        redirect: 'manual',
      })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) return res
      url = new URL(location, url)
      // 303 之外的重定向保持方法与正文（307/308 语义）；303 按规范改成 GET
      if (res.status === 303) currentInit = { ...currentInit, method: 'GET', body: null }
    }
    throw new Error(`重定向超过 ${MAX_REDIRECTS} 次`)
  }
}
