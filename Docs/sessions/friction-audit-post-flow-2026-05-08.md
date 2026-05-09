# Friction Audit — Post-Centric User Journeys

**Data:** 2026-05-08
**Persona:** Barney (HIMYM — peer review crítico, threat modeling, ceticismo construtivo)
**Round:** 3 — UI/UX +50% campaign · POST-PRIORITY
**Restrição:** doc-only · sem implementar fix
**Escopo:** post-related flows (read · engage · comment · create), com ênfase no que o user reforçou: *"ainda precisamos melhorar a UI e UX das postagens, está feio e pouco intuitivo a usabilidade"*.
**License:** CC0 1.0 Universal

> **Tom:** o newcomer cético abrindo Drift pela primeira vez sem manual.
> Onde ele desiste? Onde ele fica confuso? Onde ele não confia? **Posts
> são o hot path** — todas as outras telas são secundárias. Esta auditoria
> NÃO é fan-mode. É o user que dá 30s pro app provar valor antes de
> fechar a tab.

---

## TL;DR (60s)

35 friction findings catalogados em 5 user journeys. Distribuição:
- **S0 (dismissal trigger — user desiste):** 6
- **S1 (frustração recorrente):** 19
- **S2 (polish):** 10

**A tese central:** Drift é um produto bem arquiteturado escondido atrás
de uma camada de comunicação que **fala protocolo onde devia falar
humano**. Termos como `DERIVA`, `SUBS`, `HÁ`, `_D7DE3A` (hash hex), nsec1
literal, kind 9078, "drift ↑", "+ no post", "↳ N respostas (toque ou ↑)"
— cada um isolado é defensável. Empilhados num primeiro contato é uma
parede de jargão.

**Top 5 fixes Round 4 POST-priority:**
1. **F-04 — TextLayout: decorative letter visivelmente quebrado/oculto**
   (`SubpostLayout.tsx:443-459`). Card text-only fica ~70% vazio com
   silhueta cinza. Fix: bumpar opacity 0.55 → 0.85 e debugar
   `getDecorativeLetters` retornando string vazia.
2. **F-09 — Body do post não responde a tap** (`PostViewer.tsx:467-505`).
   Single mais alto-impacto; user toca card aguardando "abrir" e nada
   acontece. Fix: tap em area neutra → reveal CW se blurred OR next
   subpost se total>1 OR no-op (atual).
3. **F-11 — DERIVA, SUBS, HÁ, DRIFT como labels métricas é jargão sem
   tooltip** (`SubpostLayout.tsx:262-272`). Fix: tooltip on long-press +
   trocar `HÁ` por símbolo de relógio + `SUBS N/M` formato compreensível.
4. **F-17 — TM-3 multi-subpost esconde NSFW em subposts secundários**
   sem flag global óbvia (Barney TM-3 prévio + verify atual). Fix:
   indicador permanente "post tem subpost com warning" no first card.
5. **F-22 — ComposeOverlay counter "62 chars" significa REMAINING não
   USED** (`ComposeOverlay.tsx:374-381`). Convenção universal Twitter/
   Mastodon é "X / Y". Fix: trocar pra `218 / 280` formato familiar.

---

## §1 — Methodology

### 1.1 Premissa do persona

Newcomer cético = user que:
- Não leu o manifesto
- Não sabe o que é Nostr
- Tem 30-60s de paciência antes de fechar a tab
- Espera affordances de Twitter/Threads/Mastodon (referência social mainstream)
- Vai recusar criar conta antes de ver valor (Drift cria identidade automática — ainda assim, vai questionar "o que estou criando aqui?")
- Lê português BR mas pula labels muito técnicas

### 1.2 Journeys auditadas

- **Journey A — First-time landing.** Boot do app → identidade existente ou criada → primeira tela com posts → entender o que vê.
- **Journey B — Read & engage.** Ler post existente → entender controles → engajar (DRIFT/SINK) → ver feedback.
- **Journey C — Thread & comment.** Tap em "💬" → navegar comments → tentar responder.
- **Journey D — Create first post.** Tap em "+ novo" → escolher layout → escrever → publicar → encontrar no feed.
- **Journey E — CW reveal.** Encontrar post NSFW/SPOILER → entender warning → revelar → engajar.

### 1.3 Format de cada finding

```
F-N — short title
  Journey: A/B/C/D/E
  Moment: passo exato (gesto + estado)
  Cognitive load: low/med/high (porquê)
  Trust friction: yes/no (porquê)
  Dismissal trigger: S0 (yes) / S1 (maybe) / S2 (polish)
  Mitigation: 1-2 linhas
```

### 1.4 Cobertura

| Journey | Findings | S0 | S1 | S2 |
|---|---:|---:|---:|---:|
| A — first-time | 7 | 2 | 4 | 1 |
| B — read & engage | 9 | 1 | 6 | 2 |
| C — thread & comment | 8 | 2 | 4 | 2 |
| D — create post | 7 | 1 | 4 | 2 |
| E — CW reveal | 4 | 0 | 1 | 3 |
| **Total** | **35** | **6** | **19** | **10** |

### 1.5 Cross-references

Findings novos. Quando convergem com finding pré-existente, tag
`[≈ TX-N]` ou `[≈ UX-N]` cita auditoria anterior:
- TX-N = Ted UX spike (`ted-ux-spike-deployed-2026-05-08.md`)
- UX-N = Robin Comments UX audit (`comments-ux-audit-2026-05-08.md`)
- TM-N = Barney test posts (`barney-test-posts-2026-05-08.md`)

---

## §2 — Friction inventory (35 findings)

### Journey A — First-time landing

#### F-01 — Identidade silenciosa criada sem explicação

- **Journey:** A
- **Moment:** `bootstrap.ts` cria nsec local automaticamente; user vê
  feed sem nunca ter clicado "criar conta" ou "fazer login".
