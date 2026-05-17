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
import { loadPrefs, usePrefsStore } from './prefs'
import { applyTheme, DEFAULT_THEME_ID, isThemeId } from './theme'
import { loadRelays } from './relays'
import { loadIdentities } from './identities'
import { loadFollows } from './follows'
import { loadLens } from './trust-lens'
import { loadModLocal } from './moderation-local'
// V10.11 — passkey movido pra dynamic import. ~3.58 KB raw / 1.4 KB gz
// fica fora do entry chunk; só carrega se user efetivamente habilitou
// Passkey em Settings (manifesto §13.5 opt-in puro). Maioria dos users
// nunca toca esse módulo. WebAuthn API + IndexedDB access ficam lazy.
// (Import original abaixo, comentado pra referência histórica.)
// import { isPasskeyEnabled, verifyPasskey } from './passkey'
import { startProbe } from './probe'
import { evictOldPosts } from './cache'
import { loadCommentCounts } from './comment-counts'
import { wssTransport } from './transport/wss'
import { registerTransport } from './transport/orchestrator'
import { isTauri } from './runtime'
import { getPrefs } from './prefs'
// CWV-3 (2026-05-15): `webrtcTransport`, `torConnect` e
// `installTorWebSocketImpl` movidos pra dynamic import() — os 3 só são
// consumidos APÓS o boot virar `step:'ready'` (webrtc dentro do
// `scheduleIdle`; tor dentro do bloco guard `isTauri() && mode==='tor'`).
// Importar eager carregava ~17 KB raw / ~5 KB gzip (a árvore inteira
// do webrtc, 12 sub-módulos) no entry. Lighthouse 2026-05-15: "Reduce unused
// JavaScript". `wssTransport` continua eager — é registrado sempre, em
// todos os modos. Ver §3.2 do CWV-2 RFC.

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

    // Aplica tema CSS-var no <html data-theme="X"> antes do primeiro
    // render — evita flash de tema default → tema persistido. Subscribe
    // reativo ao store: qualquer mutação via setPref('theme_id', ...)
    // dispara applyTheme automaticamente.
    const initialThemeId = usePrefsStore.getState().theme_id
    applyTheme(isThemeId(initialThemeId) ? initialThemeId : DEFAULT_THEME_ID)
    usePrefsStore.subscribe((state, prev) => {
      if (state.theme_id !== prev.theme_id && isThemeId(state.theme_id)) {
        applyTheme(state.theme_id)
      }
    })

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
    const { isPasskeyEnabled, verifyPasskey } = await import('./passkey')
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

    // Trust Lens — carrega strength persistido + filter rules + cache PPR.
    // Cold-start (cache vazio) é safe: getPprForAuthor retorna 0 e
    // viewMultiplier degrada graciosamente. Manifesto §24 (view-layer).
    await loadLens()

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
        // Lazy: tor.ts + torWebSocket.ts só carregam em Tauri + modo tor.
        // PWA browser nunca alcança este branch → chunk não baixa.
        const [{ torConnect }, { installTorWebSocketImpl }] = await Promise.all([
          import('./transport/tor'),
          import('./transport/torWebSocket'),
        ])
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

    // ─── Boot perceptualmente "ready" ─────────────────────────────
    //
    // Lighthouse 2026-05-15 audit:
    //   `vendor-nostr-*.js` scripting = 5.08s no boot
    //   mainthread-work = 7.6s, bootup-time = 5.7s
    //
    // Causa: `startSync()` (logo abaixo, agora deferido) abre
    // WebSocket(s) via SimplePool + recebe até 500×N relays = ~2000
    // eventos stored, e cada um passa por `verifyEvent` (Schnorr
    // secp256k1, ~1ms cada → ~2s scripting puro só no verify storm
    // inicial). Antes esse storm rodava ANTES de `step:'ready'`,
    // bloqueando first paint.
    //
    // Agora: marcamos `step:'ready'` imediatamente — UI renderiza feed
    // **de SQLite local** (cache da sessão anterior; primeira boot
    // mostra empty state brevemente). Sync, registerTransport e probe
    // são agendados via `requestIdleCallback` pra rodar entre paints,
    // não no caminho crítico. Manifesto §7 (determinismo) preservado:
    // ordem de eventos só afeta velocidade de catch-up, não score
    // final. Invariante #1 (onNostrEvent única porta) preservado: só
    // mudou QUANDO `startSync` chama subscribe, não O QUE acontece em
    // cada evento.
    setBoot((p) => ({ ...p, step: 'ready' }))

    // Track C.6.1 — prefetch contagens de comments do banco local pra
    // UI mostrar "💬 N" sem materializar threads. Fire-and-forget: query
    // agregada COUNT(*) GROUP BY post_id é barata mas não bloqueia boot.
    void loadCommentCounts().catch((err) => {
      console.warn('[bootstrap] loadCommentCounts falhou (degraded):', err)
    })

    // ─── Post-paint: trabalho não-crítico ─────────────────────────
    //
    // Tudo abaixo abre WebSockets, dispara verify-storm de eventos
    // stored ou faz network I/O. Mover pra idle desloca scripting time
    // do critical path de boot pra depois do first paint — INP fica
    // sensivelmente melhor sem mudar comportamento funcional.
    //
    // `timeout: 2000` garante execução em até 2s mesmo se o browser
    // nunca achar idle (mobile com main thread saturada). Fallback
    // setTimeout(0) cobre Safari <16.4 que não tem requestIdleCallback.
    scheduleIdle(() => {
      // Fase 6.2-E: registra transportes ativos no orchestrator antes do
      // startSync. WSS é o transporte primário; WebRTC ativa peer-to-peer
      // quando há peers conectados (default mock signaling = só entre abas
      // mesma origin; Nostr signaling via flag `VITE_USE_NOSTR_SIGNALING=1`
      // pra peers em redes diferentes). Manifesto §12 (múltiplos transportes).
      //
      // Quando `network_mode` é tor/onion-only e arti conectou acima, o
      // `wssTransport` automaticamente roteia via Tor (TorWebSocket já foi
      // instalado no SimplePool global do nostr-tools). NÃO registramos
      // `torTransport` separado — seria duplicação ruidosa pra orchestrator.
      registerTransport(wssTransport, { weight: 10 })
      // §15 anti-censura + §27 privacidade visível: WebRTC P2P pode vazar IP
      // do user via STUN/ICE candidates locais mesmo quando o tráfego Nostr
      // passa por Tor. Em modo `tor`/`onion-only`, NÃO registramos
      // `webrtcTransport` pra honrar a promessa de anonimato do user.
      // Spec: `Docs/webrtc-6.4-plan.md` §IP leak via WebRTC ICE.
      //
      // Decisão init-only: se o user trocar `network_mode` em Settings, exige
      // reload (convenção do Drift — `setActiveIdentity` faz o mesmo).
      //
      // CWV-3: lazy import — árvore webrtc inteira (~2700 LOC em 12 sub-módulos) sai
      // do entry chunk. `void` fire-and-forget; ordem de registro não
      // muda (wssTransport já registrado; orchestrator é multi-transport).
      if (networkMode === 'clearnet') {
        void import('./transport/webrtc')
          .then(({ webrtcTransport, startFollowsDiscovery }) => {
            registerTransport(webrtcTransport, { weight: 5 })
            startFollowsDiscovery()
          })
          .catch((err) => {
            console.warn('[bootstrap] webrtcTransport lazy import falhou:', err)
          })
      }

      // Antes: `await startSync()` antes de `step:'ready'` → bloqueava
      // ~2s do main thread no Schnorr verify dos primeiros eventos
      // entregues pelos relays. Agora: fire-and-forget após paint. O
      // `pageshow(persisted=true)` em sync.ts:174 cuida do caso bfcache.
      void startSync().catch((err) => {
        console.error('[bootstrap] startSync (deferred) falhou:', err)
      })
    })

    // checkRelayConnectivity abre WebSockets DEDICADOS por relay
    // só pra medir latency (uso só informacional em DiagnosticPanel).
    // Com 4 relays seed, são +4 WS além das ~4 que `startSync` já
    // abriu via SimplePool — dobra connections no boot crítico.
    // Health probe roda em idle pra não competir com o subscribe de
    // sync que acabou de ser agendado.
    scheduleIdle(() => {
      void checkRelayConnectivity()
        .then((relays) => setBoot((p) => ({ ...p, relays })))
        .catch((err) => {
          console.warn('[bootstrap] relay health check falhou:', err)
        })
    })

    // Schedule eviction. Idempotente — só roda se contagem ultrapassou
    // SOFT_LIMIT em cache.ts. Primeira corrida acontece após 6h (não
    // imediatamente — boot já é pesado o suficiente). `scheduleEviction`
    // só seta um `setInterval`, não dispara trabalho síncrono — pode
    // ficar fora do scheduleIdle. Mantemos eager pra que o timer comece
    // a contar imediatamente, não depois da idle window.
    scheduleEviction(identity.npub)

    // Probe anti-eclipse periódico — manifesto §20. Idem `scheduleEviction`:
    // só seta `setInterval`, primeira execução real é em +30min.
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

