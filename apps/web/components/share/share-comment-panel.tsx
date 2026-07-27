'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Clock, MessageSquare, ChevronDown, ChevronRight,
  Send, Loader2, Smile, Pencil, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SharePermission } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareCommentItem {
  id: string
  body: string
  parent_id?: string | null
  guest_author?: { id: string; name: string; email: string } | null
  author?: { id: string; name: string } | null
  guest_name?: string | null
  created_at: string
  timecode_start?: number | null
  timecode_end?: number | null
  resolved?: boolean | null
  annotation?: { drawing_data?: Record<string, unknown> } | null
  replies?: ShareCommentItem[]
}

interface ShareCommentPanelProps {
  token: string
  permission: SharePermission
  currentTime?: number
  focusedCommentId?: string | null
  onSeek?: (seconds: number) => void
  onFocusComment?: (id: string | null) => void
  onAnnotationData?: (data: Record<string, unknown> | null) => void
  onCommentPosted?: () => void
  refreshKey?: number
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_CLASSES = [
  'bg-orange-500', 'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
  'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-pink-500',
]

function getAvatarClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_CLASSES[Math.abs(hash) % AVATAR_CLASSES.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Identity storage ─────────────────────────────────────────────────────────

interface Identity { name: string; email: string }
const IDENTITY_KEY = 'freeframe_guest_identity'

function loadIdentity(): Identity | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null') } catch { return null }
}
function saveIdentity(i: Identity) {
  if (typeof window === 'undefined') return
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(i))
}
function clearIdentity() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(IDENTITY_KEY)
}

// ─── Identity form ────────────────────────────────────────────────────────────

function IdentityForm({ onDone }: { onDone: (i: Identity) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setErr('Both fields required'); return }
    if (!/\S+@\S+\.\S+/.test(email.trim())) { setErr('Invalid email'); return }
    const id = { name: name.trim(), email: email.trim() }
    saveIdentity(id)
    onDone(id)
  }

  return (
    <div className="border-t border-white/[0.06] px-4 py-4">
      <p className="text-xs font-medium text-zinc-300 mb-3">Who are you?</p>
      <form onSubmit={submit} className="space-y-2">
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Your name" required
          className="flex h-8 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com" required
          className="flex h-8 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button type="submit" className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-1.5 font-medium transition-colors">
          Continue
        </button>
      </form>
    </div>
  )
}

// ─── Inline Reply Input ───────────────────────────────────────────────────────

interface ReplyInputProps {
  token: string
  parentId: string
  identity: Identity
  currentTime?: number
  onPosted: () => void
  onCancel: () => void
}