- **Cognitive load:** **high**. Modelo mental social (Twitter) = "preciso
  criar conta pra postar". Drift inverte sem avisar.
- **Trust friction:** **yes**. Falta de cerimônia parece "barato demais"
  ou "alguma coisa errada" — onde está minha conta? Posso sair? Posso
  voltar?
- **Dismissal trigger:** **S1**. User experiente acha legal; novato fica
  desconfortável.
- **Mitigation:** banner discreto top-bar primeira sessão: "uma identidade
  cripto foi criada localmente · faça backup em 30s →"
  (CTA → IdentityPanel).

#### F-02 — OnboardingOverlay aparece DEPOIS do feed estar visível

- **Journey:** A
- **Moment:** boot → feed renderiza → onboarding modal abre por cima.
  `App.tsx:97 onboardingDone` lido após bootstrap, não antes.
- **Cognitive load:** **med**. Vê posts, vê coach, fecha coach pulando
  → perde os 5 steps que tinham informação importante (swipe semantics,
  identidade backup).
- **Trust friction:** no.
- **Dismissal trigger:** **S1**. Maioria dos novatos clica "pular" no
  primeiro modal que cobre conteúdo.
- **Mitigation:** mostrar onboarding como **landing**, não overlay sobre
  feed. Ou diferir feed render até onboarding fechar.

#### F-03 — `_D7DE3A` hex hash no header de posts é ruído sem significado

- **Journey:** A · B
- **Moment:** PostViewer modal mode header mostra `anon…<8 chars do
  authorPub>` (`PostViewer.tsx:289-293`); ThreadView header mostra
  `_D7DE3A` (últimos 6 do post id). [≈ TX-5]
- **Cognitive load:** **high**. User decodifica "isso é nome? id? hash?
  do quê?".
- **Trust friction:** **yes**. Parece app de hacker/dev em modo debug —
  não app social pra humanos.
- **Dismissal trigger:** **S0**. Fan de manifesto aceita; newcomer fecha.
- **Mitigation:** trocar hex truncado por nome derivado determinístico
  (mnemonic word pair tipo "anônimo-azul-43") ou primeiros caracteres do
  npub bech32 (`npub1abc…`) que pelo menos sinaliza "endereço cripto" em
  vez de "código gibberish".

#### F-04 — TextLayout decorative letter quebrada/invisível, deixa card 70% vazio

- **Journey:** A · B
- **Moment:** post text-only renderiza via `TextLayout`
  (`SubpostLayout.tsx:423-463`); decorative letter Syne 800 100px
  `opacity: 0.55` em `text-drift-border` no canto bottom-right.
  Ted reportou em TX-3: no deploy 0.6.0-ALPHA.4, área superior do card
  fica vazia. Possíveis root causes elencadas: getDecorativeLetters
  retornando '', z-index errado, cor sub-AA invisible em drift-bg. [≈ TX-3]
- **Cognitive load:** **high**. User vê retângulo preto 70% vazio com
  texto colado embaixo. Parece bug de render.
- **Trust friction:** **yes**. App quebrado = app inacabado.
- **Dismissal trigger:** **S0**. Primeiro post text-only do feed pode ser
  o último que o user vê.
- **Mitigation:** (a) bumpar opacity 0.55 → 0.85; (b) test
  getDecorativeLetters retorna não-vazio pra todos os post ids; (c)
  fallback decoração se letras vazias (símbolo `≡` grande?).

#### F-05 — Tag row "DERIVA" como fallback quando post sem categoria/location é ruído

- **Journey:** A · B
- **Moment:** `synthesizeTag(post)` (`SubpostLayout.tsx:111-120`) retorna
  `'DERIVA'` literal quando post não tem category/location/CW.
- **Cognitive load:** **med**. Tag row top do card serve pra contextualizar
  ("PENSAMENTO · INTERIOR"). Mostrar "DERIVA" em todo post sem tag é
  noise — não acrescenta info, ocupa hierarquia visual.
- **Trust friction:** no, mas confunde — user lê "deriva" no top + "DRIFT
  ↑" no footer + "DERIVA score" no header e pensa: "o que significa
  deriva exatamente neste app?"
- **Dismissal trigger:** **S2**. Polish, mas tem efeito cumulativo.
- **Mitigation:** tag row vazia quando sem dado real; ou remover fallback
  literal "DERIVA" e usar categoria default mais neutra (`POST` no lugar
  de "DERIVA" como string vazia)... ou simplesmente esconder a row.

#### F-06 — UpdatePrompt banner cobre primeiro post no boot pós-deploy

- **Journey:** A
- **Moment:** primeiro boot após deploy → UpdatePrompt 150px ocupa topo
  da home → primeira impressão é cleanup de UI, não conteúdo. [≈ TX-9]
- **Cognitive load:** **med**.
- **Trust friction:** **yes** (forma sutil): "tô atualizando o quê?
  acabei de abrir."
- **Dismissal trigger:** **S1**.
- **Mitigation:** colapsar pra dot pulsante top-right; expand on click.

#### F-07 — Fila position "fila 1/47" ao lado de "1/3" subpost confunde

- **Journey:** A
- **Moment:** PostViewer modal footer
  (`PostViewer.tsx:511-528`) mostra simultaneamente: `↑ 12 · ↓ 3 · 1/3
  · fila 1/47`. Quatro contadores numéricos sem label clara.
- **Cognitive load:** **high**. Cada um significa coisa diferente. Em
  embedded mode (V8) isso é ocultado mas em modal viewer ainda visível.
- **Trust friction:** no.
- **Dismissal trigger:** **S1** (em modal mode).
- **Mitigation:** consolidar com ícones: `↑12 ↓3 · 📎1/3 · 🃏1/47`.
  Modal mode é legacy; embedded já resolveu — confirmar que modal nunca
  é o primeiro contato.

---

### Journey B — Read existing post & engage (DRIFT/SINK)

