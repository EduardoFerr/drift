/**
 * V11 (bug 2026-05-08 "swipe pula 2 posts") — testes de cursor pra
 * navegação swipe. Cobertura mínima:
 *
 *  1. Swipe + feed re-sort no mesmo tick → próximo post é o que o
 *     user esperava (estabilidade contra race).
 *  2. Post atual some do feed (moderação) → snap pro nearest baseado
 *     no último idx conhecido — sem crash, sem voltar pro topo nem
 *     saltar pro fim.
 *  3. Tab switch preserva posição em ambas as tabs (cursor por tab é
 *     independente).
 *
 * Funções 100% puras (manifesto §7) — testáveis sem React/DOM/SQLite.
 */

import { describe, expect, it } from 'vitest'
import {
  advanceCursor,
  exitAtEnd,
  initialAnchor,
  resolveCursorIdx,
  setCursorByIndex,
  type CursorPost,
  type FeedCursor,
} from '../src/lib/feed-cursor'

const initialCursor: FeedCursor = { postId: null, atEnd: false }

function p(id: string): CursorPost {
  return { id }
}

describe('resolveCursorIdx (derivar idx do cursor)', () => {
  it('array vazio → 0', () => {
    expect(resolveCursorIdx(initialCursor, [], 0)).toBe(0)
  })

  it('postId null → 0 (estado inicial)', () => {
    const posts = [p('a'), p('b'), p('c')]
    expect(resolveCursorIdx(initialCursor, posts, 0)).toBe(0)
  })

  it('atEnd → posts.length (sentinel pós-último)', () => {
    const posts = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'c', atEnd: true }
    expect(resolveCursorIdx(cursor, posts, 2)).toBe(3)
  })

  it('postId encontrado → findIndex', () => {
    const posts = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    expect(resolveCursorIdx(cursor, posts, 0)).toBe(1)
  })

  it('post sumiu → snap pro lastKnownIdx clampado', () => {
    const posts = [p('a'), p('b'), p('c')]
    // postId 'gone' não está no array — lastKnownIdx 1 → idx 1 ('b')
    const cursor: FeedCursor = { postId: 'gone', atEnd: false }
    expect(resolveCursorIdx(cursor, posts, 1)).toBe(1)
  })

  it('post sumiu + lastKnown além do array → clampa pro último válido', () => {
    const posts = [p('a'), p('b')]
    const cursor: FeedCursor = { postId: 'gone', atEnd: false }
    // lastKnown=5, mas array só tem 2 → clampa pra posts.length - 1 = 1
    expect(resolveCursorIdx(cursor, posts, 5)).toBe(1)
  })

  it('post sumiu + lastKnown negativo → clampa pra 0', () => {
    const posts = [p('a'), p('b')]
    const cursor: FeedCursor = { postId: 'gone', atEnd: false }
    expect(resolveCursorIdx(cursor, posts, -1)).toBe(0)
  })
})

describe('advanceCursor (swipe up/down)', () => {
  it('avança pro próximo ID baseado no SNAPSHOT do array', () => {
    const posts = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'a', atEnd: false }
    const next = advanceCursor(cursor, posts, 0)
    expect(next).toEqual({ postId: 'b', atEnd: false })
  })

  it('cenário do bug — feed re-sort entre swipe e setState NÃO afeta próximo', () => {
    // User está em posts[1] = 'b'. Swipe up.
    // Snapshot tirado no momento do swipe: ['a', 'b', 'c'].
    // PROXIMO esperado = 'c' (posts[2] do snapshot).
    const snapshot = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    const next = advanceCursor(cursor, snapshot, 1)
    expect(next).toEqual({ postId: 'c', atEnd: false })

    // Mesmo se DEPOIS do swipe o feed re-ordenar (score recalc), o
    // cursor agora aponta pra 'c' por ID — não pra slot posicional.
    // Quando resolveCursorIdx for chamado contra o feed re-ordenado,
    // ele vai achar 'c' onde quer que esteja. user vê 'c' como
    // esperado, não pula pra outro post.
    const reordered = [p('c'), p('a'), p('b')] // score recalc reordenou
    expect(resolveCursorIdx(next, reordered, 2)).toBe(0)
    // Idx é 0 agora porque 'c' está no topo, mas isso é correto —
    // o user CONTINUA vendo 'c' (o post que ele queria ver, não outro).
  })

  it('último post + swipe → atEnd=true preservando postId', () => {
    const posts = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'c', atEnd: false }
    const next = advanceCursor(cursor, posts, 2)
    expect(next).toEqual({ postId: 'c', atEnd: true })
  })

  it('array vazio → cursor inalterado (defensivo)', () => {
    const cursor: FeedCursor = { postId: 'x', atEnd: false }
    expect(advanceCursor(cursor, [], 0)).toBe(cursor)
  })

  it('idx além do array → atEnd com último ID', () => {
    const posts = [p('a'), p('b')]
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    // Defensivo: idx=5 quando array tem 2. Vira atEnd com último.
    const next = advanceCursor(cursor, posts, 5)
    expect(next).toEqual({ postId: 'b', atEnd: true })
  })
})

