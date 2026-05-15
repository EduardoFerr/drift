/**
 * ModalHeader — primitive de header pra modals/overlays.
 *
 * Composto com `<SlideUpOverlay>`:
 *
 *   <SlideUpOverlay onClose={onClose}>
 *     <ModalHeader title="perfil" onClose={onClose} />
 *     <body>...</body>
 *   </SlideUpOverlay>
 *
 * Visual (alinhado ao mockup v0.7):
 * - Title em font-display (Syne) uppercase tracking-wide
 * - Close button "✕" com border 1px drift-border, rounded
 * - Hover/focus: border-drift-accent + text-drift-accent
 *
 * Variants opcionais:
 * - `tone`: 'default' | 'danger' (danger = title em drift-bury, usado
 *   em ReportModal etc.)
 * - `subtitle`: string opcional abaixo do title
 */

// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'

export interface ModalHeaderProps {
  /** Texto principal do header (renderizado em <h2>). */
  title: string
  /** Subtítulo opcional, menor, abaixo do title. */
  subtitle?: string
  /** Disparado pelo botão ✕. */
  onClose: () => void
  /** Variante visual do title. */
  tone?: 'default' | 'danger'
  /**
   * Se omitir close button (ex.: header puramente informativo).
   * Default false.
   */
  hideClose?: boolean
}

export function ModalHeader({ title, subtitle, onClose, tone = 'default', hideClose = false }: ModalHeaderProps) {
  const titleColor = tone === 'danger' ? 'text-drift-bury' : 'text-drift-accent'

  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className={`font-display text-xs font-bold uppercase tracking-[0.2em] ${titleColor}`}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-[10px] text-drift-muted">{subtitle}</p>
        )}
      </div>
      {!hideClose && (
        <m.button
          whileTap={{ scale: 0.92 }}
          onClick={onClose}
          className="shrink-0 rounded border border-drift-border px-2 py-1 text-[10px] text-drift-muted transition-colors hover:border-drift-accent hover:text-drift-accent focus:border-drift-accent focus:text-drift-accent focus:outline-none"
          aria-label="fechar"
        >
          ✕
        </m.button>
      )}
    </header>
  )
}