#### F-08 — DRIFT/SINK semântica não é descoberta sem onboarding

- **Journey:** B
- **Moment:** user pulou onboarding (F-02). Vê post fullscreen sem dicas.
  Embedded mode oculta footer com botões ↑/↓ (`PostViewer.tsx:508-590`
  `!embedded` gate). Único affordance: gesto.
- **Cognitive load:** **high**. Sem coach mark (visualizado uma vez no
  onboarding e perdido), user não tem caminho de descoberta.
- **Trust friction:** no, mas confusion → abandono.
- **Dismissal trigger:** **S0**. Tinder funciona porque app é over-onboarded
  pelo zeitgeist cultural; Drift assume mesmo, sem ser.
- **Mitigation:** primeira sessão (post 1, 2, 3): hint sutil flutuante
  bottom "↑ DRIFT · ↓ SINK" persistente até user fazer 3 swipes
  bem-sucedidos, depois fade out permanente.

#### F-09 — Body do post não responde a tap (sem feedback)

- **Journey:** B
- **Moment:** user tap no body do card. Nada acontece. Único tap funcional
  é em CW reveal button (`PostViewer.tsx:472`). [≈ TX-7]
- **Cognitive load:** **med** ("será que travou?").
- **Trust friction:** **yes**. Tap-tap-nada é "app não funciona".
- **Dismissal trigger:** **S0**. Tap é o gesto mais primitivo; recusar
  responder é hostil.
- **Mitigation:** tap = next subpost se total>1; no single-subpost,
  shake feedback + dica "swipe ↑↓".

#### F-10 — myAction destaque visual no botão é só em modal mode

- **Journey:** B
- **Moment:** botão DRIFT ↑ destacado quando `myAction === 'spread'`
  (`PostViewer.tsx:551-555`). Mas botão só visível em modal — embedded
  esconde footer.
- **Cognitive load:** **med**. User que driftou um post no embedded mode
  não tem feedback visual persistente "você driftou". Re-encontra o post
  no feed (cursor preserved) e não sabe se já driftou.
- **Trust friction:** **yes**. "Já cliquei? Tá registrado?"
- **Dismissal trigger:** **S1**.
- **Mitigation:** badge ↑/↓ small no card tag row (top) ou border-color
  do card sutil quando myAction não-null.

#### F-11 — `DRIFT N · SUBS N · HÁ Xh` meta line é jargão denso

- **Journey:** B
- **Moment:** `CardText` (`SubpostLayout.tsx:262-272`) renderiza meta
  bottom: `DRIFT 22.1K · SUBS 3 · HÁ 6H`.
  - `DRIFT N` = spreads count (mas user just learned "DRIFT" = ação)
  - `SUBS N` = subposts count
  - `HÁ N` = "há N tempo atrás" abreviado
- **Cognitive load:** **high**. 3 abreviações em 3 idiomas conceituais
  (ação verbalizada, plural inglês de "subpost", advérbio temporal PT).
- **Trust friction:** **yes**. Parece DOS prompt.
- **Dismissal trigger:** **S1**.
- **Mitigation:** trocar:
  - `DRIFT 22.1K` → `↑ 22.1K` (símbolo > palavra repetida)
  - `SUBS 3` → `📎 3` ou `▣ 3` (visual > acronym EN)
  - `HÁ 6H` → `⏱ 6h` ou simplesmente `6h atrás`

#### F-12 — `DERIVA score` em modal header é número decimal sem contexto

- **Journey:** B
- **Moment:** modal mode header (`PostViewer.tsx:307-309`) mostra
  `DERIVA 0.247`. Manifesto §22 exige score determinístico **visível** —
  princípio mantido. Mas valor entre 0-1 sem escala explicita = noise pro
  newcomer.
- **Cognitive load:** **high**. "0.247 é bom? ruim? fora de quê?"
- **Trust friction:** no (transparência é positivo).
- **Dismissal trigger:** **S1** (mas é manifesto-locked — só polish).
- **Mitigation:** anti-recomendação: NÃO esconder o número (§6). Mas
  formato pode mudar — `DERIVA 0.247 / 1.0` ou bar visual + número.

#### F-13 — Botão ⋮ menu de ações visível só em embedded mode

- **Journey:** B
- **Moment:** `PostViewer.tsx:421-433` `embedded && <GlassIconButton>`.
  Modal mode mostra 8 botões inline no header em vez do menu.
- **Cognitive load:** **low** em embedded; **high** em modal (8 ícones
  emoji sem label permanente — só title attribute).
- **Trust friction:** no em embedded; **yes** em modal (parece toolbar
  de Photoshop).
- **Dismissal trigger:** **S1** em modal.
- **Mitigation:** confirmar que modal é deprecated path; se sim, remover.
  Se ainda usado, migrar pro mesmo ⋮ pattern.

#### F-14 — Optimistic +1 vs SQLite-confirmed delay sem visual distinct

- **Journey:** B
- **Moment:** após DRIFT, contador soma +1 imediato (`pendingAction`
  flag, `displaySpreads = post.spreads + (pending === 'spread' ? 1 : 0)`).
  Quando evento real chega, pendingAction limpa, valor real persiste.
  Visualmente idêntico — sem indicador "em vôo" vs "confirmado".
- **Cognitive load:** **low** (transparente). Mas potencial trust friction
  se rede falhar — botão volta ao estado original sem aviso de erro.
- **Trust friction:** **yes** sob falha de rede.
- **Dismissal trigger:** **S2** (raro).
- **Mitigation:** spinner micro em pendingAction; toast em rejeição.

#### F-15 — `📍` capturando location pra spread sem cancel

- **Journey:** B
- **Moment:** `PostViewer.tsx:565-569` botão mostra `📍` durante
  `capturingLocation` (até 8s). User fica esperando geolocation; sem
  fallback "ignorar localização e enviar mesmo".
