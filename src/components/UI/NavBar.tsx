/**
 * NavBar — primitive de bottom-nav com plus central (V3.3).
 *
 * Layout horizontal: 3 slots — left action(s), botão central + (compose),
 * right action(s). Botão central é disco 48×48 com glow accent e
 * `whileTap` scale 0.95 (framer-motion).
 *
 * Visual (alinhado ao mockup v0.7):
 * - Container fixed bottom-0, bg drift-bg/95 backdrop-blur-sm,
 *   border-top drift-border, padding 12px
 * - Plus central: 48×48 rounded-full bg drift-accent text drift-bg,
 *   shadow [0_0_22px_rgba(232,255,90,0.22)] (glow accent)
 * - Side buttons: SVG icon 20×20 + label DM Mono text-[12px]
 *   uppercase tracking-widest text-drift-muted
 * - Hover: text-drift-text + scale 1.02
 *
 * Composição esperada:
 *
 *   <NavBar
 *     left={[{ icon: <MapIcon />, label: 'mapa', onClick: openMap }]}
 *     right={[{ icon: <SettingsIcon />, label: 'settings', onClick: openSettings }]}
 *     onCompose={openComposer}
 *   />
 *
 * Status: ZERO CONSUMER em V3.3 — Drift atual usa header inline +
 * SubpostEditor always-mounted, o que torna bottom-nav structural
 * change (fora do escopo "visual only" de V3.x). Track futuro
 * (V7+ ou structural rework) consome este primitive. Pattern
 * idêntico aos primitives V3.0 (SlideUpOverlay/Chip/...).
 */

import type { ReactNode } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'
import { useLongPress, LONG_PRESS_MS } from '../../hooks/useLongPress'

export interface NavAction {
  /** Ícone (SVG component ou emoji em ReactNode). */
  icon: ReactNode
  /** Label DM Mono curto (recomendado ≤ 8 chars). */
  label: string
  /** Click handler. */
  onClick: () => void
  /**
   * Long-press handler (3s). V_2026-05-22 — usado pra abrir
   * MapExplainerCard no botão MAPA. Tap continua disparando onClick
   * normalmente. Quando ausente, NavBtn é só tap.
   */
  onLongPress?: () => void
  /** Variante visual ativa (ex.: aba selecionada). Default false. */
  active?: boolean
  /** aria-label se label não for descritivo o suficiente. */
  ariaLabel?: string
}

export interface NavBarProps {
  /** Ações do lado esquerdo do plus. Recomendado 1-2 itens. */
  left: NavAction[]
  /** Ações do lado direito do plus. Recomendado 1-2 itens. */
  right: NavAction[]
  /** Handler do botão central + (compose). */
  onCompose: () => void
  /** aria-label do plus button. Default 'criar post'. */
  composeAriaLabel?: string
  /**
   * Slim mode (2026-05-17): quando true, NavBar desliza off-screen
   * (translateY 110%) com spring suave, liberando viewport pro card.
   * Toggled via long-press 5s no PostViewer (`useViewModeStore`).
   * `inert` attribute desabilita focus + interaction quando hidden.
   */
  slim?: boolean
}

export function NavBar({
  left,
  right,
  onCompose,
  composeAriaLabel = 'criar post',
  slim = false,
}: NavBarProps) {
  return (
    <m.nav
      role="navigation"
      aria-label="navegação principal"
      // mx-auto + max-w-md alinha com o app centrado (App.tsx root).
      // Em mobile, max-w-md > viewport → ocupa toda largura
      // (comportamento original preservado). User feedback 2026-05-08.
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-drift-border bg-drift-bg/95 px-3 py-3 backdrop-blur-sm sm:border-x"
      // Slim: slide off-screen com spring. Mantém aria-hidden+inert quando
      // off-screen pra screen readers + keyboard nav não acharem botões.
      animate={{ y: slim ? '110%' : '0%' }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.8 }}
      aria-hidden={slim || undefined}
      // @ts-expect-error -- inert é HTML attribute valid mas tipos React 18 não cobrem
      inert={slim ? '' : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center justify-around gap-2">
          {left.map((a, i) => (
            <NavBtn key={`l-${i}`} action={a} />
          ))}
        </div>

        <m.button
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.04 }}
          onClick={onCompose}
          aria-label={composeAriaLabel}
          // shrink-0 + aspect-square: prevenir squash horizontal quando
          // os flex-1 das laterais pressionam o botão. User report
          // 2026-05-09: "o + nao está correto, parece achatado".
          // Default flex-shrink:1 deixava o w-12 ceder quando containers
          // laterais ficavam apertados (labels MAPA/CONFIG + ícones).
          className="flex h-12 w-12 shrink-0 aspect-square items-center justify-center rounded-full bg-drift-accent text-drift-bg shadow-[0_0_22px_rgba(232,255,90,0.22)] focus:outline-none focus:ring-2 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
        >
          {/* V9.14 — SVG plus em vez de glyph Syne extrabold. O glyph
              tinha asta vertical mais curta que horizontal, dando
              sensação de "+" achatado mesmo dentro do disco perfeito.
              SVG com stroke-width 2.5 + linecap round entrega cruz
              simétrica, herda cor via currentColor (text-drift-bg). */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </m.button>

        <div className="flex flex-1 items-center justify-around gap-2">
          {right.map((a, i) => (
            <NavBtn key={`r-${i}`} action={a} />
          ))}
        </div>
      </div>
    </m.nav>
  )
}

function NavBtn({ action }: { action: NavAction }) {
  // Long-press opcional. Quando action.onLongPress não fornecido,
  // hook fica disabled e handlers viram no-op (zero overhead).
  const lp = useLongPress({
    onLongPress: action.onLongPress ?? (() => undefined),
    disabled: !action.onLongPress,
  })
  return (
    <m.button
      whileTap={{ scale: 0.95 }}
      onClick={action.onClick}
      {...lp.handlers}
      aria-label={action.ariaLabel ?? action.label}
      aria-pressed={action.active}
      className={`relative flex flex-col items-center gap-1 overflow-hidden rounded px-2 py-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
        action.active
          ? 'text-drift-accent'
          : 'text-drift-muted hover:text-drift-text'
      }`}
    >
      <span className="text-[18px] leading-none">{action.icon}</span>
      <span className="font-mono text-[12px] uppercase tracking-widest">
        {action.label}
      </span>
      {/* Ripple feedback durante long-press (só monta se hook ativo). */}
      {lp.pressing && lp.pressOrigin && (
        <span
          className="ripple-wave"
          aria-hidden="true"
          style={{
            left: lp.pressOrigin.x,
            top: lp.pressOrigin.y,
            animationDuration: `${LONG_PRESS_MS}ms`,
          }}
        />
      )}
    </m.button>
  )
}
