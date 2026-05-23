# Audit Satoshi — Maps do Drift (adversarial + game theory)

**Data:** 2026-05-21
**Auditor:** Satoshi (persona LLM adversarial deep + game theory +
invariantes descentralização)
**Escopo:** TODOS os maps do Drift hoje em produção + features
em-paralelo (`TimelineScrubber` + `MapExplainerCard`).
**Status:** doc de sessão (não-normativo). Threat model normativo
permanece em [`Docs/threat-model-maps.md`](../threat-model-maps.md) —
este doc adiciona perspectiva game-theoretic adversarial e
recomendações de no-go.
**Convergência Ted:** Ted está revisando arquitetura em paralelo;
quando o doc dele aterrissar, consolidar findings. Este audit não cita
material Ted ainda inexistente.

---

## 0. Sumário executivo

**Inventário desafia premissa do briefing.** User mencionou "3 maps no
navbar + 1 por post". O código revela:

- **1 map fullscreen** acionado por NavBar[MAPA] (`MapOverlay` em
  `src/App.tsx:1927`) — UMA superfície com 3 **modes** internos
  (`post` / `global` / `network`) via `ModeToggle` em
  `SpreadMap.tsx:676`.
- **1 mini-map embedded por post** no `PostViewer` (`PostViewer.tsx:148`,
  `showMap` toggle, modo `post` fixo via `<SpreadMap postId=post.id />`
  em linha 524).
- **0 maps em outras superfícies** (Profile, ThreadView importam
  tipos mas não renderizam map).

Total: **2 surfaces, 4 contextos de render** (embedded-post,
overlay-post, overlay-global, overlay-network). O "3 no navbar"
confunde **modes** com **maps**. Esclarecer com o user antes de tratar
como bug de scope.

**Findings P0 (immediate):** 0
**Findings P1 (mitigation needed):** 2 — bandwagon visual no embedded
mini-map + tile CDN tracking sob threat ISP
**Findings P2 (documented limit):** 5 — todos já capturados em
`threat-model-maps.md` Vetores #1, #2, #3, #5 + adendum E
**OK:** 8

**Veto/no-go:** **NÃO veto** `MapExplainerCard` nem `TimelineScrubber`
inexistente, mas emito **conditional approval** com 2 guard-rails (§6).

---

## 1. Inventário confirmado

### 1.1 Map fullscreen via NavBar — `MapOverlay`

| Aspecto | Detalhe |
|---|---|
| Trigger | `NavBar` slot esquerdo `[MAPA]` (`App.tsx:1441`) → `pushLayer({id:'map', component:MapOverlay})` |
| Componente | `MapOverlay` (`App.tsx:1927`) |
| Render real | `SpreadMap` (`src/components/Feed/SpreadMap.tsx:110`) |
| State local | `mapMode: SpreadMapMode = 'post' \| 'global' \| 'network'` (`App.tsx:1935`) — default `post`, **PERSISTE só durante o lifecycle do overlay** |
| Subordinação a contexto | `postId = mapMode==='post' ? currentPost?.id : null` (`App.tsx:1955`) — depende de qual post estava em foco no Feed |
| Closing | `popLayer({id:'map'})` via FullPageCard ESC ou botão fechar |

### 1.2 Mini-map embedded no PostViewer

| Aspecto | Detalhe |
|---|---|
| Trigger | Botão 🗺 no header do card (`PostViewer.tsx:676` `setShowMap(v=>!v)`) |
| Long-press 3s | Abre `MapExplainerCard` em vez de toggle (`PostViewer.tsx:152-154`) |
| Render real | `<SpreadMap postId={post.id} />` (`PostViewer.tsx:524`) — **modo `post` fixo** (sem `mode` prop, default `'post'`) |
| Animação entrada | `clipPath inset(0 0 100% 0) → 0`, 480ms Material emphasized (`PostViewer.tsx:483-510`) |
| Cobertura | `absolute inset-0 z-20` — cobre o card inteiro, NÃO substitui o card |
| Modes acessíveis | Nenhum — `ModeToggle` não renderiza porque `onModeChange` não é passado |

### 1.3 Map indireto: explainer

`MapExplainerCard` (`src/components/Feed/MapExplainerCard.tsx`) NÃO é
map; é overlay textual explicando o map. Mas conta como surface
porque atua na game theory de descoberta.

### 1.4 NÃO existem hoje

- `TimelineScrubber` — grep retornou zero hits no repo. Feature está
  no plano em paralelo mas sem código.
- Map no Profile / ThreadView / Settings — só imports de tipo.

---

## 2. Audit por surface

### 2.1 Overlay fullscreen — modo `post`

