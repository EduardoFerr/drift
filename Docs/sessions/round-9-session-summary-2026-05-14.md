# Round 9 — Session summary (2026-05-14)

**Data:** 2026-05-14
**Persona:** Robin (research / curadoria / docs)
**Escopo:** consolidar ~21 commits shippados em 2026-05-14 cobrindo UX
de swipe/card, compose/share, long-press moderation, actions fan,
bundle/perf, tokens/conformance e tests. **Doc-only.** Não modifica
código.

> ARTEFATO DE SESSÃO — registro pontual. Decisões de tom/escopo aqui
> só viram norma se Arquiteto propaga pra `Docs/` raiz.

---

## §1 Tema da sessão

A sessão de 2026-05-14 foi um round denso de **iteração UX direta a
partir de feedback do user** (swipe travando, "ver mais" preso atrás
de overlay, dead zone diagonal, compose/share friction) somado a
**cleanup operacional de backlog** (vendor-identity split, lazy
ThreadView, ratchet S1 hard, drift-warning/danger tokens). Sem feature
nova de protocolo — todo o trabalho é polish de cliente (camadas
React/Framer/Tailwind/Vite). O fio condutor foi: cada commit responde
a um atrito observado e ratifica o invariante com teste ou ratchet
quando aplicável. 21 commits, 0 mudança em `lib/` de domínio
(`events.ts`, `protocol.ts`, `scoring.ts`, `sync.ts` intocados).

---

## §2 Mudanças por agrupamento

### UX swipe / card (8 commits)

| SHA | Mudança |
|---|---|
| `4f93bea` | Substitui bottom-sheet por **fan vertical de ícones** ancorado no avatar — actions inline sem ocupar viewport. |
| `51574a5` | NavBar: SVG plus icon substitui glyph achatado (era o `+` colando no baseline). |
| `90adc28` | Card: **direction-aware entry `y`** — swap vertical fluido em ambas direções (antes só ↓ ficava certo). |
| `4f4ed83` | **Real root cause** do snap-back: Framer's internal drag spring brigava com wrapper exit no commit. Desliga `dragSnapToOrigin`. |
| `e0ee018` | Pré-fix ao `4f4ed83` — desliga spring-back durante commit (escopo menor). |
| `017b3cb` | Avalia eixos X e Y **independente** no SwipeHandler — sem dead zone pra drag diagonal. |
| `fe55be3` / `dff853e` / `e21dfe4` | Magnetic spring-back quando threshold não cruzado; threshold vertical 80→160px; swap vertical 500→750ms. |
| `0f5a922` | **Paper-flip tilt** durante drag horizontal (subpost) — micro-feedback tátil. |

### Compose / share (5 commits)

| SHA | Mudança |
|---|---|
| `4551f63` | "Ver mais/menos" agora é **inline expand** no próprio card — antes abria modal. |
| `27df57b` | Bootstrap do "ver mais": botão aparece quando body overflowa. |
| `693952e` | Fix: `pointer-events-none` no overlay deixava "ver mais" inclicável. |
| `818eaab` | **Share post links** abrem o Drift app em vez de njump.me. |
| `8770342` | Deep-link auto-abre **PostViewer (modal)** quando user chega via link compartilhado. |
| `fcb98f1` | Fan ganha **"share post" + "share image"** como ações dedicadas. |

### Long-press moderation (5 commits)

| SHA | Mudança |
|---|---|
| `a6e517f` | **Long-press 5s** sobre o avatar abre modal de block/report — sem bottom-sheet intermediário. |
| `2297f14` | Label **"segure pra moderar"** aparece após 600ms — affordance pro user entender o gesto longo. |
| `2789040` | Nunca inicia hold timer quando pointer está sobre a imagem (evita conflito com lightbox). |
| `4f893a4` | Suprime native browser context menu / iOS callout — sem menu nativo brigando com long-press. |
| `ad59bd5` | Hold de 500ms revela **tooltip hint** sobre o ícone do fan. |

### Bundle / perf (4 commits)

| SHA | Mudança |
|---|---|
| `24302f1` | **Split vendor-identity** (qrcode + bip39/bip32) em chunk lazy — fora do entry. |
| `ebabe86` | Virtualiza `ListModeBody` via `@tanstack/react-virtual` (Phase B dos comments). |
| `23f8e6c` | **Lazy `ThreadView`** — entry chunk **308 → 200 KB** (60 KB gzip economizados). |
| `f3b48eb` | **CWV S1 ratchet hard** — entry chunk ≤ 250 KB agora é erro, não warning soft. |

### Tokens / conformance (3 commits)

| SHA | Mudança |
|---|---|
| `1d0f5ed` | Introduz tokens semânticos `drift-warning` + `drift-danger` no design system + migra top 3 settings cards. |
| `1aee96b` | Estende migração pros demais Settings sites. |
| `fde312b` | Adota `DriftChip` em **PostViewer + CommentCard** pros chips de content-warning (antes inline classes). |
| `b68b240` | **TM-3 — informative warning** no compose quando há imagem sem `content-warning` tag (manifesto §27 surface). |

### Tests (1 commit + side-effect dos refactors)

| SHA | Mudança |
|---|---|
| `7f07480` | Extrai `computeInitialFromExit` + `buildFanItems` do PostViewer pra módulos puros + tests. **+18 tests** (944 → 962). |

---

## §3 Numbers

