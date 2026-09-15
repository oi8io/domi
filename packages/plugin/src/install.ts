/**
 * 安装与权限快照 —— PRD-M6-002 · docs/adr/022
 *
 * 运行时只认 installed.json 里的快照：安装时用户确认过的权限 + 当时 manifest 的 sha256。
 * manifest 之后被改过（哪怕是插件自己改的），哈希对不上，插件就停用，直到重新安装确认（AC-4）。
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  describePermissions,
  MANIFEST_FILE,
  ManifestError,
  type PluginManifest,
  type PluginPermissions,
  parseManifest,
} from './manifest.ts'

export interface InstalledPlugin {
  name: string
  version: string
  manifestSha256: string
  granted: PluginPermissions
  installedAt: number
}

export interface InstalledIndex {
  plugins: InstalledPlugin[]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function indexPath(pluginsDir: string): string {
  return join(pluginsDir, 'installed.json')
}

export function readIndex(pluginsDir: string): InstalledIndex {
  const p = indexPath(pluginsDir)
  if (!existsSync(p)) return { plugins: [] }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as InstalledIndex
    return { plugins: Array.isArray(raw.plugins) ? raw.plugins : [] }
  } catch {
    return { plugins: [] }
  }
}

function writeIndex(pluginsDir: string, idx: InstalledIndex): void {
  mkdirSync(pluginsDir, { recursive: true })
  const p = indexPath(pluginsDir)
  writeFileSync(`${p}.tmp`, `${JSON.stringify(idx, null, 2)}\n`, 'utf8')
  renameSync(`${p}.tmp`, p)
}

export function readManifestFile(dir: string): { manifest: PluginManifest; text: string; warnings: string[] } {
  const file = join(dir, MANIFEST_FILE)
  if (!existsSync(file)) throw new ManifestError(`${dir} 下没有 ${MANIFEST_FILE}`)
  const text = readFileSync(file, 'utf8')
  return { ...parseManifest(text), text }
}

export interface InstallOptions {
  pluginsDir: string
  /**
   * 逐条展示权限并问人。返回 false 或者没有这个函数（非交互）= 拒绝安装（AC-2）
   */
  confirm?: (m: PluginManifest, permissions: string[]) => Promise<boolean>
  now?: () => number
}

export class InstallRefusedError extends Error {}

export async function installPlugin(srcDir: string, opts: InstallOptions): Promise<InstalledPlugin> {
  const src = resolve(srcDir)
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new ManifestError(`${srcDir} 不是一个目录`)
  const { manifest, text } = readManifestFile(src)
  for (const t of manifest.contributes.tools) {
    if (!existsSync(join(src, t.entry))) throw new ManifestError(`工具 ${t.name} 的入口 ${t.entry} 不存在`)
  }
  for (const s of manifest.contributes.skills) {
    if (!existsSync(join(src, s, 'SKILL.md'))) throw new ManifestError(`skill 目录 ${s} 下没有 SKILL.md`)
  }
  for (const u of manifest.contributes.ui) {
    if (!existsSync(join(src, u.entry))) throw new ManifestError(`UI ${u.id} 的入口 ${u.entry} 不存在`)
  }
  if (!opts.confirm) throw new InstallRefusedError('安装插件需要在终端里确认权限；非交互环境不会安装任何插件')
  if (!(await opts.confirm(manifest, describePermissions(manifest))))
    throw new InstallRefusedError('没有确认权限，插件没有安装')

  const dest = join(opts.pluginsDir, manifest.name)
  if (resolve(dest) !== src) {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(opts.pluginsDir, { recursive: true })
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => !p.split(/[\\/]/).some((seg) => seg === 'node_modules' || seg === '.git'),
    })
  }
  const entry: InstalledPlugin = {
    name: manifest.name,
    version: manifest.version,
    manifestSha256: sha256(text),
    granted: structuredClone(manifest.permissions),
    installedAt: (opts.now ?? Date.now)(),
  }
  const idx = readIndex(opts.pluginsDir)
  writeIndex(opts.pluginsDir, { plugins: [...idx.plugins.filter((p) => p.name !== manifest.name), entry] })
  return entry
}

export function removePlugin(pluginsDir: string, name: string): boolean {
  const idx = readIndex(pluginsDir)
  if (!idx.plugins.some((p) => p.name === name)) return false
  writeIndex(pluginsDir, { plugins: idx.plugins.filter((p) => p.name !== name) })
  rmSync(join(pluginsDir, name), { recursive: true, force: true })
  return true
}

export interface LoadedPlugin {
  dir: string
  manifest: PluginManifest
  installed: InstalledPlugin
  warnings: string[]
}

export interface LoadProblem {
  name: string
  message: string
}

/** 读出所有已安装、且 manifest 没被改过的插件 */
export function loadInstalled(pluginsDir: string): { plugins: LoadedPlugin[]; problems: LoadProblem[] } {
  const plugins: LoadedPlugin[] = []
  const problems: LoadProblem[] = []
  for (const inst of readIndex(pluginsDir).plugins) {
    const dir = join(pluginsDir, inst.name)
    try {
      const { manifest, text, warnings } = readManifestFile(dir)
      if (sha256(text) !== inst.manifestSha256) {
        problems.push({
          name: inst.name,
          message: `插件 ${inst.name} 的 manifest 在安装之后被改过，已停用。确认改动后重新安装：domi plugin install ${dir}`,
        })
        continue
      }
      plugins.push({ dir, manifest, installed: inst, warnings })
    } catch (e) {
      problems.push({ name: inst.name, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { plugins, problems }
}
