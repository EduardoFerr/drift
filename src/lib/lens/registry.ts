/**
 * LensRegistry — singleton + Zustand store reativa (POC Sprint N+2 P0.2).
 *
 * Responsabilidades:
 *  - `register(strategy)` — adiciona strategy ao map (frozen)
 *  - `getActive()` / `setActive(id)` — switching com reatividade UI
 *  - `list()` — snapshot read-only de todas as strategies registradas
 *  - Store Zustand pra UI consumir activeId reativamente
 *
 * Default active: `'ppr-trust'` — preserva behavior atual (conformance
 * test #19 passa bit-exact). Quem quiser mudar default pra `'chronological'`
 * faz isso no SHIP (Sprint N+3), não POC.
 *
 * **POC: active é volátil** — store em memória, reset on reload. Persistência
 * em `user_prefs.active_lens` defer pra SHIP (evita churn de migração no
 * POC). Justificativa registrada em `tests/lens-plugin-conformance.test.ts`.
 *
 * Manifesto §17 (sem chave mestra): registry NÃO impõe lente oficial;
 * user troca livremente.
 */

import { create } from 'zustand'
import type { LensStrategy, LensRegistryApi } from './types'

// ─── Default active ID ────────────────────────────────────────────

/**
 * Default volátil do POC. Bit-exact retro: PprTrustLens com strength=0
 * retorna posts inalterados (conformance #19 passa).
 */
const DEFAULT_ACTIVE_ID = 'ppr-trust'

// ─── Zustand store ────────────────────────────────────────────────

interface RegistryState {
  /** ID da lens ativa. Mutado via `setActive()`. */
  activeId: string
  /** Versão monotonica — incrementa em `register()` pra triggerar selectors. */
  version: number
}

export const useLensRegistryStore = create<RegistryState>(() => ({
  activeId: DEFAULT_ACTIVE_ID,
  version: 0,
}))

// ─── Strategies map (não-reativo — frozen após register) ──────────

const strategies = new Map<string, LensStrategy>()

// ─── API ──────────────────────────────────────────────────────────

/**
 * Registra strategy. Frozen pós-registro pra impedir prototype pollution
 * ou mutation acidental.
 *
 * **Idempotente em testes**: re-register do MESMO id é no-op silencioso
 * (boot pode rodar 2× em StrictMode dev; testes resetam state). Throw em
 * mismatch sinaliza colisão real de id.
 */
export function registerLens(strategy: LensStrategy): void {
  const existing = strategies.get(strategy.id)
  if (existing) {
    // Mesmo objeto (hot-reload / StrictMode double-init) → no-op.
    if (existing === strategy) return
    throw new Error(
      `[lens] strategy '${strategy.id}' already registered (different instance)`,
    )
  }
  Object.freeze(strategy)
  strategies.set(strategy.id, strategy)
  useLensRegistryStore.setState((s) => ({ version: s.version + 1 }))
}

export function getActiveLens(): LensStrategy {
  const id = useLensRegistryStore.getState().activeId
  const s = strategies.get(id)
  if (s) return s
  // Fallback defensivo: active aponta pra id inexistente (dev typo).
  // Cai pro default; se default também não existe, throw.
  const fallback = strategies.get(DEFAULT_ACTIVE_ID)
  if (fallback) return fallback
  throw new Error(`[lens] no strategy registered for active='${id}' nor default`)
}

export function setActiveLens(id: string): void {
  if (!strategies.has(id)) {
    throw new Error(`[lens] unknown strategy: '${id}'`)
  }
  useLensRegistryStore.setState({ activeId: id })
}

export function listLenses(): readonly LensStrategy[] {
  return [...strategies.values()]
}

/**
 * Wrapper API pra testes/composers que querem injetar registry-like
 * objeto sem usar singleton global.
 */
export const lensRegistry: LensRegistryApi = {
  register: registerLens,
  getActive: getActiveLens,
  setActive: setActiveLens,
  list: listLenses,
}

// ─── Testing helpers ──────────────────────────────────────────────

export const __testing = {
  reset(): void {
    strategies.clear()
    useLensRegistryStore.setState({ activeId: DEFAULT_ACTIVE_ID, version: 0 })
  },
  registeredIds(): string[] {
    return [...strategies.keys()]
  },
}
