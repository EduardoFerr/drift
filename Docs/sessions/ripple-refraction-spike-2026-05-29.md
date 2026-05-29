# Ripple — Refração Líquida Real Spike (2026-05-29)

> *"O ripple atual é uma promessa visual: 'a água passou aqui'. O que
> o user pede é a água de verdade — pixels dobrando atrás da crista
> como lente convexa. Entre os dois há um abismo de orçamento de
> render. Esse spike mede o abismo antes de pular."* — Ted
>
> *"Eu quero SENTIR o dedo afundar na superfície e ver o feed tremer
> debaixo da onda. Mas se pra isso eu travo o scroll a 22fps num
> Android de 150 dólares, o efeito vira náusea, não magia. A pergunta
> não é 'dá pra fazer' — é 'dá pra fazer sem o telefone gemer'."* — Lily

**Personas:** Ted (arquitetura gráfica, orçamento de render, §1) +
Lily (sente o efeito, runtime, fidelidade do gesto). Honestidade
Satoshi sobre viabilidade WebGL-grade.

**Escopo:** SPIKE doc-only. Avaliar viabilidade de **refração real**
(distorcer pixels do conteúdo SUBJACENTE — feed/wallpaper/texto — por
deslocamento físico de onda, com cristas atuando como lentes convexas)
ao toque. 3 approaches: A (SVG `feDisplacementMap`), B (WebGL shader),
C (aproximação CSS sem refração). POC inline para o approach viável.
**Sem wire em produção.**

**Estado atual** (`src/styles/ripple.css`):
- `.ripple-wave` — long-press, 3 ondas concêntricas (outline expand),
  CSS puro, `animation-iteration-count: infinite`.
- `.material-ripple` (`useMaterialRipple.tsx`) — single wave fill M3,
  ~550ms, contido no host.
- **Nenhum refrata conteúdo subjacente.** Ambos são overlays opacos/
  alpha por cima — o pixel atrás não se move. §1: zero-JS-pós-mount.

Consumidores do ripple hoje: `SpreadMap.tsx`, `PostViewer.tsx`,
`NavBar.tsx`. LOCK_VIA_TEST: `tests/material-ripple-conformance.test.ts`.

---

## 1. Veredito por approach

### A — SVG `feDisplacementMap` + mapa radial animado

