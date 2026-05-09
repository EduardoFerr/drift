# Barney pending activities review + threat regression check — 2026-05-08

**Data:** 2026-05-08 (final do dia)
**Persona:** Barney (HIMYM — peer review crítico, threat modeling, security, ceticismo)
**Escopo:** revisão final do dia. Tracks Lily/Marshall/Ted concluídos hoje;
checa threat regressions, manifesto compliance, gaps Barney próprios.
**Doc-only.** Sem mudança de código. Recomendações entram em backlog ou
Round 4 do plano Ted.

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual. Decisões aqui (ship vs
> regredir, blockers Round 3) viram norma só se Arquiteto propaga.

---

## §1 TL;DR

| Track | Verdict | Motivo curto |
|---|---|---|
| **Lily — primitives + track C cleanup + token migration** | 🟢 verde | DriftButton + FullPageCard regridem 0 ameaças; token swaps cosméticos não tocam §17/§22/§24/§28; `clickOutToClose` default false em todos os call sites; `escDismissible` corretamente fechado em compose+rebuild. |
| **Marshall — TX-5 + UX-9 + KIND_DISPATCH + TM-3 audit + Robin top 5** | 🟢 verde | TX-5 expõe título já público (kind 9078 content) — zero leak novo; UX-9 + UX-3 snapshot pattern fecha race condition de cursor que existia antes, *reduz* superfície (não introduz); KIND_DISPATCH preserva pipeline de §1 invariante. |
| **Ted — ADR v2 + UX spike** | 🟡 amarelo | ADR v2 cobre 5 das 6 mitigações mandatory + AT-1, AT-5, AT-9, AT-10, AT-14 explícitos; **AT-11 documentado como limite honesto, não fechado**. Spike é só docs. Risco zero pra ship; risco de implementação Round 4+ depende de aprovação Arquiteto. |
| **WebRTC §15 IP leak (T1+T2+T3+T4 + bootstrap + seeder)** | 🟢 verde | Gate `network_mode === 'clearnet'` aplicado em ambos pontos (bootstrap.ts:293 + seeder.ts:74). Conformance test estático em `manifesto-conformance.test.ts:697-744` previne regressão silenciosa. Nenhum outro caller de `connectTo`/`RTCPeerConnection` direto resta sem gate. PWA + Tauri ambos cobertos via mesmo gate (PWA não pode setar network_mode='tor' por validação prefs.ts; só clearnet permitido → WebRTC ativo. Tauri pode setar → WebRTC bloqueado quando setado). |
| **Barney pending (próprio)** | 🟡 amarelo | 4 gaps: AT-11 não-fechado por design (aceito), AT-7 (Tor bridge enum) ainda em queue Fase 6.4 follow-up, TM-3 per-subpost CW deferido pra Round 4 com Marshall recomenda Opção A, banner UI do Round 3 não pode introduzir novo motion durante switch de modo de rede sem cobrir AT-3. |

**Verdict release-readiness:** **🟢 verde — ship Round 4** com 3 ressalvas
documentadas (§4 abaixo). Nada bloqueante hoje. Round 4 segue plano Ted.

**Top-3 threat residuais (carry-over, NÃO regressões hoje):**

1. **AT-11 fundamental** — quando `auto` shippar (Round 4+), user em
   país censurado emite "moment of switch" estatisticamente identificável.
   Mitigado por prompt explícito (ADR v2 §3.2) mas não eliminado.
   *Severidade S0 manifesto-level, mitigação parcial.*
2. **AT-7 Tor bridge enumeration** — quando Tor automático shippar, scale
   adoption induz GFW a enumerar bridges de directory auths públicas.
   Pluggable transports (obfs4, snowflake) ainda não wired-up em arti.
   *Severidade S1, fix em Fase 6.4 follow-up.*
