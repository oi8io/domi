/**
 * 单实例锁 —— PRD-M3-002 AC-4：并发调用只拉起一个实例
 *
 * 用 `O_EXCL` 建锁文件，而不是「先看在不在再建」：
 * 后者在两个进程同时启动时会双双通过检查——而这正是 AC-4 要断言的场景。
 * O_EXCL 的原子性是内核给的，不需要我们自己证明。
 *
 * 锁文件里写 pid 与端口，因为**第二个进程真正想知道的不是"我抢输了"，
 * 而是"那我该连到哪里去"**。
 */
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface LockInfo {
  pid: number
  port: number
  startedAt: number
}

export class LockHeldError extends Error {
  constructor(readonly holder: LockInfo) {
    super(`daemon 已在运行（pid ${holder.pid}，端口 ${holder.port}）。连它就行，不用再起一个。`)
    this.name = 'LockHeldError'
  }
}

/** 抢锁。抢到返回释放函数；没抢到抛 LockHeldError 并带上持有者信息 */
export function acquireLock(path: string, info: Omit<LockInfo, 'startedAt'>): () => void {
  const payload = JSON.stringify({ ...info, startedAt: Date.now() })
  try {
    // 'wx' = O_CREAT | O_EXCL：文件已存在就失败。原子性由内核保证
    const fd = openSync(path, 'wx')
    writeFileSync(fd, payload, 'utf8')
    closeSync(fd)
  } catch (e) {
    const held = readLock(path)
    if (held && isAlive(held.pid)) throw new LockHeldError(held)
    // 持有者已经死了 —— 这是**崩溃留下的陈锁**，不是竞争。清掉重来一次
    if (held) {
      try {
        rmSync(path)
      } catch {
        // 删不掉就只能认输，让调用方看到原始错误
        throw new LockHeldError(held)
      }
      return acquireLock(path, info)
    }
    throw e
  }

  let released = false
  return () => {
    if (released) return
    released = true
    try {
      rmSync(path)
    } catch {
      // 锁文件没了也算释放成功 —— 目标状态已经达成
    }
  }
}

/**
 * 持锁者改写锁里的信息（比如 DOMI_PORT=0 时拿到真实端口之后）。
 * 原地写，不先释放再抢——那中间的空档足够另一个进程抢走锁。
 */
export function rewriteLock(path: string, info: Omit<LockInfo, 'startedAt'>): void {
  const prev = readLock(path)
  writeFileSync(path, JSON.stringify({ ...info, startedAt: prev?.startedAt ?? Date.now() }), 'utf8')
}

export function readLock(path: string): LockInfo | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as LockInfo
    return typeof raw.pid === 'number' ? raw : null
  } catch {
    return null
  }
}

/** 进程还活着吗。signal 0 只做权限与存在性检查，不真的发信号 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
