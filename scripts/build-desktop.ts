#!/usr/bin/env bun
/**
 * pnpm desktop —— 构建桌面端并原地替换 /Applications/domi.app（macOS only）
 *
 * 流程：build（只打 .app）→ 关旧 app（osascript quit，超时 pkill 兜底）
 *      → 备份并替换 /Applications/domi.app → 确保 domid 在跑 → open 重启
 *
 * 用法：pnpm desktop
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APP_NAME = 'domi'
const BUNDLE_ID = 'dev.domi.desktop'
const APP_PATH = '/Applications/domi.app'
const BUILD_APP = join(ROOT, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'macos', `${APP_NAME}.app`)
const LOCK_PATH = join(homedir(), '.domi', 'domid.lock')

function log(msg: string): void {
  console.log(`[desktop] ${msg}`)
}

function fail(msg: string): never {
  console.error(`[desktop] ✗ ${msg}`)
  process.exit(1)
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function run(cmd: string, args: string[], opts?: { cwd?: string }): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts?.cwd })
  if (r.error) fail(`${cmd} 启动失败：${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
}

function appRunning(): boolean {
  return spawnSync('pgrep', ['-f', `${APP_PATH}/Contents/MacOS`], { stdio: 'ignore' }).status === 0
}

function quitApp(): void {
  if (!appRunning()) return
  log('检测到 domi.app 正在运行，先优雅退出…')
  spawnSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], { stdio: 'ignore' })
  for (let i = 0; i < 50 && appRunning(); i++) sleep(100)
  if (!appRunning()) return
  log('优雅退出超时，pkill 兜底强杀…')
  spawnSync('pkill', ['-f', `${APP_PATH}/Contents/MacOS`], { stdio: 'ignore' })
  for (let i = 0; i < 20 && appRunning(); i++) sleep(100)
  if (appRunning()) fail('旧 domi.app 关不掉，请手动退出后重试')
}

function replaceApp(): void {
  if (!existsSync(BUILD_APP)) fail(`没找到构建产物 ${BUILD_APP}`)
  const backup = `${APP_PATH}.prev`
  rmSync(backup, { recursive: true, force: true })
  const hadOld = existsSync(APP_PATH)
  if (hadOld) renameSync(APP_PATH, backup)
  try {
    run('ditto', [BUILD_APP, APP_PATH])
    if (!existsSync(join(APP_PATH, 'Contents', 'MacOS', 'domi-desktop'))) {
      throw new Error('替换后缺少 Contents/MacOS/domi-desktop')
    }
  } catch (e) {
    rmSync(APP_PATH, { recursive: true, force: true })
    if (hadOld) renameSync(backup, APP_PATH)
    fail(`替换失败，已回滚旧 app：${e instanceof Error ? e.message : String(e)}`)
  }
  if (hadOld) rmSync(backup, { recursive: true, force: true })
  log('已替换 /Applications/domi.app')
}

function domidRunning(): { pid: number; port: number } | null {
  if (!existsSync(LOCK_PATH)) return null
  try {
    const info = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { pid: number; port: number }
    if (typeof info.pid !== 'number') return null
    process.kill(info.pid, 0) // signal 0：只查存活，不发信号
    return info
  } catch {
    return null
  }
}

function ensureDomid(): void {
  const running = domidRunning()
  if (running) {
    log(`domid 已在跑（pid ${running.pid}，端口 ${running.port}），跳过拉起`)
    return
  }
  log('domid 没在跑，后台拉起…')
  const child = spawn(process.execPath, [join(ROOT, 'packages', 'daemon', 'src', 'main.ts')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  for (let i = 0; i < 50; i++) {
    const r = domidRunning()
    if (r) {
      log(`domid 起来了（pid ${r.pid}，端口 ${r.port}）`)
      child.unref()
      return
    }
    sleep(100)
  }
  // 没等到锁文件：可能是竞态下别人抢了锁（退出码 3），再确认一次；否则真失败
  const r = domidRunning()
  if (r) {
    log(`domid 已在跑（pid ${r.pid}，端口 ${r.port}），跳过拉起`)
    return
  }
  child.kill('SIGKILL')
  fail('domid 拉起失败，请手动执行 `pnpm domid` 排查')
}

function main(): void {
  if (process.platform !== 'darwin') fail('此脚本只支持 macOS（替换 /Applications 用的）')

  log('step 1/4 · 构建（web + 只打 .app）')
  run('pnpm', ['--filter', '@domi/web', 'build'])
  run('npx', ['--yes', '@tauri-apps/cli@2.11.4', 'build', '--bundles', 'app'], {
    cwd: join(ROOT, 'apps', 'desktop'),
  })

  log('step 2/4 · 关闭旧 domi.app')
  quitApp()

  log('step 3/4 · 替换 /Applications/domi.app')
  replaceApp()

  log('step 4/4 · 确保 domid 在跑并重启 app')
  ensureDomid()
  run('open', [APP_PATH])
  log('完成。新的 domi.app 已启动。')
}

main()
