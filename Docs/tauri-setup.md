# Tauri desktop — setup (Fase 6.5)

> last-updated: 2026-05-01 · status: scaffold inicial · próximo: 6.4 (Tor) e 6.7 (build reproduzível)

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

## Limitações conhecidas (scaffold 6.5)

- **Sem Tor** — vem em 6.4 via `arti` Rust crate + comando IPC `tor.connect/disconnect/status`. Setting `network_mode` aparece desabilitada no webview até lá.
- **Sem code signing** — vem em 6.7 (keys em GitHub Secrets, workflow assina e publica). Builds locais são unsigned (Windows mostra SmartScreen warning, macOS pede Gatekeeper override).
- **Sem auto-update** — vem em 6.7 (Tauri updater + manifest hospedado).
- **Sem CI multi-plataforma** — workflow `tauri-release.yml` chega em 6.7.
- **Ícones não commitados** — gerar via `npx tauri icon public/pwa-512x512.png` antes do primeiro build (ver `src-tauri/icons/README.md`).

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
