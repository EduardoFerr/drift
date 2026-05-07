# Tauri desktop — setup (Fase 6.5)

> last-updated: 2026-05-01 · status: scaffold + Tor real funcional via `--features arti` (smoke e2e pendente)

Fase 6.5 do roadmap entrega o **shell desktop** que habilita as fases
seguintes — em particular **§15 anti-censura** (Tor via `arti`, 6.4)
e **§17 build reproduzível** (Docker + hashes públicos, 6.7), que não
cabem num PWA de browser.

Cross-ref: [`fase-6-roadmap.md`](fase-6-roadmap.md) §6.5,
[`drift-arquitetura-v4.md`](drift-arquitetura-v4.md) (transports).

---

## Pré-requisitos

### 1. Rust toolchain (uma vez)

Instala via [rustup.rs](https://rustup.rs/):

```bash
# Linux / macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows: baixar rustup-init.exe do site
```

Confirma:

```bash
cargo --version    # >= 1.77
rustc --version
```

### 2. Dependências de sistema (plataforma-specific)

- **Linux (Debian/Ubuntu)**: `libwebkit2gtk-4.1-dev`, `build-essential`,
  `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`. Instruções completas:
  <https://v2.tauri.app/start/prerequisites/>
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Windows**: Microsoft C++ Build Tools (Visual Studio Installer →
  "Desktop development with C++") + WebView2 (já vem no Win10/11).

### 3. Node ≥ 22 (já é requisito do Drift PWA)

```bash
node --version    # >= 22
```

---

## Rodar em dev

A primeira execução **demora** (Cargo baixa e compila ~400 crates,
5-15 min dependendo da máquina). Compilações subsequentes são
incrementais (~10-30s).

```bash
npm run tauri:dev
```

O que acontece:
1. Tauri sobe o Vite dev server (`npm run dev` → `https://localhost:5173`).
2. Compila o binário Rust em modo debug.
3. Abre uma janela nativa de 1280×800 carregando o PWA Drift.
4. DevTools abrem automaticamente em debug build.

Hot-reload do React funciona normalmente — Tauri só embarca o webview.

---

## Buildar release

```bash
npm run tauri:build
```

Artifacts ficam em `src-tauri/target/release/bundle/`:

- **Linux**: `.deb`, `.AppImage`, `.rpm`
- **macOS**: `.dmg`, `.app`
- **Windows**: `.msi`, `.exe` (NSIS)

Bundle size esperado: ~10-15 MB (vs 50-100 MB Electron).

---

## Configuração — onde mexer

| Arquivo | Pra quê |
|---|---|
| `src-tauri/Cargo.toml` | Deps Rust, versão crate |
| `src-tauri/src/lib.rs` | Setup do app, registro de comandos IPC |
| `src-tauri/src/main.rs` | Entrypoint (não tocar) |
| `src-tauri/tauri.conf.json` | Janela, CSP, identifier, build commands |
| `src-tauri/capabilities/default.json` | **Permissões** (manifesto §17 — manter mínimas) |
| `src-tauri/icons/` | Ícones (gerar via `npx tauri icon`, ver README local) |

---

## Permissões (manifesto §17)

`capabilities/default.json` declara permissões **explícitas** que o
webview pode invocar via IPC. Default Drift:

- `core:default` — acesso à API core (window, event, webview)
- `shell:allow-open` — abrir links externos do feed no browser do user

**Não habilitado por default** (e não deve ser sem revisão):

- `fs:*` — OPFS já cobre persistência; expor fs nativo viola §17
- `dialog:*` — não precisamos de file picker nativo
- `notification:*` — feed Drift não notifica
- `clipboard:*` — copy/paste do webview já funciona via Web API

Adicionar permissão = editar `capabilities/default.json` + justificar
no PR (princípio: surface mínima de ataque).

---

## CSP

`tauri.conf.json > app.security.csp` espelha COOP/COEP do `vercel.json`
pra garantir `crossOriginIsolated === true` (necessário pro OPFS).

Diferenças vs PWA browser:
- `connect-src` permite `wss:` e `https:` (relays Nostr arbitrários)
- `script-src` inclui `'wasm-unsafe-eval'` (SQLite WASM)

---

## Status (atualizado 2026-05-01)

**O que está funcional:**
- ✅ Build default (`cargo tauri build`) gera binário desktop com PWA embarcado
- ✅ Build com `--features arti` adiciona Tor real (arti-client 0.41 + listener SOCKS5 próprio + bridge WS via IPC). Quando `prefs.network_mode ∈ {tor, onion-only}`, `bootstrap.ts` bootstrapa o circuit e injeta `TorWebSocket` no `nostr-tools/pool` — `wssTransport` passa a rotear via Tor sem mudança no transport layer
- ✅ `cargo check` (default e `--features arti`) compila clean

**O que ainda não está:**
- 🟡 **Tor smoke test e2e** — código compila e roteia, mas não há teste com `tcpdump`/Wireshark confirmando que tráfego sai via guards Tor e nada vaza pra relay clearnet. Sprint pendente no roadmap pós-6.4.
- 🟡 **Trocar `network_mode` em runtime sem reload** — `installTorWebSocketImpl` é global no SimplePool; user precisa recarregar a aba pra trocar de modo. Sprint UX fix pendente.
- ⛔ **Code signing** — release Tauri formal. Builds atuais são unsigned (Windows: SmartScreen warning; macOS: Gatekeeper override). Workaround pra users documentado no [README seção "Instalação cross-platform"](../README.md#instalação-cross-platform-cliente-nativo-tauri). Track A.2 do roadmap-v060 depende de Apple Developer cert + Windows EV cert.
- ⛔ **Auto-update** — Tauri updater + manifest hospedado, sem timeline.
- ✅ **CI multi-plataforma binary release** — [`.github/workflows/tauri-distribution.yml`](../.github/workflows/tauri-distribution.yml) cobre Linux (`.AppImage` + `.deb`), macOS arm64 (`.dmg`) e Windows (`.exe` NSIS) com `--features arti`. Dispara em push de tag `v*` e anexa ao GitHub Release. Reprodutibilidade auditável continua via [`Dockerfile.reproducible`](../Dockerfile.reproducible) ([`Docs/build-reproducible.md`](build-reproducible.md), Linux apenas).
- 🟡 **Ícones não commitados** — gerar via `npx tauri icon public/pwa-512x512.png` antes do primeiro build (ver `src-tauri/icons/README.md`).

## Limitações herdadas

- **Build reproduzível só Linux** — `Dockerfile.reproducible` produz binário PWA + Tauri Linux bit-identical. Windows/macOS Tauri não têm garantia de reprodutibilidade hoje (toolchain MSVC e Apple SDK introduzem variação). Manifesto §17 promete "build reproduzível" — escopo atual = Linux.

---

## Próximos passos pra contribuidor

1. Instalar Rust toolchain (link acima).
2. Rodar `npm install` (puxa `@tauri-apps/cli` + `@tauri-apps/api`).
3. Rodar `npx tauri icon public/pwa-512x512.png` (uma vez).
4. Rodar `npm run tauri:dev` (paciência na 1ª compilação).
5. Pra hackear o Rust side, abrir `src-tauri/src/lib.rs`.

Issues conhecidas em ambiente Drift documentadas no roadmap. Quando
6.4 (Tor) e 6.7 (reproducible build) entrarem, este doc é atualizado
com as seções correspondentes.
