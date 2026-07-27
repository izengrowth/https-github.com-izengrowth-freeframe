'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareComment {
  id: string
  body: string
  guest_author?: { id: string; name: string; email: string } | null
  author?: { id: string; name: string } | null
  guest_name?: string | null
  created_at: string
  timecode_start?: number | null
  timecode_end?: number | null
  resolved?: boolean | null
}

interface ShareVideoPlayerProps {
  src: string
  comments?: ShareComment[]
  onTimeUpdate?: (time: number) => void
  onSeek?: (time: number) => void
  videoRef?: React.RefObject<HTMLVideoElement>
  focusedCommentId?: string | null
  onCommentMarkerClick?: (comment: ShareComment) => void
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_HEX_COLORS = [
  '#f97316', '#3b82f6', '#10b981', '#8b5cf6',
  '#f43f5e', '#f59e0b', '#06b6d4', '#ec4899',
]

function getAvatarHex(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_HEX_COLORS[Math.abs(hash) % AVATAR_HEX_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function formatVideoTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Comment Marker ──────────────────────────────────────────────────────────

interface MarkerProps {
  comment: ShareComment
  leftPercent: number
  isFocused: boolean
  onHover: () => void
  onLeave: () => void
  onClick: () => void
}

function CommentMarker({ comment, leftPercent, isFocused, onHover, onLeave, onClick }: MarkerProps) {
  const markerRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null)

  const authorName = comment.guest_author?.name || comment.author?.name || comment.guest_name || 'User'
  const initials = getInitials(authorName)
  const color = getAvatarHex(authorName)

  useEffect(() => {
    if (!isHovered || !markerRef.current) { setTooltipPos(null); return }
    const rect = markerRef.current.getBoundingClientRect()
    const tw = 220
    let left = rect.left + rect.width / 2 - tw / 2
    if (left < 8) left = 8
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw
    setTooltipPos({ left, top: rect.top - 8 })
  }, [isHovered])

  return (
    <div
      ref={markerRef}
      className="absolute top-0 -translate-x-1/2 cursor-pointer z-10"
      style={{ left: `${leftPercent}%` }}
      onMouseEnter={() => { setIsHovered(true); onHover() }}
      onMouseLeave={() => { setIsHovered(false); onLeave() }}
      onClick={onClick}
    >
      <div
        className={cn(
          'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-md border-2 transition-transform hover:scale-110',
          isFocused ? 'scale-125 border-white ring-2 ring-white/30' : 'border-black/30',
        )}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>

      {isHovered && tooltipPos && createPortal(
        <div
          style={{ position: 'fixed', left: tooltipPos.left, top: tooltipPos.top, width: 220, transform: 'translateY(-100%)', zIndex: 9999, pointerEvents: 'none' }}
        >
          <div className="bg-[#1a1a1f] border border-white/10 rounded-lg shadow-2xl p-3 mb-1">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: color }}>
                {initials}
              </div>
              <span className="text-xs font-medium text-white truncate">{authorName}</span>
              {comment.timecode_start != null && (
                <span className="ml-auto text-[10px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                  {formatVideoTime(comment.timecode_start)}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{comment.body}</p>
          </div>
          <div className="flex justify-center">
            <div className="w-2 h-2 bg-[#1a1a1f] border-b border-r border-white/10 rotate-45 -mt-1" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  currentTime: number
  duration: number
  comments: ShareComment[]
  focusedCommentId?: string | null
  onSeek: (time: number) => void
  onCommentMarkerClick: (comment: ShareComment) => void
}

function ShareProgressBar({ currentTime, duration, comments, focusedCommentId, onSeek, onCommentMarkerClick }: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null)

  const pct = (t: number) => !duration ? 0 : Math.max(0, Math.min(100, (t / duration) * 100))

  const getTimeAt = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track || !duration) return 0
    const rect = track.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
  }, [duration])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const t = getTimeAt(e.clientX)
    setHoverTime(t)
    const track = trackRef.current
    if (track) setHoverX(e.clientX - track.getBoundingClientRect().left)
    if (isDragging) onSeek(t)
  }, [isDragging, getTimeAt, onSeek])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
    onSeek(getTimeAt(e.clientX))
  }, [getTimeAt, onSeek])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => onSeek(getTimeAt(e.clientX))
    const onUp = (e: MouseEvent) => { setIsDragging(false); setHoverTime(null); onSeek(getTimeAt(e.clientX)) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isDragging, getTimeAt, onSeek])

  const pointMarkers = comments.filter(c => c.timecode_start != null && c.timecode_end == null && !c.resolved)
  const rangeMarkers = comments.filter(c => c.timecode_start != null && c.timecode_end != null && !c.resolved)
  const playPct = pct(currentTime)

  return (
    <div className="relative flex flex-col w-full group/progress py-1">
      {/* Track */}
      <div
        ref={trackRef}
        className="relative w-full h-1 group-hover/progress:h-1.5 transition-all duration-150 cursor-pointer bg-white/15 rounded-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { if (!isDragging) { setHoverTime(null) } }}
        onMouseDown={handleMouseDown}
      >
        {/* Range comment spans */}
        {rangeMarkers.map(c => {
          if (c.timecode_start == null || c.timecode_end == null) return null
          return (
            <div
              key={c.id}
              className="absolute inset-y-0 bg-amber-400/40 rounded-full pointer-events-none"
              style={{ left: `${pct(c.timecode_start)}%`, width: `${pct(c.timecode_end) - pct(c.timecode_start)}%` }}
            />
          )
        })}

        {/* Playback progress */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          style={{ width: `${playPct}%` }}
        />

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none z-10"
          style={{ left: `${playPct}%` }}
        />
      </div>

      {/* Comment avatar markers row */}
      {pointMarkers.length > 0 && (
        <div className="relative w-full h-6 mt-1">
          {pointMarkers.map(c => (
            <CommentMarker
              key={c.id}
              comment={c}
              leftPercent={pct(c.timecode_start!)}
              isFocused={focusedCommentId === c.id}
              onHover={() => setHoveredMarkerId(c.id)}
              onLeave={() => setHoveredMarkerId(null)}
              onClick={() => onCommentMarkerClick(c)}
            />
          ))}
        </div>
      )}

      {/* Hover time label */}
      {hoverTime !== null && (
        <div
          className="absolute -top-2 z-30 pointer-events-none"
          style={{ left: hoverX, transform: 'translateX(-50%) translateY(-100%)' }}
        >
          <div className="flex justify-center">
            <span className="bg-black/90 text-white text-[11px] font-mono px-2 py-0.5 rounded-md">
              {formatVideoTime(hoverTime)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Share Video Player ──────────────────────────────────────────────────

export function ShareVideoPlayer({
  src,
  comments = [],
  onTimeUpdate,
  onSeek: onSeekCallback,
  videoRef: externalVideoRef,
  focusedCommentId,
  onCommentMarkerClick,
}: ShareVideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const videoRef = externalVideoRef ?? internalRef
  const containerRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-hide controls
  function showControls() {
    setControlsVisible(true)
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    hideControlsTimer.current = setTimeout(() => {
      if (playing) setControlsVisible(false)
    }, 2500)
  }

  useEffect(() => () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) }, [])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  function handleSeek(time: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = time
    setCurrentTime(time)
    onSeekCallback?.(time)
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  function changeVolume(val: number) {
    const v = videoRef.current
    if (!v) return
    v.volume = val
    setVolume(val)
    if (val > 0 && v.muted) { v.muted = false; setMuted(false) }
  }

  function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative bg-black flex flex-col w-full h-full select-none"
      onMouseMove={showControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false) }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={src}
        className="flex-1 w-full h-full object-contain cursor-pointer"
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const v = videoRef.current
          if (!v) return
          setCurrentTime(v.currentTime)
          onTimeUpdate?.(v.currentTime)
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current
          if (!v) return
          setDuration(v.duration)
        }}
        onVolumeChange={() => {
          const v = videoRef.current
          if (!v) return
          setMuted(v.muted)
          setVolume(v.volume)
        }}
      />

      {/* Controls overlay */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 px-4 pb-3 pt-8 transition-opacity duration-300',
          'bg-gradient-to-t from-black/80 via-black/30 to-transparent',
          controlsVisible || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        {/* Progress bar + markers */}
        <ShareProgressBar
          currentTime={currentTime}
          duration={duration}
          comments={comments}
          focusedCommentId={focusedCommentId}
          onSeek={handleSeek}
          onCommentMarkerClick={(c) => onCommentMarkerClick?.(c)}
        />

        {/* Control buttons row */}
        <div className="flex items-center gap-3 mt-1">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white shrink-0"
          >
            {playing
              ? <Pause className="w-4 h-4 fill-white" />
              : <Play className="w-4 h-4 fill-white" />}
          </button>

          {/* Time display */}
          <span className="text-xs font-mono text-white/80 shrink-0">
            {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Volume */}
          <div className="flex items-center gap-1.5">
            <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
              {muted || volume === 0
                ? <VolumeX className="w-4 h-4" />
                : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              className="w-16 h-1 accent-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
            />
          </div>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
            {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Big play button in center when paused */}
      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center group/play"
        >
          <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover/play:bg-white/30 transition-colors">
            <Play className="w-8 h-8 fill-white text-white ml-1" />
          </div>
        </button>
      )}
    </div>
  )
}