- **Cognitive load:** **med**.
- **Trust friction:** **yes**. "Por que precisa de localização pra
  espalhar texto?"
- **Dismissal trigger:** **S1**. Manifesto §28 location off-default;
  se on, ainda confunde (mesmo que opt-in).
- **Mitigation:** (a) timeout reduzido (3s); (b) link "spread sem location"
  inline.

#### F-16 — `pendingAction !== null` desabilita ambos botões enquanto um está in-flight

- **Journey:** B
- **Moment:** `PostViewer.tsx:550, 573` `disabled={pendingAction !== null}`.
  User clica ↑ por engano, quer corrigir pra ↓. Não consegue até
  pendingAction limpar.
- **Cognitive load:** **med**.
- **Trust friction:** **yes**. Sensação "preso".
- **Dismissal trigger:** **S2** (race rara).
- **Mitigation:** permitir clicar outro botão pra cancelar in-flight + lançar
  novo.

---

### Journey C — Thread & comment

#### F-17 — Tap "💬" abre ThreadView mas botão é discreto demais

- **Journey:** C
- **Moment:** `PostViewer.tsx:435-450` botão comentários é
  `border border-drift-border bg-drift-surface/80` com emoji 12px.
  Posicionado top-right adjacente ao ⋮.
- **Cognitive load:** **med**. Newcomer não vê "comentários" como
  affordance principal — é menor que o ⋮.
- **Trust friction:** no.
- **Dismissal trigger:** **S1**. User não descobre comments até stumblar.
- **Mitigation:** badge maior + label `💬 N` em vez de só ícone; ou
  rebaixar ⋮ pra menos protagonismo (ele ganha attention demais).

#### F-18 — ThreadView edge-to-edge em desktop quebra max-w-md mental

- **Journey:** C
- **Moment:** [≈ TX-2] ThreadView ainda não usa FullPageOverlay primitive.
  Em viewport > md, comments fillam width inteira em desktop.
- **Cognitive load:** **med**.
- **Trust friction:** **yes**. Inconsistência visual = "esse modal é
  diferente, deve ter outra coisa diferente também?"
- **Dismissal trigger:** **S0** em desktop. Não-S0 em mobile.
- **Mitigation:** TX-2 fix (mover pra FullPageOverlay).

#### F-19 — Card stack pra comments força aprender swipe pra ler thread

- **Journey:** C
- **Moment:** [≈ UX-1] ThreadView default mode = card stack. User só vê
  1 comment por vez. Pra ler thread inteira, swipe ←→↑↓.
- **Cognitive load:** **high**. Modelo Tinder pra texto curto é alien
  pra "ler conversa".
- **Trust friction:** **yes**. "Não consigo ver o que tá acontecendo —
  vou embora".
- **Dismissal trigger:** **S0**. Robin já flagou.
- **Mitigation:** [UX-1 do Robin] modo lista default + toggle pra cards.

#### F-20 — Swipe ↑↓ inverso entre PostViewer e ThreadView

- **Journey:** B → C transition
- **Moment:** [≈ UX-8] PostViewer ↑=spread positivo. ThreadView ↑=descend
  (afundar na hierarquia). Mesmo motor SwipeHandler, semânticas opostas.
- **Cognitive load:** **high**. User alterna 30x/dia → cérebro nunca
  consolida.
- **Trust friction:** **yes**. "Por que esse swipe faz coisa diferente
  agora?"
- **Dismissal trigger:** **S1** com aprendizado.
- **Mitigation:** UX-8 cue persistente OR inverter (decisão arquitetural
  Robin/Ted/Barney).

#### F-21 — FAB "↵ responder" responde ao card atual sem flag clara

- **Journey:** C
- **Moment:** [≈ UX-3] FAB sempre fixo bottom-right; replyTo = currentNode
  cursor. ReplySheet header diz `para npub1abc…xyz`.
- **Cognitive load:** **high**. User precisa decodificar pubkey pra
  saber pra quem está respondendo.
- **Trust friction:** **yes**. Risco de errar destinatário publicamente.
- **Dismissal trigger:** **S1**.
- **Mitigation:** UX-3 fix (FAB nominal + quote inline na sheet).

#### F-22 — Coach mark dispara automaticamente, dismiss em 3s, irrecuperável

- **Journey:** C
- **Moment:** [≈ UX-7] primeira abertura → coach overlay 3s auto-dismiss
  ou tap, persiste irreversível.
- **Cognitive load:** **med** durante; **high** depois (perdeu).
- **Trust friction:** no.
- **Dismissal trigger:** **S2** (mas com efeito cascading em F-19/F-20).
- **Mitigation:** UX-7 fix (replay button + timeout 5-6s).

#### F-23 — "thread vazia mostra 3 botões fazendo a mesma coisa" — fixed mas validate

- **Journey:** C
- **Moment:** comentário do user de hoje ("thread vazia mostrava 3 botões")
  → fixed em commit 5ff16b2. Verify: outros empty states tem mesmo
  problema?
- **Cognitive load:** **n/a** (resolvido).
- **Trust friction:** **n/a**.
- **Dismissal trigger:** **S2** (regression watch).
- **Mitigation:** spawn audit cross-empty-states.

#### F-24 — Reply textarea sem preview de quem responde após scroll

- **Journey:** C
- **Moment:** ReplySheet header com pubkey truncado fica fora do viewport
  quando textarea cresce → user perde contexto.
- **Cognitive load:** **med**.
- **Trust friction:** **yes**. Combinado com F-21 amplifica.
- **Dismissal trigger:** **S1**.
- **Mitigation:** sticky header dentro do sheet.

---

### Journey D — Create first post

#### F-25 — "+ novo" CTA discoverability — onde está?

- **Journey:** D
- **Moment:** botão criar post em algum canto (verificar — provavelmente
  em algum AppBar/FAB). Newcomer não-Twitter user não sabe onde é
  convencional.
