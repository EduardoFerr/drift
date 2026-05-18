/**
 * Tests pra `buildFanItems` — helper puro extraído de `PostViewer.tsx`
 * (`<ActionsFan>`). Cobre as combinações de visibilidade dependentes
 * de `isMine` / `currentHasImage` / `pinned` / `mapOpen` / `isFollowing`.
 *
 * Manifesto §7 (determinismo) + §16 (funções puras críticas com tests).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  buildFanItems,
  type BuildFanItemsInput,
  type FanHandlers,
} from '../src/lib/actions-fan'

function makeHandlers(): FanHandlers {
  return {
    onPinToggle: vi.fn(),
    onFollowToggle: vi.fn(),
    onMute: vi.fn(),
    onSharePost: vi.fn(),
    onShareImage: vi.fn(),
    onOpenModeration: vi.fn(),
  }
}

function base(overrides: Partial<BuildFanItemsInput> = {}): BuildFanItemsInput {
  return {
    isMine: false,
    pinned: false,
    isFollowing: false,
    currentHasImage: false,
    handlers: makeHandlers(),
    ...overrides,
  }
}

describe('buildFanItems', () => {
  // 2026-05-18: 'map' removido do fan — mapa virou first-class no
  // PostViewer header (botão dedicado ao lado do comment-bubble), não
  // item escondido em menu secundário. mapOpen + onMapToggle removidos
  // da API. Tests abaixo refletem a nova ordem.

  it('isMine=true + currentHasImage=true → share-post, share-image, pin (sem follow/mute/map)', () => {
    const items = buildFanItems(base({ isMine: true, currentHasImage: true }))
    expect(items.map((i) => i.key)).toEqual([
      'share-post',
      'share-image',
      'pin',
    ])
    expect(items.find((i) => i.key === 'follow')).toBeUndefined()
    expect(items.find((i) => i.key === 'mute')).toBeUndefined()
    expect(items.find((i) => i.key === 'map')).toBeUndefined()
  })

  it('isMine=true + currentHasImage=false → share-post, pin (2 itens, sem share-image/map)', () => {
    const items = buildFanItems(base({ isMine: true, currentHasImage: false }))
    expect(items.map((i) => i.key)).toEqual(['share-post', 'pin'])
  })

  it('isMine=false + currentHasImage=true → 6 itens (com follow/mute/moderar, sem map)', () => {
    const items = buildFanItems(base({ isMine: false, currentHasImage: true }))
    expect(items.map((i) => i.key)).toEqual([
      'share-post',
      'share-image',
      'pin',
      'follow',
      'mute',
      'moderar',
    ])
  })

  it('isMine=false + currentHasImage=false → 5 itens (sem share-image/map)', () => {
    const items = buildFanItems(base({ isMine: false, currentHasImage: false }))
    expect(items.map((i) => i.key)).toEqual([
      'share-post',
      'pin',
      'follow',
      'mute',
      'moderar',
    ])
  })

  it('mapa nunca aparece no fan (responsabilidade do header)', () => {
    for (const isMine of [true, false]) {
      for (const currentHasImage of [true, false]) {
        const items = buildFanItems(base({ isMine, currentHasImage }))
        expect(
          items.find((i) => i.key === 'map'),
          `isMine=${isMine} currentHasImage=${currentHasImage}`,
        ).toBeUndefined()
      }
    }
  })

  it('pinned=null → item pin tem disabled=true (loading state)', () => {
    const items = buildFanItems(base({ pinned: null }))
    const pin = items.find((i) => i.key === 'pin')
    expect(pin?.disabled).toBe(true)
  })

  it('pinned=false → pin não disabled + label "fixar"', () => {
    const items = buildFanItems(base({ pinned: false }))
    const pin = items.find((i) => i.key === 'pin')
    expect(pin?.disabled).toBe(false)
    expect(pin?.label).toBe('fixar')
    expect(pin?.icon).toBe('📍')
  })

  it('pinned=true → label "desfixar" + ícone 📌', () => {
    const items = buildFanItems(base({ pinned: true }))
    const pin = items.find((i) => i.key === 'pin')
    expect(pin?.label).toBe('desfixar')
    expect(pin?.icon).toBe('📌')
    expect(pin?.disabled).toBe(false)
  })

  it('isFollowing=true → label do follow é "deixar de seguir" + ícone ✓', () => {
    const items = buildFanItems(base({ isMine: false, isFollowing: true }))
    const follow = items.find((i) => i.key === 'follow')
    expect(follow?.label).toBe('deixar de seguir')
    expect(follow?.icon).toBe('✓')
  })

  it('isFollowing=false → label "seguir" + ícone ➕', () => {
    const items = buildFanItems(base({ isMine: false, isFollowing: false }))
    const follow = items.find((i) => i.key === 'follow')
    expect(follow?.label).toBe('seguir')
    expect(follow?.icon).toBe('➕')
  })

  it('handlers são linkados — onClick dispara o handler correspondente', () => {
    const handlers = makeHandlers()
    const items = buildFanItems(
      base({ isMine: false, currentHasImage: true, handlers }),
    )
    items.find((i) => i.key === 'share-post')?.onClick()
    items.find((i) => i.key === 'share-image')?.onClick()
    items.find((i) => i.key === 'pin')?.onClick()
    items.find((i) => i.key === 'follow')?.onClick()
    items.find((i) => i.key === 'mute')?.onClick()
    expect(handlers.onSharePost).toHaveBeenCalledTimes(1)
    expect(handlers.onShareImage).toHaveBeenCalledTimes(1)
    expect(handlers.onPinToggle).toHaveBeenCalledTimes(1)
    expect(handlers.onFollowToggle).toHaveBeenCalledTimes(1)
    expect(handlers.onMute).toHaveBeenCalledTimes(1)
  })

  it('determinístico — mesma entrada, mesma saída (shape)', () => {
    const a = buildFanItems(base({ isMine: false, currentHasImage: true }))
    const b = buildFanItems(base({ isMine: false, currentHasImage: true }))
    expect(a.map((i) => i.key)).toEqual(b.map((i) => i.key))
    expect(a.map((i) => i.label)).toEqual(b.map((i) => i.label))
  })
})
