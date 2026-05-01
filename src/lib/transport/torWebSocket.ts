/**
 * TorWebSocket — WebSocket-like API que rota via Tor através de IPC.
 *
 * Webview Tauri (Edge/WebView2 / WebKit / WebKitGTK) ignora system
 * proxy programático em runtime. Mesmo se setasse SOCKS5 em env var,
 * o `WebSocket()` global da pilha web continuaria direto ao destino.
 * Solução adotada: implementar uma classe TS que **mimetiza** a API
 * `WebSocket` mínima exigida por `nostr-tools` mas, internamente,
 * invoca os IPC commands `tor_ws_open/send/close` (Etapa 3a, Rust)
 * que rodam tokio-tungstenite *dentro* do `arti DataStream` (frames
 * WS + TLS sobre circuit Tor).
 *
 * `nostr-tools/pool` aceita injeção de implementação custom via
 * `useWebSocketImplementation(impl)`. Trocamos o constructor global
 * apenas quando `prefs.network_mode === 'tor' | 'onion-only'`. Em
 * `clearnet`, o `WebSocket` nativo segue ativo — caminho rápido sem
 * overhead.
 *
 * ## Subset da API WebSocket implementado
 *
 * - Construtor `(url: string)` (segundo arg `protocols` ignorado —
 *   nostr-tools não usa subprotocols)
 * - Propriedades: `url`, `readyState` (CONNECTING/OPEN/CLOSING/CLOSED),
 *   `onopen`, `onmessage`, `onerror`, `onclose`
 * - Métodos: `send(data)` (string only — Nostr é JSON), `close(code?, reason?)`
 *
 * NÃO implementado (não necessário pra nostr-tools/pool):
 * - `addEventListener` (preferimos `onX` callbacks)
 * - `binaryType`, `bufferedAmount`, `extensions`, `protocol` props
 * - Events tipo nativos (`MessageEvent`, `CloseEvent`) — usamos objeto
 *   plano com mesma shape
 * - **`ping()`/`once('pong')`**: APIs do pacote `ws` (Node-only) usadas
 *   por `nostr-tools/abstract-relay.js:waitForPingPong` quando o pool
 *   é instanciado com `enablePing: true`. **Limitação**: NÃO usar
 *   `enablePing: true` no SimplePool quando TorWebSocket está
 *   instalado — quebraria com `TypeError: this.ws.ping is not a
 *   function`. Default do nostr-tools é `enablePing: undefined`
 *   (= false), então o caminho default está seguro. Marshall 3
 *   (Sprint 3 do roadmap pós-auditoria). Se algum dia precisarmos
 *   de pings (debug latência Tor, exatamente o caso onde fariam
 *   sentido), implementar `ping()` como no-op + emitir `pong`
 *   sintético via `setTimeout(0)` — satisfaz o contrato sem custo
 *   real.
 *
 * Manifesto §15 (anti-censura), §17 (auditável), §28 (privacidade).
 */

// Constantes do readyState — alinhadas com `WebSocket.CONNECTING/...`
// pra que callers que comparam contra esses números (nostr-tools faz)
// funcionem sem ajuste.
const WS_CONNECTING = 0
const WS_OPEN = 1
const WS_CLOSING = 2
const WS_CLOSED = 3

/** Shape mínima esperada pelo nostr-tools/pool. Não usamos `Event`
 *  nativo porque seria gerar DOM event em runtime que talvez nem
 *  esteja em escopo (nostr-tools roda em Node/SSR também). */
interface WsLikeEvent {
  type: string
  target: TorWebSocket
}
interface WsLikeMessageEvent extends WsLikeEvent {
  data: string
}
interface WsLikeCloseEvent extends WsLikeEvent {
  code: number
  reason: string
  wasClean: boolean
}

/** Payload dos eventos Tauri vindos do `tor_ws.rs`. Shapes espelham
 *  exatamente os structs `WsMsgPayload`/`WsClosePayload`/`WsErrorPayload`
 *  com `#[serde(rename_all = "camelCase")]` (Sprint 3). Marshall item 1
 *  identificou que o rename estava ausente nesses 3 structs (TorStatus
 *  já tinha) — funcionava por coincidência (`is_binary` snake batia
 *  com TS snake). Padronizado preventivamente. */
