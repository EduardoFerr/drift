# Tauri icons — placeholders

Tauri v2 espera os seguintes arquivos neste diretório (ver
`tauri.conf.json > bundle.icon`):

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)

## Como gerar (uma vez)

A partir de um PNG quadrado (>= 1024×1024), use o CLI oficial:

```bash
npx tauri icon path/to/source-1024.png
```

O Drift já tem ícones PWA em `public/pwa-512x512.png` que podem
servir de base — mas idealmente use uma fonte ≥1024 pra macOS retina.

```bash
npx tauri icon public/pwa-512x512.png
```

Isso popula este diretório automaticamente. Os arquivos gerados
**são versionados** no git (parte do bundle reproduzível — Fase 6.7).

## Por que isso não está commitado ainda

Scaffold inicial 6.5 não inclui ícones — gerá-los exige rodar o
CLI Tauri uma vez localmente (precisa do toolchain Rust + dep
nativa `image-rs`). Antes do primeiro `npm run tauri:build`, rode
o comando acima.

Cross-ref: `Docs/tauri-setup.md`, `Docs/fase-6-roadmap.md` §6.5.