function InlineReplyInput({ token, parentId, identity, currentTime, onPosted, onCancel }: ReplyInputProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  async function submit() {
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`${API_URL}/share/${token}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          guest_email: identity.email,
          guest_name: identity.name,
          parent_id: parentId,
          timecode_start: currentTime != null && currentTime > 0 ? Math.floor(currentTime) : null,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setBody('')
      onPosted()
    } catch { setErr('Failed to post reply') } finally { setSubmitting(false) }
  }

  return (
    <div className="mt-2 ml-9 border-l-2 border-white/10 pl-3">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } if (e.key === 'Escape') onCancel() }}
        placeholder="Reply…"
        rows={2}
        disabled={submitting}
        className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 min-h-[56px]"
      />
      {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
      <div className="flex items-center justify-end gap-2 mt-1.5">
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
        <button
          onClick={submit}
          disabled={!body.trim() || submitting}
          className="flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs px-3 py-1.5 font-medium transition-colors"
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Reply
        </button>
      </div>
    </div>
  )
}

// ─── Comment Card ─────────────────────────────────────────────────────────────

interface CommentCardProps {
  comment: ShareCommentItem
  index: number
  token: string
  identity: Identity | null
  currentTime?: number
  isFocused: boolean
  canComment: boolean
  onSeek?: (s: number) => void
  onFocus?: (id: string) => void
  onPosted: () => void
  onAnnotationView?: (data: Record<string, unknown> | null) => void
}

function CommentCard({
  comment, index, token, identity, currentTime,
  isFocused, canComment, onSeek, onFocus, onPosted, onAnnotationView,
}: CommentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [repliesOpen, setRepliesOpen] = useState(true)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  const displayName = comment.guest_author?.name || comment.author?.name || comment.guest_name || 'Anonymous'
  const initials = getInitials(displayName)
  const avatarClass = getAvatarClass(displayName)

  // Scroll into view when focused
  useEffect(() => {
    if (isFocused) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [isFocused])

  const hasTimecode = comment.timecode_start != null
  const hasRangeTimecode = comment.timecode_end != null
  const hasAnnotation = !!comment.annotation?.drawing_data
  const replies = comment.replies ?? []

  return (
    <div
      ref={cardRef}
      className={cn(
        'group rounded-lg border px-3 py-2.5 transition-all cursor-pointer',
        isFocused
          ? 'bg-indigo-500/10 border-indigo-500/40'
          : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]',
      )}
      onClick={() => {
        onFocus?.(comment.id)
        if (comment.timecode_start != null) onSeek?.(comment.timecode_start)
        if (hasAnnotation) onAnnotationView?.(comment.annotation!.drawing_data ?? null)
        else onAnnotationView?.(null)
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className={cn('h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5', avatarClass)}>
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + meta row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-zinc-100">{displayName}</span>
            <span className="text-[10px] text-zinc-500">{formatRelativeTime(comment.created_at)}</span>
            <span className="text-[10px] text-zinc-600 ml-auto">#{index + 1}</span>
          </div>

          {/* Timecode + annotation badge */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {hasTimecode && (
              <button
                onClick={e => { e.stopPropagation(); onSeek?.(comment.timecode_start!) }}
                className="flex items-center gap-1 text-[11px] font-mono text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/25 px-1.5 py-0.5 rounded transition-colors"
              >
                <Clock className="h-2.5 w-2.5" />
                {formatTimecode(comment.timecode_start!)}
                {hasRangeTimecode && (
                  <> – {formatTimecode(comment.timecode_end!)}</>
                )}
              </button>
            )}
            {hasAnnotation && (
              <button
                onClick={e => { e.stopPropagation(); onAnnotationView?.(comment.annotation!.drawing_data ?? null) }}
                className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-1.5 py-0.5 rounded transition-colors"
              >
                <Pencil className="h-2.5 w-2.5" />
                Annotation
              </button>
            )}
          </div>

          {/* Body */}
          <p className="text-sm text-zinc-300 leading-relaxed mt-1.5 break-words">{comment.body}</p>
        </div>
      </div>

      {/* Replies + reply button */}
      {(replies.length > 0 || canComment) && (
        <div className="mt-2 ml-9" onClick={e => e.stopPropagation()}>
          {/* Replies toggle */}
          {replies.length > 0 && (
            <button
              onClick={() => setRepliesOpen(o => !o)}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors mb-1"
            >
              {repliesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </button>
          )}

          {/* Nested replies */}
          {repliesOpen && replies.length > 0 && (
            <div className="border-l-2 border-white/10 pl-3 space-y-2 mb-2">
              {replies.map(reply => {
                const rName = reply.guest_author?.name || reply.author?.name || reply.guest_name || 'Anonymous'
                return (
                  <div key={reply.id} className="flex items-start gap-2">
                    <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5', getAvatarClass(rName))}>
                      {getInitials(rName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-200">{rName}</span>
                        <span className="text-[10px] text-zinc-600">{formatRelativeTime(reply.created_at)}</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed mt-0.5 break-words">{reply.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Reply button / inline reply input */}
          {canComment && (
            replyingTo === comment.id
              ? identity
                ? <InlineReplyInput token={token} parentId={comment.id} identity={identity} currentTime={currentTime} onPosted={() => { setReplyingTo(null); onPosted() }} onCancel={() => setReplyingTo(null)} />
                : null
              : <button onClick={() => setReplyingTo(comment.id)} className="text-[11px] text-zinc-500 hover:text-indigo-400 transition-colors mt-0.5">Reply</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Comment Input ───────────────────────────────────────────────────────

interface MainCommentInputProps {
  token: string
  identity: Identity | null
  currentTime?: number
  onIdentified: (i: Identity) => void
  onChangeIdentity: () => void
  onPosted: () => void
}

function MainCommentInput({ token, identity, currentTime, onIdentified, onChangeIdentity, onPosted }: MainCommentInputProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!identity) return <IdentityForm onDone={onIdentified} />

  async function submit() {
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`${API_URL}/share/${token}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          guest_email: identity!.email,
          guest_name: identity!.name,
          timecode_start: currentTime != null && currentTime > 0 ? Math.floor(currentTime) : null,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setBody('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      onPosted()
    } catch { setErr('Failed to post') } finally { setSubmitting(false) }
  }

  return (
    <div className="border-t border-white/[0.06] px-3 py-3 space-y-2">
      {/* Timecode bar */}
      {currentTime != null && currentTime > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-xs font-mono text-amber-400">
            <Clock className="h-3 w-3" />
            {String(Math.floor(currentTime / 3600)).padStart(2, '0')}:
            {String(Math.floor((currentTime % 3600) / 60)).padStart(2, '0')}:
            {String(Math.floor(currentTime % 60)).padStart(2, '0')}
          </div>
          <span className="text-[10px] text-zinc-500">Comment will be pinned to this time</span>
        </div>
      )}

      {/* Identity bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white', getAvatarClass(identity.name))}>
            {getInitials(identity.name)}
          </div>
          <span className="text-[11px] text-zinc-400">
            Commenting as <span className="text-zinc-200 font-medium">{identity.name}</span>
          </span>
        </div>
        <button onClick={onChangeIdentity} className="flex items-center gap-0.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
          <X className="h-3 w-3" /> Change
        </button>
      </div>

      {/* Textarea */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder="Leave a comment… (⌘+Enter to submit)"
        rows={3}
        disabled={submitting}
        className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 min-h-[72px]"
      />

      {err && <p className="text-xs text-red-400">{err}</p>}
      {success && <p className="text-xs text-emerald-400">Comment posted!</p>}

      <div className="flex items-center justify-end">
        <button
          onClick={submit}
          disabled={!body.trim() || submitting}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 font-medium transition-colors"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Comment
        </button>
      </div>
    </div>
  )
}