7 cenários adversariais:

| # | Cenário | Severity | Status |
|---:|---|:---:|---|
| O.P.1 | **K=1 doxx** (único spreader com GPS) | HIGH | **MITIGADO** — `SoloSpreaderWarning` shipado 2026-05-21, conditional render em `SpreadMap.tsx:350`. Educa user via overlay top-right. |
| O.P.2 | **Triangulação por horário + cidade** — atacante junta `(created_at, lat, lng)` no kind 9079 público pra inferir rotina diária | MEDIUM | **DOCUMENTED LIMIT** — Granularidade `country`/`city` é o gate (precisão km). `precise` é opt-in informado. Mitigação completa só com Tor (Fase 6.4). |
| O.P.3 | **Bandwagon implícito** — user vê heatmap intenso → conclui "post legítimo, vou DRIFT" | P1 | **NÃO MITIGADO**. Stats label "N drifts · M países" reforça apelo agregado. Tensão com §22 (sem reputação subjetiva) e §24 (sem afinidade). Mapa NÃO é feed mas influencia decisão de DRIFT que altera score canônico. |
| O.P.4 | **Censorship via empty map** — user abre mapa, vê vazio, conclui "ninguém engajou" → enterra ou ignora | LOW | **DOCUMENTED LIMIT**. Placeholder copy ("ninguém driftou com GPS ativo ainda") atribui causa correta (privacy padrão) em vez de "post sem engajamento". Aceito. |
| O.P.5 | **Coerção GPS via CTA** — botão "abrir GPS settings" no empty state poderia empurrar opt-in | OK | **OK 2026-05-22 Robin fix B3** — label foi de "ativar GPS" pra "abrir GPS settings" justamente pra remover sensação one-click. Manifesto §28 respeitado. |
| O.P.6 | **CARTO CDN tracking** — toda tile fetch loga IP do user na Carto.com | P1 | **PARCIAL** — `map_tile_url_template` override exposto via Settings → user sovereignty. Default leakage só fecha em Tor/Tauri. Banner mostrando "tiles servidos por carto.com" não existe; user só descobre lendo attribution bottom-right (10px font). |
| O.P.7 | **Determinismo §7** — 2 clientes Drift mostram o mesmo render? | OK | `useSpreadMap` é puro sobre `posts`+`spreads` no SQLite local; mesma data ⇒ mesma agregação. `data.destinations[0]?.point` como `center` é determinístico. ANIMATION timing (RAF) varia entre devices mas não-load-bearing (visual only). |

### 2.2 Overlay fullscreen — modo `global`

7 cenários:

| # | Cenário | Severity | Status |
|---:|---|:---:|---|
| O.G.1 | **Hub identification** — nodo gigante em São Paulo → "essa npub é influente" → ataca primeiro | MEDIUM | **DOCUMENTED LIMIT** — `threat-model-maps.md` adendum E reconhece. npub já é público em 9079; dedup visual NÃO adiciona vazamento. Tooltip mostra `anon…<6chars>` (futuro), nunca npub completo. |
| O.G.2 | **Sybil cluster aparente** — atacante popula 50 spreads de coords próximas com 50 npubs falsos → gera "hub fake" pra distorcer percepção | MEDIUM | **NÃO MITIGADO**. Defesa estrutural só virá com WebRTC P2P discovery (Fase 6). Render do globe NÃO valida randomwalk/PoW. Aceito porque `score` canônico tem weight cap (`calculateWeight`) — Sybils só ganham visual, não ranking. Fronteira §11 (sem afinidade no feed) é a defesa que importa. |
| O.G.3 | **WoT colors leak** — modo `network` mostra cores PPR via `lens_show_in_map` | LOW | **MITIGADO** — opt-in default OFF + 4-tier discreto + spreader sem edge → cor default. `threat-model-maps.md` Vetor #4. |
| O.G.4 | **Cross-post correlation** — user vê o mesmo npub em hub do post X E hub do post Y → inferência social-graph | MEDIUM | **DOCUMENTED LIMIT** — já implícito em kind 9079 público; modo `global` só agrega visualmente. Adversário com acesso ao Nostr pool faz a mesma inferência sem mapa. |
| O.G.5 | **Bandwagon agregado** — "X pessoas DRIFT em N países" no stats reforça popularidade | P1 | **NÃO MITIGADO** — mesma natureza de O.P.3, escalada. Veredito: ver §6 recomendação 1. |
| O.G.6 | **Determinismo cross-client** | OK | `buildGlobalData` faz JOIN determinístico. Ordering `sort desc spreadCount` é estável. |
| O.G.7 | **`currentPostId` highlight como tracking** — alguém olhando o ombro vê qual post o user tem em foco | LOW | OK — info já visível no Feed atrás do overlay. Mapa não adiciona surface de tracking. |

