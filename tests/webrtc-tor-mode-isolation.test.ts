/**
 * §15 anti-censura — WebRTC isolado em modo Tor (anti-IP-leak).
 *
 * **Por que esse teste existe:** Robin's finding em
 * `Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md` §7 item 1 expôs
 * spec-vs-code drift: `Docs/webrtc-6.4-plan.md:106` afirma "em modo `tor`
 * ou `onion-only`, WebRTC desabilitado (orchestrator não registra
 * `webrtcTransport`)". Mas `bootstrap.ts:277-278` registrava ambos os
 * transportes incondicionalmente — vazando IP do user via STUN/ICE
 * candidates locais mesmo quando o tráfego Nostr passa por Tor.
 *
 * **Threat model:** `RTCPeerConnection.gatherIceCandidates` enumera
 * interfaces de rede locais e as expõe ao peer remoto. Em país censurado
 * com `network_mode: tor`, isso quebra o anonimato do user — exatamente
 * o que o manifesto §15 promete prevenir. Manifesto §27 (privacidade
 * visível) também aplica: user que ativou Tor deve ter garantia de que
 * nenhum subsystem vaza por trás.
 *
 * **Cobertura:**
 *  - clearnet → ambos `wssTransport` + `webrtcTransport` registrados
 *  - tor → só `wssTransport` registrado (WebRTC bloqueado)
 *  - onion-only → só `wssTransport` registrado (WebRTC bloqueado)
 *
 * **Decisão init-only:** se user trocar `network_mode` em runtime, exige
 * reload (convenção do Drift — `setActiveIdentity` faz o mesmo, manifesto
 * §3 dispositivo descartável torna isso aceitável). Não há código de
 * unregister-em-runtime hoje no orchestrator.
 *
 * Manifesto §15 (anti-censura por país), §27 (privacidade visível),
 * invariante #15 (multi-identidade não pode confundir o pipeline).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NetworkMode, UserPrefs } from '../src/types/drift'
import { DEFAULT_USER_PREFS } from '../src/types/drift'

// ─── Hoisted mocks ───────────────────────────────────────────────────
//
// vi.hoisted é necessário porque `vi.mock` é içado pro topo do arquivo
// antes dos imports. As mock fns precisam existir nesse momento. Padrão
// já usado em `tests/network-mode.test.ts`.

const {
  getPrefsMock,
  registerTransportMock,
  resetRegistryMock,
  isTauriMock,
  torConnectMock,
  installTorWebSocketImplMock,
  initDbMock,
  loadPrefsMock,
  loadRelaysMock,
  loadModLocalMock,
  loadIdentitiesMock,
  loadFollowsMock,
  loadCommentCountsMock,
  isPasskeyEnabledMock,
  getOrCreateIdentityMock,
  startSyncMock,
  startProbeMock,
  evictOldPostsMock,
  checkRelayConnectivityMock,
  wssTransportRef,
  webrtcTransportRef,
} = vi.hoisted(() => {
  // Sentinel objects — orchestrator API é só "registrar essa instância".
  // Identidade por referência é suficiente; não precisa do shape completo.
  const wssTransportRef = { __id: 'wss' as const }
  const webrtcTransportRef = { __id: 'webrtc' as const }
  return {
    getPrefsMock: vi.fn(),
    registerTransportMock: vi.fn(),
    resetRegistryMock: vi.fn(),
    isTauriMock: vi.fn(() => false),
    torConnectMock: vi.fn(),
    installTorWebSocketImplMock: vi.fn(),
    initDbMock: vi.fn(),
    loadPrefsMock: vi.fn(),
    loadRelaysMock: vi.fn(),
    loadModLocalMock: vi.fn(),
    loadIdentitiesMock: vi.fn(),
    loadFollowsMock: vi.fn(),
    loadCommentCountsMock: vi.fn(),
    isPasskeyEnabledMock: vi.fn(),
    getOrCreateIdentityMock: vi.fn(),
    startSyncMock: vi.fn(),
    startProbeMock: vi.fn(),
    evictOldPostsMock: vi.fn(),
    checkRelayConnectivityMock: vi.fn(),
    wssTransportRef,
    webrtcTransportRef,
  }
})

vi.mock('../src/lib/db', () => ({
  initDb: initDbMock,
  db: { exec: vi.fn(), get: vi.fn(), run: vi.fn() },
}))

vi.mock('../src/lib/identity', () => ({
  getOrCreateIdentity: getOrCreateIdentityMock,
}))

vi.mock('../src/lib/nostr', () => ({
  checkRelayConnectivity: checkRelayConnectivityMock,
}))

vi.mock('../src/lib/sync', () => ({
  startSync: startSyncMock,
}))

vi.mock('../src/lib/prefs', () => ({
  loadPrefs: loadPrefsMock,
  getPrefs: () => getPrefsMock(),
}))

vi.mock('../src/lib/relays', () => ({
  loadRelays: loadRelaysMock,
}))

vi.mock('../src/lib/identities', () => ({
  loadIdentities: loadIdentitiesMock,
}))

vi.mock('../src/lib/follows', () => ({
  loadFollows: loadFollowsMock,
}))

vi.mock('../src/lib/moderation-local', () => ({
  loadModLocal: loadModLocalMock,
}))

vi.mock('../src/lib/passkey', () => ({
  isPasskeyEnabled: isPasskeyEnabledMock,
  verifyPasskey: vi.fn(),
}))

vi.mock('../src/lib/probe', () => ({
  startProbe: startProbeMock,
}))

vi.mock('../src/lib/cache', () => ({
  evictOldPosts: evictOldPostsMock,
}))

vi.mock('../src/lib/comment-counts', () => ({
  loadCommentCounts: loadCommentCountsMock,
}))

vi.mock('../src/lib/transport/wss', () => ({
  wssTransport: wssTransportRef,
}))

vi.mock('../src/lib/transport/webrtc', () => ({
  webrtcTransport: webrtcTransportRef,
}))

vi.mock('../src/lib/transport/orchestrator', () => ({
  registerTransport: registerTransportMock,
  _resetRegistry: resetRegistryMock,
}))

vi.mock('../src/lib/runtime', () => ({
  isTauri: isTauriMock,
}))

vi.mock('../src/lib/transport/tor', () => ({
  torConnect: torConnectMock,
}))

vi.mock('../src/lib/transport/torWebSocket', () => ({
  installTorWebSocketImpl: installTorWebSocketImplMock,
}))

// ─── Helpers ─────────────────────────────────────────────────────────

function setNetworkMode(mode: NetworkMode): void {
  const prefs: UserPrefs = { ...DEFAULT_USER_PREFS, network_mode: mode }
  getPrefsMock.mockReturnValue(prefs)
}

/**
 * Carrega bootstrap fresh entre testes. `vi.resetModules()` força
 * re-execução de módulo — garante que o `bootPromise` singleton dentro
 * de bootstrap.ts seja limpo. Sem isso, segunda chamada a `startBoot()`
 * retornaria a promise da primeira corrida.
 */
