# Lily — Material Ripple: Casos de Uso no Drift

**Dispatched:** 2026-05-21
**Persona:** Lily (core code / runtime / manutenibilidade / UX hands-on)
**Trigger:** User pedido "sensação de movimento ao toque estilo material
design" — paralelo à criação do primitive `useMaterialRipple()` para
decidir QUAIS componentes adotam.
**Output:** este relatório → deliberação HIMYM+Satoshi+user.

---

## Resumo executivo

Material Ripple é **primitive de feedback tátil**, não estilo visual
global. Aplicar indiscriminadamente vira ruído (toda interação acende
onda → user dessensibiliza). Aplicar onde **falta affordance de toque**
ou onde o toque dispara **ação consequente** entrega o efeito desejado
(sensação de movimento) sem virar barulho.

**Recomendação:**
- ✅ **Aplicar** em 4 superfícies de toque "intencional" (DriftButton,
  GlassIconButton xl, Settings rows, modal close buttons)
- ❌ **NÃO aplicar** em 7 superfícies onde já existe feedback ou onde
  introduz conflito (RadioGroupButton, FeedTabs, SwipeHandler,
  HintChip/AuthorChip xs/sm, feed cards, GlassIconButton sm/md/lg)
- ❓ **3 perguntas em deliberação** (ver seção final)

---

## Inventário de superfícies de toque (audit)

### ✅ Adotar ripple (Phase 1)

| Componente | Onde | Por quê |
|---|---|---|
| **DriftButton** (todas variants) | CTA principais (publish, drift, etc.) | Tap = ação consequente. Hoje só tem hover+active CSS — ripple complementa com sensação de "pressionou" |
| **GlassIconButton size=xl** | PostViewer ⋮ menu, modal triggers | Tap acessa ação destrutiva/configuração. Já tem 44×44px (WCAG target). Ripple sinaliza "registrou seu toque" |
| **Settings rows** (cards clicáveis) | SettingsCards.tsx — LocationCard, etc. | Row inteiro é tap target. Hoje feedback é hover bg apenas. Ripple a partir do ponto exato confirma o toque |
| **Modal close buttons** | Overlay close (X) | Ação reversível mas frequente. Ripple = "fechei propositalmente, não foi acidente" |

### ❌ NÃO adotar ripple

| Componente | Por quê |
|---|---|
| **RadioGroupButton** | Active state (cor + border) já é feedback claro. Adicionar ripple = duplica sinal |
| **FeedTabs** | Spring indicator (Framer Motion) já anima a troca de tab. Ripple compete com spring |
| **SwipeHandler** (PostViewer swipes) | Direction-based gesture. Ripple radial conflita com direção (↑↓←→). Long-press já tem ripple-wave concêntrico próprio |
| **HintChip / AuthorChip size=xs|sm** | <32px diâmetro. Ripple radial nessa escala vira flash, não onda |
| **Feed cards** (PostCard tap pra abrir) | Tap dispara navegação. Animação de transição (slide-in PostViewer) já é o feedback. Ripple = ruído pré-transição |
| **GlassIconButton size=sm|md|lg** | <44px (legacy). Ripple em alvo abaixo de WCAG é confusão — devíamos crescer o alvo, não compensar com efeito |
| **Long-press surface (PostViewer)** | `.ripple-wave` (3 ondas concêntricas, 3s) já é o feedback. Não duplicar com ripple curto |

---

## Princípios derivados (para futuras decisões)

1. **Ripple = confirmação de tap intencional**, não decoração. Se o
   componente NÃO dispara ação consequente, não precisa ripple.
2. **Tamanho mínimo 44×44px (WCAG 2.5.5)** pra adotar ripple. Alvos
   menores devem crescer, não compensar.
3. **Um feedback por evento.** Se já existe spring/transition/active
   state visível, ripple é redundante.
4. **Gestos direcionais (swipe) ≠ ripple radial.** Conflito visual
   confunde sobre o que aconteceu.
5. **Long-press tem ripple próprio** (`.ripple-wave`, 3 ondas). Não
   misturar com `.material-ripple` (single wave, 550ms).

---

## Phase 1 plan (se user aprovar)

**Escopo:** 4 componentes (DriftButton + GlassIconButton xl + Settings
rows + modal close). Wire `useMaterialRipple()` no host + adicionar
`material-ripple-host` class + render `<RippleLayer />`.

**Estimativa:** 4-6h (4 componentes × 1-1.5h cada incluindo tests
visuais manual + LOCK_VIA_TEST de adoção por componente).

**LOCK_VIA_TEST sugerido:**
`tests/material-ripple-adoption.test.ts` — verifica que cada um dos
4 componentes importa `useMaterialRipple` + tem classe host.

---

## Deliberação — 3 perguntas para HIMYM+Satoshi+user

### Q1. Default em `DriftChip md`?

DriftChip (selectable chip, ex: categorias) tem variant `md` (~40px).
Está no limiar WCAG (44px sugerido) mas é alvo de toque intencional.

**Lily recomenda:** OFF (não adotar). Crescer DriftChip pra 44px no
próximo polish round vale mais que compensar com ripple.

**Trade-off:** se OFF, todo chip de categoria fica sem feedback além
de active state. Se ON, viola princípio #2 (tamanho mínimo).

### Q2. GlassIconButton xl em PostViewer `⋮`: coexiste com double-edge ou esconde border durante wave?

GlassIconButton xl tem **double-edge effect** (Marshall design Sprint
N+1) — border interna + glow externo. Ripple radial expand passa por
cima da border interna.

**Opção A:** Coexiste — ripple no `z-index: 0` (atrás do conteúdo),
border permanece visível
**Opção B:** Hide border durante wave (550ms) — onda fica "limpa"

**Lily recomenda:** A (coexiste). Border é identidade visual do botão;
esconder por 550ms a cada tap polui mais que ajuda.

### Q3. Settings rows: ripple full-width OU contained no toggle?

LocationCard tem row clicável grande (~280px largura). Tap pode ser em
qualquer ponto.

**Opção A:** Full-width — ripple expand do ponto exato do tap pra cobrir
o row inteiro (~280px scale máximo)
**Opção B:** Contained no toggle — ripple só na área do switch (~52×32px)

**Lily recomenda:** A (full-width). Row inteiro É o tap target; ripple
contained no toggle desinforma sobre onde realmente clicou.

**Trade-off:** A consome mais "espaço visual" (onda grande). B é mais
discreto mas confunde affordance.

---

## Conformance gates (Phase 1)

- LOCK_VIA_TEST: `material-ripple-adoption.test.ts` (4 componentes)
- WCAG 2.5.5 (target size): cada adoção valida ≥44×44px
- WCAG 2.3.3 (reduced motion): já coberto no CSS primitive
- Manifesto §28 (privacy): nenhum efeito que leak posição/timing além
  do componente local (sem analytics tap)

---

*Lily report 2026-05-21. Sucessor implícito do
`map-animation-himym-2026-05-18.md` (mesma família de feedback
design). Próxima ação: user decide Q1/Q2/Q3 + autoriza Phase 1
wiring.*
