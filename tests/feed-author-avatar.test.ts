/**
 * Feed author avatar reactivity — LOCK_VIA_TEST D3 Sprint N+3 Batch A.
 *
 * Source: D3 issue 2026-05-21 "profile picture publica mas não aparece no
 * feed/comments — só no Profile page".
 *
 * Diagnóstico:
 *   - feed.ts:rowToPost JÁ extrai authorAvatar/authorAlias do LEFT JOIN
 *     com users_metadata (Sprint N+2 P2.11, coberto por
 *     profile-picture-render-conformance.test.ts).
 *   - SubpostLayout/CommentCard JÁ renderizam AuthorChip com esses campos.
 *   - BUG: events.ts:persistUserMetadata NÃO chamava invalidateFeed()
 *     após persistir kind 0. Resultado: SQLite tinha metadata fresca mas
 *     a store Zustand mantinha o snapshot anterior (authorAvatar=undefined)
 *     até o próximo evento de domínio chegar — podia levar minutos.
 *
 * Fix: persistUserMetadata chama invalidateFeed() após bumpProfileVersion.
 * Re-query do feed materializa shapes Post com campos decorativos
 * preenchidos. Manifesto §22 LOCK_VIA_TEST OK — ranking não muda, só
 * shape decorativa.
 *
 * Defesa estática (source-grep): persistUserMetadata contém invalidateFeed().
 * Defesa positiva via grep do bloco da função, não do arquivo todo
 * (events.ts já chama invalidateFeed em N outros handlers).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const EVENTS = readFileSync('src/lib/events.ts', 'utf8')

/**
 * Extrai o corpo da função `persistUserMetadata` por matching de chaves.
 * Suficiente pra grep determinístico — não tenta parsear TS.
 */
function extractPersistUserMetadataBody(): string {
  const start = EVENTS.indexOf('async function persistUserMetadata')
  expect(start, 'persistUserMetadata deve existir em events.ts').toBeGreaterThan(0)
  // Próxima `async function` ou EOF
  const after = EVENTS.indexOf('async function ', start + 1)
  return after > 0 ? EVENTS.slice(start, after) : EVENTS.slice(start)
}

describe('Feed author avatar reactivity — D3 Sprint N+3 Batch A', () => {
  it('events.ts importa invalidateFeed de ./feed', () => {
    expect(EVENTS).toMatch(/import\s*\{[^}]*invalidateFeed[^}]*\}\s*from\s*['"]\.\/feed['"]/)
  })

  it('persistUserMetadata chama invalidateFeed() após persistir kind 0', () => {
    const body = extractPersistUserMetadataBody()
    expect(
      body,
      'persistUserMetadata DEVE chamar invalidateFeed() pra re-query feed ' +
        'com authorAvatar/authorAlias populados pelo LEFT JOIN.',
    ).toMatch(/invalidateFeed\(\)/)
  })

  it('persistUserMetadata também chama bumpProfileVersion (regressão guard)', () => {
    // Garante que o fix não removeu o bump original — useUserMetadata hook
    // depende disso pra ProfileModal/AuthorChip re-render imediato.
    const body = extractPersistUserMetadataBody()
    expect(body).toMatch(/bumpProfileVersion\(event\.pubkey\)/)
  })
})
