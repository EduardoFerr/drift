/**
 * ActionsFan — fan vertical de quick actions (PostViewer ⋮ menu).
 *
 * Extraído de PostViewer.tsx [Sprint N+2 P1.5] pra primitive reusável.
 * Bit-exact preservation: mesma estrutura DOM, mesmas classes, mesmas
 * animações Framer Motion, mesma semântica de neutralItems vs
 * destructiveItems (item `moderar` separado por border-top).
 *
 * Lógica pura de qual item aparece em qual situação vive em
 * `lib/actions-fan.ts:buildFanItems` (testável sem React).
 *
 * Co-exporta `FanIcon` (compartilhado com ModerationModal em PostViewer).
 *
 * Histórico relevante (preservado de PostViewer):
 *
 * V9.15 — fan vertical de quick actions expandido pelo ⋮. 4 ações:
 * mapa, fixar, seguir, silenciar (last two só quando !isMine). Cada
 * GlassIconButton xl posicionado absolute right-4, com top calculado
 * (60 + i*48) descendo a partir do ⋮. Stagger 40ms na entrada via
 * Framer Motion.
 *
 * Block/Report saíram daqui — long-press 5s ativa modal de moderação
 * (Phase 2). Decisão: ações destrutivas precisam fricção intencional.
 *
 * V11.8 (user feedback 2026-05-17 round 4 — design critique completa):
 * 6 mudanças coordenadas em resposta a:
 *   "contraste + hierarquia visual + affordance" — botões soltos
 *   competiam com vazio, ícones finos morriam em mobile, destrutivo
 *   tinha mesmo peso que neutro.
 *
 * (1) **Container único** envolve TODOS os items neutros: rounded-2xl
 *     glass card (bg-drift-surface/85 + backdrop-blur-md + border
 *     drift-border/60 + shadow). Cria agrupamento, aumenta legibilidade,
 *     melhora percepção de toque.
 *
 * (2) **Ícones mais grossos** — strokeWidth 2.0 (era 1.5 default
 *     Feather), size 22 (era 20). Glyph não morre em mobile.
 *
 * (3) **Contraste alto** — border-drift-accent/55, text-drift-text
 *     (não muted), bg-drift-surface/90. User explicitly: "ícone mais
 *     escuro · borda mais definida".
 *
 * (6) **Destrutivo isolado** — `moderar` (warning ⚠) sai do container
 *     neutro pra render abaixo, com cor semântica drift-bury + sem
 *     glass wrapping. Não compete visualmente com ações neutras.
 *
 * (+) Labels permanentes mantidas (V11.7) — agora INSIDE container
 *     pra alinharem com a borda visual única.
 *
 * V11.11 (2026-05-17 round 7 — Lily audit inline depois de user
 * "está feio"). Mudanças coordenadas:
 *   (1) MODERAR vira ÚLTIMA ROW do container (separator border-
 *       top drift-bury/30). Antes era mini-container separado —
 *       parecia afterthought. Agora é uma seção destrutiva
 *       dentro do mesmo menu.
 *   (2) Inner buttons PERDEM border+bg próprio. Container já
 *       provê chrome; circle-inside-rectangle era ruído (esp.
 *       em Velatura, 3 papéis competindo). Hover ganha bg-
 *       drift-accent/10 (era /15) — mais sutil.
 *   (3) Active state ad-hoc pra mapOpen=true: row inteira
 *       ganha bg-drift-accent/8 + text-drift-accent — user vê
 *       que o mapa está aberto sem clicar.
 */

import {
  MapIcon,
  PinIcon,
  PinOffIcon,
  WarningIcon,
  BanIcon,
  MicOffIcon,
  PlusIcon,
  CheckIcon,
  ShareIcon,
  ImageIcon,
} from '../UI/Icons'
import { m, AnimatePresence } from 'framer-motion'
import { buildFanItems, type FanItem } from '../../lib/actions-fan'
import { usePrefsStore } from '../../lib/prefs'

/**
 * Renderer compartilhado: converte emoji strings (vindas de actions-fan
 * e ModerationModal item arrays) em SVG icons. actions-fan permanece
 * pure (string), tests não quebram, e UI fica consistente.
 *
 * Emojis não mapeados (📤 share, 🖼 image) renderizam como fallback —
 * actions-fan ainda funciona com Unicode.
 */
export function FanIcon({
  icon,
  size = 18,
  strokeWidth,
}: {
  icon: string
  size?: number
  /** Override strokeWidth — usar 2 em ActionsFan pra legibilidade sobre foto. */
  strokeWidth?: number
}) {
  const sw = strokeWidth
  switch (icon) {
    case '📌':
      return <PinIcon size={size} strokeWidth={sw} />
    case '📍':
      return <PinOffIcon size={size} strokeWidth={sw} />
    case '🗺':
    case '🗺️':
      return <MapIcon size={size} strokeWidth={sw} />
    case '⊘':
      return <BanIcon size={size} strokeWidth={sw} />
    case '🔇':
      return <MicOffIcon size={size} strokeWidth={sw} />
    case '➕':
      return <PlusIcon size={size} strokeWidth={sw} />
    case '✓':
      return <CheckIcon size={size} strokeWidth={sw} />
    case '⚠':
      return <WarningIcon size={size} strokeWidth={sw} />
    case '📤':
      return <ShareIcon size={size} strokeWidth={sw} />
    case '🖼':
    case '🖼️':
      return <ImageIcon size={size} strokeWidth={sw} />
    default:
      return <span aria-hidden="true">{icon}</span>
  }
}

