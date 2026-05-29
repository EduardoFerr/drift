/**
 * mock-gate — guard ÚNICO e duro pros mocks E2E (Helia + WebRTC).
 *
 * Sprint N+5 Batch B1 (Ted). Os mocks de Helia e WebRTC substituem
 * subsistemas pesados (libp2p + RTCPeerConnection) por uma malha
 * BroadcastChannel determinística, pra rodar validação E2E multi-user
 * sem STUN/TURN nem nó IPFS real.
 *
 * **Segurança — por que um gate único:** mock que vaza pra produção é
 * desastre (P2P/IPFS falsos, sem cripto real). Centralizamos a decisão
 * num só lugar pra não haver dois critérios divergindo. Toda checagem
 * de "uso mock?" passa por `useE2EMocks()`.
 *
 * Critério (AND duro):
 *   1. `import.meta.env.DEV === true` — build de produção elimina o
 *      branch inteiro por dead-code-elimination (Vite). `useE2EMocks()`
 *      vira `false` literal em prod e os `import()` dos mocks nunca
 *      entram no bundle.
 *   2. URL tem `?e2e-mock=1` OU `?dev-seed=1`. Alinha com o gate do
 *      dev-seed (`bootstrap.ts`) — quem semeia o banco normalmente
 *      também quer a malha P2P/IPFS mockada. `?e2e-mock=1` permite
 *      ativar só os mocks de transporte sem semear o banco.
 *
 * Manifesto §7 (determinismo): mocks usam timestamps/delays fixos, não
 * dependem de rede real. Manifesto §17 (sem chave-mestra): gate é
 * puramente local (URL + build flag), não consulta nenhuma API externa.
 */

/** Query param que liga os mocks de transporte explicitamente. */
const E2E_MOCK_PARAM = 'e2e-mock'
/** Param do dev-seed — quem semeia normalmente quer malha mockada. */
const DEV_SEED_PARAM = 'dev-seed'

let cached: boolean | null = null

/**
 * `true` sse os mocks E2E (Helia + WebRTC) devem substituir os reais.
 *
 * Resultado é cacheado no primeiro acesso — a URL não muda durante a
 * vida da página, e queremos uma decisão estável (o wiring em
 * `main.tsx` consulta isto uma vez no boot).
 *
 * Em produção (`import.meta.env.DEV === false`) retorna `false` literal
 * — o resto da expressão é DCE'd junto com os `import()` dos mocks.
 */
export function useE2EMocks(): boolean {
  if (!import.meta.env.DEV) return false
  if (cached !== null) return cached
  if (typeof window === 'undefined') {
    cached = false
    return cached
  }
  const params = new URLSearchParams(window.location.search)
  cached = params.has(E2E_MOCK_PARAM) || params.has(DEV_SEED_PARAM)
  return cached
}

/** Reset do cache — só pra testes unitários do gate. */
export function _resetMockGateForTest(): void {
  cached = null
}
