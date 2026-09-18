/**
 * 附件、文件引用、技能 —— PRD-M8-010 AC-2 / AC-3 / AC-4
 *
 * 落盘位置与权限、上限、模型不支持图片时提交就拒绝、拼上下文时的形态，都在这里定死。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { AttachmentError, AttachmentStore, DomiSession, fuzzyFiles, isImage, isText } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-att-'))
  dirs.push(d)
  return d
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

describe('PRD-M8-010 AC-3 · 附件落盘在 ~/.domi/attachments/<会话>/，有上限', () => {
  test('存下来的是原文，权限 600，旁边一份元信息', () => {
    const home = tmp()
    const store = new AttachmentStore(home)
    const ref = store.put('s-1', { name: 'notes.md', mime: 'text/markdown', data: new TextEncoder().encode('# 笔记') })
    const file = join(home, 'attachments', 's-1', ref.id)
    expect(readFileSync(file, 'utf8')).toBe('# 笔记')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(store.get('s-1', ref.id)).toMatchObject({ name: 'notes.md', mime: 'text/markdown', size: 8 })
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('超过上限如实拒绝（TOO_LARGE），不写半个文件', () => {
    const home = tmp()
    const store = new AttachmentStore(home, 1024)
    let err: AttachmentError | null = null
    try {
      store.put('s-1', { name: 'big.bin', mime: 'application/octet-stream', data: new Uint8Array(2048) })
    } catch (e) {
      err = e as AttachmentError
    }
    expect(err?.reason).toBe('TOO_LARGE')
    expect(existsSync(join(home, 'attachments', 's-1'))).toBe(false)
  })

  test('名字里的路径分隔符被拿掉；编号不是自己发的一律拒绝（防路径穿越）', () => {
    const home = tmp()
    const store = new AttachmentStore(home)
    const ref = store.put('s-1', { name: '../../etc/passwd', mime: 'text/plain', data: new Uint8Array([1]) })
    expect(ref.name).toBe('....etc_passwd'.replace('....etc_passwd', '.._.._etc_passwd'))
    expect(() => store.get('s-1', '../../../etc/passwd')).toThrow(AttachmentError)
  })

  test('读内容：图片给 base64（模型支持时）、文本给正文、其余两样都没有', () => {
    const home = tmp()
    const store = new AttachmentStore(home)
    const png = store.put('s-1', { name: 'shot.png', mime: 'image/png', data: PNG })
    const txt = store.put('s-1', { name: 'a.md', mime: 'text/markdown', data: new TextEncoder().encode('正文') })
    const bin = store.put('s-1', { name: 'a.zip', mime: 'application/zip', data: new Uint8Array([1, 2]) })
    expect(store.load('s-1', png, { vision: true })?.base64).toBe(PNG.toString('base64'))
    expect(store.load('s-1', png, { vision: false })).toEqual({})
    expect(store.load('s-1', txt, { vision: true })?.text).toBe('正文')
    expect(store.load('s-1', bin, { vision: true })).toEqual({})
    expect(
      store.load('s-1', { id: 'up-nope', name: 'x', mime: 'text/plain', size: 0 }, { vision: true }),
    ).toBeUndefined()
  })

  test('分支会话读得到父会话的附件（id 全局唯一）', () => {
    const home = tmp()
    const store = new AttachmentStore(home)
    const ref = store.put('s-1', { name: 'a.md', mime: 'text/markdown', data: new TextEncoder().encode('父会话的') })
    expect(store.load('s-2-branch', ref, { vision: true })?.text).toBe('父会话的')
  })

  test('图片与文本的判断', () => {
    expect(isImage('image/png')).toBe(true)
    expect(isImage('application/pdf')).toBe(false)
    expect(isText('a.ts', 'application/octet-stream')).toBe(true)
    expect(isText('a.bin', 'application/octet-stream')).toBe(false)
    expect(isText('x', 'text/plain')).toBe(true)
  })
})

describe('PRD-M8-010 AC-2 / AC-3 / AC-4 · 提交之前就校验', () => {
  function session(cwd: string, home: string, vision: boolean): DomiSession {
    return new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        attachments: { maxMB: 1 },
      }),
      sessionId: 's-1',
      cwd,
      dbPath: join(home, 'events.db'),
      provider: new StubProvider([[{ type: 'delta', text: 'ok' }]], {
        onExhausted: 'repeat-last',
        capabilities: { vision },
      }),
    })
  }

  test('引用的文件必须在工作目录里，而且真的存在', async () => {
    const home = tmp()
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.ts'), 'x')
    const s = session(cwd, home, true)
    expect(s.checkInputs({ files: ['a.ts'] }).files).toEqual(['a.ts'])
    expect(() => s.checkInputs({ files: ['../secret'] })).toThrow(/不在工作目录里/)
    expect(() => s.checkInputs({ files: ['nope.ts'] })).toThrow(/不存在/)
    await s.flushAndClose()
  })

  test('没上传过的附件编号、不存在的技能，都在接受之前拒掉', async () => {
    const home = tmp()
    const s = session(tmp(), home, true)
    expect(() => s.checkInputs({ uploads: ['up-zzz'] })).toThrow(/没有附件/)
    expect(() => s.checkInputs({ skills: ['没有这个技能'] })).toThrow(/没有这个技能/)
    await s.flushAndClose()
  })

  test('模型不支持图片时，图片附件提交就被拒（不是静默丢掉）', async () => {
    const home = tmp()
    const s = session(tmp(), home, false)
    const ref = s.attachments.put('s-1', { name: 'shot.png', mime: 'image/png', data: PNG })
    let err: AttachmentError | null = null
    try {
      s.checkInputs({ uploads: [ref.id] })
    } catch (e) {
      err = e as AttachmentError
    }
    expect(err?.reason).toBe('UNSUPPORTED_ATTACHMENT')
    expect(err?.message).toContain('不支持图片')
    await s.flushAndClose()
  })

  test('提交之后：技能正文、文件引用行、附件正文都在发给模型的那条用户消息里；图片作为图片输入', async () => {
    const home = tmp()
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.ts'), 'x')
    mkdirSync(join(home, 'skills', 'code-review'), { recursive: true })
    writeFileSync(
      join(home, 'skills', 'code-review', 'SKILL.md'),
      '---\nname: code-review\ndescription: 审代码\n---\n先看测试，再看实现。',
    )
    const { SkillRegistry } = await import('@domi/capability')
    const provider = new StubProvider([[{ type: 'delta', text: 'ok' }]], { onExhausted: 'repeat-last' })
    const s = new DomiSession({
      config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
      sessionId: 's-1',
      cwd,
      dbPath: join(home, 'events.db'),
      provider,
      skills: new SkillRegistry({ dir: join(home, 'skills') }),
    })
    const png = s.attachments.put('s-1', { name: 'shot.png', mime: 'image/png', data: PNG })
    const md = s.attachments.put('s-1', {
      name: 'note.md',
      mime: 'text/markdown',
      data: new TextEncoder().encode('笔记正文'),
    })
    await s.submit('看看这个', { uploads: [md.id, png.id], files: ['a.ts'], skills: ['code-review'] })
    const user = provider.calls
      .at(-1)
      ?.messages.filter((m) => m.role === 'user')
      .at(-1) as {
      content: string
      images?: Array<{ mime: string; data: string }>
    }
    expect(user.content).toContain('先看测试，再看实现。')
    expect(user.content).toContain('a.ts')
    expect(user.content).toContain('笔记正文')
    expect(user.content).toContain('看看这个')
    expect(user.images?.[0]).toMatchObject({ mime: 'image/png', data: PNG.toString('base64') })
    // 事件里只存引用，不存内容
    const input = (await s.pumpAll()).find((e) => e.ev.t === 'user.input')?.ev as {
      uploads?: unknown[]
      files?: string[]
      skills?: string[]
    }
    expect(input.uploads).toHaveLength(2)
    expect(input.files).toEqual(['a.ts'])
    expect(input.skills).toEqual(['code-review'])
    await s.flushAndClose()
  })
})

describe('PRD-M8-010 AC-2 · 文件清单的模糊匹配', () => {
  test('文件名命中排在路径命中前面；子序列也认；完全不沾边的不要', () => {
    const all = ['src/app.ts', 'src/apply.ts', 'docs/app-notes.md', 'test/zzz.ts']
    expect(fuzzyFiles(all, 'app')[0]).toBe('src/app.ts')
    expect(fuzzyFiles(all, 'app')).toContain('docs/app-notes.md')
    expect(fuzzyFiles(all, 'srcapp')).toEqual(['src/app.ts', 'src/apply.ts'])
    expect(fuzzyFiles(all, 'qqq')).toEqual([])
    expect(fuzzyFiles(all, '')).toHaveLength(4)
  })
})
