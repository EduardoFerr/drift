# Drift cross-runtime — PWA vs Tauri

> Author: Arquiteto · 2026-05-01
> Follow-up Barney 6.4 R7

Drift roda em **dois runtimes** com a mesma codebase TypeScript/React. As
diferenças são reais e materiais — algumas features só existem em um
deles. Este doc é a fonte da verdade sobre o que funciona onde, e como o
código discrimina.

## Detecção em runtime

```ts
// src/lib/transport/tor.ts
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
```

Tauri injeta `__TAURI_INTERNALS__` no `window` durante o boot do webview.
PWA puro nunca tem o símbolo. Esta é a única forma confiável — `userAgent`
sniff é frágil e `process.env` não existe no browser.

## Matriz de capabilities

| Capability                     | PWA (browser) | Tauri (desktop) | Onde discrimina |
|--------------------------------|:-------------:|:---------------:|-----------------|
| WSS clearnet (Nostr)           | ✅            | ✅              | `transport/wss.ts` |
| WebRTC P2P                     | ✅            | ✅              | `transport/webrtc/` (pasta, 12 arquivos) |
| OPFS (SQLite WASM)             | ✅¹           | ✅              | `db.worker.ts` |
| kvvfs fallback                 | ✅            | ✅              | `db.worker.ts` |
| Passkey (WebAuthn)             | ✅            | ❓²            | `lib/passkey.ts` |
| **Tor via arti (SOCKS5)**      | ❌            | ✅³            | `transport/tor.ts` + `src-tauri/src/socks5_proxy.rs` |
| **`.onion` relays nativos**    | ❌            | ✅³            | `transport/tor.ts` + `transport/torWebSocket.ts` |
| **`network_mode: 'tor'`**      | ❌            | ✅³            | `ContentSettings` UI gating + `bootstrap.ts` wire-up |
| **`network_mode: 'onion-only'`**| ❌           | ✅³            | `ContentSettings` UI gating + banner R6 |
| Background sync workers        | ✅            | ✅              | `service-worker.ts` |
| Push notifications             | ✅            | ✅              | (Fase 7+) |
| Filesystem direct write        | ❌            | ✅              | `@tauri-apps/api/fs` |
| Shell command exec             | ❌            | ✅              | (não usado hoje) |
| Custom protocol handler `nostr:`| ❓            | ✅              | (Fase 7+) |

¹ PWA precisa COOP/COEP corretos pra OPFS funcionar. Ver `vite.config.ts`.
² WebAuthn em Tauri 2.x é viável via plugin oficial; não testado ainda.
³ **Status atualizado (2026-05-01)**: Tor real com arti está shippado em código com `cargo tauri build --features arti` — listener SOCKS5 próprio (`socks5_proxy.rs`), bridge IPC WS (`tor_ws.rs` ↔ `torWebSocket.ts`), wire-up condicional em `bootstrap.ts`. **Smoke test e2e VERIFIED em 2026-05-01** (Sprint 7 do roadmap pós-auditoria — registro em `Docs/sessions/sprint7-smoke-2026-05-01.md`): captura Wireshark confirmou ZERO TLS direto a relay Nostr em modo `onion-only`, 7 guards Tor publicamente registrados em 7 países distintos, porta 9001 ORPort canônica. Sem `--features arti`, é stub IPC com `lastError: "STUB: arti integration pending"`.

## Pontos de gating no código

### 1. `network_mode` picker (`ContentSettings.tsx`)

```tsx
<NetworkModePicker
  value={prefs.network_mode}
  onChange={(v) => setPref('network_mode', v)}
  isTauri={isTauri()}
/>
```

Em PWA, opções `tor` e `onion-only` ficam **desabilitadas** com tooltip
explicando que exige cliente desktop. User clica e nada acontece — sem
toast de erro, só o disabled visual + hint.

### 2. `torConnect()` chamadas (`transport/tor.ts`)

```ts
async function torInvoke<T>(cmd: string): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tor exige cliente nativo Tauri — não disponível no PWA browser')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}
```

Dynamic import de `@tauri-apps/api/core` — em PWA, módulo não é carregado
(sem custo de bundle pra usuários browser).