// ─── Share Comment Panel ──────────────────────────────────────────────────────

export function ShareCommentPanel({
  token,
  permission,
  currentTime,
  focusedCommentId,
  onSeek,
  onFocusComment,
  onAnnotationData,
  onCommentPosted,
  refreshKey = 0,
}: ShareCommentPanelProps) {
  const [comments, setComments] = useState<ShareCommentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [identity, setIdentity] = useState<Identity | null>(null)

  // Load identity from localStorage on mount
  useEffect(() => { setIdentity(loadIdentity()) }, [])

  // Fetch comments
  useEffect(() => {
    setLoading(true)
    fetch(`${API_URL}/share/${token}/comments`)
      .then(r => r.ok ? r.json() : Promise.resolve([]))
      .then((data: ShareCommentItem[]) => {
        // Build tree: attach replies to their parent
        const topLevel = data.filter(c => !c.parent_id)
        const byParent = new Map<string, ShareCommentItem[]>()
        data.filter(c => c.parent_id).forEach(c => {
          const arr = byParent.get(c.parent_id!) ?? []
          arr.push(c)
          byParent.set(c.parent_id!, arr)
        })
        topLevel.forEach(c => { c.replies = byParent.get(c.id) ?? [] })
        setComments(topLevel)
      })
      .catch(() => setComments([]))
      .finally(() => setLoading(false))
  }, [token, refreshKey])

  const canComment = permission === 'comment' || permission === 'approve'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-200">Comments</span>
          {comments.length > 0 && (
            <span className="text-[10px] text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded-full">{comments.length}</span>
          )}
        </div>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <MessageSquare className="h-5 w-5 text-zinc-600" />
            </div>
            <p className="text-sm font-medium text-zinc-400">No comments yet</p>
            {canComment && <p className="text-xs text-zinc-600 mt-1">Be the first to leave feedback.</p>}
          </div>
        ) : (
          comments.map((comment, i) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              index={i}
              token={token}
              identity={identity}
              currentTime={currentTime}
              isFocused={focusedCommentId === comment.id}
              canComment={canComment}
              onSeek={onSeek}
              onFocus={onFocusComment}
              onPosted={() => { onCommentPosted?.(); setLoading(true); fetch(`${API_URL}/share/${token}/comments`).then(r => r.ok ? r.json() : []).then((d: ShareCommentItem[]) => { const top = d.filter(c => !c.parent_id); const byP = new Map<string, ShareCommentItem[]>(); d.filter(c => c.parent_id).forEach(c => { const a = byP.get(c.parent_id!) ?? []; a.push(c); byP.set(c.parent_id!, a) }); top.forEach(c => { c.replies = byP.get(c.id) ?? [] }); setComments(top) }).catch(() => {}).finally(() => setLoading(false)) }}
              onAnnotationView={onAnnotationData}
            />
          ))
        )}
      </div>

      {/* Comment input */}
      {canComment && (
        <MainCommentInput
          token={token}
          identity={identity}
          currentTime={currentTime}
          onIdentified={i => setIdentity(i)}
          onChangeIdentity={() => { clearIdentity(); setIdentity(null) }}
          onPosted={() => { onCommentPosted?.() }}
        />
      )}
    </div>
  )
}