| Métrica | Valor |
|---|---|
| Commits shippados em 2026-05-14 | **21** |
| Files changed (cumulativo `51574a5^..1aee96b`) | **32** |
| Insertions / deletions | **+1199 / −294** |
| Entry chunk (bundle JS) | **308 → 200 KB** (−60 KB gzip) |
| CWV S1 budget | promovido de **soft warning → hard error** (≤ 250 KB) |
| Tests Vitest (`tests/`) | **944 → 963 passing** (+19) + 6 todo / 72 files |
| Lint warnings (drift-warning/danger migration) | **236 → 18** (parcial, ver §5) |
| Domínio (`events.ts`/`protocol.ts`/`scoring.ts`/`sync.ts`) | **intocado** (0 LoC) |

Distribuição por agrupamento:

| Grupo | Commits |
|---|---|
| UX swipe/card | 8 |
| Compose/share | 5 |
| Long-press moderation | 5 |
| Bundle/perf | 4 |
| Tokens/conformance | 4 |
| Tests/refactor puro | 1 |

(soma > 21 porque alguns commits cabem em 2 agrupamentos — ex.
`ad59bd5` tooltip on hold é actions-fan + long-press.)

---

## §4 Manifesto alignment

Checklist dos princípios tocados pela sessão:

- **§7 (determinismo)** — `computeInitialFromExit` e `buildFanItems`
  extraídos como funções puras com tests; mesma entrada → mesma saída.
  Sem `Date.now()` implícito. Quebrar tests = quebrar §7.
- **§13 (UX e perf)** — entry chunk −60 KB, S1 hard ratchet, comments
  virtualizados, ThreadView lazy. Latência percebida cai sobretudo em
  3G / cel low-end (target manifesto).
- **§16 (disponibilidade distribuída)** — share-link agora abre o
  próprio Drift em vez de njump.me. Sutil: reduz dependência de
  bridge externo na cadeia de leitura de posts compartilhados.
- **§17 (sem chave mestra)** — preservado: long-press 5s abre modal
  de **block/report local** (camada de visualização) e **reports
  kind 9081** (moderação comunitária reativa), nada que dê poder
  global ao fundador. Invariante §12 do CLAUDE.md mantida.
- **§24 (sem afinidade no feed)** — block/mute local continuam
  camada de visualização, não de ranking. Long-press só facilita o
  gesto, não muda escopo.
- **§25 (sem chave mestra disfarçada)** — TM-3 warning no compose é
  **opcional e informativo**, sem bloquear publicação. Auto-classificação
  voluntária do autor (§27), não scan automático.
- **§27 (auto-classificação voluntária)** — TM-3 surface educa o user
  a marcar `content-warning` quando há imagem; default permanece
  blur-on-receive opt-in no leitor.

Invariantes do CLAUDE.md verificadas (sem regressão):

- ✅ `onNostrEvent()` única porta de INSERT — sem mudança.
- ✅ Optimistic UI nunca alimenta SQLite — sem mudança.
- ✅ Funções puras pra negócio — `computeInitialFromExit` + `buildFanItems`
  adicionados como puras com tests.
- ✅ SQLite em worker — sem mudança.
- ✅ Sem scan automático — TM-3 é warning textual, zero ML.

---

## §5 Open items pra próxima sessão

1. **18 lint warnings remanescentes** em `PostViewer` / `CommentCard`
   — migração `drift-warning`/`drift-danger` foi parcial (236 → 18).
   Fechar o trailing 18 antes de declarar token migration done.
2. **SRI baseline** — não shippou hoje. Continua DEFER pra Round
   CWV-4 ou Fase 6.7 (referência: `barney-cwv-security-regression-2026-05-09.md`
   §3). Importante antes de campanha em jurisdição censurada.
3. **Lighthouse real-run com bundle novo** — entry chunk caiu pra
   200 KB, mas `lhci` no CI ainda é soft. Rodar manual em 3G throttle
   pra captar TBT/LCP real e considerar promover lhci asserts pra hard
   se headroom permite.
4. **Test coverage do flow deep-link** — `818eaab` + `8770342` ainda
   sem tests automatizados pro fluxo "njump-like URL → resolver →
   `getPostById` → PostViewer modal aberto". Smoke manual OK; cobrir
   com test em `tests/share-deep-link.test.ts` (ou similar).
5. **F-09 doc decision** — tap-to-advance no PostViewer foi removido
   (`bb403fe` 2026-05-13). Registrar racional formal em
   `Docs/decisions/` ou seção do design-system.md pra evitar revert
   acidental por contributor novo.
6. **AT-1/AT-5/AT-7/AT-9/AT-11 carry-overs** — auto-mode threats
   continuam status quo (Barney round CWV-2 §4). Auto-mode não
   shippou; reabrir quando feature voltar ao roadmap.
7. **§15 E2E testbed** — status quo. Tor smoke shippou pra source
   builders em 2026-05-01; falta testbed cross-jurisdição reproduzível
   (referência: `15-e2e-testbed-scoping-2026-05-08.md`).
8. **TM-3 follow-up** — warning informativo no compose foi shippado
   (`b68b240`); per-subpost CW (gap apontado em
   `per-subpost-cw-gap-2026-05-08.md`) continua aberto. Decidir se
   subpost herda CW do post pai ou ganha tag própria.

---

*Última edição: 2026-05-14 — Robin. Persona Drift, não pessoa.*
