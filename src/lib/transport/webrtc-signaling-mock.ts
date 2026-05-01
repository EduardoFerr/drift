/**
 * webrtc-signaling-mock — implementação `SignalingChannel` via
 * BroadcastChannel (same-origin only).
 *
 * Pra Fase 6.1a (PoC): permite 2+ abas no mesmo browser/origin se
 * descobrirem e estabelecerem conexões WebRTC P2P. Útil pra dev,
 * smoke test, e2e manual.
 *
 * Em Fase 6.1b, `webrtc-signaling-nostr.ts` substitui esta impl pra
 * peers em redes diferentes (signaling via Nostr DM cifrado NIP-44).
 * O contrato `SignalingChannel` é o mesmo nas duas — `webrtc/boot.ts` não
 * precisa mudar.
 *
 * Limitações intencionais:
 *   - Same-origin only (BroadcastChannel não atravessa origins). Pra
 *     produção real, usa nostr signaling (6.1b).
 *   - Sem autenticação — qualquer aba na mesma origin pode mandar.
 *     Aceitável em dev; em prod, npub assinado já é a auth (6.1b).
 *   - Sem persistência — peers que entram depois não veem hellos
 *     antigos. Aceitável: hello é "estou aqui agora", não histórico.
 */

import type {
  SignalingChannel,
  SignalingHandler,
  SignalingMessage,
  SignalingUnsubscribe,
} from './signaling'

const CHANNEL_NAME = 'drift-webrtc-signaling-mock'

/**
 * Cria um SignalingChannel local via BroadcastChannel.
 *
 * @param peerId Identificador único deste peer no canal. Default = UUID
 *   gerado lazy. Permite injeção pra testes determinísticos (peer A
 *   sempre tem id "aaaa...", peer B "bbbb..." pra tie-break previsível).
 */
export function createMockSignalingChannel(peerId?: string): SignalingChannel {
  const myPeerId = peerId ?? randomPeerId()

  // BroadcastChannel pode não existir em ambientes server-side ou jsdom
  // antigo. Fallback: noop channel que loga warning.
  if (typeof BroadcastChannel === 'undefined') {
    console.warn(
      '[mock-signaling] BroadcastChannel indisponível — canal noop. ' +
        'Provavelmente test em jsdom antigo OU SSR.',
    )
    return createNoopChannel(myPeerId)
  }

  const bc = new BroadcastChannel(CHANNEL_NAME)
  const handlers = new Set<SignalingHandler>()
  let closed = false

  bc.onmessage = (event: MessageEvent) => {
    if (closed) return
    const msg = event.data as SignalingMessage
    // Ignora msgs sem shape mínimo (defesa contra debris no canal).
    if (!isValidSignalingMessage(msg)) return
    // Echo: BroadcastChannel NÃO ecoa mensagens enviadas pelo próprio
    // emissor por padrão — então não precisamos filtrar self aqui.
    // Mas defesa-em-profundidade: se algum dia a spec mudar...
    if (msg.from === myPeerId) return
    for (const h of handlers) {
      try {
        h(msg)
      } catch (err) {
        console.error('[mock-signaling] handler threw:', err)
      }
    }
  }

  return {
    peerId: myPeerId,
    async send(msg: SignalingMessage): Promise<void> {
      if (closed) return
      // Sanity: from deve ser o nosso id (não confiar no caller).
      if (msg.from !== myPeerId) {
        console.warn(
          `[mock-signaling] msg.from='${msg.from}' !== peerId='${myPeerId}' — corrigindo`,
        )
        msg = { ...msg, from: myPeerId }
      }
      bc.postMessage(msg)
    },
    onMessage(handler: SignalingHandler): SignalingUnsubscribe {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close(): void {
      if (closed) return
      closed = true
      handlers.clear()
      try {
        bc.close()
      } catch {
        /* noop — bc pode já estar fechado */
      }
    },
  }
}

function createNoopChannel(peerId: string): SignalingChannel {
  return {
    peerId,
    async send(): Promise<void> {
      /* noop */
    },
    onMessage(): SignalingUnsubscribe {
      return () => {
        /* noop */
      }
    },
    close(): void {
      /* noop */
    },
  }
}

/**
 * Valida shape mínimo de uma mensagem de signaling. Defesa contra
 * mensagens malformadas chegando no canal (cross-tab debris, etc).
 */
function isValidSignalingMessage(x: unknown): x is SignalingMessage {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  if (typeof m.from !== 'string' || m.from.length === 0) return false
  if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return false
  if (typeof m.type !== 'string') return false
  switch (m.type) {
    case 'hello':
      return (
        typeof m.drift === 'object' &&
        m.drift !== null &&
        Array.isArray((m.drift as { capabilities?: unknown }).capabilities)
      )
    case 'offer':
    case 'answer':
      return typeof m.to === 'string' && typeof m.sdp === 'string'
    case 'ice':
      return (
        typeof m.to === 'string' &&
        // candidate pode ser null (end-of-candidates) ou objeto
        (m.candidate === null || typeof m.candidate === 'object')
      )
    case 'bye':
      return true
    default:
      return false
  }
}

/**
 * Gera um peerId aleatório. Lazy `crypto.randomUUID()` — não chamar
 * em module scope (pode quebrar em SSR/test runner sem `crypto`).
 */
function randomPeerId(): string {
  // crypto.randomUUID está em runtimes modernos (Node 19+, Chrome 92+).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback bobinho mas suficiente pra mock (não-cripto, não-prod).
  return 'mock-' + Math.random().toString(36).slice(2, 11)
}
