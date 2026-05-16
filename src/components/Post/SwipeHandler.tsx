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
 * Threshold de 80/160px no eixo dominante + velocidade > 200px/s pra
 * evitar gesto acidental. Eixo "dominante" é o de maior delta absoluto.
 *
 * Acessibilidade: também aceita teclado (setas + Enter) — sem gestos
 * é navegável.
 *
 * ─────────────────────────────────────────────────────────────────────
 * V10 — sem Framer drag (perf round 11)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Versões anteriores (V9.27 / V9.30) usavam `<m.div drag …>` do
 * framer-motion. Isso forçava o LazyMotion do app a carregar `domMax`
 * (~143 KB gzip 48 KB) só pelo feature `drag`. Trocamos por pointer
 * events nativos + spring/easing via RAF — comportamento idêntico,
 * sem dependência de feature `drag`. Permite reduzir o LazyMotion pra
 * `domAnimation` quando o FeedTabs também perder seu `layoutId`
 * (coordenação com Marshall).
 *
 * Comportamentos preservados bit-a-bit:
 *   - Threshold split por eixo (160 vert / 80 horiz) + velocidade 200 px/s
 *   - Tilt leve no horizontal (-5°..+5°) — suprimido se nav h desabilitado
 *   - Border-color reage ao gesto (verde spread / vermelho bury / lilás nav)
 *   - Spring magnético quando NÃO comita (stiffness 500, damping 38)
 *   - Horizontal commit: animate x→0 em ease-out-quart 320ms (casa com
 *     slideVariants do SubpostCarousel — V9.30)
 *   - Vertical commit: SEM animação interna; Wrapper exit translateY
 *     ±110% no PostViewer toma conta (V9.27 — sem isso, surge a
 *     ilusão de "bouncing pro lado errado")
 *   - Reduced motion: spring/ease colapsam pra snap instantâneo
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
// `useReducedMotion` é hook puro do core do framer-motion (não vem
// gated por features), então mantemos. Removido: m, useMotionValue,
// useTransform, animate, PanInfo — não há mais dependência do `drag`
// feature de domMax.
import { useReducedMotion } from 'framer-motion'

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

// Tap detection: gesto rápido com deslocamento curto vira tap.
const TAP_MAX_DISTANCE_PX = 8
const TAP_MAX_DURATION_MS = 350

// Janela de velocidade: medimos delta entre os 2 últimos samples.
// 80ms ≈ 5 frames @ 60fps — ruído de jitter no final do gesto fica
// fora; deslocamento real de release fica dentro.
const VELOCITY_SAMPLE_MS = 80

// Curva ease-out-quart 320ms — casa exatamente com swapEase da V9.30
// (mesmos coeficientes que `[0.22, 1, 0.36, 1]` em framer).
const SWAP_EASE_DURATION_MS = 320
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

// Elasticity 0.6 — mesma constante do Framer `dragElastic={0.6}` que V9.x
// usava com constraints zeradas. Linear é a aproximação que Framer
// internamente também usava nesse cenário (constraints {0,0,0,0} colapsa
// a rubber-band em multiplicação simples). Rubber-band complexo só vale
// quando há constraint real (top/bottom finitos).
const ELASTICITY = 0.6

// Spring tuning V9.27 — stiffness 500 / damping 38 (subcritico, com
// pouco overshoot). Implementação semi-implícita de Euler com dt
// fixado em ms reais; estável até ~16ms/frame.
const SPRING_STIFFNESS = 500
const SPRING_DAMPING = 38
const SPRING_REST_VELOCITY = 0.5 // px/s — abaixo disso considera parado
const SPRING_REST_DELTA = 0.5 // px — abaixo disso considera no zero

export interface SwipeHandlerProps {
  onSpread?: () => void
  onBury?: () => void
  onPrev?: () => void
  onNext?: () => void
  /**
   * Disparado em tap (sem movimento). Recebe o PointerEvent nativo.
   * Consumidores podem inspecionar `target` se precisarem (ex.: ignorar
   * taps em children interativos). PostViewer V9.13 não usa mais essa
   * inspecção — tap-to-advance subpost foi removido em favor de swipe
   * horizontal puro.
   */
  onTap?: (event: PointerEvent) => void
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

type HintKind = 'spread' | 'bury' | 'next' | 'prev'

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

