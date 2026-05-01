/**
 * Bootstrap — singleton fora do React.
 *
 * Roda a inicialização do app uma vez por aba (SQLite WASM → identidade
 * → sync de relays → check de saúde dos relays). Mantém o estado em
 * uma store Zustand, expõe getter + subscriber para a UI consumir.
 *
 * Por que fora do React:
 * - React StrictMode em dev mount/unmount/mount pra detectar bugs.
 *   Se o boot rodasse dentro de um useEffect, a flag de cancelled
 *   do primeiro mount mataria todas as transições subsequentes mesmo
 *   após o boot real concluir. Bug clássico.
 * - Bootstrap é por aba, não por componente. Singleton casa com a
 *   semântica real.
 */

import { create } from 'zustand'
import type { DriftIdentity } from '../types/drift'
import { initDb, type StorageMode } from './db'
import { getOrCreateIdentity } from './identity'
import { checkRelayConnectivity, type RelayHealth } from './nostr'
import { startSync } from './sync'
import { loadPrefs } from './prefs'
import { loadRelays } from './relays'
import { loadIdentities } from './identities'
import { loadFollows } from './follows'
import { loadModLocal } from './moderation-local'
import { isPasskeyEnabled, verifyPasskey } from './passkey'
import { startProbe } from './probe'
import { evictOldPosts } from './cache'
import { wssTransport } from './transport/wss'
import { webrtcTransport } from './transport/webrtc'
import { registerTransport } from './transport/orchestrator'

/** A cada 6h corremos eviction. Manifesto §16: cache local respeita
 *  spreads/pinned. Eviction é decisão local de gestão de espaço, não
 *  censura (invariante #13). */
const EVICTION_INTERVAL_MS = 6 * 60 * 60 * 1000

export type BootStep =
  | 'idle'
  | 'isolation'
  | 'db'
  | 'identity'
  | 'sync'
  | 'relays'
  | 'ready'
  | 'error'

export interface BootState {
  step: BootStep
  error: string | null
  isolated: boolean | null
  hasOpfs: boolean | null
  /** Modo concreto de storage (Fase 5): opfs | kvvfs | memory */
  storage: StorageMode | null
  identity: DriftIdentity | null
  relays: RelayHealth[] | null
}

const INITIAL: BootState = {
  step: 'idle',
  error: null,
  isolated: null,
  hasOpfs: null,
  storage: null,
  identity: null,
  relays: null,
}

// ─── Store Zustand ────────────────────────────────────────────────────

/**
 * Hook React. Use no componente como `const boot = useBootStore()`
 * para re-renderizar em qualquer mudança, ou
 * `const step = useBootStore(s => s.step)` para selector específico.
 */
export const useBootStore = create<BootState>(() => INITIAL)

// API legada — mantida para módulos que ainda usam pubsub estilo antigo.
// Internamente delega para o store Zustand.
export const getBootState = useBootStore.getState

export function subscribeBootState(
  listener: (s: BootState) => void,
): () => void {
  return useBootStore.subscribe(listener)
}

function setBoot(updater: (s: BootState) => BootState): void {
  useBootStore.setState(updater)
}

// ─── Promise singleton ────────────────────────────────────────────────

let bootPromise: Promise<void> | null = null

/**
 * Inicia o boot. Idempotente — chamadas subsequentes retornam a mesma
 * promise. Seguro para chamar de múltiplos componentes ou em StrictMode
 * (que monta-desmonta-monta).
 */
export function startBoot(): Promise<void> {
  if (bootPromise) return bootPromise
  bootPromise = doBootstrap()
  return bootPromise
}

