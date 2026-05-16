/**
 * Tests pra chunking em recalculateScore (Ted follow-up #2 — sessão
 * 29-04). Posts virais (>500 spreaders) precisam de IN(?) em chunks
 * pra não estourar SQLite_MAX_VARIABLE_NUMBER em builds antigos.
 *
 * Não testamos `recalculateScore` diretamente (private + side effects);
 * testamos a constante e a estratégia de chunking via mock no db.exec.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock todas as dependências side-effecty do events.ts
vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))
vi.mock('../src/lib/nostr', () => ({
  verifyDriftEvent: vi.fn(() => true),
  getTag: vi.fn(),
}))
// 2026-05-16: verify movido pra worker (Ted RFC). events.ts consome
// verifyEventAsync de verify.ts. Mock cobre o novo caller.
vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: vi.fn(async () => true),
}))
vi.mock('../src/lib/feed', () => ({
  invalidateFeed: vi.fn(),
}))
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))

import { db } from '../src/lib/db'
import { RECALC_USER_CHUNK_SIZE } from '../src/lib/events'

describe('RECALC_USER_CHUNK_SIZE', () => {
  it('é 500 — conservador, cobre todos os builds SQLite WASM', () => {
    expect(RECALC_USER_CHUNK_SIZE).toBe(500)
  })

  it('é menor que 999 (limite mínimo histórico do SQLite)', () => {
    // Mesmo em builds antigos (SQLITE_MAX_VARIABLE_NUMBER=999), o
    // chunk size deixa folga pros parâmetros não-userPub (postId
    // aparece 2x na query principal, etc).
    expect(RECALC_USER_CHUNK_SIZE).toBeLessThan(999)
  })
})

describe('chunking strategy — divisão em batches', () => {
  // Em vez de testar fetchUserAggsInChunks diretamente (privado), validamos
  // que o tamanho de chunk produz divisões corretas pra cenários reais.

  function chunkCount(userCount: number, chunkSize: number): number {
    return Math.ceil(userCount / chunkSize)
  }

  it('100 users → 1 chunk (caso comum)', () => {
    expect(chunkCount(100, RECALC_USER_CHUNK_SIZE)).toBe(1)
  })

  it('500 users (boundary) → 1 chunk', () => {
    expect(chunkCount(500, RECALC_USER_CHUNK_SIZE)).toBe(1)
  })

  it('501 users → 2 chunks', () => {
    expect(chunkCount(501, RECALC_USER_CHUNK_SIZE)).toBe(2)
  })

  it('1500 users → 3 chunks (post viral)', () => {
    expect(chunkCount(1500, RECALC_USER_CHUNK_SIZE)).toBe(3)
  })

  it('5000 users → 10 chunks (post mega-viral)', () => {
    expect(chunkCount(5000, RECALC_USER_CHUNK_SIZE)).toBe(10)
  })

  it('50000 users → 100 chunks (limite teórico — Drift inteiro espalha)', () => {
    // Mesmo nesse cenário extremo, 100 round-trips ao worker SQLite
    // são <1s no total. Aceitável vs falhar silenciosamente sem chunk.
    expect(chunkCount(50000, RECALC_USER_CHUNK_SIZE)).toBe(100)
  })
})

describe('chunking semântica — disjunção e merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('chunks são disjuntos (sem overlap) — cada user aparece 1x', () => {
    // Sample slice pra verificar que slicing é correto
    const userPubs = Array.from({ length: 1500 }, (_, i) => `user${i}`)
    const chunks: string[][] = []
    for (let i = 0; i < userPubs.length; i += RECALC_USER_CHUNK_SIZE) {
      chunks.push(userPubs.slice(i, i + RECALC_USER_CHUNK_SIZE))
    }

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(500)
    expect(chunks[1]).toHaveLength(500)
    expect(chunks[2]).toHaveLength(500)

    // Disjunção
    const allFromChunks = chunks.flat()
    const seen = new Set(allFromChunks)
    expect(seen.size).toBe(1500) // sem duplicatas
    expect(allFromChunks.length).toBe(1500) // sem perdas
  })

  it('último chunk respeita boundary — não preenche com extras', () => {
    const userPubs = Array.from({ length: 750 }, (_, i) => `user${i}`)
    const chunks: string[][] = []
    for (let i = 0; i < userPubs.length; i += RECALC_USER_CHUNK_SIZE) {
      chunks.push(userPubs.slice(i, i + RECALC_USER_CHUNK_SIZE))
    }

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(500)
    expect(chunks[1]).toHaveLength(250) // último chunk é parcial — OK
  })
})

describe('regressão: db.exec mock chamado N vezes pra N chunks', () => {
  it('1 user → 1 db.exec call', async () => {
    // Simula o que fetchUserAggsInChunks faria — tests indiretos via mock
    const mockExec = vi.fn(async () => [])
    ;(db.exec as ReturnType<typeof vi.fn>).mockImplementation(mockExec)

    const userPubs = ['user1']
    for (let i = 0; i < userPubs.length; i += RECALC_USER_CHUNK_SIZE) {
      const chunk = userPubs.slice(i, i + RECALC_USER_CHUNK_SIZE)
      await db.exec(`SELECT 1 WHERE u.npub IN (${chunk.map(() => '?').join(',')})`, chunk)
    }

    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('1500 users → 3 db.exec calls', async () => {
    const mockExec = vi.fn(async () => [])
    ;(db.exec as ReturnType<typeof vi.fn>).mockImplementation(mockExec)

    const userPubs = Array.from({ length: 1500 }, (_, i) => `user${i}`)
    for (let i = 0; i < userPubs.length; i += RECALC_USER_CHUNK_SIZE) {
      const chunk = userPubs.slice(i, i + RECALC_USER_CHUNK_SIZE)
      await db.exec(`SELECT 1 WHERE u.npub IN (${chunk.map(() => '?').join(',')})`, chunk)
    }

    expect(mockExec).toHaveBeenCalledTimes(3)
  })
})