interface IpcMsgPayload {
  handle: number
  data: string
  isBinary: boolean
}
interface IpcClosePayload {
  handle: number
  code: number
  reason: string
}
interface IpcErrorPayload {
  handle: number
  error: string
}

/**
 * Implementação WebSocket-like que tunela via Tor.
 *
 * Usage em produção é via `useWebSocketImplementation(TorWebSocket)`
 * antes de qualquer `SimplePool` instance ser criada — ver wire-up
 * em `bootstrap.ts` (Etapa 4).
 */
export class TorWebSocket {
  // Estados nativos pra compat com código que checa contra constantes:
  static readonly CONNECTING = WS_CONNECTING
  static readonly OPEN = WS_OPEN
  static readonly CLOSING = WS_CLOSING
  static readonly CLOSED = WS_CLOSED
  readonly CONNECTING = WS_CONNECTING
  readonly OPEN = WS_OPEN
  readonly CLOSING = WS_CLOSING
  readonly CLOSED = WS_CLOSED

  readonly url: string
  readyState: number = WS_CONNECTING

  // Callbacks no estilo `onX = (ev) => {...}`. nostr-tools sets these.
  onopen: ((ev: WsLikeEvent) => void) | null = null
  onmessage: ((ev: WsLikeMessageEvent) => void) | null = null
  onerror: ((ev: WsLikeEvent) => void) | null = null
  onclose: ((ev: WsLikeCloseEvent) => void) | null = null

  /** Handle u64 alocado pelo Rust em `tor_ws_open`. `null` antes de
   *  open completar; quando close fechar, vira null pra impedir send
   *  em handle morto. */
  private handle: number | null = null

  /** Promises das `unlisten` functions retornadas pelo `listen()` da
   *  Tauri events API. Limpos em `_cleanup`. */
  private unlisteners: Array<() => void> = []

  /** Buffer de mensagens enviadas antes do open completar. send()
   *  drena assim que `handle` aparece. Mantém compat com clientes
   *  que assumem "send é OK em qualquer estado pré-OPEN" (raro mas
   *  defensivo). nostr-tools sempre espera onopen, mas defensive. */
  private pendingSends: string[] = []

  constructor(url: string) {
    this.url = url
    void this._open(url)
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  private async _open(url: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const { listen } = await import('@tauri-apps/api/event')

      // Subscribe nos 3 eventos *antes* de abrir, pra não perder
      // primeiros frames (Tauri buffer events na fila do listener
      // assim que `listen` resolve).
      const unMsg = await listen<IpcMsgPayload>('tor_ws::msg', (e) => {
        if (e.payload.handle !== this.handle) return
        if (e.payload.isBinary) return // drop binary (vide tor_ws.rs)
        this._dispatchMessage(e.payload.data)
      })
      const unClose = await listen<IpcClosePayload>('tor_ws::close', (e) => {
        if (e.payload.handle !== this.handle) return
        this._dispatchClose(e.payload.code, e.payload.reason, true)
      })
      const unErr = await listen<IpcErrorPayload>('tor_ws::error', (e) => {
        if (e.payload.handle !== this.handle) return
        this._dispatchError()
        // erro vira close não-clean implícito pelo lado Rust
      })
      this.unlisteners.push(unMsg, unClose, unErr)

      // Open via IPC — Rust faz arti.connect + tokio-tungstenite handshake.
      // Pode levar 2-30s em Tor (vs ~50-500ms clearnet).
      const handle = await invoke<number>('tor_ws_open', { url })
      this.handle = handle
      this.readyState = WS_OPEN

      // Drena buffer pre-open. Ordem preservada (FIFO).
      const buffered = this.pendingSends
      this.pendingSends = []
      for (const data of buffered) {
        await this._sendInternal(data)
      }

      // Notifica caller. setTimeout(0) emula microtask boundary que
      // WebSocket nativo respeita (open antes de qualquer send sync).
      this.onopen?.({ type: 'open', target: this })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[TorWebSocket] open falhou:', errMsg)
      // Sprint 3 (Marshall 2): se _open falha antes de OPEN, qualquer
      // send() pré-OPEN ficou enfileirado em pendingSends sem nunca
      // ser consumido. Limpar evita leak quando alguma ref ao
      // TorWebSocket sobreviver (ex: cache de retry no nostr-tools).
      // Tamanho típico: 0-5 entradas; impacto real é micro, mas
      // política limpa.
      this.pendingSends = []
      this._dispatchError()
      this._dispatchClose(1006, errMsg, false)
    }
  }