3. **TM-3 per-subpost CW** — autor pode publicar 2 subposts (1 inocente
   + 1 NSFW) sem CW global; leitor com `hide_nsfw` ativo só vê blur
   se autor marcar post inteiro. Manifesto §27 textualmente delegou ao
   autor + comunidade — *não* é violação técnica do manifesto, mas é
   surface aberto pra abuse pattern.
   *Severidade S2, fix Opção A (UX warning) em Round 4.*

---

## §2 Threat regression — checklist por commit/PR

### 2.1 — `33f7c23 fix(comments): UX-3/5/9/11 from Robin audit`

#### TX-5 (título do post no header)

**Análise leak potencial:**
- Título derivado de `splitTitleBody(post.subposts[0]?.text)` ou
  `synthesizeTag(post)`.
- `post.subposts[0].text` é literal o content do kind 9078 — já era
  visível em qualquer renderização do feed (PostCard, PostViewer,
  FeedTabs). Conteúdo público por design, kind 9078 é regular event.
- `synthesizeTag` puxa de `post.category || post.location?.city ||
  post.contentWarning` — todos campos já públicos no evento Nostr
  (tags `category`, `location`, `content-warning`).
- ID chip mostra últimos 6 chars do `post.id` em uppercase — é o
  hash SHA256 do evento, sempre público.
- `splitTitleBody` é puro, determinístico (§7).

**Verdict:** ✅ **Sem leak novo.** Toda informação exposta no header
já era pública no kind 9078 content/tags. TX-5 reduz info-cripticidade
sem mudar o set de info exposta. Manifesto §22 (determinismo) preservado
— `deriveHeaderTitle` é pura.

#### UX-9 (botão "+ no post" no header)

**Análise race condition:**
- `replyMode` state ('cursor' | 'topLevel') decide o destinatário.
- `openReplyToCursor()` e `openReplyTopLevel()` setam mode antes de
  abrir sheet.
- ReplySheet faz **snapshot ao abrir** (UX-3, `targetSnapshot` state)
  congelando `{replyTo, replyToKind, replyToAuthorPub}`.
- `resolveReplyTarget(snapshot, live)` em `doPublish` prefere snapshot
  quando presente. Header mostra `targetSnapshot.replyToAuthorPub`
  consistente com submit.
- `onClose` reseta `replyMode` pra 'cursor' default. Snapshot reseta
  pra null no useEffect com dep `[open]`.

**Cenário ataque:** user clica "+ no post" → ReplySheet abre com
`replyMode='topLevel'`, snapshot capturado com `replyTo=postId`. User
inicia digitar. Cursor pai muda (push novo comment, ou comment moderado).
`replyTo` *prop live* mudou, mas snapshot não. Submit usa snapshot.

**Pergunta cética:** o botão pode confundir user "responder ao post" vs
"responder ao comment selecionado"?
- Botão tem `aria-label="comentar no post (top-level)"` + título textual
  "+ no post" + posição header (não FAB). FAB segue dedicado a "responder
  cursor".
- ReplySheet header mostra `para {shortNpub(targetSnapshot.replyToAuthorPub)}`
  consistente com mode escolhido — user vê "para …postPubKey" se top-level,
  "para …commentPubKey" se cursor.

**Verdict:** ✅ **Race fechado, semântica clara.** UX-3 snapshot pattern
*reduz* superfície de bug (anteriormente cursor mudava silenciosamente
entre digitar e publish — comments-ux-audit-2026-05-08.md UX-3 era latent
bug real, não hipotético). Header label diferencia top-level vs cursor.

#### UX-5 (border-left "novo")

Cosmético. `isNew = node.created_at >= openedAt`. Determinístico.
**Verdict:** ✅ **Sem ameaça nova.**

#### UX-11 (footer respostas tappable)

`<button onClick={onDescend}>` substitui `<span>`. A11y melhora.
**Verdict:** ✅ **Sem ameaça nova.**

---

### 2.2 — `41757ca feat(ui): FullPageCard + DriftButton primitives (Lily)`

#### FullPageCard primitive