### 2.3 Overlay fullscreen — modo `network`

6 cenários (3 são herdados de `global`):

| # | Cenário | Severity | Status |
|---:|---|:---:|---|
| O.N.1 | **Follow-graph shoulder-surf** — observador casual vê mapa colorido → infere follow list | LOW | **MITIGADO** — `threat-model-maps.md` Vetor #3+#4. WoT colors opt-in. Pin único cor uniforme = "alguém na minha rede" (não revela quem). Acceptable. |
| O.N.2 | **Empty network como CTA pra follow churn** — user vê "sua rede está vazia → explore o feed global" → game-theoretic incentive pra seguir mais? | LOW | OK — copy é descritiva, não promotora. Sem botão "explorar agora". Aceito. |
| O.N.3 | **Modo network como confirmation bias** — user só vê quem ele já confia → bolha visual mesmo com §24 protegendo o feed canônico | P1 | **NÃO MITIGADO arquitetural** — É by design (network mode = local lens). Mas tensão com §24: feed é canônico (sem afinidade) mas mapa network introduz visualização afinitiva. Não viola §24 stricto (mapa não é feed, score não muda), mas constrói cognitive frame onde "minha rede = realidade" — exatamente o vetor que §24 combate em outro layer. Recomendação §6.2. |
| O.N.4 | Herda O.G.1 (hub identification) | MEDIUM | dito |
| O.N.5 | Herda O.G.2 (Sybil) | MEDIUM | dito |
| O.N.6 | **`networkDisabled` UI revealing identity state** — botão desabilitado revela "user não tem identidade ativa" pra observador casual | LOW | OK — info já trivialmente visível em outros lugares (header, settings, etc.). |

### 2.4 Mini-map embedded no PostViewer (modo `post` apenas)

5 cenários específicos:

| # | Cenário | Severity | Status |
|---:|---|:---:|---|
| E.1 | **Auto-render = sempre coletando opinião** — mini-map renderiza assim que user clica 🗺 e PERMANECE até fechar. User pode esquecer aberto, mapa fica "convencendo" toda interação subsequente | P1 | **NÃO MITIGADO**. Combina com O.P.3 (bandwagon). Mini-map dentro do card é mais íntimo que overlay → mais persuasivo. Veja §6.1. |
| E.2 | **Long-press 3s pra abrir Explainer competiu com long-press 3s do card pra slim-mode** | OK | Resolvido com `data-no-longpress` no botão 🗺 + posicionamento na header. Verificado em `PostViewer.tsx:195-199`. |
| E.3 | **MapExplainer copy injection** | OK | Copy estática hardcoded em `getMapExplainerCopy`. Sem source externa. §17 OK. |
| E.4 | **Tile CDN leak per-post** — abrir mini-map em N posts = N requests carto.com com Referer talvez identificável | MEDIUM | Mesmo de O.P.6. Pior em embedded porque user abre/fecha mais vezes. Reopener: Tauri shell + tile proxy local. |
| E.5 | **Mini-map sem stats label vs overlay com stats label** — inconsistência cognitiva, mas mini-map herda MapShell → tem stats sim | OK | Verificado: `MapShell` (`SpreadMap.tsx:634`) é shared. Mini-map tem mesmo stats footer. OK. |

---

## 3. Top 3 game-theoretic gaps (entrega vs promessa)

### Gap #1 — Mapa como "termômetro social" disfarçado de "visualização geográfica"

**Promessa:** mapa mostra ONDE o post viajou (geografia).
**Entrega:** mapa mostra ONDE + QUANTOS (número intenso, heatmap
saturado, "N drifts · M países" estampado). Quantitativo overrides
qualitativo na percepção do user.

**Tensão com manifesto:**
- §22 (sem reputação subjetiva) — não fala de mapa diretamente, mas
  princípio "número visível como autoridade" é o vetor que §22 combate
  em outro layer.
- §24 (sem afinidade no feed) — feed é protegido; mapa não é, mas
  influencia decisões (DRIFT) que retroalimentam o feed.

**Mitigação possível:** stats label minimal "N drifts" (sem highlight
visual, font/cor existente já está ok); evitar emojis/badges
celebrativos; documentar trade-off em `known-limitations.md` §nova.

### Gap #2 — Modo `network` legitimiza framework "minha rede = realidade"

