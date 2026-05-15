/**
 * SwipeHandler — gesto unificado pra Tela de Post fullscreen.
 *
 * Distingue eixo vertical vs horizontal e dispara callbacks separados:
 *   ↑ swipe up    → onSpread (espalha o post inteiro)
 *   ↓ swipe down  → onBury   (enterra o post inteiro)
 *   ← swipe left  → onNext   (próximo subpost)
 *   → swipe right → onPrev   (subpost anterior)
 *   tap           → onTap    (revela conteúdo blurred, fecha overlay etc.)
 *
 * Threshold de 80px no eixo dominante + velocidade > 200px/s pra evitar
 * gesto acidental. Eixo "dominante" é o de maior delta absoluto.
 *
 * Acessibilidade: também aceita teclado (setas + Enter) — sem gestos
 * é navegável.
 */

import { useEffect, useRef, useState } from 'react'
import {
  // `m` é o primitive leve do framer-motion (LazyMotion). drag é parte
  // de `domMax` provido em main.tsx; useMotionValue/useTransform/animate
  // são hooks puros (não-features-gated) e ficam.
  m,
  useMotionValue,
  useTransform,
  animate,
  type PanInfo,
} from 'framer-motion'

// Thresholds split por eixo (user pedido 2026-05-09: "aumente o limiar
// para o card sair e nao voltar magneticamente, está muito curto o
// raio do magnetismo" — sobre swipe vertical especificamente).
// Vertical commits a ação destrutiva (spread/bury → post avança no
// feed, ação irreversível visualmente), então merece raio magnético
// maior pro user "sentir" o compromisso. Horizontal é só nav reversível
// entre subposts — 80px continua confortável.
const SWIPE_THRESHOLD_PX_V = 160
const SWIPE_THRESHOLD_PX_H = 80
const SWIPE_VELOCITY_PXS = 200

export interface SwipeHandlerProps {
  onSpread?: () => void
  onBury?: () => void
  onPrev?: () => void
  onNext?: () => void
  /**
   * Disparado em tap (sem movimento). Assinatura aceita o evento do
   * Framer; consumidores podem inspecionar target se precisarem (ex.:
   * ignorar taps em children interativos). PostViewer V9.13 não usa
   * mais essa inspecção — tap-to-advance subpost foi removido em favor
   * de swipe horizontal puro.
   */
  onTap?: (event: MouseEvent | TouchEvent | PointerEvent) => void
  /**
   * Track C.4.2 — gesto vertical genérico, opt-in. Usado pelo ThreadView
   * onde ↑ = descend (filho) e ↓ = ascend (parent). Non-breaking: se
   * `onSpread`/`onBury` estiverem presentes, eles têm precedência (uso
   * atual do PostViewer não muda).
   */
  onUp?: () => void
  onDown?: () => void
  /** Desabilita gestos verticais (ex: post de só 1 subpost com gestos h opcionais). */
  disableVertical?: boolean
  /** Desabilita gestos horizontais (ex: post de 1 subpost — não há onde navegar). */
  disableHorizontal?: boolean
  children: React.ReactNode
}