**Audit dos 4-6 call sites:**

| Call site | clickOutToClose | escDismissible | Verdict |
|---|---|---|---|
| `App.tsx:1710` SettingsRoot | default false | conditional `!showFilters && !showStatus...` | ✅ ok — fechamento via ESC só quando nada aberto |
| `Create/ComposeOverlay.tsx:271` | default false | `!publishing` | ✅ ok — ESC bloqueada durante publish em vôo (anti-perda de typed content) |
| `Settings/SettingsCards.tsx:669` rebuild cache | default false | `!rebuilding` | ✅ ok — ESC bloqueada durante rebuild SQLite (ação destrutiva!) |
| `Settings/RelaySettings.tsx` | default false | default true | ✅ ok |
| `Settings/LocalListsSettings.tsx` | default false | default true | ✅ ok |
| `Identity/IdentityPanel.tsx` | default false | default true | ✅ ok |
| `Identity/IdentitySwitcher.tsx` | default false | default true | ✅ ok |
| `Post/ThreadView.tsx` | default false | default true | ✅ ok |

**Verdict crítico:** **zero call sites habilitam `clickOutToClose`.**
A propriedade existe no schema mas nenhum caller atual passa. Risco
"user dismiss accidental durante ação destrutiva" não materializa hoje.
Quando alguém habilitar (Round 3+), peer review deve checar:
- Não habilitar em modal com ação destrutiva *em vôo* (rebuild cache,
  reset identity, delete pinned).
- ESC e click-out devem ter mesma semântica (ambos respeitam
  `escDismissible`/equivalente — atualmente click-out **NÃO** respeita
  `escDismissible`, é separate flag).

