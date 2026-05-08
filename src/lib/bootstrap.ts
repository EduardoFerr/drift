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
import { loadCommentCounts } from './comment-counts'
import { wssTransport } from './transport/wss'
import { webrtcTransport } from './transport/webrtc'
import { registerTransport } from './transport/orchestrator'
import { isTauri } from './runtime'
import { torConnect } from './transport/tor'
import { installTorWebSocketImpl } from './transport/torWebSocket'
import { getPrefs } from './prefs'

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

/**
 * Razão pela qual o boot terminou em estado "ready" mas DEGRADADO —
 * uma ou mais features opcionais falharam, app continua funcional
 * em modo reduzido. Lily 1 + Sprint 6 do roadmap pós-auditoria.
 *
 * `code` é estável (programático — UI pode trocar copy por idioma);
 * `message` é human-readable pra dev/log.
 */
export interface DegradedReason {
  /** Código estável e indexável. Adicionar novos valores requer
   *  caso UI explícito; não usar como string livre. */
  code:
    | 'TOR_BOOTSTRAP_FAILED'
    | 'TOR_FEATURE_OFF'
    | 'PROBE_FAILED'
    | 'EVICTION_NOT_SCHEDULED'
  /** Mensagem detalhada (ex: stack do erro arti). */
  message: string
}

export interface BootState {
  step: BootStep
  error: string | null
  isolated: boolean | null
  hasOpfs: boolean | null
  /** Modo concreto de storage (Fase 5): opfs | kvvfs | memory */
  storage: StorageMode | null
  identity: DriftIdentity | null
  relays: RelayHealth[] | null
  /**
   * Falhas non-fatal que aconteceram durante o boot mas não impediram
   * `step === 'ready'`. UI usa pra mostrar indicador "modo degradado"
   * sem bloquear o app. Sprint 6 do roadmap pós-auditoria.
   *
   * Política de erro durante doBootstrap (Lily 1):
   *  - **Fatal** (vira `step: 'error'`): isolation, db, identity.
   *    Sem isso, app não funciona — mostra modal/tela de erro.
   *  - **Degradado** (acumula em `degradedReasons`, segue `step:
   *    'ready'`): tor, probe, eviction. App funciona com feature
   *    desligada; user precisa saber.
   *  - **Best-effort silencioso** (só log): identidades secundárias,
   *    follows. Background; ausência não trava UX.
   */
  degradedReasons: DegradedReason[]
}

const INITIAL: BootState = {
  step: 'idle',
  error: null,
  isolated: null,
  hasOpfs: null,
  storage: null,
  identity: null,
  relays: null,
  degradedReasons: [],
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

/** Adiciona razão à lista de degradedReasons mantendo idempotência por
 *  `code` — chamar 2× com mesmo código não duplica entrada. UI consome
 *  via `useBootStore(s => s.degradedReasons)`. */
function addDegradedReason(code: DegradedReason['code'], message: string): void {
  setBoot((p) => {
    if (p.degradedReasons.some((r) => r.code === code)) return p
    return {
      ...p,
      degradedReasons: [...p.degradedReasons, { code, message }],
    }
  })
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

    // ─── Modo Tor (Fase 6.4 etapa 4) ──────────────────────────────
    //
    // Quando user selecionou `tor` ou `onion-only` E estamos em runtime
    // Tauri (PWA não tem arti), bootamos o cliente Tor antes de tudo
    // que abre WebSocket. Em sucesso, instalamos `TorWebSocket` como
    // implementação global do nostr-tools/pool — daí em diante, o
    // `wssTransport` (que já está abaixo) abre WebSockets via IPC →
    // tokio-tungstenite → arti circuit. Manifesto §15.
    //
    // Em falha (bootstrap failed, listener falhou): logamos e seguimos
    // em modo `clearnet` degradado — feed funciona, mas IP do user vaza
    // pro relay. UI alerta via banner R6 quando aplicável (onion-only
    // sem onion). Decisão: NÃO bloquear o boot em modo tor com falha,
    // pra evitar app travado em condições de rede ruins; quem queria
    // anonimato sabe que precisa retry / reportar.
    const networkMode = getPrefs().network_mode
    if (isTauri() && (networkMode === 'tor' || networkMode === 'onion-only')) {
      try {
        const torStatus = await torConnect()
        if (torStatus.state === 'connected') {
          await installTorWebSocketImpl()
          console.log(
            `[bootstrap] Tor conectado · proxy=${torStatus.proxyAddr} · circuits=${torStatus.circuitCount}`,
          )
        } else {
          // Sprint 6: registra na BootState pra UI alertar. Não trava
          // o boot — manifesto §15 cumprido em sucesso, opção do user
          // em falha (pode reload pra retry, ou voltar pra clearnet
          // em Settings). Banner de Settings (Sprint 2) já cobre.
          const msg = `Tor não conectou (state=${torStatus.state}, err=${torStatus.lastError ?? 'none'})`
          console.warn(`[bootstrap] ${msg} — degradando pra clearnet nesta sessão`)
          addDegradedReason('TOR_BOOTSTRAP_FAILED', msg)
        }
      } catch (err) {
        // Em modo `arti` feature OFF, `tor_connect` retorna erro stub;
        // capturamos e seguimos em clearnet com sinal explícito pra UX.
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[bootstrap] tor_connect lançou:', msg)
        addDegradedReason('TOR_FEATURE_OFF', msg)
      }
    }

    // Fase 6.2-E: registra transportes ativos no orchestrator antes do
    // startSync. WSS é o transporte primário; WebRTC ativa peer-to-peer
    // quando há peers conectados (default mock signaling = só entre abas
    // mesma origin; Nostr signaling via flag `VITE_USE_NOSTR_SIGNALING=1`
    // pra peers em redes diferentes). Manifesto §12 (múltiplos transportes).
    //
    // Quando `network_mode` é tor/onion-only e arti conectou acima, o
    // `wssTransport` abaixo automaticamente roteia via Tor (TorWebSocket
    // já foi instalado no SimplePool global do nostr-tools). NÃO registramos
    // `torTransport` separado — seria duplicação ruidosa pra orchestrator.
    registerTransport(wssTransport, { weight: 10 })
    registerTransport(webrtcTransport, { weight: 5 })

    await startSync()

    // Track C.6.1 — prefetch contagens de comments do banco local pra
    // UI mostrar "💬 N" sem materializar threads. Fire-and-forget: query
    // agregada COUNT(*) GROUP BY post_id é barata mas não bloqueia boot.
    void loadCommentCounts().catch((err) => {
      console.warn('[bootstrap] loadCommentCounts falhou (degraded):', err)
    })

    // Boot completo — UI renderiza imediatamente.
    // checkRelayConnectivity abre WebSockets DEDICADOS por relay
    // só pra medir latency (uso só informacional em DiagnosticPanel).
    // Com 4 relays seed, são +4 WS além das ~4 que `startSync` já
    // abriu via SimplePool — dobra connections no boot crítico.
    // Fix: marca step=ready imediatamente; relays como `null` (UI
    // mostra "checando…"); health probe roda em background sem bloquear.
    setBoot((p) => ({ ...p, step: 'ready' }))
    void checkRelayConnectivity()
      .then((relays) => setBoot((p) => ({ ...p, relays })))
      .catch((err) => {
        console.warn('[bootstrap] relay health check falhou:', err)
      })

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
