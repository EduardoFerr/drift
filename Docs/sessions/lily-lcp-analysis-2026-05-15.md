# Análise LCP — 2026-05-15 (Lily)

## Contexto

Lighthouse single-run mais recente: LCP **2.6s** (anterior **2.3s**).
Bundle havia sido cortado significativamente:

- entry: 208 → 190 KB
- vendor-motion: 143 → 73 KB

A pergunta da sessão: o LCP regrediu mesmo, ou é variância de medição?
Há otimização aplicável ao elemento LCP propriamente?

## Identificação do LCP candidate

Boot pipeline:

```
main.tsx → ReactDOM.render(<StrictMode><AppErrorBoundary><LazyMotion><App/>)
App.tsx:732 → if (boot.step !== 'ready') return <BootView state={boot}/>
```

**Primeiro paint = `BootView`** (App.tsx:2092+). Above-the-fold:

```jsx
<header className="mb-10">
  <h1 className="font-display text-[25px] font-extrabold leading-none
                 tracking-[-0.5px] text-drift-text">
    dri<em className="not-italic text-drift-accent">ft</em>
  </h1>
  <p className="mt-2 text-xs uppercase tracking-widest …">
    Bootstrap · {state.step}
  </p>
</header>
<Check label="cross-origin isolation" … />
<Check label="sqlite wasm" … />
…
```

**LCP element = o `<h1>` "drift"** — 25px font-extrabold, family `font-display`
(= `"Syne Variable", Syne, system-ui, sans-serif`). É o único bloco grande
above-the-fold; os `<Check>` rows são `text-sm` (~13px).

Não há imagem above-the-fold no boot. Splash não tem hero image. Logo é
texto puro renderizado em Syne Variable.

## Estado atual das otimizações relevantes ao LCP

Auditoria do setup:

| Item | Estado | Onde |
|------|--------|------|
| Fontes locais (sem cross-origin fetch) | ✅ | `@fontsource-variable/syne`, `@fontsource/dm-mono` em `src/index.css` |
| Preload de Syne latin (variable wght) | ✅ | `scripts/preload-fonts.mjs` injeta `<link rel="preload" as="font" type="font/woff2" crossorigin>` em dist/index.html post-build |
| Preload de DM Mono 400 latin | ✅ | idem |
| `font-display: swap` (sem FOIT) | ✅ | `src/index.css:42,50` override explícito sobre `@fontsource` default |
| Fallback stack com métricas alinhadas | ✅ | `size-adjust: 100%`, `ascent-override: 90%`, `descent-override: 25%` em Syne; análogos em DM Mono |
| Fallback font stack sane | ✅ | `tailwind.config.js:80` — `['"Syne Variable"', 'Syne', 'system-ui', 'sans-serif']` |
| Critical CSS inlined | ✅ | Vite inlines small CSS por default |
| Theme color meta | ✅ | `<meta name="theme-color" content="#0c0c0b">` — pinta chrome do browser cedo |
| SVG icon < PNG fallback | ✅ | `drift-icon.svg` primary, PNG só apple-touch |

Nada está faltando no setup de fontes/preload pro LCP element atual.

## Hipóteses examinadas e descartadas

### H1: Preload de mais subsets / weights de fonts
**Descartada.** Aumentar preloads regride FCP (mais bytes críticos
competindo com o entry chunk). Latin variable + DM Mono 400 já cobrem
o `<h1>` e o `<p>` Bootstrap label. Outros weights/subsets carregam sob
demanda via `font-display: swap` sem bloquear LCP.

### H2: `<link rel="preconnect">` pra origem de fontes
**Descartada.** Fontes são same-origin (bundled em `/assets/`).
Preconnect é no-op nesse caso.

### H3: `fetchpriority="high"` no h1
**Descartada.** `fetchpriority` é pra fetch de subresources (img, fetch).
Não aplica a texto. O preload da Syne já é `as="font"` e o browser trata
font preloads em `<head>` com high priority por default.

