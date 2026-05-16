/**
 * Tests de regressão pra semântica "última ação vale" + Sybil weighted
 * (Sprint 8 do roadmap pós-auditoria, redirecionado).
 *
 * Cobre `selectLatestActionByUser` em `events.ts` — função pura que
 * decide qual ação de cada user conta no recalc de score. Garante:
 *  - Bug "spread+bury simultâneo do mesmo user" (consolidado.md §4.6)
 *    NÃO permite +0.7 líquido — última ação cronologicamente domina.
 *  - Manifesto §23 (mudança de opinião) preservado: user pode espalhar,
 *    enterrar, espalhar de novo — só a última conta.
 *  - Manifesto §7 (determinismo global): mesmo conjunto de ações em
 *    qualquer ordem de entrada → mesmo resultado.
 *
 * Esta função vivia inline no `recalculateScore`, foi extraída em 2026-
 * 05-01 (Sprint 8) pra permitir tests sem mockar SQLite. Comportamento
 * de runtime IDÊNTICO ao anterior — tests provam isso.
 */

import { describe, expect, it, vi } from 'vitest'

// events.ts importa verify.ts (que tenta spawn Worker via import.meta.url)
// top-level — mock pra evitar resolver de URL em Node.
vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: vi.fn(async () => true),
}))

import { selectLatestActionByUser, type ActionRow } from '../src/lib/events'

const USER_A = '02'.repeat(32) // 64 hex chars (npub válido fake)
const USER_B = '03'.repeat(32)
const USER_C = '04'.repeat(32)

