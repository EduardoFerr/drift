# Fontes — Atribuição e Licenças

Drift bundle localmente as fontes da identidade visual v0.7. Zero
requests pra `fonts.googleapis.com` ou `fonts.gstatic.com` em runtime
— LOCK_VIA_TEST em `tests/manifesto-conformance.test.ts` falha CI se
URL externa de fontes reaparecer.

## Syne (display)

- **Designer:** Bonjour Monde (Lucas Descroix, Mateusz Machalski, Vivien Bertin)
- **Source:** <https://github.com/bonjour-monde/fonderie-bonjour-monde-typefaces>
- **Pacote npm:** `@fontsource-variable/syne` (variable font, weights 400-800)
- **License:** SIL Open Font License 1.1 — texto completo em
  `node_modules/@fontsource-variable/syne/LICENSE`
- **Uso no Drift:** font-family `display` em `tailwind.config.js`.
  Logo, títulos de card, decorative letter (V4), badges DRIFT/SINK
  (V3.5). Variable font cobre weights 400-800 num único arquivo woff2.

## DM Mono (body / UI)

- **Designer:** Colophon Foundry, Jonny Pinhorn (commissioned by Google)
- **Source:** <https://github.com/googlefonts/dm-mono>
- **Pacote npm:** `@fontsource/dm-mono` (weights 300/400/500 + 300-italic)
- **License:** SIL Open Font License 1.1 — texto completo em
  `node_modules/@fontsource/dm-mono/LICENSE`
- **Uso no Drift:** font-family `mono` em `tailwind.config.js`.
  Body text, labels, stats, captions, mono-friendly content. Default
  da maioria dos componentes.

## SIL OFL — compatibilidade com MIT

SIL Open Font License 1.1 permite redistribuição em produtos comerciais
e open-source desde que:

1. Atribuição do designer/foundry seja preservada (este doc cumpre).
2. Fontes não sejam vendidas isoladamente (Drift não vende fontes).
3. Modificações da fonte original (re-naming, derivative works) seguem
   regras específicas. Drift não modifica os arquivos woff2; consome
   via @fontsource sem alteração.

Compatível com MIT do código Drift (`LICENSE`) — fontes ficam sob OFL,
código sob MIT, sem conflito.

## Empacotamento

Vite empacota os woff2 do `node_modules/@fontsource*` em `dist/assets/`
durante build. Workbox precache (configurado em `vite.config.ts`)
inclui `assets/index-*.css` que carrega as fontes via `@font-face`
gerado pelo @fontsource. Resultado:

- **Build:** ~30-50KB delta no precache (variable font Syne ~30KB +
  DM Mono 4 weights × ~10-15KB cada).
- **Runtime:** zero requests externos. Browser resolve fontes via
  cache do PWA / disco local.
- **FOUT:** `font-display: swap` (default @fontsource) — fallback
  mono/sans-serif renderiza durante load.

## Verificação

Após `npm run build`:

```bash
# 1. Bundle inclui woff2
ls dist/assets/*.woff2 | head

# 2. Sem URL Google Fonts no CSS bundled
grep -r "fonts.googleapis.com\|fonts.gstatic.com" dist/ && echo "FAIL" || echo "✓"

# 3. Test guard
npx vitest run tests/manifesto-conformance.test.ts -t "Fontes self-hosted"
```

## Histórico

- **2026-05-05** (V2): Syne + DM Mono adicionadas via @fontsource.
  Substituem fallback monospace genérico anterior. Drift agora tem
  identidade tipográfica própria (display + mono mix raro em apps
  sociais — diferenciação do mainstream X/Bluesky/Threads).