async function doBootstrap(): Promise<void> {
  try {
    const isolated =
      typeof window !== 'undefined' && window.crossOriginIsolated === true
    setBoot((p) => ({ ...p, step: 'isolation', isolated }))
    if (!isolated) {
      throw new Error(
        'crossOriginIsolated = false. Confira COOP/COEP no vite.config.ts.',
      )
    }

    setBoot((p) => ({ ...p, step: 'db' }))
    const { hasOpfs, storage } = await initDb()
    setBoot((p) => ({ ...p, hasOpfs, storage }))

    // Carrega preferências locais cedo — UI já consulta show_nsfw_default
    // etc. assim que o feed renderiza. Manifesto §27.
    await loadPrefs()

    // Carrega relays do banco. Primeira corrida popula seeds; corridas
    // subsequentes lêem o que o user acumulou (manualmente, NIP-65,
    // recommend). Manifesto §14.
    await loadRelays()

    // Carrega listas de bloqueio/silenciamento — manifesto §24,
    // camada de visualização local. Feed consome via store síncrona.
    await loadModLocal()

    // Passkey gate (Fase 5 opt-in, manifesto §4): se o user habilitou
    // Passkey em Settings, exigimos verificação ANTES de descriptografar
    // a identidade. Falha de Passkey = boot fica em 'error' e user
    // precisa cancelar e (eventualmente) remover passkey via recuperação
    // (fluxo: clear-site-data + import nsec1 backup).
    if (await isPasskeyEnabled()) {
      try {
        await verifyPasskey()
      } catch (err) {
        throw new Error(
          `Passkey verification falhou: ${err instanceof Error ? err.message : String(err)}. ` +
            'Pra recuperar acesso: cancele e (em outro device ou após "limpar dados do site") ' +
            'importe seu nsec1 backup.',
        )
      }
    }

    setBoot((p) => ({ ...p, step: 'identity' }))
    const identity = await getOrCreateIdentity()
    setBoot((p) => ({ ...p, identity }))

    // Multi-identidade — carrega lista pós-identidade pra UI mostrar
    // no IdentitySwitcher. Manifesto §4. Migração identity→identities
    // (em db.worker) garantiu que a row da identidade ativa atual está
    // em ambas as tabelas.
    await loadIdentities()

    // Follows (NIP-02 kind 3) — manifesto §30. Carrega do banco local
    // primeiro pra UI ficar reativa imediatamente; sync com relays
    // acontece em background (não bloqueia boot).
    await loadFollows()

    setBoot((p) => ({ ...p, step: 'sync' }))
    // Fase 6.2-E: registra transportes ativos no orchestrator antes do
    // startSync. WSS é o transporte primário; WebRTC ativa peer-to-peer
    // quando há peers conectados (default mock signaling = só entre abas
    // mesma origin; Nostr signaling via flag `VITE_USE_NOSTR_SIGNALING=1`
    // pra peers em redes diferentes). Manifesto §12 (múltiplos transportes).
    registerTransport(wssTransport, { weight: 10 })
    registerTransport(webrtcTransport, { weight: 5 })
    // TODO(Fase 6.4 — arti integration): quando `src-tauri/src/tor.rs::tor_connect`
    // sair do stub e expor SOCKS5 local real, registrar `torTransport` aqui
    // condicional ao prefs.network_mode. Esqueleto:
    //
    //   import { torTransport, torConnect } from './transport/tor'
    //   const mode = getPrefs().network_mode
    //   if (mode === 'tor' || mode === 'onion-only') {
    //     await torConnect()
    //     registerTransport(torTransport, { weight: 8 })
    //   }
    //
    // Hoje NÃO registramos: `tor_connect()` retorna erro stub, o que faria
    // o orchestrator acumular failures permanentes em modo tor. UI já gating
    // o picker pra disabled em PWA browser. Manifesto §15.

    await startSync()

    setBoot((p) => ({ ...p, step: 'relays' }))
    const relays = await checkRelayConnectivity()
    setBoot((p) => ({ ...p, relays, step: 'ready' }))

    // Schedule eviction. Idempotente — só roda se contagem ultrapassou
    // SOFT_LIMIT em cache.ts. Primeira corrida acontece após 6h (não
    // imediatamente — boot já é pesado o suficiente).
    scheduleEviction(identity.npub)

    // Probe anti-eclipse periódico — manifesto §20. Roda a cada 30min
    // pegando sample de eventos conhecidos pra verificar que cada
    // relay realmente os entrega.
    startProbe()
  } catch (err) {
    // Multi-aba: OPFS permite só 1 SyncAccessHandle por arquivo. Quando
    // a 2ª aba do mesmo origin tenta abrir, db.worker propaga
    // 'MULTI_TAB_CONFLICT'. App.tsx renderiza MultiTabModal nesse caso —
    // user fecha aba ou recarrega. Não é "erro" no sentido fatal.
    if (err instanceof Error && err.name === 'MULTI_TAB_CONFLICT') {
      console.warn('[bootstrap] conflito multi-aba detectado — exibindo modal')
      setBoot((p) => ({ ...p, step: 'error', error: 'MULTI_TAB_CONFLICT' }))
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bootstrap]', err)
    setBoot((p) => ({ ...p, step: 'error', error: message }))
  }
}

let evictionTimer: ReturnType<typeof setInterval> | null = null

function scheduleEviction(currentNpub: string): void {
  if (evictionTimer) return // idempotente — chamada repetida no mesmo boot

  evictionTimer = setInterval(() => {
    void evictOldPosts(currentNpub)
      .then((removed) => {
        if (removed > 0) {
          console.log(`[bootstrap] eviction removeu ${removed} posts frios`)
        }
      })
      .catch((err) => {
        console.error('[bootstrap] eviction falhou:', err)
      })
  }, EVICTION_INTERVAL_MS)
}
