# Ted UX Spike — drift-wheat-one.vercel.app (deploy production)

**Data:** 2026-05-08
**Persona:** Ted (HIMYM — arquitetura, padrões)
**Versão deploy:** 0.6.0-ALPHA.4 (Vercel — alguns commits atrás do `main` local que está em 33f7c23)
**Viewport spike:** 542×575 (mobile narrow ~ iPhone 13 Pro)
**Foco:** UX flow / interaction / information architecture / paradigm

> Robin já entregou QA #1 baseline com 90 findings de cor + component
> compliance (`design-qa-baseline-2026-05-08.md`). Este doc é
> **complementar**, não duplicado: foco aqui é em **fluxo, hierarquia,
> animação, descoberta** — não em token correctness.

---

## §1 Sumário executivo

Drift entrega o **happy path navegável** pelo design system v0.7. Color
scheme está em ~62% de conformidade (Robin QA #1). O que **falta** é
o nível seguinte: **paradigmas de leitura, transições polidas,
informação justificada**. Encontrei 12 issues de UX flow que NÃO são
cor — são interação.

| Severity | Count | Effort |
|---|---|---|
| S0 (quebra fluxo) | 2 | E1 |
| S1 (irrita regularmente) | 7 | E0–E1 |
| S2 (polish) | 3 | E0 |

---

## §2 Findings

### TX-1 — Sub-card abre por cima do SettingsRoot com flicker visível mid-transition (S1, E1)

**Arquivo:** `src/App.tsx:780-845` (SettingsRoot AnimatePresence + onSelect handlers que setam `setShowStatusCard(true)` etc.)

**Sintoma:** Tap em STATUS (e provavelmente outros itens — RELAYS,
CHAVE, etc.) inicia animação de slide-up do StatusCard *enquanto*
SettingsRoot ainda renderiza completamente. Em ~300ms da transição, é
possível ver:
- 2 títulos sobrepostos ("configurações" + "status")
- 2 botões FECHAR stacked
- Conteúdo do sub-card translucid sobre items da SettingsRoot

Após settle (~500ms), tudo limpa. Mas o flicker é confuso pra user
("o que aconteceu?").

**Causa provável:** `FullPageOverlay` motion config:
```ts
initial={{ opacity: 0, y: 22 }}
animate={{ opacity: 1, y: 0 }}
```

`opacity: 0 → 1` cria fase translucid antes de bater no opaque
`bg-drift-bg`. Combinado com `y: 22 → 0` fica visível durante slide.

**Mitigação proposta:**
- (a) Remover fade — só `y` slide. Sub-card aparece "pop" mas sem
  translucid mid-state.
- (b) Setar opacity inicial em 0.95 em vez de 0 — sub-card já bg-opaque
  no boot da animação.
- (c) Animar `y` mais rápido (250ms → 150ms) — flicker dura menos.

Recomendado: (a). Translucid em sub-card é "explainer brand" antes de
"function design".

### TX-2 — ThreadView (comentários) NÃO respeita max-w-md cap visual (S0, E0)

**Arquivo:** `src/components/Post/ThreadView.tsx`

**Sintoma:** Em viewport > 448px (desktop, tablet portrait), home view
e post viewer respeitam `max-w-md` centered (mockup mobile-first).
ThreadView vai **edge-to-edge** — comment cards fillam a width inteira
do browser.

**Evidência:** Screenshot em viewport 542×575: thread mostra `ANON_D7DE3A`
header + "i" content + "RESPONDER" footer ocupando 958+ pixels de width
(saindo do viewport visível).

**Por que isso quebra UX:**
- Inconsistência: mesmo "modal-like overlay" em viewport diferente
- Reading width >75ch é ruim pra leitura (typography research)
- Drift é mobile-first; desktop usuários têm reading line gigante

**Mitigação:** `<FullPageOverlay>` já tem `max-w-md mx-auto sm:border-x`
desde fix de 2026-05-08. ThreadView provavelmente NÃO usa
FullPageOverlay primitive — render próprio. Migrar pra primitive (ou
adicionar wrapper `<div className="mx-auto max-w-md">`).

### TX-3 — Post card text-only deixa ~70% vazio (S1, E1)

**Arquivo:** `src/components/Post/SubpostLayout.tsx` — TextLayout

**Sintoma:** Post "III. Da identidade" (4 subposts, sem imagem
detectável no atual) mostra título + meta no rodapé do card (~30%
inferior). Top 70% do card = bloco preto vazio.

**Mockup v0.7 prevê:** decorative letter Syne 800 100px absolute
bottom-right (subtle, aria-hidden). Não vejo render desse letter no
deploy. Possível root cause:
- (a) `getDecorativeLetters()` retornando `''` pra esse post
- (b) Letter renderizando atrás de outros elementos com z-index
  errado
- (c) Cor da letter (drift-muted/10) invisível em drift-bg

**Mitigação:** Inspecionar com DOM tools — confirmar se letter está no
DOM mas invisível. Se sim, bumpar opacidade (`text-drift-muted/10` →
`text-drift-muted/20`). Se ausente, debug `getDecorativeLetters` pra
ver retorno.

Manifesto §22 (score determinístico) não vetado letter decorativo
desde que pure (`getDecorativeLetters(postId)` puro).

### TX-4 — Comentário com 1 char ("i") tem mesma altura que comentário com 1000 chars (S1, E0)

**Arquivo:** `src/components/Post/CommentCard.tsx`

**Sintoma:** Comment de 1 letra ocupa ~700+ pixels height (preenche
viewport). Comment com 1k chars provavelmente ocuparia mesma altura
visual (limitado por overflow-hidden do card).

**Por que problema:**
- Density inversa do esperado: comment vazio gigante, comment cheio
  cortado
- Card paradigm com h-fixa não escala com content size

**Mitigação (curto prazo):** `min-h` em vez de `h-full`. Card cresce com
content; vazio fica baixo (auto-height). Opção long-term: list-mode
(UX-1 do Robin audit) — não é card-stack, é stream scrollable.

### TX-5 — Cabeçalho ThreadView críptico ("_D7DE3A 1/1 NÍVEL 1") (S1, E0)

**Arquivo:** `src/components/Post/ThreadHeader.tsx`

**Sintoma:** Header do thread mostra:
- "_D7DE3A" — últimos 6 chars do post ID em hex (críptico — user não
  reconhece "qual post é")
- "1/1 NÍVEL 1" — significa "comment 1 de 1, profundidade 1" (?). Sem
  legenda, é ruído.

**Mitigação:** Mostrar **título do post original** (truncated, com
elipse) em vez de `_xxxxxx`. Ex: "III. Da identidade" com `…D7DE3A`
chip pequeno se precisar de ID literal pra debug. Manifesto §22
(determinismo): título já está no SQLite local.

### TX-6 — Botão "+ no post" do UX-9 (Marshall) NÃO visível no deploy (S0, E0 — pendente deploy)

**Arquivo:** `src/components/Post/ThreadHeader.tsx` (commit 33f7c23)

**Status:** Marshall shipou `+ no post` em 33f7c23. Deploy 0.6.0-ALPHA.4
está antes desse commit. Verify: novo deploy + retest. Sem botão, user
em thread só consegue criar reply ao cursor (UX-9 do Robin audit
descobrira esse gap).

**Ação:** Aguardar deploy automático Vercel (CI verifica + push triggers
deploy). Confirmar visualmente em ~30min.

### TX-7 — Post card não responde a tap no body (S1, E0)

**Arquivo:** `src/components/Post/PostViewer.tsx` (embedded mode)

**Sintoma:** Tap fora dos botões (action menu, comment icon, spread
map) no post card retorna no-op. Usuário esperaria "tap = open detail"
ou "tap = next subpost" ou "tap = reveal CW".

**Realidade:** Tap só funciona em CW reveal ("toque pra revelar"
button). Body tap = nada.

**Mitigação:** Adicionar tap = next subpost (caso post tenha múltiplos)
ou tap = mostra footer hidden. Discoverability gap.

### TX-8 — Status indicators (network/GPS) ícones SVG corretos mas tooltip overflow (S2, E0)

**Arquivo:** `src/App.tsx:1077-1183` (StatusIndicators)

**Sintoma:** Tooltip "rede: clearnet — abrir modo de rede" e "gps:
desativado — abrir granularidade de gps" são longos. Em mobile, tooltip
nativo do browser pode ficar fora da viewport.

**Mitigação:** Usar `aria-label` (já implementado) + tooltip mais curto
("modo de rede" / "gps off") + custom tooltip usando o sistema
DialogHost. Lower priority.

### TX-9 — Update banner (`UpdatePrompt`) ocupa muito espaço no boot (S1, E0)

**Arquivo:** `src/components/UI/UpdatePrompt.tsx`

**Sintoma:** Banner "Nova versão do Drift disponível" + 2 botões
(ATUALIZAR AGORA / MAIS TARDE) ocupa ~150px da home no primeiro boot
após deploy. Cobre parte do post card.

**Mitigação:** Renderizar como toast top-right colapsado (similar a
GitHub merged-PR notifications). User vê dot pulsante + click expande.
Reduz first-impression-clutter.

### TX-10 — NetworkModeCard tem ~75% vazio em PWA mode (S2, E0)

**Arquivo:** `src/components/Settings/SettingsCards.tsx` — NetworkModeCard

**Sintoma:** Em PWA, Tor + Onion-only desabilitados (gray). Card mostra
3 buttons + 1 paragraph status, depois vasto vazio até EOF.

**Mitigação:** Mostrar info-card "Por que Tor/Onion-only requer Tauri?"
no espaço vazio, com link pra docs (manifesto §15) + CTA "baixar
Drift Desktop" quando Fase 6.7 ship distribuição. Educação sobre
manifesto + path migracional.

### TX-11 — FECHAR button correto (chartreuse border + mint text), MAS tela inteira não-clicável fora dele (S2, E0)

**Arquivo:** `src/components/UI/FullPageOverlay.tsx`

**Sintoma:** SettingsRoot (e sub-cards) abrem como fullscreen. ESC e
botão FECHAR fecham. **Não tem click-out** (clicar em área escura ao
redor não fecha — porque overlay É fullscreen, sem área escura).

**Mitigação:** Em viewport > sm, há `border-x` revealing dark area
ao lado do max-w-md. Não responde a click. Adicionar onClick handler
nessa área OU manter ESC + FECHAR como únicos paths (consistente).

Decisão: deixar como está se decidir consistência cross-viewport. Se
mudar, fazer pra TODOS os FullPageOverlays.

### TX-12 — ComposeOverlay layout selector RETRATO ativo mas SEM upload mostra empty placeholder (S2, E0)

**Arquivo:** `src/components/Create/ComposeOverlay.tsx`

**Sintoma:** Em modo RETRATO sem imagem upload, área "ADICIONAR IMAGEM"
fica empty drop zone com ícone montanha. Caption textarea ainda vazia
("legenda (opcional)..."). User precisa entender: "preciso da imagem
pra retrato funcionar?" Affordance pouco clara.

**Mitigação:** RETRATO sem imagem → layout falha publicar (provavelmente).
Em vez disso: **graceful fallback**: se RETRATO + sem imagem,
auto-switch pra TEXTO ao publicar (Drift já faz isso em
`SubpostLayout.tsx:287-296` para render — extender pro publish).
Hint visual: "RETRATO precisa de imagem · TEXTO usa só palavras".

---

## §3 Cross-cutting (não-finding mas observação)

### CC-1 — Vocabulário UI consistente

DRIFT/SINK em UI confirmados. Spread/bury só em código/spec. Vocabulário
mapping (CLAUDE.md §) honrado em deploy. ✓

### CC-2 — StatusIndicators clicáveis após user feedback de hoje

Ícones de network e GPS no header agora respondem a click → abre
respectivo card. Mudança de hoje (2d1337a) está no deploy. ✓

### CC-3 — InstallModal ainda não no deploy

Modal de instalação (commit 5be7643) não está no deploy 0.6.0-ALPHA.4.
Banner de install ainda inline (legacy). Após próximo deploy, verificar.

### CC-4 — Per-tab unseen badge no FeedTabs

Dot chartreuse no nome de cada tab — recém shipado (52029b0). Em deploy:
**ainda não testável**. Verificar após Vercel auto-deploy.

---

## §4 Quick wins ordenados por ROI

| # | Finding | Severity | Effort | ROI |
|---|---|---|---|---|
| 1 | TX-2 | S0 | E0 | 🔥🔥🔥 — fix de 1 div wrapper resolve thread-edge-to-edge |
| 2 | TX-1 | S1 | E1 | 🔥🔥 — opacity-1-initial fix flicker em todos sub-cards |
| 3 | TX-5 | S1 | E0 | 🔥🔥 — title legível em vez de hex hash |
| 4 | TX-4 | S1 | E0 | 🔥 — min-h em vez de h-full em CommentCard |
| 5 | TX-3 | S1 | E1 | 🔥 — debug decorative letter render |
| 6 | TX-7 | S1 | E0 | 💧 — adicionar tap = next subpost |

Top 3 em sequência (~1.5h Lily): TX-2 + TX-1 + TX-5.

---

## §5 Refactor maior recomendado

Convergente com Robin QA #1 §7 (`<DriftButton>` primitive) — um
**`<FullPageCard>` primitive** que gerencia z-index + animação +
backdrop properly resolveria TX-1 (flicker) + TX-2 (max-w-md
inconsistente em ThreadView) + TX-11 (click-out behavior consistent)
de uma só.

**Effort:** ~2h Lily ou Marshall. **Bloqueio:** depende de aprovação
arquitetural do Arquiteto pra fazer agora vs deferir pra design-system
v0.8.

---

## §6 Cross-references

- `Docs/sessions/design-qa-baseline-2026-05-08.md` (Robin QA #1) —
  90 findings cor + component compliance
- `Docs/sessions/comments-ux-audit-2026-05-08.md` (Robin) — 15 finds
  Comments UX, top 3 quick wins
- `Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md` (Ted ADR) — auto
  fallback FSM
- `Docs/sessions/auto-mode-detection-algorithm-2026-05-08.md` (Robin) —
  detection algorithm + PWA blocker
- `Docs/sessions/auto-mode-threat-model-2026-05-08.md` (Barney) —
  threat model + AT-11 fundamental blocker

---

*Spike conduzido em ~30min. Tools: Claude_in_Chrome MCP. Deploy testado:
0.6.0-ALPHA.4 (Vercel). Scope: visual + interactive flow.*
