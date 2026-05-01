/**
 * runtime — detecção de runtime do cliente Drift.
 *
 * Cliente Drift roda em **dois runtimes**: PWA browser (default,
 * via Vercel + GitHub Release `dist.zip`) e Tauri desktop (via
 * `cargo tauri build`). Várias features são gateadas em runtime:
 * Tor real (`--features arti`), filesystem direct, IPC custom.
 *
 * Esta função é a fonte da verdade pra o gating cross-runtime.
 * `Docs/runtime-pwa-vs-tauri.md` documenta a matriz completa
 * de capabilities por runtime e onde cada gate vive no código.
 *
 * Por que mora em `lib/runtime.ts` (não em `transport/tor.ts`):
 * a função NÃO é específica de Tor — ContentSettings, App, e
 * outros gates não-Tor a usam. Mover pra cá deixa imports mais
 * honestos. Antes era exportada de `transport/tor.ts` por inércia
 * histórica.
 */

/**
 * Detecta runtime Tauri vs browser puro.
 *
 * Tauri 2.x injeta `__TAURI_INTERNALS__` no objeto `window` durante
 * o boot do webview. Em PWA/browser puro o símbolo não existe.
 *
 * SSR/Node: `typeof window !== 'undefined'` guard cobre o caso de
 * algum dia rodarmos isto em build-time ou SSR (improvável, mas
 * defensivo). Sem este guard, throw `ReferenceError` em Node.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