export function SwipeHandler({
  onSpread,
  onBury,
  onPrev,
  onNext,
  onTap,
  onUp,
  onDown,
  disableVertical = false,
  disableHorizontal = false,
  children,
}: SwipeHandlerProps) {
  // Track C.4.2 — handlers verticais efetivos. onSpread/onBury (usados
  // pelo PostViewer) têm precedência; onUp/onDown são fallback opt-in
  // (ThreadView).
  const fireUp = onSpread ?? onUp
  const fireDown = onBury ?? onDown
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // V9.5 — rotação leve em função do drag horizontal. User pedido
  // 2026-05-09: "ao arrastar deve rotacionar levemente nas pontas,
  // como se imitasse o papel passando". Mapping linear x → rotate,
  // suprimido quando horizontal está desabilitado (single subpost).
  // Curva: [-160, 160] → [-5°, 5°]. Threshold de swipe (80px) cai em
  // ~2.5°, ainda discreto. Pivot default (center) é suficiente — pivô
  // bottom-center foi testado mas exagera o efeito a ponto de
  // distorcer a leitura do título superior do subpost.
  const rotate = useTransform(x, [-160, 0, 160], [5, 0, -5])

  // Feedback visual: borda vai mudando de cor conforme o gesto progride.
  // ↑ = verde (spread), ↓ = vermelho (bury), ← → = lilás (navegação).
  const borderColor = useTransform(
    [x, y] as never,
    ([latestX, latestY]: number[]) => {
      const ax = Math.abs(latestX!)
      const ay = Math.abs(latestY!)
      if (ay > ax && ay > 20 && !disableVertical) {
        return latestY! < 0
          ? `rgba(52, 211, 153, ${Math.min(0.8, ay / 200)})` // verde spread
          : `rgba(248, 113, 113, ${Math.min(0.8, ay / 200)})` // vermelho bury
      }
      if (ax > 20 && !disableHorizontal) {
        return `rgba(167, 139, 250, ${Math.min(0.8, ax / 200)})` // lilás nav
      }
      return 'rgba(31, 41, 55, 1)' // borda default
    },
  )

  const [hint, setHint] = useState<'spread' | 'bury' | 'next' | 'prev' | null>(
    null,
  )
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showHint(kind: NonNullable<typeof hint>) {
    setHint(kind)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(null), 600)
  }

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current)
    }
  }, [])

  function handleDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info
    const ax = Math.abs(offset.x)
    const ay = Math.abs(offset.y)
    const verticalDominant = ay > ax

    const verticalPassed =
      !disableVertical &&
      (ay > SWIPE_THRESHOLD_PX_V || Math.abs(velocity.y) > SWIPE_VELOCITY_PXS)
    const horizontalPassed =
      !disableHorizontal &&
      (ax > SWIPE_THRESHOLD_PX_H || Math.abs(velocity.x) > SWIPE_VELOCITY_PXS)

    function fireVertical() {
      if (offset.y < 0 && fireUp) {
        if (onSpread) showHint('spread')
        fireUp()
      } else if (offset.y > 0 && fireDown) {
        if (onBury) showHint('bury')
        fireDown()
      }
    }
    function fireHorizontal() {
      if (offset.x < 0 && onNext) {
        showHint('next')
        onNext()
      } else if (offset.x > 0 && onPrev) {
        showHint('prev')
        onPrev()
      }
    }

    // V9.27 (user report 2026-05-14: "o problema de arrastar pra um
    // lado e animação ir pro outro continua"):
    //
    // ROOT CAUSE DEEPER LEVEL — Framer Motion's drag tem seu PRÓPRIO
    // elastic snap-back interno que anima x/y → 0 em toda release,
    // independente de `dragMomentum: false` (que só desabilita inercia
    // de velocidade). x.set(0) NÃO cancela essa animação interna;
    // precisamos chamar x.stop() / y.stop() explicitamente.
    //
    // Sem stop(), no commit vertical: Framer animava y de -150 → 0
    // (pra BAIXO) ao mesmo tempo que o Wrapper exit animava y de 0 →
    // -110% (pra CIMA). Resultado visual nos primeiros 100-150ms: card
    // bouncia pra baixo (snap interno mais rápido que o exit) antes de
    // voar pra cima — exatamente a ilusão de "foi pro lado errado".
    //
    // Fix:
    //   - Commit (vertical ou horizontal): x.stop() + y.stop() pra
    //     cancelar Framer drag snap. Vertical deixa motion values onde
    //     estão (Wrapper exit toma conta). Horizontal seta 0 (próximo
    //     subpost renderiza centralizado).
    //   - Sem commit: animate() com spring magnético — Framer
    //     internamente substitui sua animação pela nossa.
    const spring = { type: 'spring' as const, stiffness: 500, damping: 38 }

    // V9.30 (user report 2026-05-15: "card não completa movimento de
    // sair, e o card que entra deveria emergir suavemente"). Horizontal
    // commit antes fazia x.set(0) instantâneo → o tree saltava de
    // -150 (drag end) pra 0 num frame, ANTES do SubpostCarousel iniciar
    // suas variants de slide. Sensação de "snap brusco antes do swap".
    //
    // Agora horizontal commit usa animate(x, 0, ease-out-quart 320ms)
    // — duração casa com slideVariants do carousel. SwipeHandler volta
    // ao centro suavemente enquanto o carousel desliza old→out + new→in
    // em paralelo. Cada camada tem seu papel sem brigar.
    //
    // Vertical commit fica intocado (x.stop()/y.stop() sem animate):
    // Wrapper exit translateY 0→±110% toma conta do visual. Mexer
    // aqui re-introduziria a regressão V9.27 ("vai pro lado oposto").
    const swapEase = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }

    if (verticalPassed && horizontalPassed) {
      // Ambos passaram — dominante decide
      if (verticalDominant) {
        x.stop()
        y.stop()
        fireVertical()
      } else {
        x.stop()
        y.stop()
        animate(x, 0, swapEase)
        y.set(0)
        fireHorizontal()
      }
    } else if (verticalPassed) {
      x.stop()
      y.stop()
      fireVertical()
    } else if (horizontalPassed) {
      x.stop()
      y.stop()
      animate(x, 0, swapEase)
      y.set(0)
      fireHorizontal()
    } else {
      // Desistiu: spring back magnético. animate() substitui qualquer
      // animação Framer-interna em curso pelos nossos valores.
      animate(x, 0, spring)
      animate(y, 0, spring)
    }
  }

  // Suporte a teclado — acessibilidade básica.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Não interferir em inputs.
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
      ) {
        return
      }
      switch (e.key) {
        case 'ArrowUp':
        case 'k':
        case 'K':
          if (!disableVertical && fireUp) {
            e.preventDefault()
            if (onSpread) showHint('spread')
            fireUp()
          }
          break
        case 'ArrowDown':
        case 'j':
        case 'J':
          if (!disableVertical && fireDown) {
            e.preventDefault()
            if (onBury) showHint('bury')
            fireDown()
          }
          break
        case 'ArrowLeft':
        case 'h':
        case 'H':
          if (!disableHorizontal && onPrev) {
            e.preventDefault()
            showHint('prev')
            onPrev()
          }
          break
        case 'ArrowRight':
        case 'l':
        case 'L':
          if (!disableHorizontal && onNext) {
            e.preventDefault()
            showHint('next')
            onNext()
          }
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    onSpread,
    onBury,
    onPrev,
    onNext,
    fireUp,
    fireDown,
    disableVertical,
    disableHorizontal,
  ])

  return (
    <m.div
      className="relative h-full w-full touch-none select-none rounded border-2"
      style={{
        x,
        y,
        borderColor,
        // Rotação só vale quando horizontal nav é possível. Sem isso,
        // single-subpost post ainda rota com pequenos deslocamentos
        // verticais → sensação esquisita.
        ...(disableHorizontal ? {} : { rotate }),
      }}
      drag
      dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
      dragElastic={0.6}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      onTap={onTap}
    >
      {children}

      {/* Overlay de feedback do gesto — badges estilizados (V3.5).
          - i-drift (top-left): bg drift-accent, color drift-bg, Syne 800, rotate -5deg
          - i-sink (top-right): border 2px #ff4f4f, color #ff4f4f, rotate 5deg
          - i-sub (center): border 2px drift-accent2, color drift-accent2 (horizontal nav)
          Opacity já gerenciado por show/hide via timer (600ms) — efeito visual puro. */}
      {hint && (
        <div
          className={`pointer-events-none absolute ${hintPosition(hint)}`}
          aria-hidden="true"
        >
          <div className={hintClasses(hint)}>{hintLabel(hint)}</div>
        </div>
      )}
    </m.div>
  )
}

type HintKind = 'spread' | 'bury' | 'next' | 'prev'

function hintLabel(h: HintKind): string {
  switch (h) {
    case 'spread':
      return '↑ DRIFT'
    case 'bury':
      return '↓ SINK'
    case 'next':
      return '→ SUB'
    case 'prev':
      return '← SUB'
  }
}

function hintPosition(h: HintKind): string {
  switch (h) {
    case 'spread':
      return 'left-4 top-4'
    case 'bury':
      return 'right-4 top-4'
    case 'next':
    case 'prev':
      return 'inset-0 flex items-center justify-center'
  }
}

function hintClasses(h: HintKind): string {
  // Comum: font-display Syne 800 uppercase tracking-widest, padding 5px 12px
  const base =
    'font-display text-base font-extrabold uppercase tracking-widest px-3 py-[5px] rounded-sm'
  switch (h) {
    case 'spread':
      return `${base} bg-drift-accent text-drift-bg -rotate-[5deg]`
    case 'bury':
      return `${base} border-2 border-[#ff4f4f] text-[#ff4f4f] rotate-[5deg]`
    case 'next':
    case 'prev':
      return `${base} border-2 border-drift-accent2 text-drift-accent2`
  }
}
