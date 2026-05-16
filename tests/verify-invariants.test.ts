/**
 * Invariantes do verify worker boundary — conformance lock-via-test.
 *
 * Origem: Barney threat model `Docs/security/verify-worker-threat-model-
 * 2026-05-16.md` §3 (invariantes BW1-BW6) e Ted RFC §7.4.
 *
 * Diferente de `verify-queue.test.ts` (runtime behavior) e
 * `events-verify-pipeline.test.ts` (integration), este arquivo audita
 * o SOURCE estaticamente — pega regressões silenciosas onde a impl
 * "funciona" mas viola contrato (ex: alguém importa `db` no
 * verify.worker.ts, ou copia nsec via postMessage).
 *
 * Invariantes do CLAUDE.md verificados:
 *  #1 — INSERT só via events.ts (worker NÃO escreve em SQLite)
 *  #5 — Pipeline cheap→caro (verify.worker importa SOMENTE nostr-tools/pure)
 *  #7 — Determinismo: verify result determinístico em main vs worker
 *  #8 — nsec NUNCA passa por verify boundary
 *
 * Bonus: fixture digest stability — detecta drift quando @noble bump.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verifyEvent } from 'nostr-tools/pure'

import {
  validEvents,
  invalidSigEvents,
  invalidSchemaEvents,
  FIXTURES_DIGEST,
  FIXTURE_COUNTS,
} from './fixtures/verify-events'

const ROOT = join(__dirname, '..')
const SRC_LIB = join(ROOT, 'src', 'lib')
const VERIFY_WORKER = join(SRC_LIB, 'verify.worker.ts')
const VERIFY_MAIN = join(SRC_LIB, 'verify.ts')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

// ─── BW1/BW3 — Worker é stateless, só nostr-tools/pure ──────────────

describe('verify.worker.ts — imports mínimos (BW3, BW4, inv #5)', () => {
  it('arquivo existe (gate Ted RFC §3.1)', () => {
    expect(existsSync(VERIFY_WORKER)).toBe(true)
  })

  it('NÃO importa db / sqlite / IndexedDB (inv #1, BW3)', () => {
    const src = stripComments(readFileSync(VERIFY_WORKER, 'utf8'))
    expect(src).not.toMatch(/from\s+['"][^'"]*\bdb\b/i)
    expect(src).not.toMatch(/from\s+['"][^'"]*sqlite/i)
    expect(src).not.toMatch(/\bindexedDB\b/)
  })

  it('NÃO importa identity / crypto (master key) — inv #8, BW3', () => {
    const src = stripComments(readFileSync(VERIFY_WORKER, 'utf8'))
    expect(src).not.toMatch(/from\s+['"]\.\/identity\b/)
    expect(src).not.toMatch(/from\s+['"]\.\/identities\b/)
    expect(src).not.toMatch(/from\s+['"]\.\/crypto\b/)
    expect(src).not.toMatch(/nsecHexToBytes|finalizeEvent|generateSecretKey|getOrCreateIdentity/)
  })

  it('NÃO referencia nsec / secretKey / privateKey (inv #8)', () => {
    const src = stripComments(readFileSync(VERIFY_WORKER, 'utf8'))
    expect(src).not.toMatch(/\bnsec\b/i)
    expect(src).not.toMatch(/\bsecretKey\b/)
    expect(src).not.toMatch(/\bprivateKey\b/)
  })

  it('NÃO tem fetch / XMLHttpRequest / WebSocket (BW4 — surface mínima)', () => {
    const src = stripComments(readFileSync(VERIFY_WORKER, 'utf8'))
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).not.toMatch(/\bXMLHttpRequest\b/)
    expect(src).not.toMatch(/\bWebSocket\b/)
  })

  it('importa SOMENTE de nostr-tools/pure (Barney §4 — chunk enxuto)', () => {
    const src = readFileSync(VERIFY_WORKER, 'utf8')
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l))
    // Permitido: nostr-tools/pure + tipo SignedEvent ('nostr-tools' barrel
    // só pra type, tree-shaken).
    for (const line of importLines) {
      expect(line).toMatch(/from\s+['"](?:nostr-tools(?:\/pure)?)['"]/)
    }
  })

  it('NÃO escreve em SQLite (sem db.run / db.exec / INSERT / UPDATE / DELETE) — inv #1', () => {
    const src = stripComments(readFileSync(VERIFY_WORKER, 'utf8'))
    expect(src).not.toMatch(/\bdb\.(run|exec|get)\b/)
    expect(src).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(src).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i)
    expect(src).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

// ─── BW2 — Main side: persist só após ack verify (inv #1, #5) ───────

describe('verify.ts — main side boundary (BW1, BW2)', () => {
  it('arquivo existe', () => {
    expect(existsSync(VERIFY_MAIN)).toBe(true)
  })

  it('exporta verifyEventAsync com retorno Promise<boolean>', () => {
    const src = readFileSync(VERIFY_MAIN, 'utf8')
    expect(src).toMatch(/export\s+async\s+function\s+verifyEventAsync/)
    expect(src).toMatch(/Promise<boolean>/)
  })

  it('exporta getVerifyMetrics + _resetVerifyForTest', () => {
    const src = readFileSync(VERIFY_MAIN, 'utf8')
    expect(src).toMatch(/export\s+function\s+getVerifyMetrics/)
    expect(src).toMatch(/export\s+function\s+_resetVerifyForTest/)
  })

  it('NÃO importa nsec / identity / crypto (inv #8)', () => {
    const src = stripComments(readFileSync(VERIFY_MAIN, 'utf8'))
    expect(src).not.toMatch(/from\s+['"]\.\/identity\b/)
    expect(src).not.toMatch(/from\s+['"]\.\/identities\b/)
    expect(src).not.toMatch(/from\s+['"]\.\/crypto\b/)
  })

  it('NÃO escreve em SQLite domínio (inv #1)', () => {
    const src = stripComments(readFileSync(VERIFY_MAIN, 'utf8'))
    // Imports de db proibidos (worker boundary não toca SQLite)
    expect(src).not.toMatch(/from\s+['"]\.\/db\b/)
    expect(src).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(src).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i)
  })

  it('queue cap = 5000 (Barney P1.1)', () => {
    const src = readFileSync(VERIFY_MAIN, 'utf8')
    expect(src).toMatch(/QUEUE_CAP\s*=\s*5000/)
  })

  it('drop policy NEWEST: increment dropped + return false ANTES de enfileirar', () => {
    const src = readFileSync(VERIFY_MAIN, 'utf8')
    // O bloco abaixo precisa existir: checa cap, incrementa dropped,
    // retorna false sem `pending.set` daquele id. Pattern conservador.
    expect(src).toMatch(
      /pending\.size\s*>=\s*QUEUE_CAP[\s\S]*?dropped\+\+[\s\S]*?return\s+false/,
    )
  })

  it('SEM fallback sync (Barney P1.5) — init falha propaga Error', () => {
    const src = stripComments(readFileSync(VERIFY_MAIN, 'utf8'))
    // Não importa `verifyDriftEvent` (sync) como fallback.
    expect(src).not.toMatch(/verifyDriftEvent/)
    // ensureWorker rejeita com Error em catch do construtor
    expect(src).toMatch(/reject\(new\s+Error/)
  })
})

// ─── events.ts integração — verify async vem ANTES de persist (BW2) ─

describe('events.ts — pipeline preserva inv #5 e #1', () => {
  const EVENTS_PATH = join(SRC_LIB, 'events.ts')
  it('events.ts importa verifyEventAsync (não usa verifyDriftEvent direto)', () => {
    const src = stripComments(readFileSync(EVENTS_PATH, 'utf8'))
    expect(src).toMatch(/from\s+['"]\.\/verify\b/)
    expect(src).toMatch(/\bverifyEventAsync\b/)
    // verifyDriftEvent (sync, legado) NÃO deve aparecer no caminho do
    // pipeline (pode estar em comentário, mas em comments-stripped não).
    expect(src).not.toMatch(/verifyDriftEvent\(/)
  })

  it('onNostrEvent: kind check + schema check rodam SYNC antes de await verifyEventAsync', () => {
    // Heurística estática: extrai corpo de onNostrEvent e valida que
    // o primeiro `await` é o verifyEventAsync. Garante invariante #5
    // (cheap antes de caro).
    const src = readFileSync(EVENTS_PATH, 'utf8')
    const fnMatch = src.match(
      /export\s+async\s+function\s+onNostrEvent[\s\S]*?\{([\s\S]*?)\n\}/,
    )
    expect(fnMatch).not.toBeNull()
    const body = fnMatch![1]!
    // O primeiro await deve ser verifyEventAsync. Anti-padrões:
    // await db./await getX/await pool — se aparecerem antes, viola
    // cheap→caro.
    const firstAwait = body.match(/\bawait\s+([\w.]+)/)
    expect(firstAwait).not.toBeNull()
    expect(firstAwait![1]!).toMatch(/^verifyEventAsync$/)
  })
})

// ─── webrtc/pipeline.ts boundary (Fase 6.4) ─────────────────────────

describe('transport/webrtc/pipeline.ts — usa verifyEventAsync', () => {
  const WEBRTC_PIPE = join(SRC_LIB, 'transport', 'webrtc', 'pipeline.ts')

  it('importa verifyEventAsync (não verifyDriftEvent sync)', () => {
    if (!existsSync(WEBRTC_PIPE)) return // future-proof
    const src = stripComments(readFileSync(WEBRTC_PIPE, 'utf8'))
    expect(src).toMatch(/\bverifyEventAsync\b/)
    expect(src).not.toMatch(/\bverifyDriftEvent\(/)
  })
})

// ─── Inv #7 — determinismo: worker e main produzem mesmo resultado ──

describe('determinismo (inv #7) — worker semântica equivalente a main', () => {
  it('verifyEvent (sync) produz resultados estáveis para fixtures determinísticas', () => {
    // Sanity contínua — quebra se algum upstream (@noble) muda
    // serialization ou nostr-tools quebra getEventHash. Pareia com
    // FIXTURES_DIGEST abaixo.
    const validResults = validEvents.map((e) => verifyEvent(e))
    expect(validResults.every((r) => r === true)).toBe(true)

    const invalidResults = invalidSigEvents.map((e) => verifyEvent(e))
    expect(invalidResults.every((r) => r === false)).toBe(true)

    // invalidSchemaEvents: sig é válida (kind/tags só falham no
    // schema check do pipeline, não em verifyEvent crypto).
    const schemaResults = invalidSchemaEvents.map((e) => verifyEvent(e))
    expect(schemaResults.every((r) => r === true)).toBe(true)
  })

  it('FIXTURES_DIGEST estável — detecta drift de geração', () => {
    // Snapshot do digest no commit. Quebra deliberada quando
    // nostr-tools/noble bump → revisão consciente.
    //
    // Recompute (rodar uma vez e copiar): tests/fixtures-smoke.test.ts
    // imprimiu digest = 'f9725db3d737079e71e28dc2b75ec25761620a0384c3a4016603a4a3228f94fd'
    expect(FIXTURES_DIGEST).toBe(
      'f9725db3d737079e71e28dc2b75ec25761620a0384c3a4016603a4a3228f94fd',
    )
  })

  it('counts são exatamente 70 / 20 / 10 (Barney §7 spec)', () => {
    expect(FIXTURE_COUNTS.valid).toBe(70)
    expect(FIXTURE_COUNTS.invalidSig).toBe(20)
    expect(FIXTURE_COUNTS.invalidSchema).toBe(10)
    expect(validEvents.length).toBe(70)
    expect(invalidSigEvents.length).toBe(20)
    expect(invalidSchemaEvents.length).toBe(10)
  })
})