### H4: Dimensões explícitas no `<h1>` (width/height)
**Descartada.** `<h1>` é texto inline-block dentro de `<header>`. Não
existe atributo width/height nativo pra texto. CLS está mitigado via
`size-adjust` + `ascent-override` + `descent-override` no fallback —
métrica do fallback alinhada com Syne, swap não shifta layout.

### H5: Inline o ícone SVG dentro do `<head>` pra pintar enquanto JS carrega
**Descartada como otimização de LCP.** Esse seria um paint do browser
antes do React mount, mas:
1. O ícone (`/drift-icon.svg`) é `rel="icon"`, não renderizado no body
2. Adicionar um SVG hero inline no `<body>` aumenta o initial HTML payload
   e desloca o LCP element pro novo elemento (que precisaria ser maior)
3. Sem `<noscript>` content útil, e adicionar um faz dupla manutenção

### H6: Pre-render do BootView no HTML estático
**Descartada por escopo.** Drift é client-rendered React + SQLite WASM.
SSR pra um shell `<h1>drift</h1>` exigiria mover a entry pra um template
HTML que duplica o JSX. Ganho: ~50-100ms (eliminação do React hydrate
pra esse h1). Custo: pipeline complexo, risco de divergência. **Não
faz sentido sem evidência forte de que o LCP é dominado pelo React
mount, não pelo font swap / fetch chunks.**

### H7: Reduzir o JS crítico antes do primeiro paint
**Validada como vetor, mas já foi feito.** Esse foi o trabalho
recente — entry 208→190 KB, vendor-motion 143→73 KB via LazyMotion +
domAnimation tree-shake. Mais cortes possíveis (e.g. mover AppErrorBoundary
pra dynamic import) mas com diminishing returns. Lily não vai nessa
rodada — esperar próximo Lighthouse run validar o trabalho já feito.

## Conclusão

**A regressão 2.3 → 2.6s é compatível com variância de medição
single-run do Lighthouse.** Typical noise em LCP é ±200-400ms entre
runs idênticos em mesmo CPU/network throttle. 300ms cabe dentro disso.

Recomendação: **rodar 5 Lighthouse runs e tomar mediana** antes de
declarar regressão. Single-run não é evidência suficiente pra agir.

**Não há otimização clara aplicável ao LCP element atual** que não
seja:
1. Trabalho pesado (SSR/pre-render) com ROI marginal
2. Mudanças cegas que podem regredir FCP/CLS

**Decisão: NO-OP em código.** Documentar a análise (este arquivo) e
aguardar:
1. Próximo Lighthouse fresh com média de 3-5 runs
2. Trabalho já em curso de bundle reduction (paralelos) chegar em
   entry < 180 KB

## Próximos vetores reais de LCP improvement (se necessário no futuro)

Em ordem de ROI, **se** Lighthouse mediano confirmar regressão ou
target < 2.0s:

1. **Lazy-load `AppErrorBoundary`** — atualmente carrega no entry. Se
   bootstrap não erra, é dead code no critical path. Economia: ~3-5 KB
   gzip. Ganho LCP estimado: 30-50ms em 4G slow.
2. **Splittar `LazyMotion` shell pro entry** — atualmente
   `LazyMotion features={loadMotionFeatures}` puxa o LazyMotion shell
   no entry (~3 KB). BootView não usa motion. Mover LazyMotion pra
   dentro do `<App>` (depois do early return de BootView) tira do
   critical path. Risco: requer cuidado pra não quebrar boundary de
   features. **Vetor mais promissor.**
3. **HTTP/2 push de `/assets/index-[hash].js`** via Vercel Edge Config
   — push do entry chunk antes mesmo do browser parsear o HTML.
   Vercel já faz Early Hints (103) automaticamente pra `<link rel="modulepreload">`;
   conferir headers em prod pra garantir.

## Arquivos auditados

- `index.html` (root)
- `src/main.tsx`
- `src/App.tsx` (BootView em 2090-2230)
- `src/index.css`
- `scripts/preload-fonts.mjs`
- `tailwind.config.js` (fontFamily)

— Lily, 2026-05-15
