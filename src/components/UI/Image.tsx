/**
 * Image — `<img>` com skeleton enquanto carrega + fallback visual em
 * erro. Usado em Feed (preview) e PostViewer (fullscreen).
 *
 * Por que existe: nostr.build serve via CDN mas com ocasionais latências
 * altas. Sem skeleton, layout pula quando a imagem chega — UX ruim em
 * mobile com conexão instável. Com skeleton, o espaço é reservado e o
 * conteúdo desliza suavemente.
 */

import { useState } from 'react'

export interface ImageProps {
  src: string
  alt?: string
  className?: string
  /** Aspect ratio CSS pra reservar espaço enquanto carrega. Ex: '16/9', '1/1'. Default: 'auto'. */
  aspect?: string
  /** Modo de ajuste — `contain` (default — preserva integralidade) ou `cover`. */
  fit?: 'contain' | 'cover'
  draggable?: boolean
  onLoad?: () => void
  onError?: () => void
}

export function Image({
  src,
  alt = '',
  className = '',
  aspect = 'auto',
  fit = 'contain',
  draggable = false,
  onLoad,
  onError,
}: ImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')

  return (
    <div
      className={`relative overflow-hidden bg-drift-surface/40 ${className}`}
      style={{ aspectRatio: aspect }}
    >
      {state === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-drift-surface to-drift-bg" />
      )}

      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-600">
          <span className="text-base">⊘</span>
          <span>imagem indisponível</span>
        </div>
      )}

      <img
        src={src}
        alt={alt}
        draggable={draggable}
        className={`h-full w-full transition-opacity duration-200 ${
          fit === 'cover' ? 'object-cover' : 'object-contain'
        } ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => {
          setState('loaded')
          onLoad?.()
        }}
        onError={() => {
          setState('error')
          onError?.()
        }}
      />
    </div>
  )
}
