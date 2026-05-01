/**
 * Tor transport (Fase 6.4) — WSS via SOCKS5 local proxy do `arti`.
 *
 * Status atual: **scaffold + stub**. As 3 commands Tauri abaixo
 * (`tor_connect`, `tor_disconnect`, `tor_status`) são implementadas em
 * `src-tauri/src/tor.rs` (Ted) e hoje retornam erro
 * `"STUB: arti integration pending"`. Quando o crate `arti-client`
 * for embutido no shell Rust, a internals desta camada muda sem
 * quebrar callers — `Transport.publish/subscribe/health` mantêm o
 * shape.
 *
 * Manifesto §15 (anti-censura por país — em país que bloqueia
 * relays Nostr, Tor contorna), §28 (privacidade pelo mínimo, IP do
 * user não vaza pro relay), §4 (anonimato em modo paranoia).
 *
 * **PWA browser**: throws `"Tor exige cliente nativo Tauri"` em qualquer
 * uso real. UI deve gating disabled antes de chamar.
 *
 * **Tauri**: invoca IPC commands via `@tauri-apps/api/core`. Real arti
 * em sessão futura — quando chegar, `publish/subscribe` vão delegar pra
 * `wssTransport` configurado com SOCKS5 agent apontando pro proxy local
 * que arti expõe (porta dinâmica retornada por `tor_connect`).
 *
 * NÃO registrar este transport no `bootstrap.ts:registerTransport` ainda
 * — stub gera `failed: 1` permanente em modo tor. Wire-up correto vem
 * junto com a integração arti real (ver TODO em bootstrap.ts).
 */

import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from './index'
import type { SignedEvent } from '../../types/nostr'

/** Shape do `TorStatus` retornado por todos os 3 IPC commands.
 *  Espelha exatamente `src-tauri/src/tor.rs::TorStatus` (Ted). */
export interface TorStatusIPC {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** Quantos circuitos Tor ativos. 0 enquanto não conectado. */
  circuitCount: number
  /** Última mensagem de erro do daemon, se houver. */
  lastError: string | null
}

/** Detecta runtime Tauri vs browser puro.
 *  Tauri injeta `__TAURI_INTERNALS__` no objeto `window` durante o boot
 *  do webview. Em PWA/browser puro o símbolo não existe. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Wrapper genérico de `invoke` com gating de runtime + dynamic import.
 *  Dynamic import evita bundle-cost em PWA puro — `@tauri-apps/api`
 *  só é resolvido quando rodando dentro do shell Tauri. */
async function torInvoke<T>(cmd: string): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tor exige cliente nativo Tauri — não disponível no PWA browser')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}

/** Inicia o daemon Tor (arti) e retorna status.
 *  Hoje (stub): retorna `state: 'error', lastError: 'STUB: arti integration pending'`.
 *  Real: bootstraps directory consensus, abre circuitos, expõe SOCKS5 local. */
export async function torConnect(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_connect')
}

/** Desliga o daemon Tor. Idempotente — chamar desconectado é no-op. */
export async function torDisconnect(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_disconnect')
}

/** Snapshot do status atual sem efeito colateral. UI consulta isto pra
 *  desenhar o ícone 🧅/🛡️ no Header. */
export async function torStatus(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_status')
}

// ─── Transport API ───────────────────────────────────────────────────
//
// Implementação placeholder até arti real chegar. Mantém shape idêntico
// ao `wssTransport` pra orchestrator poder iterar sem `if (kind === ...)`.

async function publish(_event: SignedEvent): Promise<PublishResult> {
  // TODO(arti): quando arti expor SOCKS5 local, instanciar um
  // wssTransport-like aqui que abre WebSocket via proxy
  // (ver `src-tauri/src/tor.rs::tor_connect` retorno).
  // Por enquanto, marca tudo como falha pra orchestrator pular.
  return {
    ok: 0,
    failed: 1,
    perRelay: [{ url: 'tor:stub', ok: false, error: 'arti integration pending' }],
  }
}

function subscribe(_filter: Filter, handlers: SubscribeHandlers): Unsubscribe {
  // TODO(arti): delega pra wssTransport configurado com SOCKS5 agent
  // depois que `tor_connect` retornar `state === 'connected'`.
  // Por enquanto, sinaliza EOSE imediato pra caller não ficar pendurado.
  if (handlers.oneose) queueMicrotask(() => handlers.oneose?.())
  return () => {
    /* noop — não há subscription real a cancelar */
  }
}

async function health(_timeoutMs?: number): Promise<TransportHealth[]> {
  if (!isTauri()) {
    return [{ url: 'tor:browser-not-supported', ok: false, latencyMs: null }]
  }
  try {
    const status = await torStatus()
    return [
      {
        url: `tor:${status.state}`,
        ok: status.state === 'connected',
        latencyMs: null,
      },
    ]
  } catch {
    return [{ url: 'tor:error', ok: false, latencyMs: null }]
  }
}

export const torTransport: Transport = {
  kind: 'tor',
  publish,
  subscribe,
  health,
}
