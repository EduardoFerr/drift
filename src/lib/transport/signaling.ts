/**
 * SignalingChannel — abstração de canal de signaling pro WebRTC.
 *
 * Implementações:
 *   - `webrtc-signaling-mock.ts` (Fase 6.1a) — BroadcastChannel,
 *     same-origin only. Pra dev/PoC com 2 abas no mesmo browser.
 *   - `webrtc-signaling-nostr.ts` (Fase 6.1b, futura) — Nostr DM
 *     cifrado (NIP-44 + kind 1059). Pra peers em redes diferentes.
 *
 * `webrtc.ts` recebe a impl via DI. Trocar mock ↔ nostr é flag de
 * configuração; nenhuma mudança no resto do código de transport.
 *
 * Schema das mensagens é o mesmo nas duas impls — o que muda é só
 * o canal de transporte. `from` e `to` são identificadores opacos
 * (peerId UUID no mock; npub hex no Nostr) — tie-break lexicográfico
 * funciona pros dois.
 */

interface BaseMsg {
  /** Identificador do emissor — UUID v4 (mock) ou npub hex (nostr). */
  from: string
  /** Epoch ms. Usado pra debug e (em 6.1b) replay-window de ICE candidates. */
  ts: number
}

/**
 * Anúncio de presença. Mock: broadcast, peers se descobrem
 * automaticamente. Nostr (6.1b): NÃO existe — quem inicia já sabe
 * o npub do alvo via Proof of Interest (manifesto §16).
 */
export interface HelloMsg extends BaseMsg {
  type: 'hello'
  /** Capabilities pra extensibilidade futura. v0 = ['datachannel-v1']. */
  drift: {
    capabilities: string[]
  }
}

/** SDP offer direcionado a um peer específico. */
export interface OfferMsg extends BaseMsg {
  type: 'offer'
  to: string
  sdp: string
}

/** SDP answer direcionado a um peer específico. */
export interface AnswerMsg extends BaseMsg {
  type: 'answer'
  to: string
  sdp: string
}

/**
 * ICE candidate trickle direcionado. `candidate` opcional — se omitido,
 * sinaliza end-of-candidates (pode acelerar setup remoto).
 */
export interface IceMsg extends BaseMsg {
  type: 'ice'
  to: string
  candidate: RTCIceCandidateInit | null
}

/**
 * Notificação de saída. Mock: broadcast — peers removem o emissor do
 * registry. Nostr (6.1b): drop — peer detecta close via dc.onclose
 * (delay 5-10s aceitável).
 */
export interface ByeMsg extends BaseMsg {
  type: 'bye'
}

export type SignalingMessage =
  | HelloMsg
  | OfferMsg
  | AnswerMsg
  | IceMsg
  | ByeMsg

/** Handler registrado via `onMessage`. Invocado a cada msg recebida. */
export type SignalingHandler = (msg: SignalingMessage) => void

/** Função pra unsubscribe um handler — retornada por `onMessage`. */
export type SignalingUnsubscribe = () => void

/**
 * Canal de signaling abstrato. Fluxo típico:
 *
 *   const ch = createChannel({ peerId: myId })
 *   const off = ch.onMessage((msg) => { ... })
 *   await ch.send({ type: 'hello', from: myId, ts: Date.now(), drift: {...} })
 *   ...
 *   off()
 *   ch.close()
 */
export interface SignalingChannel {
  /** Identificador deste peer no canal (echoed em `from` das msgs enviadas). */
  readonly peerId: string

  /** Envia uma msg pelo canal. Em mock: broadcast (filtro por `to` no receptor). */
  send(msg: SignalingMessage): Promise<void>

  /**
   * Registra handler. Returna função pra remover. Múltiplos handlers
   * permitidos — todos recebem cada msg.
   *
   * Filtro por `to`: handler recebe TODAS as msgs do canal, mesmo as não
   * direcionadas. Quem usa decide ignorar (ex: `if (msg.to !== myId) return`).
   * Hello/bye são broadcast e sempre passam.
   */
  onMessage(handler: SignalingHandler): SignalingUnsubscribe

  /**
   * Desliga o canal. Após close: `send` é no-op, handlers param de receber.
   * Idempotente — close() repetido não throwa.
   */
  close(): void
}

/**
 * Tie-break determinístico pra glare prevention (Barney peer review #1).
 *
 * Quando 2 peers entram simultâneo e ambos sentem `hello` do outro, ambos
 * tentariam mandar `offer` ao mesmo tempo (glare). Esta função decide
 * unilateralmente quem inicia: o peer com menor id lexicográfico.
 *
 * Determinístico → ambos os peers chegam à mesma decisão sem comunicação
 * adicional. Funciona com UUIDs (mock) e npubs hex (nostr) — string lex
 * compare está bem definido.
 */
export function shouldInitiateOffer(myId: string, peerId: string): boolean {
  if (myId === peerId) return false // mesmo peer — não conecta consigo
  return myId < peerId
}