**Promessa:** "lente local não afeta feed canônico" (Trust Lens
disclaimer já existente).
**Entrega:** user vê mapa cheio de pins quentes da sua rede, mapa
global vazio relativamente → constrói viés "minha rede é o que
importa". §24 cobre feed; nada cobre cognitive frame visual.

**Mitigação possível:** quando alternar entre modes, mostrar
brevemente "lente local" badge (300ms toast tipo "TLE — afetando só
visualização"). Já existe `SuaLenteCard` mas o badge de modo é mudo
nesse aspecto.

### Gap #3 — Default modo `post` no overlay = "este post é o mundo"

**Promessa:** overlay fullscreen = visão da rede.
**Entrega:** abre com `mapMode='post'` (App.tsx:1935), centrado no
`currentPost`. User clica MAPA esperando "ver a rede" e vê só este
post. Precisa lembrar de tocar `global`.

**Mitigação possível:** default `global` quando entry-point é NavBar
(usuário pediu visão geral); manter default `post` quando entry-point
é botão 🗺 do card (já é assim — embedded sempre `post`). Atualmente
ambos defaultam `post`.

---

## 4. Veto / no-go explícito

### 4.1 `MapExplainerCard` (já mergeado em paralelo)

**NÃO veto.** Copy revisada em `getMapExplainerCopy`:
- Disclaimer §28 sempre presente — bom
- Vocabulary DRIFT user-facing — bom
- Sem CTA pra ativar GPS — bom
- Copy NETWORK menciona "lente local, não afeta feed canônico §24" —
  excelente, fecha parte do Gap #2

**Recomendação Satoshi:** adicionar 1 frase no copy `global` e `post`
sobre **tamanho ≠ qualidade**:
> "Tamanho dos pontos mede frequência, não importância nem qualidade
> dos posts. Drift não usa esses dados para ranquear (§22)."

Fecha parcialmente Gap #1.

### 4.2 `TimelineScrubber` (inexistente; planejado em paralelo)

**Conditional approval** com 2 guard-rails:

1. **NÃO mostrar contador acumulado em tempo real** ("X drifts em 10s")
   durante scrub — vira bandwagon temporal. Mostrar só timestamps
   discretos (horas/dias).
2. **NÃO permitir scrub além do `created_at` do post** — pin "futuro"
   relativo a outros posts é semanticamente confuso. Limitar a
   `[postCreatedAt, now]`.

Se ambos respeitados: ship. Caso contrário: NO-GO até revisão.

### 4.3 Map novo no Profile (sugerido tacitamente no briefing)

**NO-GO preventivo.** Profile já expõe npub + posts; adicionar map
"onde essa pessoa esteve" amplifica K=1 doxx em escala individual
(todos os spreads dela em um lugar só). Reopener: K-anonymity engine
(Phase 2) + opt-out explícito por autor.

---

## 5. Manifesto compliance — recheck

| § | Princípio | Mapas hoje | Notas |
|---|---|:---:|---|
| §7 | Determinismo | OK | `useSpreadMap` puro; render varia só em RAF timing (não load-bearing) |
| §11 | Sem afinidade no feed | OK | Mapa NÃO afeta `posts.score`; modos lens são view-layer |
| §17 | Sem chave mestra | OK | `map_tile_url_template` user sovereignty; CARTO é fundo, não filtro |
| §22 | Sem reputação subjetiva | TENSÃO | Stats agregado pode funcionar como proxy de "qualidade". Gap #1. |
| §24 | Sem afinidade canônica | OK strict, TENSÃO frame | network mode = local-only. Mas cognitive frame issue (Gap #2). |
| §25 | Sem scan automático | OK | Mapa não escaneia conteúdo, só geo declarada |
| §28 | Privacy mínima | OK | Default OFF, granularity picker, K=1 warning, placeholder honest |

---

## 6. Recomendações priorizadas

### 6.1 [P1] Mini-map auto-close timer ou hint dismiss

Após 30s sem interação (pan/zoom) no mini-map embedded, mostrar hint
"toque pra fechar" + animação subtle. Ataca E.1 (persistence
persuasiva) sem prejudicar power user. Implementar via `useEffect` +
`setTimeout` resetando em pointer events do container.

### 6.2 [P1] Mode badge ao trocar modes no overlay

Toast 280ms ao alternar `post`→`global`→`network`: "modo NETWORK
— lente local, não afeta feed (§24)". Fecha parte de Gap #2.

### 6.3 [P2] Default `global` no overlay quando entry = NavBar

`App.tsx:1935` muda `useState<SpreadMapMode>('global')` quando
overlay é aberto pela NavBar. Embedded (PostViewer) continua `post`
forçado. Resolve Gap #3.

### 6.4 [P2] Stats label deemphasis

Reduzir font weight do stats badge (`SpreadMap.tsx:656`) de regular
pra `font-light`. Reduz visual primacy do número agregado. Custo
zero; alinha com Gap #1.

### 6.5 [P2] CARTO attribution upgrade

Banner one-time (dismissible permanent) primeira vez que user abre
mapa: "tiles servidos por carto.com — seu IP é logado por eles". Reuse
LensNudgeBanner pattern. Sovereignty pref já existe; user precisa
SABER pra usar.

### 6.6 [P2] Adicionar copy "tamanho ≠ qualidade" no MapExplainerCard

Conforme §4.1 acima.

---

## 7. Convergência / divergência com Ted

**Ted está revisando arquitetura em paralelo. Doc dele ainda não
existe.** Quando consolidar, conferir especificamente:

- Bundle size do `loadMapDeps` (Ted bundle audit §1.8) — Satoshi não
  re-audita aqui.
- Determinismo cross-client em `buildGlobalData` JOIN ordering —
  Marshall reviewable, fora do escopo Satoshi.
- WebRTC P2P discovery anti-Sybil cluster detection (Fase 6) — Ted
  arquitetura, Satoshi só validou que score canônico tem weight cap.

Sem divergência prevista. Convergência principal esperada: ambos
flagam Gap #1 (bandwagon visual), aproximadamente.

---

## 8. Reabertura deste audit

Re-rodar quando:

1. `TimelineScrubber` mergear — re-audit P0 sobre temporal bandwagon
2. Profile ganhar map (NO-GO atual) — full re-audit
3. K-anonymity engine shipar (Phase 2) — fechar #5 K=1 residual
4. Tor mode shipar (Fase 6.4) — fechar O.P.6 / E.4 tile CDN
5. Mode "cluster" adicional no toggle — re-audit Sybil cluster
6. DAU > 1000 + telemetria empírica de small-town K=1 disponível

---

## 9. Findings summary table

| Code | Surface | Severity | Status | Action |
|---|---|:---:|---|---|
| O.P.1 | overlay post | HIGH | MITIGATED | none |
| O.P.2 | overlay post | MEDIUM | DOC LIMIT | Fase 6.4 Tor |
| O.P.3 | overlay post | P1 | OPEN | §6.4 deemphasis + §6.6 copy |
| O.P.4 | overlay post | LOW | DOC LIMIT | none |
| O.P.5 | overlay post | OK | DONE | none |
| O.P.6 | overlay post | P1 | PARTIAL | §6.5 banner CDN |
| O.P.7 | overlay post | OK | OK | none |
| O.G.1 | overlay global | MEDIUM | DOC LIMIT | none |
| O.G.2 | overlay global | MEDIUM | OPEN | Fase 6 P2P |
| O.G.3 | overlay global | LOW | MITIGATED | none |
| O.G.4 | overlay global | MEDIUM | DOC LIMIT | none |
| O.G.5 | overlay global | P1 | OPEN | §6.4 + §6.6 |
| O.G.6 | overlay global | OK | OK | none |
| O.G.7 | overlay global | LOW | OK | none |
| O.N.1 | overlay network | LOW | MITIGATED | none |
| O.N.2 | overlay network | LOW | OK | none |
| O.N.3 | overlay network | P1 | OPEN | §6.2 mode badge |
| O.N.6 | overlay network | LOW | OK | none |
| E.1 | embedded post | P1 | OPEN | §6.1 auto-close hint |
| E.2 | embedded post | OK | DONE | none |
| E.3 | embedded post | OK | OK | none |
| E.4 | embedded post | MEDIUM | DOC LIMIT | Fase 6.4 Tor |
| E.5 | embedded post | OK | OK | none |
| G.#1 | cross | P1 | OPEN | §6.4 + §6.6 + known-limitations |
| G.#2 | network | P1 | OPEN | §6.2 |
| G.#3 | overlay | P2 | OPEN | §6.3 |
| V.MapExplainer | new feature | OK | APPROVED | §6.6 copy add |
| V.TimelineScrubber | new feature | CONDITIONAL | OPEN | 2 guard-rails §4.2 |
| V.ProfileMap | speculative | NO-GO | BLOCKED | K-anonymity gate |

**Totais:** 1 NO-GO (preventivo, feature não pediu), 1 conditional,
6 P1 abertos (todos têm action ≤ 1h cada), 6 documented limits
aguardando Fase 6/Phase 2.

---

*Auditoria adversarial Satoshi 2026-05-21. Próxima review:
pós-implementação P1 recommendations OR consolidação com doc Ted
paralelo (quando aterrissar).*
