/**
 * Tor IPC bridge — wrappers TS pros 3 commands Tauri (`tor_connect`,
 * `tor_disconnect`, `tor_status`) implementados em
 * `src-tauri/src/tor.rs` e `src-tauri/src/socks5_proxy.rs`.
 *
 * **Não é um `Transport`** no sentido do `transport/index.ts:Transport`.
 * Versões anteriores (até `0e7d0c0`) exportavam um `torTransport` com
 * `publish/subscribe/health` placeholders, mas a arquitetura final NÃO
 * registra esse transport no orchestrator (seria duplicação ruidosa).
 * Em vez disso, `bootstrap.ts` chama `torConnect()` + instala
 * `TorWebSocket` como impl global do `nostr-tools/pool` via
 * `installTorWebSocketImpl()` (em `transport/torWebSocket.ts`). O
 * `wssTransport` existente passa a rotear via Tor sem mudança.
 *
 * Por isso este módulo só expõe as 3 IPC functions + helper. Sem
 * Transport API morta. Mantido em `transport/` por proximidade
 * conceitual com `transport/torWebSocket.ts` (peer mais próximo).
 *
 * **PWA browser**: `torInvoke` lança "Tor exige cliente nativo Tauri".
 * UI deve gating disabled antes de chamar.
 *
 * **Tauri sem `--features arti`**: stub Rust retorna
 * `state: 'error', lastError: "STUB: arti integration pending"`.
 *
 * **Tauri com `--features arti`**: Tor real bootstrap + listener SOCKS5
 * local + IPC bridge WS funcional.
 *
 * Manifesto §15 (anti-censura por país), §28 (privacidade pelo mínimo,
 * IP do user não vaza pro relay), §4 (anonimato em modo paranoia).
 */

export { isTauri } from '../runtime'

/** Shape do `TorStatus` retornado por todos os 3 IPC commands.
 *  Espelha exatamente `src-tauri/src/tor.rs::TorStatus` com
 *  `#[serde(rename_all = "camelCase")]`. */
export interface TorStatusIPC {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** Quantos circuitos Tor ativos. 0 enquanto não conectado. */
  circuitCount: number
  /** Última mensagem de erro do daemon, se houver. */
  lastError: string | null
  /** Endereço do listener SOCKS5 local (`127.0.0.1:<porta>`) quando
   *  state === 'connected'. `null` em qualquer outro estado.
   *  Bridge WS interna (`tor_ws.rs` + `torWebSocket.ts`) usa este
   *  endpoint pra rotear frames via Tor. */
  proxyAddr: string | null
}

/** Helper de conveniência: retorna o `proxyAddr` se Tor está conectado,
 *  `null` caso contrário (qualquer outro state). Em PWA browser:
 *  throws via `torStatus()` antes de chegar aqui. */
export async function getTorProxyAddr(): Promise<string | null> {
  const s = await torStatus()
  return s.state === 'connected' ? s.proxyAddr : null
}

/** Wrapper genérico de `invoke` com gating de runtime + dynamic import.
 *  Dynamic import evita bundle-cost em PWA puro — `@tauri-apps/api`
 *  só é resolvido quando rodando dentro do shell Tauri. */
async function torInvoke<T>(cmd: string): Promise<T> {
  // Local import pra evitar circular: runtime → tor → torWebSocket →
  // ContentSettings → runtime. Re-export acima já cobre callers TS.
  const { isTauri } = await import('../runtime')
  if (!isTauri()) {
    throw new Error('Tor exige cliente nativo Tauri — não disponível no PWA browser')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}

/** Inicia o daemon Tor (arti). Em build com `--features arti`:
 *  bootstraps directory consensus, abre circuit, sobe listener SOCKS5
 *  local. Em build default: stub retorna `state: 'error'`. */
export async function torConnect(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_connect')
}

/** Desliga o daemon Tor. Idempotente — chamar desconectado é no-op. */
export async function torDisconnect(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_disconnect')
}

/** Snapshot do status atual sem efeito colateral. */
export async function torStatus(): Promise<TorStatusIPC> {
  return torInvoke<TorStatusIPC>('tor_status')
}
