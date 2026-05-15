/**
 * HTTPS pre-probe — defesa cosmética + diagnóstica contra relays
 * unreachable.
 *
 * Problema: `new WebSocket('wss://relay-fora-do-ar.example')` em
 * navegadores Chromium/Firefox/Safari dispara um `console.error` NATIVO
 * antes de qualquer handler nosso rodar:
 *
 *   `WebSocket connection to 'wss://...' failed: ...`
 *
 * Esse erro:
 *   - **Não é capturável** via `ws.onerror`, `window.onerror`,
 *     `unhandledrejection` ou nenhum hook JS — é log direto do
 *     networking layer do browser.
 *   - Polui o DevTools com noise vermelho em cada boot.
 *   - Penaliza Lighthouse Best Practices (regra "no browser errors").
 *   - Confunde usuário avançado que abre o console pra debug.
 *
 * **Solução**: antes de instanciar o WebSocket, tentar uma requisição
 * HTTPS leve no mesmo host. `fetch()` rejections SÃO silenciáveis (são
 * Promise rejections, não console.error nativo). Se o fetch falha
 * (DNS, TLS, connection refused), marcamos o relay como demoted via
 * `relay-health` e PULAMOS `new WebSocket` totalmente — zero ruído.
 *
 * **NIP-11 bônus**: NIP-11 define exatamente isso — `GET wss://...`
 * trocado pra `https://` com `Accept: application/nostr+json` retorna
 * metadata do relay (nome, software, versão, limites). Se a resposta
 * parsea como JSON com `name`/`software`, cacheamos in-memory pra
 * eventual UI.
 *
 * **Threat model**:
 *
 *  - MitM atacante intercepta probe e devolve 200 mas o relay real
 *    está filtrando WS upgrade → probe passa, WS falha. **Mitigação**:
 *    `relay-health` registra a falha do WS via `recordRelayError`,
 *    demota normalmente. Probe é otimista — só blinda contra "morto
 *    e desconhecido", não contra "vivo e malicioso".
 *
 *  - Atacante DoS slow-loris no HTTPS → bloqueia boot por minutos.
 *    **Mitigação**: timeout de 3s + probes paralelos.
 *
 *  - Atacante usa o probe pra distinguir cliente Drift de outros
 *    Nostr clients pelo `Accept: application/nostr+json` header.
 *    **Não-mitigado**: o header é o padrão NIP-11; qualquer cliente
 *    que faça pre-probe NIP-11 envia isso. Aceitável — não vaza
 *    identidade, só "é um cliente Nostr".
 *
 *  - **Privacy**: o probe faz HTTPS request ao mesmo host do WSS.
 *    DNS lookup + TLS handshake já aconteceriam no WebSocket anyway.
 *    Não vaza informação adicional. Em modo Tor (Fase 6.4), o fetch
 *    NÃO usa Tor automaticamente — daí integramos só no transporte
 *    WSS clearnet, não no torWebSocket.
 *
 * Funções abaixo são **quase-puras** (só `fetch` + relógio implícito
 * via cache TTL). Testáveis via mock de `fetch` global.
 */

/** Timeout default por probe — curto pra não bloquear boot. */
export const PROBE_TIMEOUT_MS = 3000

/** TTL do cache de resultado — evita re-probe em re-connects rápidos. */
export const PROBE_CACHE_TTL_MS = 30 * 1000

export interface Nip11Metadata {
  name?: string
  description?: string
  software?: string
  version?: string
  /** Capturado em raw — UI pode parsear mais campos se precisar. */
  raw?: unknown
}

export interface ProbeReachResult {
  reachable: boolean
  /** Latência do fetch em ms; null se timeout/erro. */
  latencyMs: number | null
  /** Metadata NIP-11 se a resposta tinha JSON parseável. */
  nip11: Nip11Metadata | null
}

interface CacheEntry {
  at: number
  result: ProbeReachResult
}

const cache = new Map<string, CacheEntry>()

/**
 * Converte URL WSS pra HTTPS (ou WS→HTTP em dev). Pura.
 *
 * `wss://relay.example/path` → `https://relay.example/path`
 * `ws://localhost:7777`      → `http://localhost:7777`
 *
 * Outras schemes ficam unchanged (caller é responsável por validar).
 */
export function wsToHttp(url: string): string {
  if (url.startsWith('wss://')) return 'https://' + url.slice(6)
  if (url.startsWith('ws://')) return 'http://' + url.slice(5)
  return url
}

