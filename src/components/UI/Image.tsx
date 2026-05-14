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

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { BlobMeta } from '../../lib/nip94'
import {
  lightboxBackdropVariants,
  lightboxImageVariants,
} from '../../lib/motion-variants'

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
  /**
   * Quando true, tap/click abre lightbox fullscreen com imagem limpa
   * (sobre backdrop preto, click-out / ESC fecha). User feedback
   * 2026-05-08: "deve haver um jeito de abrir e fechar a imagem em
   * primeiro plano". Use em PostViewer/CommentCard onde imagem é
   * conteúdo (não só decorativa).
   */
  lightbox?: boolean
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
  lightbox = false,
  onLoad,
  onError,
}: ImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // User pedido 2026-05-09 (v9.3): voltar pra double-click. Razões:
  // - Single-click conflitava com swipe quando user tinha intenção de
  //   navegar mas o toque era curto demais.
  // - Padrão Instagram/Twitter: tap navega/like, doubleclick zoom.
  // Implementação: counter via onClick (2 cliques < 400ms / < 40px de
  // distância). Mobile-friendly — onClick em touch fires depois do
  // browser classificar como tap (Framer drag detect já filtra swipes).
  // touch-action:none no wrapper garante que tap fires no JS.
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const DOUBLE_TAP_MS = 400
  const DOUBLE_TAP_SLOP_PX = 40
  // Track B.2 — quando meta está presente e tem cid|hash, tenta resolver
  // via blobs.fetchBlobUrl (Helia + verify). Senão, usa src direto.
  const [resolvedSrc, setResolvedSrc] = useState<string>(src)

  // Stable refs pra useEffect deps — meta é object, recriado a cada
  // refresh do feed (rowToPost sempre cria novo subpost). Sem isso,
  // useEffect re-roda a cada render → fetchBlobUrl loop.
  // User diagnóstico 2026-05-08 confirmou: re-fetch infinito vinha
  // daqui. Comparar por `meta.cid`/`meta.hash` resolve — referência
  // do object pode mudar mas chaves estáveis não.
  const metaCid = meta?.cid
  const metaHash = meta?.hash

  useEffect(() => {
    // Sem meta com cid/hash — usa src direto (legacy ou só url).
    if (!metaCid && !metaHash) {
      setResolvedSrc(src)
      return
    }

    // Reconstrói meta minimal a partir das chaves estáveis pra
    // passar a fetchBlobUrl. Mime/size/dim viriam do object original
    // mas só cid/hash são necessárias pro fetch (mime usado na
    // construção do Blob, default ok).
    const stableMeta = { cid: metaCid, hash: metaHash, mime: meta?.mime }
    let canceled = false
    const ctrl = new AbortController()

    void (async () => {
      try {
        const { fetchBlobUrl } = await import('../../lib/blobs')
        const url = await fetchBlobUrl(stableMeta, { signal: ctrl.signal })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, metaCid, metaHash])

  // ESC fecha lightbox quando aberta.
  useEffect(() => {
    if (!lightboxOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen])

  const isInteractive = lightbox && state === 'loaded'
  const Wrapper = isInteractive ? 'button' : 'div'
  const wrapperProps = isInteractive
    ? {
        type: 'button' as const,
        onClick: (e: React.MouseEvent) => {
          const now = performance.now()
          const last = lastTapRef.current
          if (
            last &&
            now - last.t <= DOUBLE_TAP_MS &&
            Math.abs(e.clientX - last.x) <= DOUBLE_TAP_SLOP_PX &&
            Math.abs(e.clientY - last.y) <= DOUBLE_TAP_SLOP_PX
          ) {
            lastTapRef.current = null
            e.preventDefault()
            e.stopPropagation()
            setLightboxOpen(true)
            return
          }
          lastTapRef.current = { t: now, x: e.clientX, y: e.clientY }
        },
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setLightboxOpen(true)
          }
        },
        'aria-label': alt
          ? `abrir imagem em primeiro plano: ${alt} (toque duplo)`
          : 'abrir imagem em primeiro plano (toque duplo)',
        title: 'toque duplo pra abrir',
        // V9.17 — long-press 5s (em PostViewer) NÃO deve disparar
        // moderação quando o press é sobre a imagem. data-no-longpress
        // é o opt-out explícito que PostViewer.handleCardPointerDown
        // checa via target.closest('[data-no-longpress]'). Belt-and-
        // suspenders sobre closest('button') que já deveria filtrar.
        'data-no-longpress': 'true',
        // touch-action: 'none' delega TUDO pro JS — necessário pra
        // que o Framer drag do SwipeHandler pai veja os movimentos
        // de pan iniciados sobre a imagem. Com 'manipulation' o
        // browser intercepta pan nativo, virando no-op (sem scroll
        // horizontal na página) e Framer drag morre na área da
        // imagem. User report 2026-05-09: "navegar pra direita ou
        // esquerda está bugado entre os subposts". React onClick
        // continua disparando em taps (lightbox); Framer drag agora
        // captura swipes (subpost nav + spread/bury).
        style: { aspectRatio: aspect, touchAction: 'none' },
        className: `relative block w-full overflow-hidden bg-drift-surface/40 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 ${className}`,
      }
    : {
        style: { aspectRatio: aspect },
        className: `relative overflow-hidden bg-drift-surface/40 ${className}`,
      }

  return (
    <>
    <Wrapper {...wrapperProps}>
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
    </Wrapper>

    {/* Lightbox fullscreen — backdrop preto, imagem centralizada limpa,
        click-out / ESC / botão X fecham. Usa portal-like fixed inset-0
        com z alto pra ficar acima de tudo (incluindo NavBar fixed).
        Round 4 Fase B (B4): fade-in tokenizado (motion-fast backdrop +
        motion-base image scale) substitui o "pop" abrupto que existia
        antes (UX hostil — RFC §2.1 P1). Reduced motion respeitado
        via factories. */}
    <LightboxOverlay
      open={lightboxOpen}
      src={resolvedSrc}
      alt={alt ?? ''}
      onClose={() => setLightboxOpen(false)}
    />
    </>
  )
}

// ─── LightboxOverlay (Round 4 Fase B B4) ─────────────────────────────

/**
 * Lightbox fullscreen com fade tokenizado. Substitui o pop abrupto
 * pre-Round 4. Backdrop em motion-fast, imagem em motion-base com
 * scale sutil (0.92 → 1) — preserva sense of "imagem subindo pra
 * frente" sem ser flashy.
 */
function LightboxOverlay({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean
  src: string
  alt: string
  onClose: () => void
}) {
  const reduced = useReducedMotion() ?? false
  const backdrop = lightboxBackdropVariants(reduced)
  const image = lightboxImageVariants(reduced)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={alt ? `imagem em primeiro plano: ${alt}` : 'imagem em primeiro plano'}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 cursor-zoom-out"
        >
          <motion.img
            {...image}
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain cursor-default select-none"
            draggable={false}
          />
          <button
            onClick={onClose}
            aria-label="fechar"
            title="fechar (ESC)"
            className="absolute right-4 top-4 rounded-full border border-drift-accent bg-black/40 p-2 text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
