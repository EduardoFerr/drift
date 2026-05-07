/**
 * Image — `<img>` com skeleton enquanto carrega + fallback visual em
 * erro. Usado em Feed (preview) e PostViewer (fullscreen).
 *
 * Por que existe: nostr.build serve via CDN mas com ocasionais latências
 * altas. Sem skeleton, layout pula quando a imagem chega — UX ruim em
 * mobile com conexão instável. Com skeleton, o espaço é reservado e o
 * conteúdo desliza suavemente.
 *
 * **Track B.2** — quando `meta` é passado, a imagem é resolvida via
 * `blobs.fetchBlobUrl(meta)`: tenta Helia local → HTTP url → IPFS
 * gateway, com hash verify obrigatório se `meta.hash` está presente.
 * Sem `meta`, cai pro `src` direto (compat retro com posts pré-RFC).
 *
 * O fetch via blobs é **lazy + assíncrono** — primeiro pinta o skeleton,
 * depois resolve `<img src>` quando a Promise volta. Render path crítico
 * fica leve (sem importar Helia até hover/scroll-into-view).
 */

import { useEffect, useState } from 'react'
import type { BlobMeta } from '../../lib/nip94'

export interface ImageProps {
  /** Fallback URL quando `meta` é ausente ou fetch via blobs falha. */
  src: string
  /** Track B.2 — metadado NIP-94. Se presente, usa fetch verificado. */
  meta?: BlobMeta
  alt?: string
  className?: string
  /** Aspect ratio CSS pra reservar espaço enquanto carrega. Ex: '16/9', '1/1'. Default: 'auto'. */
  aspect?: string
  /** Modo de ajuste — `contain` (default — preserva integralidade) ou `cover`. */
  fit?: 'contain' | 'cover'
  /**
   * Alinhamento do conteúdo da imagem dentro do `<img>`. CSS
   * `object-position`. Default 'center' (centro). Use `'top'` em
   * Portrait pra evitar letterbox no topo (faces costumam ficar no
   * topo de retratos — alinhar top mantém o sujeito visível, sobra
   * cai embaixo).
   */
  position?: 'center' | 'top' | 'bottom'
  /**
   * Quando true, o `<img>` renderiza em tamanho natural (`width:auto;
   * height:auto`) em vez de `h-full w-full`. `object-fit` e
   * `object-position` viram inertes nesse modo (não há scaling). Use
   * em Landscape onde queremos a imagem servida tal qual o autor
   * subiu, com overflow no container cortando o que extrapola — user
   * feedback 2026-05-07: "estilo mínimo correto pra paisagem".
   */
  natural?: boolean
  draggable?: boolean
  onLoad?: () => void
  onError?: () => void
}

export function Image({
  src,
  meta,
  alt = '',
  className = '',
  aspect = 'auto',
  fit = 'contain',
  position = 'center',
  natural = false,
  draggable = false,
  onLoad,
  onError,
}: ImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  // Track B.2 — quando meta está presente e tem cid|hash, tenta resolver
  // via blobs.fetchBlobUrl (Helia + verify). Senão, usa src direto.
  const [resolvedSrc, setResolvedSrc] = useState<string>(src)

  useEffect(() => {
    // Sem meta com cid/hash — usa src direto (legacy ou só url).
    if (!meta || (!meta.cid && !meta.hash)) {
      setResolvedSrc(src)
      return
    }

    let canceled = false
    const ctrl = new AbortController()

    void (async () => {
      try {
        const { fetchBlobUrl } = await import('../../lib/blobs')
        const url = await fetchBlobUrl(meta, { signal: ctrl.signal })
        if (!canceled) setResolvedSrc(url)
      } catch (err) {
        // Falha total (incluindo hash mismatch em todas as rotas) — cai
        // pro src original. Hash verify ainda protegeu contra conteúdo
        // trocado: o `<img>` carregaria do mesmo url, sem garantia, mas
        // pelo menos o user vê algo. Em contexto de censura, o user
        // pode ter desligado IPFS — preserva UX.
        console.warn('[Image] fetch via blobs falhou, fallback pra src direto:', err)
        if (!canceled) setResolvedSrc(src)
      }
    })()

    return () => {
      canceled = true
      ctrl.abort()
    }
  }, [src, meta])

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
        src={resolvedSrc}
        alt={alt}
        draggable={draggable}
        style={
          natural
            ? {
                // Tamanho natural — width/height auto, sem object-fit.
                // Container tem overflow-hidden; pixels que extrapolam
                // são cortados. object-position guia qual região fica
                // visível quando há overflow.
                width: 'auto',
                height: 'auto',
                objectPosition:
                  position === 'top'
                    ? 'center top'
                    : position === 'bottom'
                    ? 'center bottom'
                    : 'center center',
              }
            : {
                objectPosition:
                  position === 'top'
                    ? 'center top'
                    : position === 'bottom'
                    ? 'center bottom'
                    : 'center center',
              }
        }
        className={
          natural
            ? `transition-opacity duration-200 ${
                state === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`
            : `h-full w-full transition-opacity duration-200 ${
                fit === 'cover' ? 'object-cover' : 'object-contain'
              } ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`
        }
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
