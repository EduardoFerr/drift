/**
 * Helper puro pra montar a lista de itens do `<ActionsFan>` (PostViewer
 * V11 — menu ⋮ no embedded mode).
 *
 * Extraído pra função pura (manifesto §7) pra permitir testes
 * exaustivos das combinações de visibilidade: share-image só aparece
 * quando o subpost atual tem imagem; follow/mute/moderar só aparecem
 * em posts de terceiros; pin fica disabled enquanto o estado de pin
 * ainda carrega do SQLite (pinned === null).
 *
 * **2026-05-17 — semântica do long-press 5s mudou** (user pedido):
 * - Antes: long-press 5s abria ModerationModal direto
 * - Agora: long-press 5s alterna modo padrão/slim (ver lib/view-mode.ts)
 * - Moderação foi movida PRO FAN como item `moderar` (item destrutivo
 *   ainda exige fricção mas via menu explícito, não gesto). Mantém o
 *   modal real (block/mute/report) — só o trigger mudou.
 */

export interface FanItem {
  key: string
  icon: string
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
}

export interface FanHandlers {
  onPinToggle: () => void
  onFollowToggle: () => void
  onMute: () => void
  onSharePost: () => void
  onShareImage: () => void
  /** Abre ModerationModal (block / mute / report). Só em posts de terceiros. */
  onOpenModeration: () => void
}

export interface BuildFanItemsInput {
  isMine: boolean
  /** `null` enquanto carrega do SQLite. Item `pin` fica disabled nesse caso. */
  pinned: boolean | null
  isFollowing: boolean
  /** Subpost atual tem imagem? Controla render do item `share-image`. */
  currentHasImage: boolean
  handlers: FanHandlers
}

export function buildFanItems(input: BuildFanItemsInput): FanItem[] {
  const {
    isMine,
    pinned,
    isFollowing,
    currentHasImage,
    handlers,
  } = input

  // Mapa de spread NÃO está mais aqui — user pedido 2026-05-18: mapa
  // é first-class no header (botão dedicado ao lado do comment-bubble),
  // não item escondido em menu de ações secundárias. Visualização
  // geográfica de "quem drift-ou este post" é descoberta primária.
  const items: FanItem[] = [
    {
      key: 'share-post',
      icon: '📤',
      label: 'compartilhar post',
      hint: 'gera link njump.me que abre em qualquer cliente Nostr',
      onClick: handlers.onSharePost,
    },
  ]
  if (currentHasImage) {
    items.push({
      key: 'share-image',
      icon: '🖼',
      label: 'compartilhar imagem',
      hint: 'abre o share sheet do sistema com a imagem como arquivo',
      onClick: handlers.onShareImage,
    })
  }
  items.push(
    {
      key: 'pin',
      icon: pinned ? '📌' : '📍',
      label: pinned ? 'desfixar' : 'fixar',
      hint: pinned
        ? 'remove proteção contra eviction local'
        : 'protege de eviction local + marca pra re-broadcast (§16)',
      onClick: handlers.onPinToggle,
      disabled: pinned === null,
    },
  )
  if (!isMine) {
    items.push(
      {
        key: 'follow',
        icon: isFollowing ? '✓' : '➕',
        label: isFollowing ? 'deixar de seguir' : 'seguir',
        hint: isFollowing
          ? 'publica kind 3 atualizado removendo este autor'
          : 'alimenta a aba "seguindo" do feed (NIP-02)',
        onClick: handlers.onFollowToggle,
      },
      {
        key: 'mute',
        icon: '🔇',
        label: 'silenciar',
        hint: 'esconde posts dele do meu feed (filtro local §24)',
        onClick: handlers.onMute,
      },
      {
        key: 'moderar',
        icon: '⚠',
        label: 'moderar',
        hint: 'abre opções: bloquear, silenciar ou denunciar (kind 1984)',
        onClick: handlers.onOpenModeration,
      },
    )
  }
  return items
}
