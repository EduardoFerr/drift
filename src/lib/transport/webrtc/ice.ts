/**
 * webrtc/ice — STUN/TURN config.
 *
 * STUN é livre (Google público). TURN é opt-in via env var pra preservar
 * privacidade — TURN provider vê IP do user. Default sem TURN
 * (manifesto §28).
 *
 * Formato VITE_TURN_SERVERS: comma-separated URLs com query params opcionais
 *   turn:host:port (sem auth)
 *   turn:host:port?username=foo&credential=bar
 *   turn:host:port?username=foo&credential=bar,turn:host2:port?...
 *
 * User configura em .env.local pra ativar mobile real (4G CGN, symmetric
 * NAT).
 *
 * **AVISO**: Vite EMBUTE env vars `VITE_*` no bundle JS público.
 * Credentials TURN comerciais (Twilio, Cloudflare paid) NÃO devem ser
 * hardcoded aqui — usar ephemeral creds via REST API runtime. Esta env
 * é segura APENAS pra TURN gratuito com creds públicas (numb.viagenie.ca)
 * ou self-hosted coturn aberto. Manifesto §28.
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

/** Test-only export: parser de env var pra RTCIceServer[].
 *  Re-exportado em `webrtc/index.ts` como `_parseTurnServers`. */
export function _parseTurnServers(envValue: string | undefined): RTCIceServer[] {
  if (!envValue) return []
  const out: RTCIceServer[] = []
  for (const raw of envValue.split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith('turn:') && !trimmed.startsWith('turns:')) continue
    const [urlPart, queryPart] = trimmed.split('?', 2)
    const server: RTCIceServer = { urls: urlPart! }
    if (queryPart) {
      const params = new URLSearchParams(queryPart)
      const username = params.get('username')
      const credential = params.get('credential')
      if (username) server.username = username
      if (credential) server.credential = credential
    }
    out.push(server)
  }
  return out
}

/** Lê env var só uma vez por boot (Vite resolve em build-time, mas
 *  mantemos lazy pra testes poderem injetar via mock). */
export function getICEServers(): RTCIceServer[] {
  const turn = _parseTurnServers(import.meta.env.VITE_TURN_SERVERS as string | undefined)
  return [...STUN_SERVERS, ...turn]
}
