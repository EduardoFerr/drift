/**
 * SlideUpOverlay — primitive de modal/overlay com slide-up animation.
 *
 * Padrão único pra todos os overlays do Drift v0.7+ (ProfileModal,
 * IdentityPanel, IdentitySwitcher, ReportModal, MultiTabModal,
 * SubpostEditor, futuras Settings sub-overlays).
 *
 * Extraído em V3.0 do redesign visual (HIMYM Round 1 — Lily flag de
 * 6+ modals reimplementando ~30 linhas de framer-motion boilerplate
 * cada). DRY mandatório, não opcional.
 *
 * Comportamento:
 * - Backdrop fixed-inset com opacity 0 → 1 (200ms)
 * - Modal container com translateY(22px → 0) + opacity 0 → 1 (250ms ease-out)
 * - Click em backdrop fecha; click em modal stops propagation
 * - role="dialog" + aria-modal="true" pra acessibilidade
 *
 * Composição esperada com `<ModalHeader>`:
 *
 *   <SlideUpOverlay onClose={onClose} ariaLabel="perfil">
 *     <ModalHeader title="perfil" onClose={onClose} />
 *     <section>...</section>
 *   </SlideUpOverlay>
 *
 * Customizável via props:
 * - `maxWidth`: 'sm' | 'md' | 'lg' (default 'md' = max-w-md)
 * - `padded`: boolean (default true; se false, content controla padding)
 * - `backdropDismissible`: boolean (default true)
 *
 * V3.4 (futuro reskin) migra todos os 6+ modals existentes pra consumir
 * este primitive. V3.0 (este commit) só cria; consume começa em V3.4.
 */

import type { ReactNode } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'

export interface SlideUpOverlayProps {
  /** Disparado quando user clica backdrop ou fecha via outro mecanismo. */
  onClose: () => void
  /** Conteúdo interno (geralmente `<ModalHeader />` + section + footer). */
  children: ReactNode
  /** Largura máxima do modal. Default 'md' (28rem). */
  maxWidth?: 'sm' | 'md' | 'lg'
  /**
   * Padding interno do modal. Default true (p-5). Setar false em casos
   * onde o conteúdo controla padding (ex.: SubpostEditor com tabs+footer
   * sem gap visual).
   */
  padded?: boolean
  /**
   * Se backdrop click fecha. Default true. Setar false em modals que
   * exigem ação explícita (ex.: MultiTabModal — user precisa decidir).
   */
  backdropDismissible?: boolean
  /**
   * aria-label pro role="dialog". Default null (sem aria-label, mas
   * children deve ter heading semantically discoverable).
   */
  ariaLabel?: string
}

const MAX_WIDTH_CLASS: Record<NonNullable<SlideUpOverlayProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function SlideUpOverlay({
  onClose,
  children,
  maxWidth = 'md',
  padded = true,
  backdropDismissible = true,
  ariaLabel,
}: SlideUpOverlayProps) {
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-drift-bg/90 p-4 backdrop-blur-sm"
      onClick={backdropDismissible ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* V9 anti-overflow: max-h-[85dvh] + overflow-y-auto garantem que
          content longo (e.g. ReportModal AuthoritiesBlock + ConfirmStep,
          IdentityPanel com 3 tabs, SubpostEditor com 8 drafts) NÃO
          ultrapassa viewport. Scrollbar interno em vez de modal cortado.
          Pad inferior extra evita "última linha colada" na borda. */}
      <m.div
        initial={{ y: 22, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 22, opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={`flex max-h-[85dvh] w-full flex-col overflow-y-auto overscroll-contain rounded border border-drift-border bg-drift-surface ${MAX_WIDTH_CLASS[maxWidth]} ${
          padded ? 'p-5' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </m.div>
    </m.div>
  )
}
