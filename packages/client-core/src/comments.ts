/**
 * SPEC-M14-008 · diff 行评论的攒批与转换（PRD-M14-008 AC-1/AC-2/AC-5）
 *
 * 端上在右侧栏改动 tab 里点 diff 行号（可拖选多行）写评论，先攒在 `$comments`，
 * 「交给 domi」时经 `commentsToRefs` 转成文件行引用（FileRef）挂进输入框，**不自动发送**。
 *
 * 评论是端上工作区状态，不是事件流投影（docs/adr/009 的"投影"纪律针对会话状态；
 * 评论在发出之前只存在于端上）。切范围 / 切文件保留（AC-5），关会话未交出由端上提示。
 */

import type { FileRef } from '@domi/protocol'
import { atom } from 'nanostores'

/** 一条评论草稿。snippet 是点行号那一刻从 diff 数据里带的代码片段（SPEC 取舍-2） */
export interface CommentDraft {
  id: string
  file: string
  lineStart: number
  lineEnd: number
  /** 新旧侧。未标（老侧行号存疑）时 undefined */
  side?: 'new' | 'old'
  /** 被评论的代码片段（从 diff 数据带过去；事件只存引用与文字） */
  snippet?: string
  /** 评论文字 */
  text: string
}

let nextId = 0
export function newCommentId(): string {
  nextId += 1
  return `cmt-${nextId}`
}

/** 攒批的 store：端上未交评论，跨 tab / 范围 / 文件保留（AC-5） */
export const $comments = atom<readonly CommentDraft[]>([])

export function addComment(draft: Omit<CommentDraft, 'id'>): CommentDraft {
  const c: CommentDraft = {
    ...draft,
    id: newCommentId(),
    // 行号倒置规范化：拖选方向不影响语义
    lineStart: Math.min(draft.lineStart, draft.lineEnd),
    lineEnd: Math.max(draft.lineStart, draft.lineEnd),
  }
  $comments.set([...$comments.get(), c])
  return c
}

export function removeComment(id: string): void {
  $comments.set($comments.get().filter((c) => c.id !== id))
}

export function clearComments(): void {
  $comments.set([])
}

export function pendingCount(): number {
  return $comments.get().length
}

/**
 * 评论 → 输入框文件行引用组（AC-2）。只组装不发送：模型看到的是结构化引用
 * （path + 行范围 + 新旧侧 + 代码片段 + 评论文字），由用户确认后随下一条消息提交
 */
export function commentsToRefs(comments: readonly CommentDraft[]): FileRef[] {
  return comments.map((c) => ({
    kind: 'file' as const,
    path: c.file,
    lineStart: c.lineStart,
    lineEnd: c.lineEnd,
    ...(c.side === undefined ? {} : { side: c.side }),
    ...(c.snippet === undefined || c.snippet === '' ? {} : { snippet: c.snippet }),
    ...(c.text === '' ? {} : { text: c.text }),
  }))
}