### 3. Bootstrap wire-up Tor via `installTorWebSocketImpl` (`bootstrap.ts`)

**Atualização (2026-05-01)**: a arquitetura final NÃO registra
`torTransport` separado no orchestrator (seria duplicação ruidosa).
Em vez disso, quando `isTauri()` e `network_mode ∈ {'tor', 'onion-only'}`,
o bootstrap chama `torConnect()` e `installTorWebSocketImpl()`. Esse
último injeta uma classe `TorWebSocket` como implementação global do
`nostr-tools/pool` via `useWebSocketImplementation()` — com isso, o
`wssTransport` existente (já registrado) passa a rotear via Tor sem
mudar uma linha. `kind: 'wss'` segue honesto: **é** WSS, só por baixo
passa pelo circuit Tor.

```ts
// src/lib/bootstrap.ts (resumido)
const networkMode = getPrefs().network_mode
if (isTauri() && (networkMode === 'tor' || networkMode === 'onion-only')) {
  try {
    const torStatus = await torConnect()
    if (torStatus.state === 'connected') {
      await installTorWebSocketImpl()
    }
  } catch (err) { /* degrada pra clearnet com warn */ }
}
registerTransport(wssTransport, { weight: 10 })
registerTransport(webrtcTransport, { weight: 5 })
```

Em sucesso: WSS roteia via Tor pra todos os relays. Em falha (timeout,
listener falhou, feature `arti` off): degrada pra clearnet com console
warn — sem bloquear o boot. UX honesta exige reload se user trocar
`network_mode` em runtime (limitação conhecida — sprint pendente).

### 4. Banner em `onion-only` sem onion (`ContentSettings.tsx`, R6 Barney)

Quando user seleciona `onion-only` e nenhum relay tem alias `.onion`, UI
mostra alerta vermelho explicando o isolamento iminente. Reativo via
`useRelaysStore`. Manifesto §15 (anti-censura tem que ser auditável).

## Build artifacts

| Artifact          | Runtime  | Onde mora                          |
|-------------------|----------|------------------------------------|
| `dist/`           | PWA      | Vercel (`drift.<arquiteto>.dev`) + GitHub Release `dist.zip` |
| Tauri bundles     | Desktop  | GitHub Release (Linux `.AppImage`/`.deb`, Windows `.msi`, macOS `.dmg`) |
| Tauri reproducible| Desktop  | `Dockerfile.reproducible` → Linux only |

PWA build é determinístico via `SOURCE_DATE_EPOCH` no Dockerfile (Fase 6.7).
Tauri reproducible exige toolchain Rust pinned + Linux (Windows/macOS
notoriously hard pra repro builds).

## Quando duplicar lógica vs gating

**Duplicar** (cliente nativo precisa de comportamento diferente):
- Filesystem ops (Tauri usa `@tauri-apps/api/fs`, PWA usa OPFS)
- Tor — arti só roda em Tauri

**Gating** (código compartilhado, comportamento unificado, capability
desligada em runtime):
- `network_mode` picker
- Banner `onion-only`
- `torInvoke` early-throw em PWA

**Nunca duplicar**:
- Lógica de domínio (scoring, weight, moderation)
- Schema SQLite
- Protocolo Nostr
- Pipelines de eventos

Estes são funções puras / cross-runtime — duplicar = duas implementações
divergindo = quebra de manifesto §7 (determinismo).

## Smoke checklist quando mudar gating

- [ ] PWA browser: feature gated não aparece, ou aparece desabilitada
- [ ] PWA browser: nenhum erro em console com runtime check
- [ ] Tauri desktop: feature funciona end-to-end
- [ ] Bundle size: `@tauri-apps/api` não vaza pro PWA bundle
- [ ] Type check passa em ambos modos (`vite build` valida bundling)

## Releases sincronizados

A versão `package.json` é compartilhada — PWA e Tauri shippam o mesmo
número. Tag `v0.6.0-alpha.X` cobre ambos artifacts. Não há "versão Tauri
diferente da versão PWA". Manifesto §17 (sem chave mestra na distribuição
implica único `package.json` é fonte da verdade).

---

*Manifesto §15 anti-censura · §17 sem chave mestra · §28 privacidade pelo mínimo*
