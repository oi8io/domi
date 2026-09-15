/**
 * 进程内插件 —— PRD-M6-001 AC-3（吃自己的狗粮）
 *
 * 官方内置能力用和第三方插件同样的形状声明（名字、版本、API、扩展点），只是不进沙箱：它们本来就是 domi 的代码。
 * 第三方插件不能走这条路——安装流程只认目录 + manifest。
 */
import type { Skill, Tool } from '@domi/capability'
import { PLUGIN_API_VERSION } from './manifest.ts'

export interface InProcessPlugin<Ctx = void> {
  name: string
  version: string
  api: number
  description: string
  tools?: (ctx: Ctx) => Tool[]
  skills?: () => readonly Skill[]
}

export function definePlugin<Ctx = void>(
  p: Omit<InProcessPlugin<Ctx>, 'api'> & { api?: number },
): InProcessPlugin<Ctx> {
  const api = p.api ?? PLUGIN_API_VERSION
  if (api !== PLUGIN_API_VERSION) throw new Error(`内置插件 ${p.name} 写的是 API ${api}，宿主是 ${PLUGIN_API_VERSION}`)
  return { ...p, api }
}