describe('setCursorByIndex (jumpToTop, onActiveTabTap)', () => {
  it('targetIdx=0 → primeiro post', () => {
    const posts = [p('a'), p('b'), p('c')]
    const cursor: FeedCursor = { postId: 'c', atEnd: true }
    expect(setCursorByIndex(cursor, posts, 0)).toEqual({ postId: 'a', atEnd: false })
  })

  it('targetIdx além do array → atEnd com último', () => {
    const posts = [p('a'), p('b')]
    expect(setCursorByIndex(initialCursor, posts, 99)).toEqual({
      postId: 'b',
      atEnd: true,
    })
  })

  it('targetIdx negativo → clampa pra 0', () => {
    const posts = [p('a'), p('b')]
    expect(setCursorByIndex(initialCursor, posts, -3)).toEqual({
      postId: 'a',
      atEnd: false,
    })
  })

  it('array vazio → cursor inalterado', () => {
    const cursor: FeedCursor = { postId: 'x', atEnd: false }
    expect(setCursorByIndex(cursor, [], 0)).toBe(cursor)
  })
})

describe('exitAtEnd (onBack do EndOfFeed)', () => {
  it('atEnd=true → atEnd=false preservando postId', () => {
    const cursor: FeedCursor = { postId: 'c', atEnd: true }
    expect(exitAtEnd(cursor)).toEqual({ postId: 'c', atEnd: false })
  })

  it('atEnd=false → identidade (cursor inalterado)', () => {
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    expect(exitAtEnd(cursor)).toBe(cursor)
  })
})

describe('initialAnchor (lazy bootstrap)', () => {
  it('postId null + posts disponíveis → ancora em posts[0]', () => {
    const posts = [p('a'), p('b')]
    expect(initialAnchor(initialCursor, posts)).toEqual({ postId: 'a', atEnd: false })
  })

  it('postId já setado → null (sem mudança)', () => {
    const cursor: FeedCursor = { postId: 'a', atEnd: false }
    const posts = [p('a'), p('b')]
    expect(initialAnchor(cursor, posts)).toBeNull()
  })

  it('atEnd=true → null (não re-ancora; user já passou pelo fim)', () => {
    const cursor: FeedCursor = { postId: 'b', atEnd: true }
    const posts = [p('a'), p('b')]
    expect(initialAnchor(cursor, posts)).toBeNull()
  })

  it('posts vazio → null (espera próximo refresh)', () => {
    expect(initialAnchor(initialCursor, [])).toBeNull()
  })
})

// ─── Cenários integrados ─────────────────────────────────────────────

describe('cenário 1 — swipe + feed re-sort durante swipe', () => {
  it('user vê o post esperado mesmo com re-sort no mesmo tick', () => {
    // Estado: feed [postX, postY, postZ], user em postX.
    let cursor: FeedCursor = { postId: 'postX', atEnd: false }
    const snapshotAtSwipe = [p('postX'), p('postY'), p('postZ')]
    const idxAtSwipe = resolveCursorIdx(cursor, snapshotAtSwipe, 0)
    expect(idxAtSwipe).toBe(0)

    // User dá swipe up. Snapshot é tirado AGORA.
    cursor = advanceCursor(cursor, snapshotAtSwipe, idxAtSwipe)
    expect(cursor).toEqual({ postId: 'postY', atEnd: false })

    // No mesmo tick, invalidateFeed dispara — score recalc do postX
    // (que o user acabou de espalhar) reordena o feed. postX agora é
    // primeiro mas o array inteiro re-orderou: novo é [postX, postZ, postY].
    const afterResort = [p('postX'), p('postZ'), p('postY')]

    // resolveCursorIdx contra novo array: 'postY' está no idx 2 agora.
    // CRÍTICO: o user continua vendo 'postY' (o post que ele esperava
    // como próximo), não pulou pra postZ.
    const newIdx = resolveCursorIdx(cursor, afterResort, idxAtSwipe)
    expect(newIdx).toBe(2)
    expect(afterResort[newIdx]!.id).toBe('postY')
  })

  it('comportamento idêntico quando feed NÃO muda (regression guard)', () => {
    // Mesmo cenário sem re-sort — comportamento padrão preservado.
    let cursor: FeedCursor = { postId: 'postX', atEnd: false }
    const posts = [p('postX'), p('postY'), p('postZ')]
    const idx = resolveCursorIdx(cursor, posts, 0)
    cursor = advanceCursor(cursor, posts, idx)
    // Pós-swipe sem reorder, idx é 1 (postY).
    expect(resolveCursorIdx(cursor, posts, 0)).toBe(1)
    expect(posts[1]!.id).toBe('postY')
  })
})