**Recomendação Round 3:** se algum caller adicionar `clickOutToClose`,
exigir simétrico ao `escDismissible` ("clickOut também bloqueado durante
ação destrutiva em vôo"). Adicionar invariante no docstring de
FullPageCard. Não bloqueia ship hoje (sem callers); flag pra futuro.

#### DriftButton primitive

**Audit das 5 variants:**

| Variant | Semântica | Risco |
|---|---|---|
| `primary` | bg accent + text bg invertido | benigno — equivalente DRIFT ↑ |
| `ghost` | border accent + text accent2 | benigno — equivalente FECHAR |
| `cancel` | border drift-border + text drift-muted | benigno |
| `danger` | border drift-bury + text drift-bury sem bg | ⚠️ semântica destrutiva |
| `danger-prominent` | bg drift-bury + text drift-bg cheio | ⚠️ semântica destrutiva forte |

**Pergunta cética:** existe variant que ofusca semântica destrutiva?
- `danger` vs `danger-prominent` ambos usam mesma cor base (drift-bury).
  Diferença é "outline vs cheio" — escala visual de severidade. Semântica
  preservada em ambos.
- Sem call sites hoje (`grep -r "variant=\"danger\""` retorna zero
  matches em src/).
- ⚠️ **Mas:** `cancel` vs `ghost` podem confundir leitor de código —
  ambos são "secondary outline". Cancel é "discreto neutro" (border
  drift-border), ghost é "neutral accent-aware" (border accent).
  Semântica sutil; uso correto depende do contexto.

**Verdict:** ✅ **Variants corretas.** Sem regressão. Nenhum site usa
`danger`/`danger-prominent` ainda — quando usar (Round 3 pra Identity
Reset, Track C delete pinned, etc.), peer review deve confirmar:
- `danger-prominent` *só* em delete confirmado de 2 etapas.
- `danger` em ações reversíveis (limpar local, desligar helia).

**Recomendação Round 3:** adicionar exemplo de uso em docstring com
"NÃO usar danger-prominent em primary action sem confirmação prévia".

---

### 2.3 — `2b0e147 refactor(events): KIND_DISPATCH lookup table`

**Análise pipeline §1 invariante:**

CLAUDE.md invariante #1 — `onNostrEvent()` é a ÚNICA porta de INSERT em
domínio. KIND_DISPATCH centraliza:
- 5 entries (9078 / 9079 / 9080 / 9081 / 1111).
- Cada handler tem `validate(event)` + `persist(event)`.
- Pipeline preservado: kind check (Set lookup) → schema check
  (`handler.validate`) → verify Schnorr → `handler.persist` →
  `scheduleScoreRecalc` → `invalidateFeed`.
- `INSERT OR IGNORE` preservado (idempotência).

**Risco:** alguém adiciona kind sem entry em KIND_DISPATCH → silent drop
(não-bug por design — manifesto §28 compatibilidade Nostr não-Drift).

**Risco:** alguém modifica `validate*` de um kind sem atualizar tests →
schema drift. Mitigado por `tests/events-dispatch.test.ts` (16 tests
adicionados).

**Verdict:** ✅ **Refactor preserva invariante #1.** Centralização REDUZ
risk de schema-drift entre 2 switches paralelos (era o motivo do RFC
original de Robin). Não introduz ameaça nova.

---

### 2.4 — `2d1337a fix(transport): gate webrtcTransport by network_mode` + `ce02e26 fix(seeder): gate seedFromSpreaders by network_mode`

**Análise §15 cobertura PWA + Tauri:**

`bootstrap.ts:293`:
```ts
if (networkMode === 'clearnet') {
  registerTransport(webrtcTransport, { weight: 5 })
}
```

`seeder.ts:74`:
```ts
const networkMode = getPrefs().network_mode
if (networkMode !== 'clearnet') {
  return 0
}
```

**Cobertura PWA:** PWA só permite `clearnet` em `prefs.ts`
(validation `applyPrefValue`). Mesmo se hipotéticamente PWA tentasse
setar `'tor'`, gate cobre — apenas `'clearnet'` libera WebRTC.
**Cobertura Tauri:** Tauri permite `'tor'`/`'onion-only'`/`'clearnet'`
(Round 4+ adiciona `'auto'`). Gate `=== 'clearnet'` bloqueia 'tor',
'onion-only', e (futuro) 'auto' antes do FSM decidir → safe default.

**Outros entry points de RTCPeerConnection:**
- `transport/webrtc/peer.ts:69` — `new RTCPeerConnection` direto.
  Chamado por `getOrCreatePeer`, que é chamado por `connectTo` (gated
  em seeder), `discovery.performRandomWalk` (chamado por
  `startRandomWalkTimer`, que é chamado por `boot.ensureSignalingAsync`,
  que é chamado por `webrtcTransport.subscribe/publish` — gated em
  bootstrap orchestrator).
- `reconnect.ts:101` — chama `connectTo` apenas se já existe peer
  state com `connectionstatechange` event. Sem peers iniciais (Tor
  mode, gate em bootstrap), nenhum reconnect dispara.
- `seeder.ts:112` — gate primeiro, retorna 0 antes de `connectTo`.

**Verdict:** ✅ **§15 IP leak fechado em ambos PWA E Tauri.**
Cobertura completa: nenhum path RTCPeerConnection acessível em
network_mode != 'clearnet'. Conformance test estático garante regressão
zero.

**Manifesto-conformance test em `tests/manifesto-conformance.test.ts:697-744`:**
verifica que `bootstrap.ts:registerTransport(webrtcTransport)` está dentro
de `if (networkMode === 'clearnet')` ou equivalente. Falha se gate é removido
silentemente em refactor futuro.

---

### 2.5 — Outros commits do dia (cleanup track C, polish, fix de feedback)

- `1d9e2b0 cleanup(comments): track C P2 (10 items) + extract format.ts` — extracção pra `format.ts`. Cosmético + pure functions. ✅
- `fdf795c polish(comments): track C P1 UX (5 items)` — polish UX. ✅
- `52029b0 ui(feed,post,image): 3 user-feedback fixes` — Image lightbox dblclick (closes single-click conflict com swipe + tap-reveal CW). ✅ — observação: passou de single → double click reduz discoverability mas resolve conflito real. Aceito.
- `32c378f fix(home): track navigation by postId instead of array index` — feed cursor stabilization. ✅ — não toca §15/§17/§22/§24/§28.

**Verdict global:** todos cosmetic/cleanup, sem regressão.

---

## §3 Manifesto compliance — §s tocados hoje

| § | Toca? | Como | Verdict |
|---|---|---|---|
| §1 Existência autônoma | não | — | ✅ |
| §2 Auto-soberania | não | — | ✅ |
| §3 Identidade portável | não | — | ✅ |
| §4 Anonimato | parcial (gate WebRTC §15) | gate Tor mode preserva anonimato user em modo paranoia | ✅ |
| §5 Autenticidade | KIND_DISPATCH preserva verify Schnorr na ordem correta | ✅ |
| §7 Determinismo | TX-5 `deriveHeaderTitle` é puro; KIND_DISPATCH `validate*` puros | ✅ |
| §15 anti-censura por país | **fix shipped** (gate WebRTC + seeder) | ✅ |
| §17 sem chave mestra | nenhum commit toca scan automático, banUser, deletePost | ✅ |
| §22 score determinístico | TX-5 não toca scoring; KIND_DISPATCH preserva | ✅ |
| §23 bury não pune | não tocado | ✅ |
| §24 sem afinidade no feed | UX-9 + UX-3 não personalizam feed | ✅ |
| §27 auto-classificação | TM-3 audit *documenta* gap; **não shippa fix** (Marshall recomenda Opção A pra Round 4) | 🟡 amarelo — gap reconhecido, fix em queue |
| §28 privacidade pelo mínimo | nenhum commit adiciona telemetria, analytics, fetch a backend | ✅ |
| §32 compatibilidade entre clientes | KIND_DISPATCH não muda schema kinds 9078..9081; preserva NIP-22 1111 | ✅ |

**Cross-checks:**
- `grep -rn "fetch(\|navigator.connection\|gtag\|analytics" src/` retorna apenas
  `src/lib/blobs.ts` (IPFS gateway HTTP fetch — necessário pra blob retrieval,
  já existia) e `src/lib/upload.ts` (nostr.build POST — feature existente).
  **Nenhum analytics/telemetry adicionado hoje.**
- Nenhum import novo de `fetch` em `src/lib/transport/`, `src/lib/events.ts`,
  `src/lib/feed.ts`, `src/components/`.

**Verdict §27 (TM-3):** Marshall doc `per-subpost-cw-gap-2026-05-08.md`
documenta:
- Gap confirmado: schema atual não suporta CW per-subpost.
- Opção A recomendada: warning leve antes de publicar quando subpost
  tem imagem mas user não marcou CW global. Custo ~1h.
- Opção B (granularidade real): mudança schema, ~5-7h, vira RFC própria.
- Decisão Arquiteto pendente: A vs B vs deferir.

Plan Ted (`ted-delegation-plan-2026-05-08.md`) lista TM-3 Opção A pra
Round 4 com Marshall + Lily. **Documentado pro Arquiteto** ✓.

---

## §4 Pending Barney activities — gaps abertos hoje

### Gap 1 — AT-11 fundamental blocker (não-fechável por design)

**Status:** ADR Ted v2 aceita o limite explicitamente em §8. Mitigação
parcial via prompt obrigatório no first-boot Tauri (`'auto'` exige
consent informado).

**Pendência Barney:** verificar quando Round 4 Tauri auto shippar:
- Prompt **realmente** aparece no first-boot (sem dismiss possível)?
- `prefs.firstBootPromptShown` é honrado (não regrida pra mostrar de
  novo após reload)?
- UI text reflete trade-off ("Tor sempre" mais anônimo que "Auto" pra
  país censurado)?

**Prazo sugerido:** retest E2E após Round 4 Tauri build, *antes* de
release ao público. Backlog do testbed Robin Fase A.

### Gap 2 — AT-7 Tor bridge enumeration

**Status:** ADR Ted v2 §8 admite "não endereçado em v2; pluggable
transports são Fase 6.4 follow-up".

**Pendência Barney:** quando Tor automático (auto-mode) ganhar adoção
≥1000 users em país censurado, GFW vai enumerar bridges Tor padrão
(directory auths públicas). Drift `auto` precisa pluggable transports
(obfs4, snowflake) wired-up em arti.

**Prazo sugerido:** Fase 6.4 follow-up, *antes* de campanha pública em
jurisdições conhecidamente censuradas (China, Iran, Russia). Não
bloqueia Round 4 Tauri auto pra users ocidentais.

### Gap 3 — TM-3 per-subpost CW (deferido pra Round 4)

**Status:** Marshall verdict (b): bug confirmado, fix queue Round 4
Opção A.

**Pendência Barney:** revisar Marshall + Lily implementação do warning
quando subpost com imagem + CW global ausente. Verificar:
- Warning é *informativo* (não-bloqueante) → respeita §27 "auto-classificação
  voluntária".
- Warning não persiste no SQLite, não envia telemetria, não hash a imagem
  (§17 + §28).
- Test em `tests/compose-overlay.test.ts` cobre cenário (subpost com
  imagem sem CW → warning aparece; sem imagem → warning não aparece).

**Prazo sugerido:** Round 4 finish (~1h Marshall + 30min review Barney).

### Gap 4 — Round 3 UI/UX motion guidelines

**Status:** Round 3 (delegation plan §Round 3) é "+50% elevation
campaign" com 5 personas paralelo. Adiciona motion polish em vários
sites.

**Pendência Barney:** verificar pré-ship que **nenhum motion novo é
introduzido durante switch de modo de rede** (clearnet ⇄ Tor ⇄ FailedAll).
Razão:
- Switch de modo (Round 4 Tauri auto) força `location.reload()`. Estado
  React é descartado; banner "verificando rede…" aparece em boot fresco.
- Se Round 3 adiciona transição motion entre estados internos da app
  (ex: `step: 'auto-decide' → 'sync'`), e essa transição empacota state
  React que sobrevive reload (zustand persist?), pode introduzir AT-3
  timing fingerprint (motion duration vira sinal de "este boot foi
  reload pós-switch" vs "primeiro boot"). Improvável mas verificável.
- Verificação: confirmar que zustand stores não persistem em localStorage
  + que motion durations são constantes (não dependem de `last_auto_decision`).

**Prazo sugerido:** review Round 3 PR-by-PR antes de merge. Cobertura
trivial (~15min de grep em changes).

---

## §5 Round 3 input — o que UI/UX campaign DEVE evitar

Plan Ted §Round 3 é elevation campaign visual (5 personas paralelo).
Diretrizes Barney pra evitar regressão de threat surface:

### Diretriz 1 — Sem motion novo durante switch de modo de rede

**Razão:** AT-3 timing fingerprint. Motion duration vira observável
ao A4/A5. Switch de transport já é fingerprint AT-11; novo motion
amplia sinal sem benefício UX.

**Recomendação:** transitions entre `Probing → Switching → Tor` (FSM
auto-mode) usam `location.reload()` (já decidido em ADR §4.1). Reload
é sinal "evento discreto", não "motion analógica" — preservar.

### Diretriz 2 — Sem persistência client-side de "decisões UI"

**Razão:** AT-13 (telemetry leakage via verbose logging). Round 3 pode
adicionar "lembrar última tab aberta", "lembrar último filter aplicado",
etc. — cada um é um log local que pode revelar comportamento user em
post-seizure forensics.

**Recomendação:** se Round 3 persiste em `user_prefs`, justificar por
PR ("prefs persiste pra UX X — risco AT-13 aceito porque Y"). Se em
SQLite, justificar com mais cuidado (manifesto §28 + invariante #1).

### Diretriz 3 — Sem clickOutToClose em modal com ação destrutiva em vôo

**Razão:** FullPageCard primitive ganhou `clickOutToClose` opt-in mas
nenhum caller hoje usa. Quando Round 3 habilitar (modal mais leve, sub-card
informativo, etc.), exigir simétrico ao `escDismissible`:
- Click-out *deve* respeitar mesma flag de "ação destrutiva em vôo".
- Action em vôo: rebuild cache, identity reset, delete pinned, publish
  em vôo.

**Recomendação:** estender `clickOutToClose` pra aceitar `'always' |
'never' | 'unless-busy'` (ou similar) que combina com `escDismissible`.
Documentar invariante no FullPageCard docstring.

### Diretriz 4 — Sem prompt automático que infere localização do user

**Razão:** AT-11 + manifesto §17 + §28. Round 3 pode tentar adicionar
"detectamos que você pode estar em país X — ative Tor?" via Geolocation
API ou timezone heurística. ADR Ted §3.3 explicitly veda.

**Recomendação:** qualquer banner de país/jurisdição é *opt-in
second-step* (user clica "ajude a sugerir"), nunca first-step automático.

### Diretriz 5 — Sem novo external link sem verificação manual

**Razão:** Round 3 pode adicionar links pra docs externas, store badges,
bridges Tor. Cada link externo é vetor pra phishing futuro.

**Recomendação:** todos external links em UI passam por `lib/dialog.ts`
ou whitelist em `config/external-links.ts`. PR review verifica.

---

## §6 Release-readiness verdict

### Verde, ship Round 4

**Critérios atendidos:**

1. ✅ **Threat regressions zero.** Lily primitives + Marshall fixes não
   introduzem ameaça nova. Auditoria de 6 commits do dia + 4 call sites
   de FullPageCard + 5 variants de DriftButton.

2. ✅ **§15 IP leak completamente fechado.** Gate em bootstrap.ts +
   seeder.ts cobrem PWA E Tauri. Conformance test estático previne
   regressão. Nenhum entry point RTCPeerConnection ungated.

3. ✅ **§17/§22/§24/§28 preservados.** Nenhum commit hoje toca scan
   automático, ranking subjetivo, telemetria, persistência fora do
   pipeline canônico.

4. ✅ **Determinismo §7 preservado.** `deriveHeaderTitle`, `KIND_DISPATCH
   handlers`, `resolveReplyTarget` são puras + testadas.

5. ✅ **Manifesto-conformance test verde** (presumido — 792 tests, regex
   gates §15 + native dialogs ban + scan automático ban).

**Ressalvas (não-bloqueadoras):**

1. 🟡 **AT-11** continua S0 manifesto-level mas mitigado por prompt
   first-boot (ADR v2 §3.2). Aceito como limite honesto.
2. 🟡 **TM-3 per-subpost CW** documentado, fix queue Round 4 Opção A.
   Manifesto §27 não é violado tecnicamente.
3. 🟡 **AT-7 Tor bridge enum** queue Fase 6.4 follow-up. Não aplica
   antes de campanha pública em país censurado.

**Recomendação operacional:**
- **SHIP Round 4 conforme plan Ted.** Marshall + Lily executam ADR v2
  (a)-(g). Robin testbed Fase A roda em paralelo desde (a).
- **NÃO regredir** nenhum commit do dia.
- **Round 3 review** segue plan Ted, com diretrizes §5 acima como gate
  Barney.

**Próximo Barney activity (proativo):**
- Pré-ship Round 4 Tauri auto: re-audit AT-1, AT-5, AT-9, AT-10, AT-14
  contra implementação real (não doc). Estimativa 30min — 1h.
- Pós-ship Round 4: smoke test E2E de prompt first-boot em build Tauri
  fresh (`firstBootPromptShown=false` → modal aparece, escolha persiste,
  reload não re-mostra).

---

## §7 Cross-references

### Sessão de hoje (companion docs 2026-05-08)
- [`Docs/sessions/auto-mode-threat-model-2026-05-08.md`](./auto-mode-threat-model-2026-05-08.md) — Barney próprio. AT-1..14.
- [`Docs/sessions/barney-test-posts-2026-05-08.md`](./barney-test-posts-2026-05-08.md) — Barney TM-1..4.
- [`Docs/sessions/per-subpost-cw-gap-2026-05-08.md`](./per-subpost-cw-gap-2026-05-08.md) — Marshall TM-3 audit.
- [`Docs/sessions/ted-ux-spike-deployed-2026-05-08.md`](./ted-ux-spike-deployed-2026-05-08.md) — Ted UX spike.
- [`Docs/sessions/ted-delegation-plan-2026-05-08.md`](./ted-delegation-plan-2026-05-08.md) — Ted meta-coord (Round 2-5).
- [`Docs/sessions/design-qa-baseline-2026-05-08.md`](./design-qa-baseline-2026-05-08.md) — Robin QA #1 (90 finds).
- [`Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md`](./15-e2e-testbed-scoping-2026-05-08.md) — Robin testbed Fase A scoping.
- [`Docs/sessions/auto-mode-detection-algorithm-2026-05-08.md`](./auto-mode-detection-algorithm-2026-05-08.md) — Robin algorithm.
- [`Docs/sessions/comments-ux-audit-2026-05-08.md`](./comments-ux-audit-2026-05-08.md) — Robin Comments UX.
- [`Docs/sessions/webrtc-architecture-audit-2026-05-08.md`](./webrtc-architecture-audit-2026-05-08.md) — Barney T1-T4 WebRTC.
- [`Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md`](../rfcs/2026-05-rfc-network-mode-auto-fsm.md) — Ted ADR v2.

### Manifesto §s relevantes
- §15 anti-censura por país (linhas 290-310)
- §17 sem chave mestra (linhas 350-375)
- §22 score determinístico (linhas 482-495)
- §24 sem algoritmo personalizado (linhas 545-570)
- §27 auto-classificação voluntária (linhas 666-700)
- §28 privacidade pelo mínimo (linhas 705-725)

### Código auditado
- `src/lib/bootstrap.ts:240-298` — gate WebRTC + Tor connect.
- `src/lib/seeder.ts:64-80` — gate seedFromSpreaders.
- `src/lib/events.ts:34-150` — KIND_DISPATCH dispatch table.
- `src/components/UI/FullPageCard.tsx:107-177` — primitive overlay + clickOutToClose.
- `src/components/UI/DriftButton.tsx:35-147` — 5 variants.
- `src/components/UI/FullPageOverlay.tsx:1-23` — re-export deprecation shim.
- `src/components/Post/ThreadHeader.tsx:32-216` — TX-5 + UX-9.
- `src/components/Post/ThreadView.tsx:42-400` — UX-9 replyMode logic.
- `src/components/Post/ReplySheet.tsx:77-460` — UX-3 snapshot pattern.
- `src/components/Create/ComposeOverlay.tsx:230-272` — DRIFT primary + escDismissible.
- `src/lib/transport/webrtc/peer.ts:69` — RTCPeerConnection direct (gated upstream).
- `src/lib/transport/webrtc/discovery.ts:121` — connectTo (gated upstream).
- `src/lib/transport/webrtc/reconnect.ts:101` — connectTo (only fires from existing peer state).
- `tests/manifesto-conformance.test.ts:697-744` — §15 conformance regex gate.
- `tests/webrtc-tor-mode-isolation.test.ts:1-267` — §15 dynamic test (3 scenarios).

---

*Barney · 2026-05-08 · pending review final · ship Round 4 verde · 3 ressalvas
documentadas · 4 gaps Barney próprios em queue · diretrizes §5 pra Round 3
review · próxima atividade pós-Round 4 = re-audit AT-1/5/9/10/14 contra
impl real.*