describe('selectLatestActionByUser', () => {
  it('user sem ações nenhuma — Map vazio', () => {
    const result = selectLatestActionByUser([])
    expect(result.size).toBe(0)
  })

  it('user com ação única — retorna essa ação', () => {
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.get(USER_A)).toBe('spread')
    expect(result.size).toBe(1)
  })

  // ─── Cenário central: bug "spread+bury simultâneo" ─────────────────

  it('mesmo user spread depois bury — APENAS bury conta (consolidado §4.6)', () => {
    // Antes do fix de "última ação vale" (pré 2026-04-29): user contribuía
    // com 1 spread + 1 bury → score líquido = +1 - 0.3 = +0.7. Vetor de
    // manipulação trivial. Agora: só o bury conta. Score = -0.3 * weight.
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.get(USER_A)).toBe('bury')
    expect(result.size).toBe(1)
  })

  it('mesmo user bury depois spread — APENAS spread conta', () => {
    // Caso simétrico: user enterrou primeiro, mudou de ideia e espalhou.
    // Manifesto §23 (mudança de opinião). Última cronologicamente vence.
    const actions: ActionRow[] = [
      { kind: 'bury', user_pub: USER_A, created_at: 100 },
      { kind: 'spread', user_pub: USER_A, created_at: 200 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.get(USER_A)).toBe('spread')
  })

  it('mesmo user 4 ações alternadas — só a última conta', () => {
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
      { kind: 'spread', user_pub: USER_A, created_at: 300 },
      { kind: 'bury', user_pub: USER_A, created_at: 400 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.get(USER_A)).toBe('bury')
    expect(result.size).toBe(1)
  })

  // ─── Tie-break determinístico ──────────────────────────────────────

  it('empate em created_at — tie-break por kind ASC (bury < spread)', () => {
    // Cliente Nostr pode publicar 2 eventos com o mesmo `created_at`
    // (relógios de 1 segundo de granularidade no Nostr) — dois clientes
    // diferentes precisam chegar ao MESMO winner pra preservar §7.
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 100 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.get(USER_A)).toBe('bury') // 'bury' < 'spread' em lex
  })

  it('empate independente da ordem de entrada — bury sempre ganha', () => {
    const actionsAB: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 100 },
    ]
    const actionsBA: ActionRow[] = [
      { kind: 'bury', user_pub: USER_A, created_at: 100 },
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
    ]
    const r1 = selectLatestActionByUser(actionsAB)
    const r2 = selectLatestActionByUser(actionsBA)
    expect(r1.get(USER_A)).toBe(r2.get(USER_A))
    expect(r1.get(USER_A)).toBe('bury')
  })

  // ─── Multi-user ─────────────────────────────────────────────────────

  it('users distintos — cada um com sua própria última ação', () => {
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'spread', user_pub: USER_B, created_at: 100 },
      { kind: 'bury', user_pub: USER_C, created_at: 200 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.size).toBe(3)
    expect(result.get(USER_A)).toBe('spread')
    expect(result.get(USER_B)).toBe('spread')
    expect(result.get(USER_C)).toBe('bury')
  })

  it('user que reverte ação não conta duas vezes (count distinct preserved)', () => {
    // Cenário de UI: post viral mostra "3 espalharam". Se userA espalha
    // depois enterra, ele NÃO deve aparecer no contador de spreads — só
    // de buries. count = users distintos com ação líquida 'spread' +
    // count de users distintos com 'bury'.
    const actions: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
      { kind: 'spread', user_pub: USER_B, created_at: 150 },
    ]
    const result = selectLatestActionByUser(actions)
    expect(result.size).toBe(2) // 2 users distintos
    expect(result.get(USER_A)).toBe('bury')
    expect(result.get(USER_B)).toBe('spread')
  })

  // ─── Determinismo cross-ordem ──────────────────────────────────────

  it('determinismo: ordem reversa de entrada produz mesmo resultado', () => {
    const ascending: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
      { kind: 'spread', user_pub: USER_B, created_at: 150 },
    ]
    const descending = [...ascending].reverse()
    const r1 = selectLatestActionByUser(ascending)
    const r2 = selectLatestActionByUser(descending)
    expect(r1.get(USER_A)).toBe(r2.get(USER_A))
    expect(r1.get(USER_B)).toBe(r2.get(USER_B))
    expect(r1.size).toBe(r2.size)
  })

  it('determinismo: ordem aleatória produz mesmo resultado', () => {
    // Simula 10 clientes Nostr entregando os mesmos eventos em ordens
    // diferentes (problema clássico de event sourcing). Todos devem
    // chegar ao mesmo estado.
    const base: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
      { kind: 'spread', user_pub: USER_A, created_at: 300 },
      { kind: 'bury', user_pub: USER_B, created_at: 150 },
      { kind: 'spread', user_pub: USER_C, created_at: 250 },
    ]
    const ref = selectLatestActionByUser(base)

    // Permutações deterministas (3 das 120 possíveis com 5 elementos)
    const perm1 = [base[2]!, base[0]!, base[3]!, base[4]!, base[1]!]
    const perm2 = [base[4]!, base[3]!, base[2]!, base[1]!, base[0]!]
    const perm3 = [base[1]!, base[3]!, base[0]!, base[4]!, base[2]!]

    for (const perm of [perm1, perm2, perm3]) {
      const r = selectLatestActionByUser(perm)
      expect(r.size).toBe(ref.size)
      expect(r.get(USER_A)).toBe(ref.get(USER_A))
      expect(r.get(USER_B)).toBe(ref.get(USER_B))
      expect(r.get(USER_C)).toBe(ref.get(USER_C))
    }
  })

  // ─── Cenário Sybil ──────────────────────────────────────────────────

  it('100 Sybils espalhando + 100 enterrando depois = 100 buries líquidos', () => {
    // Atacante controla 100 npubs. Cada um espalha um post pra inflar
    // engajamento, depois enterra (dropa engagement adversário).
    // Nossa lógica: a última ação de cada user é 'bury' → 100 buries
    // líquidos. Combinado com peso ~0 desses Sybils novos (scoring
    // weighted), score real do post fica negativo mas com magnitude
    // microscópica. Manifesto §22 (sem reputação subjetiva, peso ID).
    const actions: ActionRow[] = []
    for (let i = 0; i < 100; i++) {
      const sybil = `00${i.toString(16).padStart(62, '0')}` // 64 hex
      actions.push({ kind: 'spread', user_pub: sybil, created_at: 100 })
      actions.push({ kind: 'bury', user_pub: sybil, created_at: 200 })
    }
    const result = selectLatestActionByUser(actions)
    expect(result.size).toBe(100)
    let buries = 0
    let spreads = 0
    for (const action of result.values()) {
      if (action === 'bury') buries++
      else spreads++
    }
    expect(buries).toBe(100)
    expect(spreads).toBe(0)
  })

  it('user spreader que reverte 5x — comportamento idempotente cross-ordem', () => {
    // Edge case: user nervoso espalha/enterra 5 vezes em rajada. Cada
    // par de eventos chegando em ordem diferente nos relays não pode
    // produzir score diferente.
    const events: ActionRow[] = [
      { kind: 'spread', user_pub: USER_A, created_at: 100 },
      { kind: 'bury', user_pub: USER_A, created_at: 200 },
      { kind: 'spread', user_pub: USER_A, created_at: 300 },
      { kind: 'bury', user_pub: USER_A, created_at: 400 },
      { kind: 'spread', user_pub: USER_A, created_at: 500 },
    ]
    // Última (created_at=500) é 'spread'.
    const r1 = selectLatestActionByUser(events)
    const r2 = selectLatestActionByUser([...events].reverse())
    const r3 = selectLatestActionByUser([events[2]!, events[0]!, events[4]!, events[1]!, events[3]!])
    expect(r1.get(USER_A)).toBe('spread')
    expect(r2.get(USER_A)).toBe('spread')
    expect(r3.get(USER_A)).toBe('spread')
  })
})
