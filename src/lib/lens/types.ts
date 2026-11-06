/**
 * Lens Pluggable — interfaces canônicas (POC Sprint N+2 P0.2).
 *
 * Boundary: extrai abstração `LensStrategy` do hard-coded `applyLensToPost`
 * em `trust-lens.ts`. Cada lente é função pura (manifesto §7) que opera
 * SÓ no view-boundary, NUNCA escreve em `posts.score` (§24 carve-out).
 *
 * POC scope (deste arquivo):
 *  - `LensStrategy<TParams>` — interface canônica que toda lente implementa
 *  - `LensApplyContext` — read-only context passado pra `apply()`
 *  - `LensRegistry` — singleton de strategies (impl em `registry.ts`)
 *
 * Composição §6 (set theory `∪ ∩ −`) DEFERRED pra Sprint N+3 — design
 * doc `Docs/lens-pluggable-design.md` §6 cobre. POC ship sem composer.
 *
 * Manifesto refs:
 *  - §7 Determinismo — `apply()` é pure function
 *  - §17 Sem chave mestra — registry é open; user troca lente
 *  - §22 Sem reputação subjetiva — lente NUNCA escreve score canônico
 *  - §24 Sem afinidade no feed canônico — `s_local` é view-only
 */

import type { Post } from '../../types/drift'

// ─── Context ──────────────────────────────────────────────────────

/**
 * Contexto read-only passado pra cada `apply()`. NÃO expõe `db` cru —
 * isolation de write (Marshall LOCK). Lente recebe só hooks específicos.
 *
 * `network`: posts de quem o leitor segue que passam no filtro da mesma
 * aba (na ordem canônica), lidos pelo feed só quando a lente ativa pede
 * (`needsNetwork`). Sem eles, a lente só pode reordenar a aba.
 */
export interface LensApplyContext {
  /** npub do user ativo, ou null se anônimo. */
  readonly viewer: string | null
  /** Timestamp ms no momento da chamada (determinismo cross-device). */
  readonly now: number
  /** Posts de quem o leitor segue, mesma aba (bloqueados/silenciados fora). */
  readonly network?: readonly Post[]
  /** PPR score lookup (read-only). Retorna 0 pra autor desconhecido. */
  readonly getPprScore?: (authorPub: string) => number
}

// ─── Result ───────────────────────────────────────────────────────

/**
 * Resultado de `apply()`. A lente decide a ORDEM da aba. Ela pode trazer
 * para dentro da aba posts de `ctx.network` (de quem o leitor segue),
 * empurrando para fora o fim da aba; nunca traz post de outra origem,
 * nunca muda o tamanho da aba e nunca muta os Post de entrada (os
 * adiantados saem como cópia com `lensLift`).
 */
export interface LensApplyResult {
  /** A aba na ordem da lente, com o mesmo tamanho da de entrada. */
  readonly posts: readonly Post[]
}

// ─── Strategy interface ───────────────────────────────────────────

/**
 * Interface canônica que toda lente registrada implementa.
 *
 * `TParams` permite cada lente declarar shape próprio de params
 * (ex: PprTrustLens lê `strength` do store; futuras lentes podem
 * declarar params explícitos). POC mantém params implícito (lido de
 * stores externos pra preservar bit-exactness do migration).
 */
export interface LensStrategy<TParams = unknown> {
  /** ID estável — referência em prefs, conformance tests, sharing. */
  readonly id: string
  /** Nome user-friendly (PT-BR — i18n quando vier). */
  readonly name: string
  /** Descrição curta pra UI dropdown / tooltip. */
  readonly description: string
  /** Versão semver-int do schema de `TParams`. Compat check em SHIP. */
  readonly version: number

  /**
   * Aplica a lente a um array de posts. Pure function (§7) —
   * mesma entrada + mesmo state → mesma saída.
   *
   * Convenção: NÃO mutar `posts` input. Retornar nova array.
   */
  apply(posts: readonly Post[], ctx: LensApplyContext): LensApplyResult

  /**
   * A lente quer `ctx.network` agora? (Ex.: a de quem você segue, só com
   * força > 0.) Ausente = não quer: o feed não faz a consulta extra.
   */
  needsNetwork?(): boolean

  /** Marker pra futuro params typing — POC não usa. */
  readonly __paramsBrand?: TParams
}

// ─── Registry interface (impl em registry.ts) ─────────────────────

/**
 * Contrato do registry. Implementação singleton vive em `registry.ts`
 * com store Zustand reativa pra UI consumir `getActive()` reativamente.
 */
export interface LensRegistryApi {
  register(strategy: LensStrategy): void
  getActive(): LensStrategy
  setActive(id: string): void
  list(): readonly LensStrategy[]
}