  const reducedMotion = useReducedMotion() ?? false

  const elRef = useRef<HTMLDivElement | null>(null)

  // Estado de gesto em refs (não dispara re-render por sample) — só o
  // DOM transform muda durante o drag. Imitamos useMotionValue da V9.x.
  const xRef = useRef(0)
  const yRef = useRef(0)

  // Pointer ativo + amostras pra cálculo de velocidade no release.
  const activePointerRef = useRef<number | null>(null)
  // startX/Y ÂNCORA: compensam offset atual de xRef/yRef pra continuação
  // contínua mid-animation. Usado em pointermove pra delta = clientX -
  // startX, virando xRef = delta * ELASTICITY (extensão contínua).
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  // startXRaw/YRaw: posição ABSOLUTA do pointer no down. Usado SÓ pra
  // tap detection (dist = hypot(clientX - startXRaw, ...)). Independente
  // de xRef offset — tap real é "finger essentially stayed put no chão".
  const startXRawRef = useRef(0)
  const startYRawRef = useRef(0)
  const startTimeRef = useRef(0)
  // Histórico curto de samples: [{ t, x, y }]. Usamos só os últimos
  // dentro de VELOCITY_SAMPLE_MS pra estimar velocidade no release.
  const samplesRef = useRef<{ t: number; x: number; y: number }[]>([])

  // RAF handle pra animações de release (spring back ou swap ease).
  // Cancelado se um novo gesto começa — comportamento equivalente ao
  // `x.stop()` da Framer (V9.27).
  const rafRef = useRef<number | null>(null)

  // V10.2 — Suprime o click "fantasma" que o browser dispara DEPOIS de
  // pointerup, mesmo quando capturamos o ponteiro. iOS/Chrome dispara
  // click no target original (a `<img>` lightbox, dots, "ver mais"
  // button) ainda que SwipeHandler tenha capturado o ponteiro. Sem
  // este flag, cada swipe horizontal fazia o `lastTapRef` da Image
  // somar um tap; dois swipes em <400ms acionavam o double-tap →
  // lightbox abria durante navegação. User report 2026-05-15: "swipe
  // ficou bagunçado novamente". V9.13 já removeu tap-to-advance em
  // PostViewer pela mesma razão, mas a fuga vivia em children
  // interativos abaixo do SwipeHandler.
  //
  // V10.3 — Trocado boolean+setTimeout por timestamp pra resolver race
  // condition: swipe-em-sequência onde o timer do primeiro reseta o flag
  // do segundo antes do click vir. Janela de 200ms cobre tanto Chrome
  // (~30ms) quanto iOS Safari (até ~150ms em throttling de CPU).
  const swipeEndAtRef = useRef(0)
  const CLICK_SUPPRESSION_WINDOW_MS = 200