/**
 * Agenda trabalho não-crítico pra rodar entre paints. Usado pra mover
 * tarefas de boot pra fora do critical path — melhora bootup-time e
 * INP sem mudar comportamento funcional.
 *
 * `requestIdleCallback` com `timeout: 2000` é o ideal: o browser
 * escolhe um momento de idle, mas garante execução em ≤2s mesmo se
 * o main thread ficar saturado (mobile, abas em background promovidas).
 *
 * Fallback `setTimeout(fn, 0)`: Safari <16.4 não expõe
 * `requestIdleCallback`. setTimeout(0) ainda cede o thread ao próximo
 * tick — boot promise resolve, layout pinta, callback roda depois.
 *
 * Não introduzimos dep externa nem polyfill — manifesto §29
 * (compatibilidade Nostr) só impõe runtime browser; aqui usamos só
 * web platform APIs.
 */
function scheduleIdle(fn: () => void): void {
  if (typeof window === 'undefined') {
    // SSR/test: roda síncrono. Tests vitest podem assertar comportamento.
    fn()
    return
  }
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (typeof ric === 'function') {
    ric(fn, { timeout: 2000 })
  } else {
    setTimeout(fn, 0)
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

/**
 * Para o timer de eviction periódica. Chamado por `stopBoot()` pra
 * cleanup em teardown (hot-reload dev, testes, troca de identidade).
 */
export function stopEviction(): void {
  if (evictionTimer) {
    clearInterval(evictionTimer)
    evictionTimer = null
  }
}