- **Cognitive load:** **med**.
- **Trust friction:** no.
- **Dismissal trigger:** **S1** se não-óbvio.
- **Mitigation:** confirmar visibilidade primary + label "criar post" não
  só ícone.

#### F-26 — ComposeOverlay 3 layout chips (TEXTO/RETRATO/PAISAGEM) sem preview

- **Journey:** D
- **Moment:** `ComposeOverlay.tsx:328-348` layout picker chips. Sem
  preview do que cada layout produz visualmente. User adivinha.
- **Cognitive load:** **high**. "PAISAGEM = horizontal? imagem grande?
  layout do mockup?"
- **Trust friction:** **yes**.
- **Dismissal trigger:** **S1**. User pode escolher RETRATO sem imagem
  → cai pra TextLayout (graceful fallback `:287-296`) sem aviso.
- **Mitigation:** mini-thumbnail visual ao lado do label de cada chip.

#### F-27 — Counter "62 chars" significa REMAINING não USED [≈ BX-1]

- **Journey:** D
- **Moment:** `ComposeOverlay.tsx:374-381`. `remaining = MAX - text.length`.
  Render `{remaining} chars`.
- **Cognitive load:** **high**. Twitter/Mastodon usam "X / Y" ou contagem
  decrescente perto do limit. Drift mostra número flutuante sem unit.
- **Trust friction:** **yes**. User digita 100 chars, vê "180 chars"
  decrescente, pensa "180 chars já? mas digitei pouco".
- **Dismissal trigger:** **S1**.
- **Mitigation:** `218 / 280` (used / max) ou `restam: 62`.

#### F-28 — TM-3 multi-subpost permite NSFW oculto em subpost secundário

- **Journey:** D · E
- **Moment:** [≈ TM-3 Barney] post multi-subpost com subpost-1 inocente
  + subpost-2 NSFW sem CW global. UI compose tem CW único pro post
  inteiro (`ComposeOverlay.tsx:117-120, 391-394`) mas não força flag se
  subposts heterogêneos.
- **Cognitive load:** baixo (autor); **high** (leitor surpreendido).
- **Trust friction:** **yes** pro leitor (manifesto §27 violado).
- **Dismissal trigger:** **S0** em escala (poucos casos hoje, mas vetor
  de manipulação).
- **Mitigation:** UI per-subpost CW OR auto-flag global CW se qualquer
  subpost marcado individualmente.

#### F-29 — Layout RETRATO sem imagem cai pra TEXTO sem aviso

- **Journey:** D
- **Moment:** `SubpostLayout.tsx:287-302` graceful fallback. User escolheu
  RETRATO esperando layout retrato — produto final é TextLayout. Sem
  aviso no compose.
- **Cognitive load:** **med** (post-publish surprise).
- **Trust friction:** **yes**. "Por que meu post ficou diferente?"
- **Dismissal trigger:** **S1**.
- **Mitigation:** ComposeOverlay banner amarelo se RETRATO/PAISAGEM
  selecionado mas sem imagem: "este layout vai virar TEXTO ao publicar
  (sem imagem)".

#### F-30 — "drift ↑" CTA ambíguo: drift = ação ou drift = nome?

- **Journey:** D
- **Moment:** `ComposeOverlay.tsx:259` botão `drift ↑`. User pensa "tô
  driftando o quê — meu próprio post?"
- **Cognitive load:** **high**. DRIFT é verbo de engajamento (↑ no feed),
  aqui é "publicar".
- **Trust friction:** **yes**. Vocabulário sobrecarregado quebra mental
  model.
- **Dismissal trigger:** **S1**.
- **Mitigation:** trocar pra `publicar` ou `enviar drift`. Manter "DRIFT"
  só pra ação de feed evita overload.

#### F-31 — Após publish, post não é visualizável imediato no feed [≈ BX-4 não-bug]

- **Journey:** D
- **Moment:** publish → ComposeOverlay fecha → user volta pro feed →
  cursor preservado no post anterior, novo post **não** é destacado.
- **Cognitive load:** **med**. "Cadê meu post?"
- **Trust friction:** **yes**. "Foi publicado? cadê o feedback?"
- **Dismissal trigger:** **S1**. BX-4 marcou "não-bug" porque cursor
  preservation é correto, mas UX feedback pós-publish é ausente.
- **Mitigation:** toast "publicado · ver no feed →" com tap navega pro
  novo post.

---

### Journey E — CW reveal flow

#### F-32 — CW blur cobre conteúdo mas botão "toque pra revelar" pequeno

- **Journey:** E
- **Moment:** `PostViewer.tsx:488-503` button `border-drift-accent px-4
  py-2 text-xs`.
- **Cognitive load:** **low**.
- **Trust friction:** no.
- **Dismissal trigger:** **S2**.
- **Mitigation:** botão maior, padding-md, fluid-base font.

#### F-33 — Reveal só persiste por sessão; reabrir post = blur de novo

- **Journey:** E
- **Moment:** `PostViewer.tsx:122-126` reset `setRevealed(!hint.blur ...)`
  on `post.id` change. User revela post NSFW; navega pra outro; volta
  pelo cursor → blur de novo.
- **Cognitive load:** **med**.
- **Trust friction:** no, mas é fricção repetida.
- **Dismissal trigger:** **S2**.
- **Mitigation:** memoizar `revealedPosts: Set<postId>` em prefs ou store
  durante sessão.

#### F-34 — Reason "spoiler/nsfw/violence/ad" mostrado em uppercase sem context

- **Journey:** E
- **Moment:** `PostViewer.tsx:490-492` `⚠ {hint.reason}`. User vê `⚠ NSFW`
  ou `⚠ SPOILER` mas não sabe se é override do leitor (filter) ou
  declarado pelo autor (manifesto §27).
- **Cognitive load:** **med**.
- **Trust friction:** no.
- **Dismissal trigger:** **S2**.
- **Mitigation:** `⚠ marcado pelo autor: NSFW` + tooltip explica filtros
  locais.