/**
 * Probe HTTP/HTTPS de um relay. Retorna se está reachable + metadata
 * NIP-11 quando disponível.
 *
 * Fluxo:
 *   1. Tenta `fetch(httpsUrl, { Accept: application/nostr+json })` com
 *      timeout via AbortSignal. CORS = `cors` pra tentar ler JSON.
 *   2. Se resposta volta (status 200-5xx), `reachable = true`. Se for
 *      200 e o body parsea como JSON com `name`/`software`, popula
 *      `nip11`.
 *   3. Se `fetch` rejeita por CORS (TypeError em alguns browsers),
 *      retry com `mode: 'no-cors'`. Resposta opaque ainda indica
 *      servidor vivo → `reachable = true`, sem metadata.
 *   4. Se ambos rejeitam (DNS/TLS/conn fail) ou timeout → `reachable
 *      = false`. **Erros NÃO disparam console.error nativo** — são
 *      Promise rejections, capturadas em try/catch.
 *
 * Cacheado por `PROBE_CACHE_TTL_MS` pra não duplicar latency em
 * re-connects rápidos.
 *
 * @param wssUrl — URL `wss://` ou `ws://`.
 * @param timeoutMs — default PROBE_TIMEOUT_MS.
 * @param now — injetado pra teste; default Date.now().
 * @param fetchImpl — injetado pra teste; default global fetch.
 */
export async function probeRelayReachable(
  wssUrl: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeReachResult> {
  const cached = cache.get(wssUrl)
  const t = now()
  if (cached && t - cached.at < PROBE_CACHE_TTL_MS) {
    return cached.result
  }

  const httpUrl = wsToHttp(wssUrl)
  const start = t

  // Helper: cria AbortSignal com timeout. `AbortSignal.timeout` é
  // padrão (Chrome 103+, Firefox 100+, Safari 16+) — fallback manual
  // pra ambientes sem ela (alguns ambientes de teste).
  function timeoutSignal(): AbortSignal {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(timeoutMs)
    }
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), timeoutMs)
    return ctrl.signal
  }

  // Tentativa 1: CORS — pode ler JSON se relay permite.
  let result: ProbeReachResult | null = null
  try {
    const res = await fetchImpl(httpUrl, {
      method: 'GET',
      headers: { Accept: 'application/nostr+json' },
      signal: timeoutSignal(),
      mode: 'cors',
      // `credentials: omit` evita enviar cookies/auth (privacy).
      credentials: 'omit',
      // `cache: no-store` evita SW intermediário cachear.
      cache: 'no-store',
    })
    const latencyMs = Math.round(now() - start)
    const nip11 = await tryParseNip11(res)
    result = { reachable: true, latencyMs, nip11 }
  } catch {
    // Fetch rejeitou. Pode ser CORS (TypeError) ou conn fail. Tenta
    // no-cors — se o servidor responder qualquer coisa, sabemos que
    // está vivo (opaque response).
    try {
      const res = await fetchImpl(httpUrl, {
        method: 'GET',
        signal: timeoutSignal(),
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
      })
      // Em no-cors, type === 'opaque'. Status sempre 0. Mas o fetch
      // resolveu — servidor respondeu. Sufficient pra "reachable".
      void res
      const latencyMs = Math.round(now() - start)
      result = { reachable: true, latencyMs, nip11: null }
    } catch {
      // Ambos falharam — DNS/TLS/conn/timeout. Relay morto.
      result = { reachable: false, latencyMs: null, nip11: null }
    }
  }

  cache.set(wssUrl, { at: t, result })
  return result
}

async function tryParseNip11(res: Response): Promise<Nip11Metadata | null> {
  // Se status não-OK, ainda consideramos reachable (server vivo, só
  // não atende NIP-11 nesse path). Skip parsing.
  if (!res.ok) return null
  const ctype = res.headers.get('content-type') ?? ''
  if (!ctype.includes('json') && !ctype.includes('nostr+json')) return null
  try {
    const json = (await res.json()) as Record<string, unknown>
    if (!json || typeof json !== 'object') return null
    const meta: Nip11Metadata = { raw: json }
    if (typeof json.name === 'string') meta.name = json.name
    if (typeof json.description === 'string') meta.description = json.description
    if (typeof json.software === 'string') meta.software = json.software
    if (typeof json.version === 'string') meta.version = json.version
    return meta
  } catch {
    return null
  }
}

/** **Test-only**: limpa cache. Não usar em runtime. */
export function _resetProbeCacheForTests(): void {
  cache.clear()
}

/** Snapshot do tamanho do cache — útil pra testes/diagnóstico. */
export function _probeCacheSize(): number {
  return cache.size
}