describe('cenário 2 — post atual some do feed (moderação)', () => {
  it('snap pra nearest sem crash', () => {
    // User estava no post 'b' (idx 1).
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    const before = [p('a'), p('b'), p('c'), p('d')]
    const idxBefore = resolveCursorIdx(cursor, before, 1)
    expect(idxBefore).toBe(1)

    // Moderação atinge 'b' → score=-999 → some do feed.
    const after = [p('a'), p('c'), p('d')]
    // Snap usa lastKnownIdx=1 (clampado contra after.length-1=2 → 1).
    // posts[1] no novo array é 'c' — vizinho lógico do 'b' que sumiu.
    const idxAfter = resolveCursorIdx(cursor, after, 1)
    expect(idxAfter).toBe(1)
    expect(after[idxAfter]!.id).toBe('c')
  })

  it('último post some + lastKnown era o último → snap pro novo último', () => {
    const cursor: FeedCursor = { postId: 'd', atEnd: false }
    // Antes: 4 posts, user no idx 3 (last).
    // Depois: 3 posts (d sumiu).
    const after = [p('a'), p('b'), p('c')]
    // lastKnown=3 mas after.length-1=2 → clampa pra 2.
    const idx = resolveCursorIdx(cursor, after, 3)
    expect(idx).toBe(2)
    expect(after[idx]!.id).toBe('c')
  })

  it('todos os posts somem (feed esvazia) → idx=0 (UI mostra HomeEmpty)', () => {
    const cursor: FeedCursor = { postId: 'b', atEnd: false }
    expect(resolveCursorIdx(cursor, [], 1)).toBe(0)
  })
})

describe('cenário 3 — tab switch preserva posição', () => {
  it('cursor independente por tab — switch mantém posição em ambas', () => {
    // Cada tab tem seu próprio FeedCursor. Simulamos um Record<Tab, Cursor>.
    type Tab = 'global' | 'following' | 'trending'
    const cursors: Record<Tab, FeedCursor> = {
      global: { postId: null, atEnd: false },
      following: { postId: null, atEnd: false },
      trending: { postId: null, atEnd: false },
    }

    const globalPosts = [p('g1'), p('g2'), p('g3')]
    const followingPosts = [p('f1'), p('f2')]

    // Tab global: ancora + avança 1.
    cursors.global = initialAnchor(cursors.global, globalPosts) ?? cursors.global
    expect(cursors.global).toEqual({ postId: 'g1', atEnd: false })
    cursors.global = advanceCursor(
      cursors.global,
      globalPosts,
      resolveCursorIdx(cursors.global, globalPosts, 0),
    )
    expect(cursors.global).toEqual({ postId: 'g2', atEnd: false })

    // Switch pra following: ancora separadamente em f1.
    cursors.following = initialAnchor(cursors.following, followingPosts) ?? cursors.following
    expect(cursors.following).toEqual({ postId: 'f1', atEnd: false })

    // Switch de volta pra global: posição preservada em g2.
    expect(cursors.global).toEqual({ postId: 'g2', atEnd: false })
    expect(resolveCursorIdx(cursors.global, globalPosts, 0)).toBe(1)

    // Switch pra following de novo: posição preservada em f1.
    expect(cursors.following).toEqual({ postId: 'f1', atEnd: false })
    expect(resolveCursorIdx(cursors.following, followingPosts, 0)).toBe(0)
  })

  it('mesmo cursor.postId em tabs diferentes não confunde — isolamento por tab', () => {
    // Edge case: user spreadou um post que aparece em multiple tabs.
    // Cada cursor é setado independentemente. Mesmo postId em ambas
    // não cria estado compartilhado — são cópias.
    type Tab = 'global' | 'following'
    const cursors: Record<Tab, FeedCursor> = {
      global: { postId: 'shared', atEnd: false },
      following: { postId: 'shared', atEnd: true },
    }

    expect(cursors.global.atEnd).toBe(false)
    expect(cursors.following.atEnd).toBe(true)

    // Avançar global não afeta following.
    const posts = [p('shared'), p('next')]
    cursors.global = advanceCursor(cursors.global, posts, 0)
    expect(cursors.global).toEqual({ postId: 'next', atEnd: false })
    expect(cursors.following).toEqual({ postId: 'shared', atEnd: true })
  })
})