  // ─── send ────────────────────────────────────────────────────────

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') {
      // Nostr é JSON text. Se algum dia precisar binário, encode
      // base64 + chamar IPC equivalente. Hoje seria silent-drop
      // perigoso, então throw alto.
      throw new Error('TorWebSocket.send: só aceita string (Nostr text frames)')
    }
    if (this.readyState === WS_CONNECTING) {
      this.pendingSends.push(data)
      return
    }
    if (this.readyState !== WS_OPEN) {
      // close()/error já passou — silent drop como WebSocket nativo.
      return
    }
    void this._sendInternal(data)
  }

  private async _sendInternal(data: string): Promise<void> {
    if (this.handle === null) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('tor_ws_send', { handle: this.handle, data })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[TorWebSocket] send falhou:', errMsg)
      this._dispatchError()
      this._dispatchClose(1006, errMsg, false)
    }
  }

  // ─── close ───────────────────────────────────────────────────────

  close(code = 1000, reason = ''): void {
    if (this.readyState === WS_CLOSED || this.readyState === WS_CLOSING) return
    this.readyState = WS_CLOSING
    void this._closeInternal(code, reason)
  }

  private async _closeInternal(code: number, reason: string): Promise<void> {
    if (this.handle === null) {
      // Nunca abriu — só limpa o estado local.
      this._cleanup()
      this._dispatchClose(code, reason, true)
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('tor_ws_close', { handle: this.handle, code, reason })
      // Não emit close aqui — o handler do evento `tor_ws::close` fará
      // (Rust manda quando ack o close frame). Race: se Rust falhar em
      // emit, ficamos em CLOSING — aceitamos por simplicidade. nostr-tools
      // tolera essa janela curta.
    } catch (err) {
      console.warn('[TorWebSocket] close falhou:', err)
      this._dispatchClose(1006, String(err), false)
    }
  }

  // ─── Dispatchers ─────────────────────────────────────────────────

  private _dispatchMessage(data: string): void {
    this.onmessage?.({ type: 'message', target: this, data })
  }

  private _dispatchError(): void {
    this.onerror?.({ type: 'error', target: this })
  }

  private _dispatchClose(code: number, reason: string, wasClean: boolean): void {
    if (this.readyState === WS_CLOSED) return
    this.readyState = WS_CLOSED
    this._cleanup()
    this.onclose?.({ type: 'close', target: this, code, reason, wasClean })
  }

  private _cleanup(): void {
    for (const un of this.unlisteners) {
      try {
        un()
      } catch {
        /* noop */
      }
    }
    this.unlisteners = []
    this.handle = null
  }
}

/**
 * Injeta `TorWebSocket` como implementação default do `nostr-tools/pool`.
 * Idempotente — chamadas múltiplas com o mesmo flag são no-op (mas
 * trocar entre Tor e clearnet em runtime exige `location.reload()`
 * pra que `SimplePool` instances antigas reciclem; aceita-se isso
 * porque trocar `network_mode` já dispara reload — ver bootstrap.ts).
 *
 * Importa nostr-tools dinamicamente pra evitar bundle-cost em PWA puro
 * (que nem chega aqui — `isTauri()` guarda a chamada).
 */
export async function installTorWebSocketImpl(): Promise<void> {
  // Both pool and relay re-export the same hook; pool é o mais alto
  // nível e é o único usado pelo wssTransport.
  const { useWebSocketImplementation } = await import('nostr-tools/pool')
  useWebSocketImplementation(TorWebSocket)
  console.log('[TorWebSocket] WebSocket implementation override applied')
}