async function freshStartBoot(): Promise<void> {
  vi.resetModules()
  // crossOriginIsolated check em bootstrap.ts:166 olha pra `window`.
  // Stub mínimo pra passar a guarda.
  const w = globalThis as { window?: { crossOriginIsolated?: boolean } }
  w.window = { crossOriginIsolated: true }
  const mod = await import('../src/lib/bootstrap')
  await mod.startBoot()
}

// ─── beforeEach ──────────────────────────────────────────────────────

beforeEach(() => {
  // `mockReset: true` no vitest.config.ts limpa retornos entre testes;
  // re-armar todo turno garante doBootstrap encontre cada async resolvido.
  initDbMock.mockResolvedValue({ hasOpfs: true, storage: 'opfs' })
  loadPrefsMock.mockResolvedValue(undefined)
  loadRelaysMock.mockResolvedValue(undefined)
  loadModLocalMock.mockResolvedValue(undefined)
  loadIdentitiesMock.mockResolvedValue(undefined)
  loadFollowsMock.mockResolvedValue(undefined)
  loadCommentCountsMock.mockResolvedValue(undefined)
  isPasskeyEnabledMock.mockResolvedValue(false)
  getOrCreateIdentityMock.mockResolvedValue({
    npub: 'npub1test',
    nsec: 'nsec1test',
    pubkeyHex: 'a'.repeat(64),
  })
  startSyncMock.mockResolvedValue(undefined)
  startProbeMock.mockReturnValue(undefined)
  evictOldPostsMock.mockResolvedValue(0)
  checkRelayConnectivityMock.mockResolvedValue([])
  isTauriMock.mockReturnValue(false)
})

// ─── Casos ───────────────────────────────────────────────────────────

describe('§15 — bootstrap registra webrtcTransport gated por network_mode', () => {
  it('clearnet: registra wssTransport E webrtcTransport (modo padrão, sem isolamento)', async () => {
    setNetworkMode('clearnet')
    await freshStartBoot()

    const registered = registerTransportMock.mock.calls.map((c) => c[0])
    expect(registered, 'wssTransport deve estar registrado em clearnet').toContain(
      wssTransportRef,
    )
    expect(registered, 'webrtcTransport deve estar registrado em clearnet (P2P livre)').toContain(
      webrtcTransportRef,
    )
    expect(registerTransportMock).toHaveBeenCalledTimes(2)
  })

  it('tor: registra apenas wssTransport (webrtcTransport bloqueado pra evitar leak via STUN/ICE)', async () => {
    setNetworkMode('tor')
    await freshStartBoot()

    const registered = registerTransportMock.mock.calls.map((c) => c[0])
    expect(registered, 'wssTransport sempre registrado (rotea via TorWebSocket quando arti up)').toContain(
      wssTransportRef,
    )
    expect(
      registered,
      'webrtcTransport NÃO pode estar registrado em modo tor — STUN/ICE vazaria IP local',
    ).not.toContain(webrtcTransportRef)
    expect(registerTransportMock).toHaveBeenCalledTimes(1)
  })

  it('onion-only: registra apenas wssTransport (paranoia máxima — WebRTC desabilitado)', async () => {
    setNetworkMode('onion-only')
    await freshStartBoot()

    const registered = registerTransportMock.mock.calls.map((c) => c[0])
    expect(registered).toContain(wssTransportRef)
    expect(
      registered,
      'webrtcTransport NÃO pode estar registrado em onion-only — promessa de "isolamento iminente" do banner R6',
    ).not.toContain(webrtcTransportRef)
    expect(registerTransportMock).toHaveBeenCalledTimes(1)
  })
})
