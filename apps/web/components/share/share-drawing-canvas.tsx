'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Minus, Square, ArrowRight, RotateCcw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrawingTool = 'pen' | 'line' | 'rectangle' | 'arrow'

interface ShareDrawingCanvasProps {
  active: boolean
  onAnnotationChange?: (data: Record<string, unknown> | null) => void
  onExit?: () => void
  className?: string
}

const COLORS = ['#f43f5e', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#ffffff']

// ─── Canvas ───────────────────────────────────────────────────────────────────

export function ShareDrawingCanvas({ active, onAnnotationChange, onExit, className }: ShareDrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const [tool, setTool] = useState<DrawingTool>('pen')
  const [color, setColor] = useState('#f43f5e')
  const [ready, setReady] = useState(false)

  // Load Fabric.js lazily
  useEffect(() => {
    if (!active || !canvasRef.current || !containerRef.current) return
    let disposed = false

    async function init() {
      try {
        const { Canvas, PencilBrush } = await import('fabric')
        if (disposed || !canvasRef.current || !containerRef.current) return
        const w = containerRef.current.offsetWidth || 800
        const h = containerRef.current.offsetHeight || 450
        const fc = new Canvas(canvasRef.current, {
          isDrawingMode: true,
          selection: false,
          backgroundColor: 'transparent',
        })
        fc.setDimensions({ width: w, height: h })
        const brush = new PencilBrush(fc)
        brush.color = color
        brush.width = 3
        fc.freeDrawingBrush = brush
        fabricRef.current = fc

        // Export on every modification
        fc.on('object:added', () => {
          if (!disposed) onAnnotationChange?.({ ...fc.toJSON(), _canvasWidth: w, _canvasHeight: h })
        })

        setReady(true)
      } catch (e) {
        console.warn('Fabric.js failed to load', e)
      }
    }

    init()

    return () => {
      disposed = true
      try { fabricRef.current?.dispose() } catch {}
      fabricRef.current = null
      setReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Resize canvas with container
  useEffect(() => {
    if (!active || !containerRef.current || !fabricRef.current) return
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.offsetWidth || 800
      const h = containerRef.current?.offsetHeight || 450
      fabricRef.current?.setDimensions({ width: w, height: h })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [active, ready])

  // Update brush color + mode when tool/color changes
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    fc.freeDrawingBrush.color = color
  }, [color])

  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return

    if (tool === 'pen') {
      fc.isDrawingMode = true
    } else {
      // For shape tools, disable free drawing and handle manually
      fc.isDrawingMode = false
    }
  }, [tool])

  function handleUndo() {
    const fc = fabricRef.current
    if (!fc) return
    const objects = fc.getObjects()
    if (objects.length > 0) {
      fc.remove(objects[objects.length - 1])
      fc.renderAll()
      const json = fc.toJSON()
      onAnnotationChange?.((json as any).objects?.length ? { ...json } : null)
    }
  }

  function handleClear() {
    const fc = fabricRef.current
    if (!fc) return
    fc.clear()
    fc.renderAll()
    onAnnotationChange?.(null)
  }

  if (!active) return null

  return (
    <div ref={containerRef} className={cn('absolute inset-0 z-20', className)}>
      {/* Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ cursor: 'crosshair' }} />

      {/* Toolbar */}
      <div
        className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 px-3 py-2 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Exit */}
        <button onClick={onExit} className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors mr-2">
          <X className="h-4 w-4" /> <span className="text-xs">Done</span>
        </button>
        <div className="w-px h-5 bg-white/10 mr-2" />

        {/* Tools */}
        {([
          { id: 'pen', icon: Pencil, label: 'Pen' },
          { id: 'line', icon: Minus, label: 'Line' },
          { id: 'rectangle', icon: Square, label: 'Rectangle' },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={label}
            className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
              tool === id ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/10',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Colors */}
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cn('w-4 h-4 rounded-full border-2 transition-transform', color === c ? 'border-white scale-125' : 'border-transparent hover:scale-110')}
            style={{ backgroundColor: c }}
          />
        ))}

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Undo / Clear */}
        <button onClick={handleUndo} title="Undo" className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button onClick={handleClear} title="Clear" className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-white/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Read-only annotation overlay ─────────────────────────────────────────────

interface AnnotationViewProps {
  drawingData: Record<string, unknown> | null
  className?: string
}

export function ShareAnnotationView({ drawingData, className }: AnnotationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!drawingData || !canvasRef.current || !containerRef.current) return
    let fabricCanvas: any = null
    let disposed = false

    const rafId = requestAnimationFrame(async () => {
      if (disposed || !canvasRef.current || !containerRef.current) return
      try {
        const { Canvas } = await import('fabric')
        if (disposed) return
        const w = containerRef.current.offsetWidth || 800
        const h = containerRef.current.offsetHeight || 450
        fabricCanvas = new Canvas(canvasRef.current, { selection: false, interactive: false, skipTargetFind: true })
        fabricCanvas.setDimensions({ width: w, height: h })
        const origWidth = (drawingData._canvasWidth as number) || w
        const origHeight = (drawingData._canvasHeight as number) || h
        fabricCanvas.setViewportTransform([w / origWidth, 0, 0, h / origHeight, 0, 0])
        await fabricCanvas.loadFromJSON(drawingData)
        fabricCanvas.renderAll()
      } catch {}
    })

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      try { fabricCanvas?.dispose() } catch {}
    }
  }, [drawingData])

  if (!drawingData) return null

  return (
    <div ref={containerRef} className={cn('absolute inset-0 pointer-events-none', className)}>
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
