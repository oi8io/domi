/**
 * 连接认证的线上形状 —— PRD-M3-006 · docs/adr/017
 *
 * token 放在 WebSocket **子协议**里：`Sec-WebSocket-Protocol: domi, domi-token.<token>`。
 * 浏览器的 WebSocket 不能设请求头，子协议是它在握手阶段唯一能带凭据的地方；
 * 放查询串的话 token 会进反向代理和浏览器历史。服务端只回选中的 `domi`，token 不回显。
 * 命令行客户端也可以用 `Authorization: Bearer <token>`，两者等价。
 */
export const AUTH_SUBPROTOCOL = 'domi'
export const TOKEN_SUBPROTOCOL_PREFIX = 'domi-token.'

/** 子协议里只能出现 token 字符（RFC 6455 → RFC 7230 tchar 的一个安全子集） */
export const TOKEN_CHARS = /^[A-Za-z0-9._~-]+$/

/** 客户端建连时传给 `new WebSocket(url, protocols)` 的那一项 */
export function authProtocols(token: string | undefined): string[] {
  if (token === undefined || token === '') return [AUTH_SUBPROTOCOL]
  if (!TOKEN_CHARS.test(token)) {
    throw new Error('token 里只能有字母、数字和 . _ ~ -（它要放进 WebSocket 子协议）')
  }
  return [AUTH_SUBPROTOCOL, `${TOKEN_SUBPROTOCOL_PREFIX}${token}`]
}
