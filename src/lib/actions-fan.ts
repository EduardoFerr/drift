/**
 * Helper puro pra montar a lista de itens do `<ActionsFan>` (PostViewer
 * V11 — menu ⋮ no embedded mode).
 *
 * Extraído pra função pura (manifesto §7) pra permitir testes
 * exaustivos das combinações de visibilidade: share-image só aparece
 * quando o subpost atual tem imagem; follow/mute só aparecem em posts
 * de terceiros; pin fica disabled enquanto o estado de pin ainda
 * carrega do SQLite (pinned === null).
 *
 * Block/Report saíram do fan — long-press 5s ativa modal de moderação
 * (Phase 2). Decisão: ações destrutivas precisam fricção intencional.
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
  onMapToggle: () => void
  onFollowToggle: () => void
  onMute: () => void
  onSharePost: () => void
  onShareImage: () => void
}

export interface BuildFanItemsInput {
  isMine: boolean
  /** `null` enquanto carrega do SQLite. Item `pin` fica disabled nesse caso. */
  pinned: boolean | null
  isFollowing: boolean
  mapOpen: boolean
  /** Subpost atual tem imagem? Controla render do item `share-image`. */
  currentHasImage: boolean
  handlers: FanHandlers
}

export function buildFanItems(input: BuildFanItemsInput): FanItem[] {
  const {
    isMine,
    pinned,
    isFollowing,
    mapOpen,
    currentHasImage,
    handlers,
  } = input

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
      key: 'map',
      icon: '🗺',
      label: mapOpen ? 'fechar mapa' : 'mapa de spread',
      hint: 'visualização geográfica de quem drift-ou este post',
      onClick: handlers.onMapToggle,
    },
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
    )
  }
  return items
}