**Mecânica:** `<filter>` SVG com `<feImage>`/`<feTurbulence>` gerando
um *displacement map* (cada pixel do mapa diz "desloque o pixel-fonte
em (R,G)→(dx,dy)"). `feDisplacementMap` lê esse mapa e empurra os
pixels do elemento-fonte. Aplicado via `filter: url(#ripple)` num
container, distorce **os children renderizados** desse container — ou
seja, refrata o DOM real subjacente, não um snapshot.

| Critério | Veredito |
|---|---|
| **Fidelidade** | 🟢 Refração REAL de pixels DOM. Crista como lente convexa = gradiente radial no mapa com inflexão de sinal nos anéis (dx aponta pra fora na crista, pra dentro no vale). Shimmer via `feGaussianBlur` leve no mapa. É o efeito pedido, de verdade. |
| **Perf** | 🟡 SVG filter full-screen re-avaliado a cada frame é **caro** — é o gargalo clássico de filtros SVG. Mas **scoped a um raio ~200px** o custo cai pra fração da tela. Animar só o `scale` do displacement + raio da onda (não regenerar o `feImage` por frame) mantém o filtro estável e só varia 1-2 atributos. |
| **Lib** | 🟢 Zero lib. SVG + CSS + `requestAnimationFrame`. Built-in do browser. |
| **§1** | 🔴 Viola "zero-JS-pós-mount" — exige RAF loop durante a animação (~600-900ms por toque). Trade-off explícito documentado abaixo. |
| **reduced-motion** | 🟢 Fallback trivial: não monta o filtro, cai no `.material-ripple` atual (overlay sem distorção). |

**Detalhe arquitetural crítico (Ted):** o ponto de aplicação do
`filter` define o *view-boundary* da distorção. Aplicar no container do
feed inteiro = re-render do filtro sobre toda a árvore = caro **e**
quebra `position: fixed`/`sticky` (filtros criam containing block,
NavBar fixa "gruda" no container filtrado). **Por isso scoped vence
duplamente:** um `<div>` overlay clip-pado a um disco de ~200px ao
redor do toque, contendo um `<foreignObject>` ou um `backdrop`
filtrado, isola o efeito sem tocar layout do feed.

⚠️ **Pegadinha real de implementação:** `feDisplacementMap` distorce
os *próprios children* do elemento filtrado, **não** o que está *atrás*
dele no z-stack. Para refratar o feed-atrás-do-overlay sem duplicar o
DOM, o caminho honesto é `backdrop-filter` — **mas `backdrop-filter`
NÃO aceita `url(#svgfilter)` de displacement em Chromium/WebKit hoje**
(só blur/brightness/etc. das funções CSS nativas). Logo, refratar
*backdrop* arbitrário via SVG displacement **não funciona cross-browser
sem duplicar/re-render a subárvore dentro do overlay filtrado.**

Isto rebaixa A de 🟢 para 🟡 em fidelidade-no-backdrop: A refrata
perfeitamente *children do elemento filtrado*, não *o backdrop livre*.
Para o caso Drift (refratar o feed inteiro atrás), A exigiria envolver
o feed inteiro no filtro (caro + quebra fixed) OU renderizar um clone
da região tocada dentro do overlay (custo de clone DOM por toque).

### B — WebGL canvas overlay (fragment shader)

**Mecânica:** capturar a tela → textura → fragment shader com
deslocamento radial senoidal + refração. O shader em si é trivial e
60fps sobrando. O problema é **conseguir a textura do DOM**.

| Critério | Veredito |
|---|---|
| **Fidelidade** | 🟢 Máxima. Shader faz refração fisicamente correta, Snell, cromática, o que quiser. |
| **Perf (shader)** | 🟢 60fps tranquilo. **Perf (captura)** | 🔴 ver abaixo. |
| **Lib** | 🔴 Capturar DOM arbitrário = `html2canvas` (~50KB+ gz, lento, falha em CSS moderno) ou `dom-to-image`. WebGL puro dispensa three.js, mas a CAPTURA é o veto. |
| **§1 / latência** | 🔴 `html2canvas` leva **dezenas a centenas de ms** pra rasterizar uma viewport não-trivial. Isso mata o "instantâneo ao toque" — o usuário vê o feed *congelar*, depois a onda. O snapshot lag é exatamente o oposto da sensação de água viva. |
| **reduced-motion** | 🟢 fallback trivial (não captura). |

**Veredito B: 🔴 NO-GO** para o cliente oficial. Não pela GPU — pela
captura. Não existe API web pra "textura ao vivo do que está atrás
deste canvas" (não há `BackdropTexture`). `html2canvas` viola
no-lib-externa (memory: validar 4 alternativas — aqui as alternativas
nativas não existem) E viola o requisito de instantaneidade. Único
cenário onde B vira viável: **Fase 6 cliente nativo Tauri**, onde a
camada nativa pode dar um framebuffer real da webview à GPU sem
rasterização JS. Fora do escopo PWA atual.

### C — Aproximação CSS (sem refração de pixels)

**Mecânica:** overlay com `backdrop-filter: blur()` radial animado +
`scale`/`brightness` shimmer. Anéis de blur expandindo dão "água
mexida" sem deslocar geometria.

| Critério | Veredito |
|---|---|
| **Fidelidade** | 🟡 NÃO há lente convexa, NÃO há dobra de pixels. Dá *desfoque pulsante radial* — sensação de "perturbação líquida", não de refração. Honestamente: é água fosca, não água que dobra a luz. |
| **Perf** | 🟢 `backdrop-filter` é GPU-acelerado; animar `clip-path`/raio + opacity é barato. Scoped fica trivial. Pode chegar a 60fps mobile. |
| **Lib** | 🟢 Zero. |
| **§1** | 🟡 `backdrop-filter` animado ainda quer RAF ou keyframe CSS; um `@keyframes` puro com `clip-path` expandindo mantém zero-JS-pós-mount (como o ripple atual). Esse é o ponto forte: C **pode** ser 100% CSS. |
| **reduced-motion** | 🟢 trivial. |

**Veredito C: 🟢 GO como baseline seguro.** Não é o que o user
descreveu literalmente (sem lente convexa), mas entrega "a superfície
reagiu como líquido" sem nenhum risco de perf/lib/§1.

---

## 2. Recomendação

**Approach A, scoped a raio limitado (~180-220px), com fallback C.**

Racional honesto (Satoshi):

1. **B está morto no PWA** — não é questão de esforço, é ausência de
   API de captura ao vivo. WebGL-grade real só na Fase 6 nativa.
2. **A é o único que entrega refração REAL sem lib** — mas com a
   ressalva dura da §1.A: refrata *children do elemento filtrado*, não
   *backdrop livre*. Para Drift, isso significa que a versão honesta de
   A produz uma **lente convexa local num disco ao redor do toque sobre
   um clone/região renderizada**, não a tela inteira tremendo. Que é,
   de fato, fisicamente o que uma gota faz: a perturbação é local e se
   dissipa. "Tela inteira torcendo" é estilização, não física.
3. **Scope = disco ~200px** resolve simultaneamente: custo de filtro
   (fração da tela), quebra de `position: fixed` (overlay isolado fora
   do fluxo do feed), e fidelidade ao gesto (a água nasce no dedo).

**Decisão de viabilidade: 🟡 CONDITIONAL GO para A-scoped como
enhancement opt-in; 🟢 GO para C como baseline universal.**

Camadas (progressive enhancement):
- **Default / baixo-fim / reduced-motion:** C (ou o `.material-ripple`
  atual). Zero risco.
- **Opt-in "refração" (feature flag) em device capaz:** A-scoped, com
  RAF cancelado ao fim da dissipação e `will-change` removido pós-anim.
- **Fase 6 nativa:** reavaliar B com framebuffer real.

**Não vale o custo** queimar orçamento tentando A full-screen ou B com
`html2canvas`. Vale o custo um A-scoped polido como detalhe premium
opt-in, exatamente o tipo de "beleza não-previsível" que o projeto
persegue — desde que atrás de flag e capability-gated.

---

## 3. POC mínimo (Approach A scoped)

> Sandbox não roda browser headless com GPU aqui; FPS abaixo é
> **estimativa fundamentada**, a confirmar no primeiro wire real via
> DevTools Performance / `requestAnimationFrame` delta logging num
> Android mid-tier. Snippet é inline-testável colando num `.html`.

O POC distorce os **children de um disco overlay** (representando a
região do feed clonada/posicionada sob o toque). O mapa de
deslocamento é um `<feImage>` com radial-gradient codificando dx/dy nos
canais R/G; a onda é animada movendo o raio do anel claro via RAF (só
1 atributo muda por frame — o filtro não é regenerado).

```html
<!-- POC: cole num arquivo .html e abra. NÃO é wire de produção. -->
<svg width="0" height="0" style="position:absolute">
  <filter id="ripple-refract" x="-20%" y="-20%" width="140%" height="140%">
    <!-- mapa radial: centro neutro (gray = sem deslocamento, 128,128),
         anel da crista empurra pixels pra FORA (lente convexa) -->
    <feImage id="ripple-map" result="map"
      href="data:image/svg+xml,..." /> <!-- gerado dinâmico, ver JS -->
    <feDisplacementMap in="SourceGraphic" in2="map"
      scale="0" id="ripple-disp"
      xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div id="surface" style="filter:url(#ripple-refract); width:200px;
     height:200px; overflow:hidden; position:fixed">
  <!-- conteúdo a refratar: na produção, região do feed sob o toque -->
  <img src="wallpaper.jpg" style="width:100%">
</div>

<script>
const disp = document.getElementById('ripple-disp');
const mapImg = document.getElementById('ripple-map');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// gera o displacement map como SVG radial: anel claro = crista (empurra
// fora), anel escuro logo após = vale (puxa dentro). cx,cy = epicentro.
function mapHref(ringR, ringWidth) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
    <defs><radialGradient id='g' cx='50%' cy='50%' r='50%'>
      <stop offset='${Math.max(0, ringR - ringWidth)}%' stop-color='rgb(128,128,128)'/>
      <stop offset='${ringR}%' stop-color='rgb(220,220,128)'/>  <!-- crista: dx+ -->
      <stop offset='${Math.min(100, ringR + ringWidth)}%' stop-color='rgb(40,40,128)'/> <!-- vale: dx- -->
      <stop offset='100%' stop-color='rgb(128,128,128)'/>
    </radialGradient></defs>
    <rect width='200' height='200' fill='url(#g)'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function fireRipple() {
  if (reduce) { /* fallback C / overlay simples, sem RAF */ return; }
  const t0 = performance.now();
  const DURATION = 750;     // ms até dissipar
  const MAX_SCALE = 28;     // px de deslocamento de pico
  let raf;
  function frame(t) {
    const k = (t - t0) / DURATION;           // 0..1
    if (k >= 1) {
      disp.setAttribute('scale', '0');        // tela volta plana
      cancelAnimationFrame(raf);
      return;
    }
    const ringR = k * 90;                      // onda expande 0→90%
    const energy = Math.sin(k * Math.PI);      // sobe e dissipa
    disp.setAttribute('scale', String(MAX_SCALE * energy));
    mapImg.setAttribute('href', mapHref(ringR, 14)); // só href muda
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
document.getElementById('surface').addEventListener('pointerdown', fireRipple);
</script>
```

**Notas do POC (honestidade):**
- Regenerar o `href` do `feImage` por frame (`mapHref`) **é** custo —
  o browser re-parseia o data-URI SVG. Otimização real: pré-gerar
  N quadros de mapa (ex. 24) e ciclar `href` entre eles (sprite de
  mapas), ou usar `feTurbulence` + `feComponentTransfer` animando só o
  `seed`/`baseFrequency` (mais barato, shimmer orgânico, menos controle
  de "anel" limpo). Trade-off controle-vs-custo a decidir no impl.
- `scale` de pico ~28 dá lente convexa nítida; >40 vira "vidro
  derretido" exagerado. Ajustar com o user no wire.

**FPS estimado (a confirmar):**
- Desktop / iPhone recente: **60fps** num disco 200px, com sprite de
  mapas pré-gerado.
- Android mid-tier (~Snapdragon 6xx): **~45-55fps** com sprite; **~25-35fps**
  se regenerar `feImage` por frame (logo: sprite obrigatório no impl).
- Full-screen (rejeitado): **<30fps** em qualquer mid-tier — confirma
  a decisão scoped.

---

## 4. Honestidade radical sobre WebGL-grade

Refração WebGL-grade *real* (Snell físico, dispersão cromática, normal
map de fluido, 60fps garantido sobre o conteúdo ao vivo) **é inviável
no PWA atual** — não por falta de GPU, mas porque **não existe API web
que entregue ao WebGL a textura ao-vivo do que está atrás do canvas.**
Toda rota passa por `html2canvas` (lib externa pesada + lag de snapshot
que mata o gesto). Isso é um **NO-GO honesto para B no cliente PWA.**

O **melhor aproximável sem lib / sem violar perf** é **A-scoped**: uma
**lente convexa local de verdade** (pixels DOM dobrando) num disco ao
redor do toque, dissipando em ~750ms. Não é "a tela inteira torcendo"
— é a física honesta de uma gota: perturbação local que se espalha e
morre. Para o caso de refratar o *backdrop livre* (feed inteiro atrás),
A esbarra na limitação de `backdrop-filter` não aceitar displacement
SVG; o contorno é renderizar a região tocada dentro do overlay
(custo de clone) ou aceitar que o efeito atua sobre uma camada
dedicada, não sobre o feed bruto.

Se o requisito for *literalmente* "todo app/texto/wallpaper atrás
torce ao mesmo tempo, fisicamente correto, 60fps mobile" — então o
veredito honesto é: **espere a Fase 6 nativa (Tauri)**, onde o
framebuffer da webview vai à GPU sem rasterização JS. No PWA, isso é
NO-GO. O que dá pra entregar hoje, lindo e barato, é A-scoped opt-in
+ C universal.

---

## 5. Plano reduced-motion (WCAG 2.3.3)

`prefers-reduced-motion: reduce` é **condição de bypass total da
refração**:

- **Nunca** monta o filtro SVG nem inicia o RAF loop (distorção +
  movimento radial são exatamente o gatilho de náusea vestibular que
  2.3.3 protege).
- Fallback = `.material-ripple` atual (single fade, já com keyframe
  reduced-motion) OU um pulso de `opacity`/`brightness` estático sem
  deslocamento geométrico.
- Capability-gate também desliga em devices sem GPU compositing
  decente (heurística: `navigator.hardwareConcurrency` baixo + medição
  de 1º frame > budget → cai pra C).
- Sem regressão de a11y: a refração é **enhancement opt-in**; a base
  (ripple atual) já é WCAG-compliant e permanece o default.

---

## Resumo executivo

| Approach | Refração real? | Perf mobile | Lib | §1 | Veredito |
|---|---|---|---|---|---|
| A — SVG feDisplacementMap | 🟢 children / 🟡 backdrop | 🟡 só scoped | 🟢 zero | 🔴 RAF | 🟡 GO scoped opt-in |
| B — WebGL + html2canvas | 🟢 | 🔴 captura | 🔴 lib + lag | 🔴 | 🔴 NO-GO (PWA); reavaliar Fase 6 |
| C — backdrop blur radial | 🔴 (fosco, sem lente) | 🟢 | 🟢 zero | 🟡 pode ser CSS-puro | 🟢 GO baseline |

**Recomendação final:** C como baseline universal (zero risco) +
A-scoped (~200px) como enhancement opt-in capability-gated atrás de
flag, RAF cancelado na dissipação, sprite de mapas pré-gerado
obrigatório. B fica para Fase 6 nativa. Refração full-screen
WebGL-grade no PWA = NO-GO honesto.

---

*Spike doc-only. Nenhuma linha wired em produção. POC §3 é
inline-testável, não importado. Próximo passo sugerido: se user aprovar
A-scoped, abrir task de impl com benchmark FPS real (DevTools
Performance em Android mid-tier) como gate antes de merge.*
