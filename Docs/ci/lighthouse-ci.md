# Lighthouse CI — gating de Performance / A11y / Best Practices / SEO

> Round CWV-1 (Ted — arquitetura/CI), 2026-05-15.
> Complementa `Docs/cwv-tooling.md` (foco no ferramental); este doc foca
> em **operação do gate em PRs** e **como atualizar thresholds**.

## TL;DR

Cada PR que toca frontend (`src/**`, `public/**`, `index.html`,
`vite.config.ts`, `tailwind.config.js`, `postcss.config.js`,
`package.json`, `package-lock.json`, `.lighthouserc.cjs`,
`.github/workflows/lighthouse.yml`) dispara
[`.github/workflows/lighthouse.yml`](../../.github/workflows/lighthouse.yml),
que:

1. Builda `dist/` (`npm run build`).
2. Sobe `vite preview` em HTTP (toggle `DRIFT_DEV_HTTP=1`).
3. Roda Lighthouse 3x mobile throttled, calcula mediana.
4. Asserts em `.lighthouserc.cjs` (warn em PR / hard em main).
5. Upload do report HTML como artifact (`lighthouse-reports`, 14 dias).

## Thresholds atuais (2026-05-15)

Mobile, throttled 3G fast (1.6Mbps / 150ms RTT / 4x CPU). Definidos em
[`.lighthouserc.cjs`](../../.lighthouserc.cjs).

| Categoria / métrica | Threshold | Sev | Atual (median) | Folga |
|---|---|---|---|---|
| `categories:performance` | ≥ 0.85 | warn | ~0.93 | ~8pt |
| `categories:accessibility` | ≥ 0.95 | warn | 1.00 | 5pt |
| `categories:best-practices` | ≥ 0.90 | warn | ~0.96 | 6pt |
| `categories:seo` | ≥ 0.95 | warn | 1.00 | 5pt |
| LCP | ≤ 2500ms | warn | — | — |
| FCP | ≤ 1800ms | warn | — | — |
| CLS | ≤ 0.1 | **error** | — | — |
| TBT | ≤ 200ms | warn | — | — |
| TTI | ≤ 3800ms | warn | — | — |

CLS é hard porque é determinístico (layout shift é function pura do CSS
+ ordem de paint). Performance/TBT/LCP têm variance natural ~3-5pt em
runner compartilhado — warn evita falsos negativos.

## Como rodar local

```bash
npm install         # garante @lhci/cli instalado
npm run build       # gera dist/
npm run lhci        # autorun: preview + 3 runs + assert
```

Saída:
- Console: warns/errors por assertion + link pro report público.
- `.lighthouseci/`: HTML report local (1 por run).

Para debug interativo (1 run só, sem asserts), use Chrome DevTools →
Lighthouse tab apontando para `http://localhost:4173/` (depois de
`DRIFT_DEV_HTTP=1 npm run preview -- --port 4173`).

## Como atualizar thresholds

**Bump (apertar gate)** — quando categoria ficou estável acima do
threshold por 2+ semanas:

1. Pull dos últimos 5-10 reports do main (artifact `lighthouse-reports`).
2. Calcular p95 dos scores (`numberOfRuns: 3` já dá mediana; usar p95
   across PRs).
3. Novo threshold = p95 - 5pt (margem variance).
4. Editar `.lighthouserc.cjs` → commit `ci(perf): bump lhci threshold …`.

**Loosen (afrouxar gate)** — só com justificativa documentada:

- Dep upgrade trouxe regressão temporária (PR que aceita a regressão
  cita o tradeoff no body).
- Categoria nova/deprecated do Lighthouse muda baseline.

**Promover warn → error**:

1. Bundle ratchet relacionado já está em hard mode
   (`tests/bundle-chunks-conformance.test.ts`).
2. 4 semanas sem warning na categoria.
3. Editar severidade no `.lighthouserc.cjs` + remover
   `continue-on-error` correspondente no workflow.

## Como debugar uma falha

PR falhou com `lighthouse-ci` warning:

1. Abrir o job, expandir step "Run Lighthouse CI".
2. Linha de assertion falhada mostra: `[warn] categories:performance
   failure for minScore assertion: 0.83 < 0.85`.
3. Baixar artifact `lighthouse-reports` (download zip do summary do
   workflow run).
4. Abrir `.lighthouseci/lhr-<timestamp>.html` no browser.
5. Aba "Opportunities" + "Diagnostics" listam o que regrediu.
6. Comparar com último report verde do main (baseline).

Suspeitos comuns:
- Bundle cresceu (cruzou referência com `npm run build:analyze`).
- Imagem nova sem `loading="lazy"` ou sem dimensões fixas (CLS).
- Font swap missing (FCP).
- Long task nova em main thread (TBT).

## Por que `.cjs` e não `.json`?

`@lhci/cli@0.14` faz `require()` da config. Repo é `"type": "module"`,
então `.js` seria parseado como ESM. `.json` funciona mas perde
comentários — preferimos `.cjs` pra manter rationale inline.

## Por que preview HTTP e não HTTPS?

`vite.config.ts` adiciona `@vitejs/plugin-basic-ssl` por default (cert
auto-assinado pra mobile testing em LAN). Lighthouse v11+ aborta com
`INSECURE_DOCUMENT_REQUEST` mesmo com `--ignore-certificate-errors`.
Toggle `DRIFT_DEV_HTTP=1` (lido em `vite.config.ts`) pula
`basicSsl()` → preview HTTP plain.

## Por que não testar via Vercel preview URL?

Considerado, descartado por enquanto:
- Exige Vercel token em CI (mais um secret pra gerenciar).
- Delay pro Vercel terminar deploy (~30-90s) cria flake em PR fresh.
- LH contra `localhost:4173` mede o build, não o CDN — separa preocupações:
  bundle/build perf vai pra LHCI; CDN perf vai pra RUM real
  (Vercel Analytics, futuro).

Quando RUM entrar em produção (Fase 7), revisitar: rodar LH contra
preview URL real pode adicionar valor pra detectar regressão de
cache headers / Brotli config.

## Workflow vs script local — diferenças

| | Local (`npm run lhci`) | CI |
|---|---|---|
| Runs | 3 | 3 |
| Throttling | Sim (config) | Sim (config) |
| CPU/network | Sua máquina | GitHub runner (Ubuntu, 4 vCPU) |
| Upload | Public temporary | Public temporary (link em log) |
| Fail mode | Exit code != 0 se assert falha | `continue-on-error` em PR, hard em push main |

Scores podem divergir ~5-10pt entre local e CI por causa de CPU
slowdown × HW base. Asserts são calibrados pra CI (Ubuntu runner) —
local pode mostrar números melhores.

---

*Última revisão: 2026-05-15 · Ted · CWV-1*