export interface ActionsFanProps {
  visible: boolean
  isMine: boolean
  pinned: boolean | null
  isFollowing: boolean
  /** Subpost atual tem imagem? Controla render do share-image. */
  currentHasImage: boolean
  onPinToggle: () => void
  onFollowToggle: () => void
  onMute: () => void
  onSharePost: () => void
  onShareImage: () => void
  onOpenModeration: () => void
}

export default function ActionsFan({
  visible,
  isMine,
  pinned,
  isFollowing,
  currentHasImage,
  onPinToggle,
  onFollowToggle,
  onMute,
  onSharePost,
  onShareImage,
  onOpenModeration,
}: ActionsFanProps) {
  const items: FanItem[] = buildFanItems({
    isMine,
    pinned,
    isFollowing,
    currentHasImage,
    handlers: {
      onPinToggle,
      onFollowToggle,
      onMute,
      onSharePost,
      onShareImage,
      onOpenModeration,
    },
  })
  // Phase 6.1 (2026-05-20): labels textuais à esquerda dos ícones
  // gateadas via Menu Detalhado. Default ON (preserva comportamento
  // atual / discoverability pra novice). User opta-out pra view limpa
  // só com ícones (power user que já decorou o significado).
  const showLabels = usePrefsStore((s) => s.menu_detail_show_action_labels)

  // Separação: neutralItems (mostrados no container) vs destructiveItems
  // (renderizados abaixo, sem container). Discriminação por item.key.
  const neutralItems = items.filter((it) => it.key !== 'moderar')
  const destructiveItems = items.filter((it) => it.key === 'moderar')

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          key="fan-container"
          initial={{ opacity: 0, y: -8, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.92 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute right-4 z-30 flex flex-col items-end gap-2"
          // User feedback 2026-05-18: ícones do header (top-4 + h-11 = bottom
          // em 60px) ficavam COLADOS no container quando fan abria. Bump
          // pra 72px (12px gap = rhythm do design system) cria respiro
          // visual entre 'post controls' floating e 'menu' container.
          style={{ top: `72px` }}
          // BUG-LONGPRESS-FAN fix — opt-out do long-press 5s do card
          // parent. Touch sustentado no fan não deve disparar slim toggle.
          data-no-longpress="true"
        >
          <div
            // D4 Sprint N+3 Batch A — contraste hardening sobre backgrounds
            // claros / fotos brilhantes. Mudanças:
            //   (1) shadow-lg → shadow-2xl (stronger drop shadow, projeta
            //       o container sobre foto independente do brilho)
            //   (2) border drift-border → drift-border/80 + ring-1 ring-
            //       black/10 (segunda borda externa garante separação
            //       em bg branco/claro onde drift-border quase desaparece)
            //   (3) bg-drift-surface mantido SOLID (já era 100% opacity),
            //       confirma — alpha modifier removido se algum PR
            //       reintroduzir /85 quebraria contraste WCAG 4.5:1
            // Resultado: contraste container vs background ≥4.5:1
            // (AA) em backgrounds claros via combinação shadow+ring.
            className="flex flex-col rounded-2xl border border-drift-border/80 bg-drift-surface p-1.5 shadow-2xl ring-1 ring-black/10"
            role="group"
            aria-label="ações do post"
          >
            {neutralItems.map((item, i) => (
              <m.div
                key={item.key}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.16, delay: i * 0.035, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center justify-end gap-3 rounded-lg px-1 py-0.5"
              >
                {showLabels && (
                  <span
                    className="pointer-events-none whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-meta text-drift-text"
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                )}
                {/* Inner button SEM border/bg — só hover effect. Container
                    é o chrome. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!item.disabled) item.onClick()
                  }}
                  disabled={item.disabled}
                  aria-label={item.label}
                  title={item.hint}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-drift-text transition-colors hover:bg-drift-accent/10 hover:text-drift-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">
                    <FanIcon icon={item.icon} size={22} strokeWidth={2} />
                  </span>
                </button>
              </m.div>
            ))}
            {/* (1) MODERAR INSIDE container — separator border-top drift-
                bury/30 anuncia a seção destrutiva sem precisar de mini-
                container próprio. mt-1.5 + pt-1.5 cria respiro visual. */}
            {destructiveItems.map((item, i) => (
              <m.div
                key={item.key}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.16, delay: 0.035 * (neutralItems.length + i), ease: [0.22, 1, 0.36, 1] }}
                className="mt-1.5 flex items-center justify-end gap-3 border-t border-drift-bury/30 px-1 pt-1.5 pb-0.5"
              >
                {showLabels && (
                  <span
                    className="pointer-events-none whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-meta text-drift-bury"
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!item.disabled) item.onClick()
                  }}
                  disabled={item.disabled}
                  aria-label={item.label}
                  title={item.hint}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-drift-bury transition-colors hover:bg-drift-bury/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-bury disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">
                    <FanIcon icon={item.icon} size={22} strokeWidth={2} />
                  </span>
                </button>
              </m.div>
            ))}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