#### F-35 — `você pode mudar isso em settings` ponta solta sem link clicável

- **Journey:** E
- **Moment:** `PostViewer.tsx:499-501` `<span class="text-[10px]
  text-slate-600">você pode mudar isso em settings</span>`. Texto
  estático, não link.
- **Cognitive load:** **low**.
- **Trust friction:** **yes** sutil. "Onde fica settings? Como abro?"
- **Dismissal trigger:** **S1**.
- **Mitigation:** tornar `<button>` que abre Settings → CW prefs.

---

## §3 — Top 10 friction moments S0/S1 priorizadas pra Round 4

Ordenado por **dismissal-impact × frequency × effort-inverse**.

| # | Finding | Journey | Severity | Why now |
|---|---|---|---|---|
| 1 | F-04 — TextLayout decorative letter quebrada | A·B | S0 | Visual quebrado = primeira impressão arruinada. Lily fix ~30min. |
| 2 | F-09 — Body do post não responde a tap | B | S0 | Tap-tap-nada é hostil. Lily fix ~1h. |
| 3 | F-19 — Card stack obriga swipe pra ler thread | C | S0 | UX-1 Robin já documentou. Maior ROI cognitivo. ~5h. |
| 4 | F-03 — `_D7DE3A` hex hash é gibberish | A·B | S0 | Trust collapse no header. Trocar por bech32 friendly ~1h. |
| 5 | F-08 — DRIFT/SINK semântica não descobrível | B | S0 | Hint persistente primeiras 3 swipes ~1h. |
| 6 | F-28 — TM-3 NSFW oculto em subpost | D·E | S0 | Manifesto §27 violation. Logic fix ~2h. |
| 7 | F-11 — DRIFT/SUBS/HÁ jargão denso | B | S1 | Ícones substituem labels ~30min. |
| 8 | F-27 — Counter "62 chars" REMAINING não USED | D | S1 | Convenção universal. ~10min. |
| 9 | F-21 — FAB sem flag de destinatário (UX-3) | C | S1 | Robin já documentou. ~2h. |
| 10 | F-30 — "drift ↑" CTA ambíguo no compose | D | S1 | Trocar pra "publicar" ~10min. |

**Sum effort estimado top 10:** ~13-14h. Fora do cap de Round 4 (5-6h).
Recomendação: split em Round 4a (top 5 = ~10h, mas com #3 sendo o
maior); Round 4b (top 6-10 = ~3h em fixes pequenos).

---

## §4 — Trust signals audit

### 4.1 Onde Drift ganha trust

- **Manifesto §28 privacy-by-default**: location off, sem analytics,
  sem KYC. User experiente nota.
- **Score determinístico transparente** (manifesto §22): número visível,
  fórmula pública. Anti-black-box.
- **Posts imutáveis** (§5-9): "nem o fundador apaga" — explícito no
  onboarding step 5.
- **Identidade auto-soberana** (§2-3): nsec1 portável, sem dependência de
  servidor. User cripto-aware aprecia.
- **Sem ML scan automático** (§7/§25): explícito. Diferencial competitivo
  vs ecossistema centralizado.
- **Multi-relay**: redundância visível em UI de relays (Settings).

### 4.2 Onde Drift PERDE trust

- **Termos cripticos sem tradução pra humano**: `_D7DE3A`, `npub1abc…`,
  `nsec1…`, `kind 9078`, `DERIVA score 0.247`, `SUBS`, `HÁ`. Cada um é
  defensável; juntos parecem app de hacker, não rede social.
- **Mistura de português + inglês + acrônimos**: `DRIFT ↑` (EN), `SINK`
  (EN), `DERIVA` (PT), `SUBS` (EN abrev), `HÁ` (PT abrev). Sem coerência.
- **Vocabulário sobrecarregado "DRIFT"**: nome do app, ação no feed
  (espalhar), CTA no compose ("drift ↑" = publicar). 3 significados pra
  mesma palavra.
- **Identidade silenciosa**: cripto criada sem cerimônia → "muito bom pra
  ser verdade".
- **Decorative letter quebrada (F-04)**: visual bug = app inacabado.
- **CW reveal sem persistência**: user revela uma vez, blur de novo →
  "esse app não confia em mim".

### 4.3 5 trust-building changes priorizadas

1. **Hex hashes → bech32 friendly format**: `_D7DE3A` → `npub1q5h…` ou
   pseudo-name `azul-43`. Sinaliza "endereço cripto" não "código solto".
2. **Vocabulário consistency**: padronizar "DRIFT" como nome do app
   apenas; ação = "espalhar/drift up"; CTA compose = "publicar". Quebra
   ambiguity.
3. **Identidade welcome banner primeira sessão**: 30s de cerimônia explica
   "criamos uma chave cripto local — backup é tua responsabilidade →".
4. **Decorative letter fix (F-04)**: bumpar opacity + debugar empty
   returns. Eliminar percepção "buggy".
5. **CW reveal session memory**: revelei uma vez, fica revelado pra
   sessão. User feedback "app me trata como adulto".

---

## §5 — Cognitive load reduction (gestalt-aware)

### 5.1 Information hierarchy unclear

- **Modal mode header com 8 botões emoji** (`PostViewer.tsx:289-391`).
  pin, follow, mute, block, report, map, score, close → cognitive
  overload. Embedded mode ⋮ menu resolve. Confirmar modal é deprecated;
  se sim, remover.
- **PostViewer footer com 4 contadores numéricos** (F-07): ↑12 · ↓3 ·
  1/3 · fila 1/47. Sem agrupamento visual.
- **Tag row "DERIVA" fallback ocupa hierarquia sem dado** (F-05).

### 5.2 Múltiplos CTAs visíveis (já fixado em thread vazia, mas check outros)

