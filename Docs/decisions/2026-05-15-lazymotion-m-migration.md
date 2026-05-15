# ADR — LazyMotion + `m.*` em vez de `motion.*` everywhere

**Date:** 2026-05-15
**Status:** Accepted (shipped across `e8327d6`, `5c211b9`, `b31fc4b`, `1d0c998`, `777e530`)
**Manifesto refs:** §16 (disponibilidade — bundle pequeno = sneakernet viável)

## Context

Framer Motion é a lib de gestos do Drift (swipes verticais ↑↓ pra
DRIFT/SINK, horizontais ← → pra subposts navigation). Default API
(`motion.div`, `motion.button`, etc.) importa o pacote inteiro:

- `m.*` shapes (todos os componentes).
- `domMax` feature set (drag, layout animations, pan, tap, hover,
  exit, gestures, etc.).
- Animação completa engine.

Entry chunk antes da migração: 308 KB raw / ~85 KB gzip — bem acima
do hard ratchet de 250 KB (S1 budget, manifesto-coverage-matrix).

Drift PWA precisa caber em **dist.zip pequeno** pra cenários de
sneakernet (manifesto §16 — disponibilidade distribuída sem internet
contínua; cliente baixado por torrent / USB / share).

## Problem

Três sub-decisões acopladas:

1. **`motion.div` vs `m.div`.** `motion.*` é eager; `m.*` é o shape
   "passive" que requer `LazyMotion` provider e features
   carregadas separado. Migrar tudo pra `m.*` permite tree-shake do
   feature set.

2. **`domMax` vs `domAnimation`.** `domMax` traz drag, layoutId, pan,
   gestures completos (~70 KB). `domAnimation` traz só
   animação básica (~25 KB). Se o app não usar drag/pan, `domAnimation`
   corta ~45 KB raw.

3. **Drag em swipes: Framer drag vs pointer events nativos.** Framer
   drag é parte do `domMax`. Se `SwipeHandler` e `ReplySheet`
   usarem pointer events + RAF próprios, `domAnimation` vira
   suficiente.

## Decision

Migração em três etapas, executadas como commits separados:

1. **`e8327d6`** — `motion.* → m.*` em todos os consumidores. Wrap
   App root com `LazyMotion` provider. Inicial: features `domMax`.
   Bundle redução: ~10 KB (shape tree-shake já ajuda).

2. **`b31fc4b` + `1d0c998`** — Rewrite `SwipeHandler` e `ReplySheet`
   sem Framer drag. Pointer events nativos + RAF + transform inline.
   Permite trocar `domMax` por `domAnimation`. Bundle redução: ~45 KB.

3. **`5c211b9`** — `FeedTabs` substitui `layoutId` por `animate x`
   manual. Última dependência de `domMax` removida.

4. **`777e530`** — Import via named destructure
   (`import { domAnimation, LazyMotion, m } from 'framer-motion'`)
   pra garantir tree-shake (subpath imports tinham edge case).
   Bundle redução final: ~70 KB raw.

Resultado agregado: entry chunk 308 KB → 200 KB (S1 ratchet ≤ 250 KB).

## Consequences

**Positivas:**

- Entry chunk dentro do hard budget. CWV verde (LCP < 2.5s em
  Lighthouse 3G).
- Bundle compacto direta cumpre §16 (disponibilidade sneakernet) —
  cada KB cortado é KB que cabe num WhatsApp share.
- Forçou separação de concerns clean: pointer events nativos em
  `SwipeHandler` são mais previsíveis (single owner do gesture
  pipeline) — pavimentou a remoção de F-09 (`d2ff4fd`) e o fix de
  Framer snap-back (`4f4ed83`).

**Negativas:**

- Pointer events nativos exigem mais código de boilerplate em
  `SwipeHandler` (cancel detection, RAF cleanup, scroll lock).
  Trade-off aceito — código é local, testável (`computeInitialFromExit`
  + `buildFanItems` helpers em `7f07480`).
- Contributor novo precisa lembrar de usar `m.*` (não `motion.*`).
  Lint rule via `eslint-plugin-no-restricted-syntax` ou code review.
- `LazyMotion` provider é dependency global — bootstrap menor não-comum
  pode esquecer (em testes ou storybooks isolados). Mitigado por
  wrapper no test setup.

## Alternatives considered

1. **Manter `motion.*` everywhere + tree-shake automático.** Tentado;
   Webpack/Vite tree-shake não conseguem eliminar `domMax` se
   qualquer consumidor importa `motion.*` (ele puxa o feature set
   completo eager). Rejeitado.

2. **Substituir Framer Motion inteiramente por CSS animations / Web
   Animations API.** Tentação clássica. Rejeitado: o investimento em
   testes de swipe (`tests/post-viewer.test.ts`, helpers extraídos)
   está construído em cima do mental model Framer; rewrite seria
   sprint inteira de regressões. Sai mais caro que ganho.

3. **`domMax` mas split em chunk lazy.** Diferia 70 KB pra second
   paint, mas chunk inicial ainda paga 200+ KB e gestos críticos no
   first paint (swipe imediato) ficam atrasados. Rejeitado.

## References

- Commits: `e8327d6` (migração `m.*`), `b31fc4b` (SwipeHandler sem
  Framer drag), `1d0c998` (ReplySheet sem Framer drag), `5c211b9`
  (FeedTabs sem layoutId), `777e530` (named destructure).
- `tests/post-viewer.test.ts` — helpers de swipe testados.
- `Docs/manifesto-coverage-matrix-2026-05-15.md` — S1 budget ratchet.
- Manifesto §16 (disponibilidade distribuída — bundle compacto).
- Co-decisão com `2026-05-15-f09-removal.md` — separação de
  responsabilidades de gesto.