  const [hint, setHint] = useState<HintKind | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showHint(kind: HintKind) {
    setHint(kind)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 600)
  }

  // V10.8 — feedback border overlay separado do wrapper. Antes o
  // `border-2` ficava na div principal de SwipeHandler — durante o
  // swipe horizontal, o user via essa borda "retornando ao centro"
  // (easeXToZero) ao mesmo tempo que o conteúdo dentro slidava. Cancel
  // visual. Agora: border do CARD vive em SubpostCarousel (vai com o
  // slide), e a borda de FEEDBACK de gesto vive aqui como overlay
  // transparent-default que só pinta durante drag ativo.
  const feedbackBorderRef = useRef<HTMLDivElement | null>(null)

  // Aplica transform direto no DOM. Chamado de RAF e dos handlers de
  // pointer — evita re-render por sample (motion value style).
  function applyTransform() {
    const el = elRef.current
    if (!el) return
    const x = xRef.current
    const y = yRef.current
    // Tilt: linear x → rotate, [-160, 160] → [+5°, -5°]. Suprimido
    // quando horizontal desabilitado (V9.5 — single-subpost não rota).
    let rotate = 0
    if (!disableHorizontal) {
      const clamped = Math.max(-160, Math.min(160, x))
      rotate = (-clamped / 160) * 5
    }
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg)`

    // Border-color do OVERLAY de feedback: verde spread, vermelho bury,
    // lilás nav, ou TRANSPARENT (default — não polui visual durante
    // slide entre subposts). Mesma curva de cor da V9.x.
    const overlay = feedbackBorderRef.current
    if (overlay) {
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      let color = 'transparent'
      if (ay > ax && ay > 20 && !disableVertical) {
        color =
          y < 0
            ? `rgba(52, 211, 153, ${Math.min(0.8, ay / 200)})`
            : `rgba(248, 113, 113, ${Math.min(0.8, ay / 200)})`
      } else if (ax > 20 && !disableHorizontal) {
        color = `rgba(167, 139, 250, ${Math.min(0.8, ax / 200)})`
      }
      overlay.style.borderColor = color
    }
  }

  function cancelRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  // Spring back magnético até (0, 0) — V9.27 stiffness 500 damping 38.
  // Equivalente a `animate(x, 0, spring) + animate(y, 0, spring)` em
  // Framer, mas sem importar `animate` (que requer `dragControls`
  // pesado em runtime de feature).
  function springBack() {
    cancelRaf()
    if (reducedMotion) {
      xRef.current = 0
      yRef.current = 0
      applyTransform()
      return
    }
    let last = performance.now()
    let vx = 0
    let vy = 0
    const step = (now: number) => {
      const dt = Math.min(0.064, (now - last) / 1000) // clamp >64ms
      last = now
      // Semi-implicit Euler.
      const ax = -SPRING_STIFFNESS * xRef.current - SPRING_DAMPING * vx
      const ay = -SPRING_STIFFNESS * yRef.current - SPRING_DAMPING * vy
      vx += ax * dt
      vy += ay * dt
      xRef.current += vx * dt
      yRef.current += vy * dt
      applyTransform()
      const settled =
        Math.abs(xRef.current) < SPRING_REST_DELTA &&
        Math.abs(yRef.current) < SPRING_REST_DELTA &&
        Math.abs(vx) < SPRING_REST_VELOCITY &&
        Math.abs(vy) < SPRING_REST_VELOCITY
      if (settled) {
        xRef.current = 0
        yRef.current = 0
        applyTransform()
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  // Horizontal commit: ease-out-quart 320ms até x = 0 (V9.30). Casa com
  // slideVariants do SubpostCarousel — paralelos sem briga.
  function easeXToZero() {
    cancelRaf()
    if (reducedMotion) {
      xRef.current = 0
      yRef.current = 0
      applyTransform()
      return
    }
    const fromX = xRef.current
    const fromY = yRef.current
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SWAP_EASE_DURATION_MS)
      const e = easeOutQuart(t)
      xRef.current = fromX * (1 - e)
      yRef.current = fromY * (1 - e)
      applyTransform()
      if (t >= 1) {
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function pushSample(t: number, x: number, y: number) {
    const arr = samplesRef.current
    arr.push({ t, x, y })
    // Mantém só os últimos ~5 (mais que suficiente p/ janela 80ms).
    if (arr.length > 8) arr.shift()
  }

  function estimateVelocity(): { vx: number; vy: number } {
    const arr = samplesRef.current
    if (arr.length < 2) return { vx: 0, vy: 0 }
    const last = arr[arr.length - 1]!
    // Encontra primeiro sample dentro da janela.
    let ref = arr[0]!
    for (let i = arr.length - 2; i >= 0; i--) {
      if (last.t - arr[i]!.t >= VELOCITY_SAMPLE_MS) {
        ref = arr[i]!
        break
      }
      ref = arr[i]!
    }
    const dt = (last.t - ref.t) / 1000
    if (dt <= 0) return { vx: 0, vy: 0 }
    return { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Só primary button / primary touch.
    if (e.button !== undefined && e.button !== 0) return
    // Já tem outro pointer ativo — ignora multi-touch (zoom etc.).
    if (activePointerRef.current !== null) return

    // Cancela animação de retorno anterior (V9.27 equivalent — antes
    // era x.stop()/y.stop()). Sem isso, novo gesto começa de um valor
    // sendo animado pra zero, dá sensação de "lag".
    cancelRaf()

    activePointerRef.current = e.pointerId
    const t = performance.now()
    // V10.4 fix: ÂNCORA compensa offset atual (xRef/yRef) pra que o novo
    // gesto CONTINUE da posição visual onde o card está. Sem isso, se
    // user interrompe easeXToZero ou springBack mid-flight, o card "pula"
    // — pointermove computa dx = clientX - startX = 0 e setaria xRef = 0,
    // mas visivelmente o card estava em xRef=−45.
    // Fórmula: pointermove faz xRef = (clientX - startX) * ELASTICITY.
    // Pra extensão contínua, startX = clientX - xRef/ELASTICITY.
    // V9.x Framer drag fazia equivalente internamente via dragControls.
    startXRef.current = e.clientX - xRef.current / ELASTICITY
    startYRef.current = e.clientY - yRef.current / ELASTICITY
    // Posição absoluta separada pra tap detection — não pode ser
    // contaminada pelo offset (senão tap durante animação vira "swipe").
    startXRawRef.current = e.clientX
    startYRawRef.current = e.clientY
    startTimeRef.current = t
    samplesRef.current = []
    pushSample(t, xRef.current, yRef.current)
    // Captura: garante que mesmo se o ponteiro sair do elemento durante
    // o drag, continuamos recebendo move/up. Crítico p/ desktop e p/
    // gestos amplos em touch.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Alguns browsers tiram do pool antes do up — defensivo.
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    const dx = e.clientX - startXRef.current
    const dy = e.clientY - startYRef.current
    // Elasticity 0.6 linear — V9.x Framer drag com constraints zeradas
    // se comportava assim. O threshold (80h / 160v) é em coord visual,
    // então 80 visual = 133 raw. Mantemos.
    xRef.current = dx * ELASTICITY
    yRef.current = dy * ELASTICITY
    applyTransform()
    pushSample(performance.now(), xRef.current, yRef.current)
  }

  function commitDecision(offsetX: number, offsetY: number): boolean {
    const ax = Math.abs(offsetX)
    const ay = Math.abs(offsetY)
    const verticalDominant = ay > ax

    const { vx, vy } = estimateVelocity()

    const verticalPassed =
      !disableVertical &&
      (ay > SWIPE_THRESHOLD_PX_V || Math.abs(vy) > SWIPE_VELOCITY_PXS)
    const horizontalPassed =
      !disableHorizontal &&
      (ax > SWIPE_THRESHOLD_PX_H || Math.abs(vx) > SWIPE_VELOCITY_PXS)

    function fireVertical() {
      if (offsetY < 0 && fireUp) {
        if (onSpread) showHint('spread')
        fireUp()
      } else if (offsetY > 0 && fireDown) {
        if (onBury) showHint('bury')
        fireDown()
      }
    }
    function fireHorizontal() {
      if (offsetX < 0 && onNext) {
        showHint('next')
        onNext()
      } else if (offsetX > 0 && onPrev) {
        showHint('prev')
        onPrev()
      }
    }

    // V9.27 / V9.30 — semântica preservada:
    //   - Vertical commit: NÃO mexer nas motion values; deixar onde
    //     estão; Wrapper exit do PostViewer (translateY ±110%) toma
    //     conta. Mexer aqui re-introduz "bouncing pro lado errado".
    //   - Horizontal commit: x→0 em ease-out-quart 320ms (casa com
    //     slideVariants do SubpostCarousel).
    //   - Sem commit: spring back magnético.
    // V10.8 — retorna boolean: true se COMITOU (suprime click pós-gesto),
    // false se só voltou (não suprime — jitter de dedo não deve quebrar
    // double-tap do lightbox).
    if (verticalPassed && horizontalPassed) {
      if (verticalDominant) {
        fireVertical()
      } else {
        easeXToZero()
        fireHorizontal()
      }
      return true
    } else if (verticalPassed) {
      fireVertical()
      return true
    } else if (horizontalPassed) {
      easeXToZero()
      fireHorizontal()
      return true
    } else {
      springBack()
      return false
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    // Tap dist usa o startXRaw absoluto, NÃO o âncora — pra "tap real"
    // ser detectado mesmo quando o gesto começa com o card mid-animation.
    const dxRaw = e.clientX - startXRawRef.current
    const dyRaw = e.clientY - startYRawRef.current
    const dist = Math.hypot(dxRaw, dyRaw)
    const elapsed = performance.now() - startTimeRef.current

    activePointerRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    // Tap: pouca distância + curto. Não toca xRef/yRef (já devem estar
    // próximos de zero). Garante reset por via das dúvidas. NÃO marca
    // swipeEndAt — tap deve propagar normalmente pra onClick dos
    // children (lightbox double-tap, "ver mais", dots indicator).
    if (dist < TAP_MAX_DISTANCE_PX && elapsed < TAP_MAX_DURATION_MS) {
      xRef.current = 0
      yRef.current = 0
      applyTransform()
      swipeEndAtRef.current = 0
      if (onTap) onTap(e.nativeEvent)
      return
    }

    // V10.8 fix (user report 2026-05-15: "double-click para abrir a
    // imagem parou de funcionar"). Antes: marcávamos swipeEndAt em
    // QUALQUER gesto > 8px. Mas em touch há micro-jitter no tap (10-15px
    // facilmente) — o gesto cai aqui (NÃO tap path), porém springBack
    // sem commit. Marcar swipeEndAt nesses casos suprimia o click,
    // quebrando o double-tap counter da Image (lastTapRef nunca seta).
    // Fix: commitDecision retorna boolean — só suprime click quando o
    // gesto efetivamente COMITOU (fireVertical ou fireHorizontal
    // chamados). Springback (sem commit) não suprime.
    const fired = commitDecision(xRef.current, yRef.current)
    if (fired) {
      swipeEndAtRef.current = performance.now()
    }
  }

  // Capture-phase click handler — roda ANTES dos onClick dos children
  // no caminho do DOM. Se foi swipe (não tap) dentro da janela de
  // supressão, consome o click ali mesmo — Image lightbox onClick,
  // "ver mais" button, dots, etc. não recebem o evento fantasma.
  function handleClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
    const sinceSwipe = performance.now() - swipeEndAtRef.current
    if (swipeEndAtRef.current > 0 && sinceSwipe < CLICK_SUPPRESSION_WINDOW_MS) {
      e.preventDefault()
      e.stopPropagation()
      swipeEndAtRef.current = 0
    }
  }

  function handlePointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    samplesRef.current = []
    springBack()
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

  // Cleanup: cancela RAFs em andamento + timer de hint.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    }
  }, [])

  // Style base — transform inicial (0,0,0 + 0deg) garante que o
  // elemento começa identidade. `touch-action: none` desabilita scroll
  // nativo no eixo do gesto — equivalente ao `touch-none` Tailwind.
  // `willChange: transform` dá hint pro browser pra promover layer.
  // V10.8: borderColor removido — borda do card agora vive em
  // SubpostCarousel (vai com o slide); aqui é só wrapper transparente.
  const baseStyle: CSSProperties = {
    transform: 'translate3d(0px, 0px, 0) rotate(0deg)',
    willChange: 'transform',
  }

  return (
    <div
      ref={elRef}
      className="relative h-full w-full touch-none select-none"
      style={baseStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
    >
      {children}

      {/* V10.8 — overlay de feedback de gesto. Default transparent;
          applyTransform pinta com verde/vermelho/lilás durante drag.
          inset-0 + pointer-events-none + z-[3] (acima do SubpostCarousel
          z-[2] gradient e do card content) garante que a cor pinta
          POR CIMA do card sem bloquear gestos. rounded espelha o card. */}
      <div
        ref={feedbackBorderRef}
        className="pointer-events-none absolute inset-0 z-[3] rounded border-2"
        style={{ borderColor: 'transparent' }}
        aria-hidden="true"
      />

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
    </div>
  )
}

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