- **CompoOverlay**: csub dots (1, 2, 3, +) + layout chips + drop area +
  textarea + CW chips + footer (SUB- / DRIFT↑) + cancelar header.
  ~7 superfícies interativas em uma tela. User feedback hoje sobre
  thread vazia ("3 botões fazendo a mesma coisa") sugere padrão. Compose
  pode ser alvo similar.
- **PostViewer modal mode header** (F-13): 8 botões.
- **ThreadView header**: ✕ + breadcrumb + counter + ?N novos + ?coach
  replay + ?+ no post. Já está pra crescer.

### 5.3 Jargão unexplained

| Termo | Where | Onboarding cobriu? | Tooltip? |
|---|---|---|---|
| DRIFT (ação) | Feed swipe + compose CTA | ✓ step 2 | ✓ no compose |
| SINK | Feed swipe | ✓ step 2 | ✗ |
| DERIVA (score) | PostViewer header | ✗ | ✓ via title |
| DERIVA (tag fallback) | Card top | ✗ | ✗ |
| SUBS | Card meta | ✗ | ✗ |
| HÁ (time) | Card meta | ✗ | ✗ |
| nsec / npub | Identity panel + onboard | ✓ step 3 | parcial |
| `_D7DE3A` | Thread header | ✗ | ✗ |
| `kind 9078` | (interno apenas) | n/a | n/a |
| `subpost` | Compose csub | ✗ | ✗ |
| `content-warning` | Compose CW row | ✓ step 5 | ✓ §27 ref |

**Recomendação:** glossário acessível via `?` icon no header global,
abrindo lista de 8-10 termos com explicação 1-linha.

---

## §6 — Anti-recommendations (friction Drift INTENCIONALMENTE preserva)

Manifesto-locked. Round 4 NÃO toca:

1. **Score determinístico VISÍVEL** (manifesto §22). NÃO esconder o
   `0.247`. Pode reformatar (bar visual + número), nunca remover.
2. **Vocabulário SPREAD/BURY → DRIFT/SINK na UI**. Já mapeado em
   CLAUDE.md. NÃO renomear. F-30 sugere reformular CTA do compose, mas
   não tocar no SINK/DRIFT do feed swipe.
3. **Sem feed personalizado** (§24). NÃO adicionar "for you", "trending
   for you", "suggested for you", recommendations baseadas em
   comportamento individual.
4. **Sem login social** (§17). NÃO adicionar Google/Apple/Facebook OAuth.
5. **Sem reactions em comments** (manifesto §22 implícito + comments.md
   §1 explicit). NÃO adicionar 👍/❤️/etc.
6. **Sem delete/edit de post** (§5-9 imutabilidade). User reclama? É
   trade-off explícito.
7. **Sem analytics/telemetria**. NÃO trackear comportamento pra "improve
   UX". Friction audit é FEITA por humano (este doc), não inferida de
   logs.
8. **Sem gamification**: badges, streaks, levels. Manifesto §22
   anti-vício.
9. **Identidade silenciosa criada localmente**: NÃO substituir por
   "criar conta primeiro" tradicional. F-01 sugere banner explicativo;
   não fluxo cadastral.
10. **Sem moderação central**: NÃO criar `deletePost()` global, NÃO
    embutir blocklists default. F-28 (TM-3) é fix LOCAL (UX warn ao
    leitor), não decisão central.

---

## §7 — Round 4 priority — top 5 friction fixes alinhados com user feedback

User feedback central: *"está feio e pouco intuitivo a usabilidade"*.
Foco em **intuitividade** (descobrabilidade, affordance, vocabulary) e
**aparência** (coerência visual, hierarquia).

### Fix #1 — F-04: TextLayout decorative letter visualmente quebrada

- **File/spot:** `src/components/Post/SubpostLayout.tsx:443-459` +
  `src/lib/decorativeLetters.ts`
- **What's wrong:** card text-only fica ~70% vazio. Decorative letter
  Syne 800 100px com opacity 0.55 em `text-drift-border` (sub-AA?) ou
  `getDecorativeLetters` retornando string vazia para alguns post ids.
- **Proposed fix:** (a) bumpar opacity 0.55 → 0.85; (b) test cobertura
  pra `getDecorativeLetters` retornar não-vazio sempre; (c) fallback
  símbolo `≡` se vazio.
- **Effort:** E0 (~30min Lily).

### Fix #2 — F-09: Body do post tap unresponsive

- **File/spot:** `src/components/Post/PostViewer.tsx:467-505` SwipeHandler
  onTap config.
- **What's wrong:** tap em area neutra do card = no-op silencioso.
  Newcomer espera feedback (Twitter abre detail, Tinder mostra info).
- **Proposed fix:** se `total > 1`, tap = next subpost (cycle); se
  single subpost, micro-shake + dica "swipe ↑↓ pra agir".
- **Effort:** E1 (~1h Lily).

### Fix #3 — F-11: Meta line `DRIFT N · SUBS N · HÁ Xh` densifica jargão

- **File/spot:** `src/components/Post/SubpostLayout.tsx:262-272`
  `CardText` meta block.
- **What's wrong:** 3 abreviações em 3 idiomas conceituais (verbo PT/EN
  reaproveitado, plural EN, advérbio PT). Newcomer lê DOS prompt.
- **Proposed fix:** trocar pra ícones:
  - `↑ 22.1K` (drift count)
  - `▣ 3` (subposts count, mantém SUBS como tooltip)
  - `⏱ 6h` (time)
- **Effort:** E0 (~30min Lily).

### Fix #4 — F-27: ComposeOverlay "62 chars" significa REMAINING não USED

- **File/spot:** `src/components/Create/ComposeOverlay.tsx:374-381`.
- **What's wrong:** convenção Twitter/Mastodon = "X / Y" ou contagem
  decrescente perto do limit. Drift mostra número flutuante sem unit
  → user assume "já usei 62 chars" quando na verdade restam 62.
- **Proposed fix:** trocar pra `218 / 280` (used / max), com cor
  warning quando remaining < 20.
- **Effort:** E0 (~10min Lily).

### Fix #5 — F-30: "drift ↑" CTA do compose conflita com ação no feed

- **File/spot:** `src/components/Create/ComposeOverlay.tsx:246-260`
  DriftButton primary.
- **What's wrong:** "DRIFT" é nome do app + ação no feed (↑ swipe). Botão
  "drift ↑" no compose vira terceiro significado ("publicar"). Newcomer
  lê: "tô driftando o quê — meu post?"
- **Proposed fix:** trocar pra `publicar ↑` ou `enviar drift ↑`. Mantém
  ↑ ícone (consistência visual com swipe direction) sem sobrecarregar
  o verbo "drift".
- **Effort:** E0 (~10min Lily, mas Marshall valida que LOCK_VIA_TEST
  manifesto-conformance não tem assertion sobre "drift ↑" literal).

**Total Round 4 priority POST:** ~2.5h Lily. Cabe no cap, deixa room
pra outras workstreams.

---

## §8 — Cross-cutting

### 8.1 Convergências com auditorias prévias

- **TX-3 (Ted UX spike) + F-04**: ambos identificam decorative letter
  problem. Convergente.
- **TX-7 (Ted) + F-09**: tap unresponsive no body. Convergente.
- **TX-5 (Ted) + F-03**: hex hash `_D7DE3A` ilegível. Convergente.
- **UX-1 (Robin Comments) + F-19**: card stack vs lista pra threads.
  Convergente.
- **UX-3 (Robin) + F-21**: FAB destinatário invisível. Convergente.
- **UX-7 (Robin) + F-22**: coach mark irrecuperável. Convergente.
- **UX-8 (Robin) + F-20**: swipe ↑↓ semântica inversa. Convergente.
- **TM-3 (Barney prévio) + F-28**: NSFW oculto em subpost. Convergente.

### 8.2 Friction novas neste audit (não em outros)

- F-01 — identidade silenciosa
- F-04 — decorative letter (parcialmente em TX-3)
- F-08 — DRIFT/SINK não-discoverable em embedded mode
- F-10 — myAction sem badge persistente
- F-11 — meta line jargão
- F-12 — DERIVA score float decimal sem escala
- F-15 — capturando location sem cancel
- F-26 — layout chips sem preview visual
- F-27 — counter chars REMAINING vs USED
- F-29 — RETRATO sem imagem fallback silencioso
- F-30 — "drift ↑" CTA ambíguo
- F-31 — pós-publish sem feedback ao user
- F-33 — CW reveal não persiste sessão
- F-35 — "você pode mudar isso em settings" não-clicável

### 8.3 Open questions (não-decisões)

1. **Modal mode PostViewer ainda usado em algum path?** Confirmar.
   Se não, deletar — elimina F-13/F-07.
2. **`SUBS` como termo internalizado?** Robin pode draftar termos
   alternativos (`partes`, `subs`, `▣`, `📎`). Decisão arquitetura.
3. **Vocabulário CTA compose: "publicar" / "enviar" / "drift ↑"?**
   Decisão Robin × Ted.
4. **Friction de identidade silenciosa: cerimônia explícita vs progresso
   atual?** Manifesto-conformance check com Marshall.

---

## §9 — Sumário em números

| Categoria | Count |
|---|---:|
| Total findings | 35 |
| **Por severity** | |
| S0 (dismissal trigger) | 6 |
| S1 (frustração recorrente) | 19 |
| S2 (polish) | 10 |
| **Por journey** | |
| A — first-time | 7 |
| B — read & engage | 9 |
| C — thread & comment | 8 |
| D — create post | 7 |
| E — CW reveal | 4 |
| **Trust friction** | |
| Yes | 22 |
| No / sutil | 13 |

| Quick wins (E0, ≤30min cada) | Count |
|---|---:|
| F-04 / F-09 / F-11 / F-27 / F-30 / F-32 / F-34 / F-35 | 8 |

**Round 4 priority effort estimado top 10:** ~13-14h (excede cap).
**Recomendação:** split Round 4a/4b. 4a = top 5 POST-priority (~2.5h);
4b = top 6-10 (~3h) + UX-1 modo lista (5-6h, separate workstream).

---

## §10 — Veredito

**Drift posts UX está ~50% pronta.** O esqueleto arquitetural é sólido
(card stack, three-layout, content-warning, optimistic UI, score
determinístico, identidade portável). O que falta é **camada de
linguagem humana**: termos jargão, hex hashes, jargon meta, vocabulário
sobrecarregado.

**A boa notícia:** maioria dos top 5 fixes é E0 (≤30min cada). Fix #1-#5
totalizam ~2.5h. Ship-ready em 1 sprint Lily.

**A má notícia:** F-19 (card stack thread) é E2 (5-6h) e é S0. Sem
ele, comments continuam abandonados por casual readers. **Recomendação
forte:** spawn workstream dedicado pra UX-1 modo lista, paralelo a
Round 4 POST-priority.

**User feedback "feio e pouco intuitivo" é justificado.** Não é fan-mode:
newcomer abre Drift, vê hex hashes (`_D7DE3A`), labels jargão (`DERIVA
SUBS HÁ`), card text-only com decorative letter quebrada (F-04), tap
no body sem feedback (F-09). Cada um isolado seria S1; combinados
formam um wall S0. Round 4 POST-priority é cirúrgico, não cosmético.

---

*Barney · audit cap respeitada (~2.5h: leitura ~30min + grep código
~30min + escrita ~1.5h). Doc-only. Sem tool-modifications.*
*Confiança: alta nos S0/S1; média nos S2 (alguns são gut-feeling).*
*Próximo: arquiteto reviewa contra Ted RFC v0.8 + Lily plan;
Round 4 selection.*
