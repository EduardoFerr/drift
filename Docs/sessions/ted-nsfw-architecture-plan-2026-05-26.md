# Ted — NSFW Scanner Opt-in Architecture Plan (2026-05-26)

> *"Padrão emerge quando N > 2. Aqui N = 1 — primeiro scanner opt-in
> da história do Drift. Por isso registramos precedente em CLAUDE.md
> ANTES do código existir: pra quando vier o segundo (face-detection?
> deepfake check?) ninguém precise re-deliberar §25 do zero."*  — Ted

**Persona:** Ted Mosby (arquitetura, padrões, camadas, abstrações).
**Escopo:** plano arquitetural **doc-only** de implementação do scanner
NSFW local opt-in (Opção A confirmada após deliberação 2026-05-23/26).
**Precedente registrado:** CLAUDE.md §"Tecnologias proibidas / decisões
já tomadas" — slippery-slope mitigation contra "contributor futuro
adiciona outro scanner sem reler manifesto".

---

## 1. TL;DR

**Arquitetura em 1 parágrafo:** dynamic-import lazy chunk em
`src/lib/optional-scanners/nsfw.ts` exportando `scanIfOptedIn(file:
File): Promise<{ label: 'nsfw'|'safe'; confidence: number } | null>` —
retorna `null` se `usePrefsStore().nsfw_scanner_optin === false`
(default), só faz `await import('nsfwjs')` quando opt-in ON; modelo
TensorFlow servido **same-origin** de `public/models/nsfw/` (NÃO CDN
Infinite Red); inferência 100% WebGL/WASM local; resultado vira
**sugestão UI** (HintChip "este modelo sugere: nsfw — concorda?")
que autor confirma manualmente pra acionar `ContentWarningRow.onChange('nsfw')`
no `ComposeOverlay`. Suggest-flow, NÃO tag automática. Pref serializada
em `user_prefs` (key/value, sem DDL migration).

**Manifesto compliance summary** (uma frase por §):
- **§7** determinismo preservado — `scanIfOptedIn` é caller-side; score
  do feed não muda.
- **§17** sem chave mestra — opt-in OFF default, escolha consciente,
  scanner local roda no device do user; nenhum operador externo decide
  o que passa.
- **§22** sem reputação — scanner não toca score, weight, threshold ou
  qualquer signal compartilhado entre users.
- **§24** sem afinidade no feed — output do scanner NUNCA persiste em
  SQLite, NUNCA escapa do device, NUNCA modifica ordem do feed.
- **§25** escape opt-in respeitado — exatamente o caso "plugin opt-in
  OFF-by-default" que §25 explicitamente tolera; cliente oficial padrão
  continua sem scanner ligado por default.
- **§27** auto-classificação reforçada — scanner SUGERE tag
  `content-warning`; autor decide; tag continua sendo declaração
  voluntária do autor (não inferência opaca).
- **§28** privacidade mínima — imagem NUNCA sai do device (canvas em
  memória → TF.js webgl/wasm → resultado in-process); zero network
  call por scan; SRI hash pin do modelo (defesa supply chain).
- **§32** compatibilidade — modelo + nsfwjs versionados via Drift
  releases; cliente alternativo pode escolher não embarcar; feature
  parity gap é aceitável conforme §25.
- **§3** identidade portável — scanner é state local-only
  (`user_prefs.nsfw_scanner_optin`); identidade Drift continua
  funcionando em cliente alternativo Drift sem scanner.
- **§4** dispositivo descartável — opt-in pref some no reset (correto
  — feature por device, não por identidade).

**Fases + estimativa:**
- **Spike** (2-3h) — validar isolation (zero network call por scan,
  postinstall scripts NULL, override model URL pra same-origin).
- **Impl** (4-6h) — 6 commits serial (schema → scanner → settings →
  compose wire → docs → tests).
- **Total ~1d trabalho real.**

---

## 2. Decisões já tomadas (NÃO re-deliberar)

Deliberação user 2026-05-23 → 2026-05-26 (registrada no BACKLOG.md
item "NSFW scanner opt-in via lazy load + same-origin model",
commit `8c950c0`). User releu §25 e concluiu: "nsfwjs é só uma dep
como qualquer outra que hospedamos — não precisa de plugin architecture
formal; default OFF + lazy load + feature flag + opt-in user = mesmo
efeito spirit-wise."

Fixas (não re-abrir sem dado novo):

- **Opção A confirmada** — lazy chunk no main repo (não worktree
  separado, não plugin registry formal, não cliente alternativo).
- **Same-origin model** — `.bin` ~3.5MB em `public/models/nsfw/`,
  servido pela mesma Vercel deploy do Drift. NÃO CDN `nsfwjs.com`
  (essa URL é o vetor §17/§28 que motivou a deliberação inteira).
- **SRI hash pin §32** — manifest `metadata.json` carrega hash do
  modelo; release Drift re-pinta se modelo trocar.
- **Suggest-tag flow** — scanner sugere; autor confirma; tag vira
  `content-warning` apenas pós-confirm. NUNCA tag automática (isso
  violaria §27 — auto-classificação deixa de ser voluntária).
- **Default OFF** — `nsfw_scanner_optin` é `false` no DEFAULT_USER_PREFS.
- **Settings toggle único** em `FiltersCard` (Conteúdo) — não enterrar
  em sub-card; user precisa achar voluntariamente quando quiser.
- **Slippery slope precedente** — CLAUDE.md ganha nota explícita: "se
  futuro contributor quiser adicionar SEGUNDO scanner (face detection,
  deepfake, etc.), abrir RFC e re-deliberar — não tratar precedente do
  NSFW como permissão genérica."

---

## 3. Mapa de componentes

| Arquivo | Status | Função | Linhas est. |
|---|---|---|---:|
| `src/lib/optional-scanners/nsfw.ts` | **novo** | `scanIfOptedIn(file): Promise<NsfwResult \| null>`; dynamic `import('nsfwjs')`; usa `usePrefsStore.getState().nsfw_scanner_optin` como gate; sobrescreve model URL pra `/models/nsfw/`; converte `File` → `HTMLImageElement` via `createImageBitmap` → `<canvas>`; throw-safe (retorna `null` em falha, NUNCA bloqueia compose) | ~80 |
| `src/lib/optional-scanners/types.ts` | **novo** | `type NsfwResult = { label: 'nsfw' \| 'safe'; confidence: number; threshold: number }` exportado pra ComposeOverlay consumir sem importar lazy chunk | ~15 |
| `public/models/nsfw/model.json` | **novo (static asset)** | TF.js model.json + shards `.bin` ~3.5MB; commit no repo (pode usar Git LFS se inflar release zip) + `metadata.json` com SRI hash sha384 dos shards | (asset) |
| `public/models/nsfw/README.md` | **novo** | Origem (Infinite Red `nsfwjs` v2.x), data do snapshot, comando pra regenerar hash, versão do modelo, links de auditoria; rastro pra release re-pin | ~30 |
| `src/types/drift.ts` | modificar | Adicionar `nsfw_scanner_optin: boolean` em `UserPrefs` + `false` em `DEFAULT_USER_PREFS` | ~3 |
| `src/lib/prefs.ts` | modificar | Adicionar case `'nsfw_scanner_optin'` no `applyRow` (boolean parse `value === '1'`); padrão idêntico aos toggles existentes (`show_nsfw_default`, etc.) | ~3 |
| `src/components/Settings/SettingsCards.tsx` | modificar | Em `FiltersCard` (já existe; cuida de NSFW/spoiler/ad), adicionar 4º `<SettingExplainer accordionId="filters-nsfw-scanner">` com `<Toggle value={prefs.nsfw_scanner_optin}>` + copy honesta sobre custo (3.5MB download, accuracy não-100%, sugestão e não bloqueio) | ~50 |
| `src/components/Create/ComposeOverlay.tsx` | modificar | Após `handleFile(file)` shipar upload OK, chamar `scanIfOptedIn(file)` em background (fire-and-forget Promise, NÃO bloqueia upload); resultado mostrado em novo `<HintChip>` acima do `ContentWarningRow` com `[adicionar tag]` action que chama `setContentWarning('nsfw')` + dismissable | ~70 |
| `src/components/Settings/GuideCard.tsx` | modificar | Acrescentar entry na seção "Privacidade & Conteúdo" explicando: "modelo NSFW opcional roda local; nada vai pra rede; modelo da Infinite Red v2.x SRI-pinned"; sync com `Docs/guia-do-usuario.md` (defer) | ~20 |
| `CLAUDE.md` | modificar | §"Tecnologias proibidas / decisões já tomadas" ganha bullet: "scanner NSFW opt-in (Infinite Red `nsfwjs` v2.x via lazy chunk + same-origin model) — escape §25 autorizado 2026-05-26; precedente NÃO genérico (segundo scanner exige RFC)" | ~10 |
| `package.json` | modificar | `nsfwjs` em `dependencies` (precisa estar disponível em runtime — `devDependencies` não vai parar no bundle prod); `@tensorflow/tfjs` como peer/transitive; lazy import no codebase garante chunk-split (Vite faz isso auto pra `import()` dinâmico). LOCK_VIA_TEST garante main chunk sem strings nsfwjs | ~2 |
| `vite.config.ts` | modificar (talvez) | Confirmar `build.rollupOptions.output.manualChunks` não force inline; default Vite já chunk-splita dynamic imports — provavelmente zero touch necessário | (zero) |

Total LoC novo: **~280** (excluindo static asset ~3.5MB + ~150 LoC de tests).

---

## 4. LOCK_VIA_TEST esperados (descrição, não código)

Quatro arquivos novos em `tests/` cobrindo as 4 invariantes adversariais
distintas. Padrão de assertion: source-grep + bundle-grep + schema check
(consistente com `no-scan-automatico-conformance.test.ts` e
`no-telemetry.test.ts` que já existem).

### 4.1 `tests/no-external-model-fetch.test.ts`

**Invariante:** bundle final produzido por `npm run build` NÃO contém
strings que indiquem fetch de modelo externo. Defesa contra Infinite
Red CDN leak (§17/§28).

**Asserções:**
- `dist/**/*.js` grep — proibido `nsfwjs.com`, `tensorflow.org`,
  `cdn.jsdelivr.net`, `unpkg.com` em qualquer chunk.
- Allow-list: nada (zero exceções para esses 4 domínios).
- Falha com mensagem clara: "modelo NSFW deve ser servido same-origin
  de /models/nsfw/ — string CDN externa indica regressão §17."

### 4.2 `tests/nsfw-scanner-isolation.test.ts`

**Invariante:** nsfwjs é lazy chunk (não bundle no main entry); package
sem postinstall scripts (supply chain §32).

**Asserções:**
- `package-lock.json` parse — `nsfwjs` package entry sem `scripts.postinstall`,
  sem `scripts.preinstall`, sem `scripts.install`. Mesmo check recursivo
  pra transitive deps (`@tensorflow/tfjs*`).
- Source grep — `src/**` só pode importar `nsfwjs` via `await import(...)`
  (regex `import\(['"]nsfwjs['"]\)`); proíbe `import ... from 'nsfwjs'`
  static.
- Bundle grep — `dist/assets/index-*.js` (entry chunk principal) NÃO
  contém string `'nsfwjs'`; deve aparecer apenas em chunk separado
  (`dist/assets/nsfw-*.js` ou similar — Vite nomeia por dynamic import).

### 4.3 `tests/nsfw-scanner-default-off.test.ts`

**Invariante:** opt-in default false; bootstrap NUNCA chama
`scanIfOptedIn` antes do toggle ser flipado pelo user.

**Asserções:**
- `src/types/drift.ts` — `DEFAULT_USER_PREFS.nsfw_scanner_optin === false`
  (parse AST ou source grep).
- `src/lib/optional-scanners/nsfw.ts` — primeira instrução executável
  do `scanIfOptedIn` deve ser checagem `if (!getPrefs().nsfw_scanner_optin)
  return null` ANTES de qualquer `await import('nsfwjs')` (grep+order
  check).
- `src/lib/bootstrap.ts` — NÃO importa `optional-scanners/nsfw` (boot
  zero-cost; chunk só carrega quando ComposeOverlay chama).
- `src/lib/sync.ts`, `src/lib/events.ts`, `src/lib/feed.ts` — mesma
  proibição: scanner NÃO toca pipeline de eventos (apenas compose UI).

### 4.4 `tests/nsfw-suggest-not-tag.test.ts`

**Invariante:** scanner sugere; tag só vira `content-warning` após
ação consciente do autor (§27 voluntário preservado).

**Asserções:**
- `src/lib/optional-scanners/nsfw.ts` — função `scanIfOptedIn` retorna
  `NsfwResult | null`; NÃO chama `setContentWarning`, NÃO modifica
  `drafts`, NÃO toca `ComposeDraft` (grep por `setContentWarning`,
  `setDrafts`, `updateCurrent` proibido neste arquivo).
- `src/components/Create/ComposeOverlay.tsx` — o handler que aplica
  `content-warning='nsfw'` em resposta ao scanner deve ser callback
  separado de `setContentWarning`, disparado por `onClick` de botão
  visível (grep estrutural: `onClick={() => setContentWarning('nsfw')}`
  deve aparecer num bloco que renderiza HintChip com label visível ao
  autor).
- Copy assertion — string user-facing deve conter "sugestão" / "concorda"
  / "adicionar" (verbo deliberativo); proíbe "detectado", "classificado",
  "marcado automaticamente".

---

## 5. Spike phase (2-3h) — validation ANTES de impl

Antes do primeiro commit, validar premissas. Spike-fail aborta plano;
spike-pass libera fase impl.

- [ ] **`npm view nsfwjs`** — confirmar versão atual (2.x), maintenance
  status (last publish < 12 meses ideal; >24 meses sinal vermelho),
  total dependents (deve ter >1000 — não package fantasma).
- [ ] **Install local + `npm ls nsfwjs`** — full tree. Listar TODAS as
  transitive deps. Cada uma vira candidata pra
  `tests/nsfw-scanner-isolation.test.ts` postinstall check.
- [ ] **Scan postinstall scripts** — `node -e "const p =
  require('./node_modules/nsfwjs/package.json'); console.log(p.scripts)"`
  + mesmo pra `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter`,
  `@tensorflow/tfjs-backend-webgl`. Spike-fail se qualquer um tem
  `postinstall` não-trivial (analytics opt-out exigiria fork).
- [ ] **Test scan local** — `npm run dev` + REPL script importando
  nsfwjs + sample image local (NSFW de teste + safe de teste); abrir
  DevTools Network tab DURANTE scan; **zero requests externos
  esperados**. Spike-fail se vir GET pra `nsfwjs.com` ou
  `storage.googleapis.com`.
- [ ] **Bundle size impact** — `npm run build` antes vs depois
  (com `nsfwjs` em deps + lazy import em arquivo dummy). Confirmar:
  (a) main entry chunk size **inalterado** (lazy import = chunk split);
  (b) novo chunk `nsfw-*.js` ~1-2MB JS (não 3.5MB — esse é o `.bin`
  model, asset separado). Spike-fail se main chunk ratchet quebra (≤
  250 KB hard ratchet existente).
- [ ] **TF.js telemetry grep** — `node_modules/@tensorflow/**/*.js` por
  strings `analytics`, `telemetry`, `gtag`, `metrics`, `'ping'`,
  `navigator.sendBeacon`, `fetch.*google-analytics`. Spike-fail se
  achar qualquer call site não-comentado (precedente Drift: hoje zero
  telemetria runtime — `tests/no-telemetry.test.ts` enforce).
- [ ] **Mobile 3G smoke** — DevTools throttle "Slow 3G" + simular
  primeira ativação do scanner (download chunk + model). Medir wall
  time até primeira inferência completa. Spike-fail se >60s (UX
  proibitivo; precisaria progress UI elaborada — fora do escopo da
  1d estimada).
- [ ] **Model URL override** — `nsfwjs.load(modelUrl)` aceita URL
  custom (default `https://nsfwjs.com/quant_mid/`). Confirmar API
  permite passar `/models/nsfw/`; spike-fail se hardcoded ou via flag
  buildtime que vaze CDN string no bundle final.

Spike output esperado: 1 paragraph em `Docs/sessions/ted-nsfw-spike-results-2026-05-XX.md`
(ou amend deste doc) confirmando ALL-CLEAR e liberando phase impl.

---

## 6. Impl phase (4-6h) — 6 commits planejados

Ordem serial — cada commit é review-able isolado, sem `--amend`. Tests
fecham na cauda (commit 6) intencionalmente: PR1-5 shipam feature
funcional; PR6 cristaliza invariantes.

| # | Commit subject | Files | LoC est. |
|:---:|---|---|---:|
| 1 | `feat(prefs): nsfw_scanner_optin pref (default OFF)` | `src/types/drift.ts` + `src/lib/prefs.ts` | ~6 |
| 2 | `feat(scanner): lazy chunk optional-scanners/nsfw.ts` | `src/lib/optional-scanners/nsfw.ts` + `src/lib/optional-scanners/types.ts` + `public/models/nsfw/{model.json,group1-shard*.bin,metadata.json,README.md}` + `package.json` | ~95 + asset |
| 3 | `feat(settings): toggle scanner NSFW local opt-in` | `src/components/Settings/SettingsCards.tsx` (FiltersCard +1 SettingExplainer) | ~50 |
| 4 | `feat(compose): suggest-tag flow no image upload` | `src/components/Create/ComposeOverlay.tsx` (HintChip pós-upload com action `[adicionar tag]`) | ~70 |
| 5 | `docs(guide): scanner NSFW + slippery-slope precedente` | `src/components/Settings/GuideCard.tsx` + `CLAUDE.md` | ~30 |
| 6 | `test(lock): 4 LOCK_VIA_TEST anti-regressão scanner NSFW` | `tests/no-external-model-fetch.test.ts` + `tests/nsfw-scanner-isolation.test.ts` + `tests/nsfw-scanner-default-off.test.ts` + `tests/nsfw-suggest-not-tag.test.ts` | ~150 |

**Push policy:** cada commit não-WIP push imediato (workflow_push_on_artefacts).
User valida em paralelo no Vercel preview enquanto impl segue.

**Rollback strategy:** se PR3 (settings toggle) shipar mas PR4 (compose
wire) der issue em testing manual, scanner fica disponível mas
desconectado — toggle ON não faz nada visível, mas NÃO quebra app
(scanner module nunca importado, chunk não baixa). Falha graciosa.

---

## 7. UX flow ASCII mockup

**Settings (entrada):**

```
┌─ FiltersCard ─ filtros de conteúdo ────────────┐
│ ▾ conteúdo adulto e violência                  │
│ ▸ spoilers de filme/livro/série                │
│ ▸ anúncios de divulgação                       │
│ ▸ scanner NSFW local (opcional)         ◯ OFF  │
│   ↳ modelo da Infinite Red roda no seu device. │
│     imagem nunca sai. ~3.5MB download na 1ª    │
│     ativação. sugestão e não bloqueio — você   │
│     decide se concorda.                        │
│     [referência: §25 + §27]                    │
└─────────────────────────────────────────────────┘
```

**ComposeOverlay (upload + scan):**

```
┌─ novo drift                  📍 OFF  CANCELAR ┐
├─────────────────────────────────────────────────┤
│ 🖼️ image.jpg (1.2MB) ✓                          │
│                                                  │
│ ⚙️ scanner local rodando…                       │
│    ↓ (2-4s)                                      │
│ 💡 modelo sugere: nsfw (confiança 0.91)         │
│    [adicionar tag] [ignorar] [✕ dispensar]      │
│                                                  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ content-warning: [ ] nsfw  [ ] violence ...     │  ← ContentWarningRow
│                                                  │
│ escreva o que vai derivar…                      │
│                                                  │
│ [◐ prévia]    [DRIFTAR ▲]                       │
└─────────────────────────────────────────────────┘
```

Estado quando opt-in OFF (default): segundo bloco (HintChip) **não
renderiza** — compose visualmente idêntico ao atual. Warning genérico
existente (linhas 536-544 do ComposeOverlay) continua funcionando como
fallback pra qualquer imagem sem content-warning.

---

## 8. Manifesto §-by-§ compliance

Justificativa curta por princípio relevante. Cross-ref com a deliberação
2026-05-23 (BACKLOG item) e a research base (Barney 2026-05-23).

- **§3 (Identidade portável):** OK. `nsfw_scanner_optin` é
  `user_prefs` local, não viaja com a identidade. Cliente alternativo
  Drift lê eventos públicos sem precisar do scanner; feature parity
  gap aceitável (§25 escape autorizado).
- **§4 (Dispositivo descartável):** OK. Pref some no reset; user
  re-ativa no novo device se quiser. Modelo `.bin` re-baixado
  one-time same-origin (mesmo deploy Vercel).
- **§7 (Determinismo):** OK. `calculateScore`, `calculateWeight`,
  `getMaxSubposts` intocados. `scanIfOptedIn` é caller-side em UI,
  não entra no pipeline `onNostrEvent → SQLite → invalidateFeed`.
- **§17 (Sem chave mestra):** OK por construção. (a) opt-in OFF
  default, (b) escolha explícita do user via SettingExplainer com
  copy honesta, (c) scanner local (zero operador externo), (d) modelo
  same-origin (não dá ao Infinite Red poder sobre o que o user vê),
  (e) suggest-flow preserva agência (user pode discordar). §25 v2.2
  explicitamente autoriza esse caso ("Plugin opt-in de scan ... pode
  existir, sempre OFF por default").
- **§22 (Sem reputação subjetiva):** OK. Scanner não afeta score,
  weight, threshold, ranking. Output é estritamente local + ephemeral
  (RAM do compose).
- **§24 (Sem afinidade no feed):** OK. Output do scanner NUNCA
  persiste, NUNCA escapa do device, NUNCA modifica ordem do feed.
  É view-layer puro do compose (visualização do autor sobre sua
  própria imagem antes de publicar).
- **§25 (Sem scan automático):** OK — este é literalmente o caso de
  escape autorizado. Manifesto §25 v2.2: *"Plugin opt-in de scan
  (PhotoDNA, classificador NSFW local, etc.) pode existir, sempre OFF
  por default, com consent explícito do user pra ligar e desligar a
  qualquer momento. Plugin não pode ser carregado sem ação do user;
  não pode ser imposto via auto-update ou config remota."* Validar
  cada cláusula no LOCK_VIA_TEST 4.3 (default-off) + 4.2 (lazy/no
  auto-load).
- **§27 (Auto-classificação voluntária):** **REFORÇADO**, não
  substituído. Scanner SUGERE; autor CONFIRMA; tag `content-warning`
  segue sendo declaração voluntária do autor. Critical: LOCK 4.4
  enforça suggest-not-tag — qualquer regressão pra "tag automática"
  derrubaria §27.
- **§28 (Privacidade mínima):** OK. Imagem em `<canvas>` em memória;
  TF.js webgl/wasm in-process; zero network call por scan; SRI hash
  pin do modelo (supply chain). Cross-ref §32.
- **§32 (Supply chain / compat clientes):** OK. SRI hash em
  `metadata.json` + release re-pin se modelo muda. Cliente alternativo
  pode não embarcar — feature parity gap aceitável conforme §25.

---

## 9. Riscos honestos

Sem soft-pedaling — registrar pra que futuras decisões não fingiam
surpresa.

1. **Infinite Red abandona projeto.** `nsfwjs` não tem maintainer
   garantido. Drift herda maintenance do modelo + dep. Mitigação:
   pin de versão + snapshot do modelo no repo + spike valida
   maintenance status. Pior caso: fork local quando precisar.
2. **Bundle 3.5MB chunk brutal mobile 3G.** Primeira ativação do
   toggle desencadeia download. UX precisa ser HONESTA — copy "~3.5MB
   download na 1ª ativação" no SettingExplainer evita surprise. Spike
   mede tempo wall-clock 3G real (gate de "vai a impl?").
3. **Model download falha pós-opt-in.** Cenário: user habilita,
   abre compose, scanner tenta `load()` mas asset 404 (cache stale,
   Vercel deploy mid-update). `scanIfOptedIn` retorna `null`
   silenciosamente; compose funciona normal sem sugestão. Fallback
   gracioso enforce no LOCK 4.4 (compose nunca bloqueia em erro do
   scanner).
4. **Cache stale após release Drift atualizar modelo.** Service
   worker pode segurar modelo antigo. Mitigação: hash no filename
   (`group1-shard1of1-{hash}.bin`) força cache bust em release. SRI
   `integrity` no fetch detecta mismatch e força re-download.
5. **Slippery slope — contributor adiciona SEGUNDO scanner.**
   Mitigação principal deste plano: nota em CLAUDE.md "precedente
   NÃO genérico, segundo scanner exige RFC + re-deliberação §25 do
   zero". Defesa em camada: code review verá pattern repetido em
   `optional-scanners/` e pergunta "isso seguiu o mesmo processo do
   NSFW?". Ted N=1 não vira padrão por inércia.
6. **False positives no scanner.** Modelo NSFW classifica obras de
   arte clássicas / amamentação / contexto médico como `nsfw`.
   Mitigação: suggest-flow (autor pode discordar). User decide com
   contexto que modelo não tem. NÃO tentar "fine-tune modelo Drift" —
   isso é categoria de problema diferente, fora do escopo §25 escape.
7. **Vercel deploy size bloat.** Adicionar 3.5MB em `public/models/`
   infla `dist.zip`. Mitigação: validar release pipeline (zip size
   sob limite GitHub Release ~2GB; trivial), mas comunicar no
   `CHANGELOG.md` "release size +3.5MB pra modelo NSFW opt-in".
   Considerar Git LFS se assets dispararem (defer — N=1 não
   justifica).
8. **Edge: user abre compose ANTES do modelo terminar de carregar.**
   `nsfwjs.load()` é async; primeira chamada após opt-in pode demorar
   2-15s. UX: HintChip mostra estado "⚙️ carregando modelo…" até
   resolver; suggest aparece quando pronto OU desaparece se user
   já enviou o post. Não bloqueia DRIFTAR.

---

## 10. Estimativa final + ordem + recomendação

**Spike total:** 2-3h (7 itens da seção 5; serial pois cada um pode
abortar plano).

**Impl total:** 4-6h (6 commits da seção 6).

**Total:** ~1d trabalho real (~8h conservador, mais provável 6-7h).

**Ordem recomendada:**
1. Spike completo → registrar resultado em doc (amend deste ou novo).
2. Se spike ALL-CLEAR → dispatch single agent (Lily ou Marshall) com
   este plano como input, 6 commits serial.
3. Após PR6 push → user smoke test no Vercel preview (cenários:
   default-off invisível, opt-in toggle UI, primeira inferência,
   suggest-flow, dismiss, ignore, "adicionar tag" path).
4. Se smoke OK → fechar BACKLOG item com 6 commit hashes anexos.

**Recomendação Ted (honest):** **dispatch implementation diretamente**
após spike. Plano é estável, decisões já tomadas, manifesto §25 escape
é unambíguo. Não há gain em mais deliberation. Risco residual #5
(slippery slope) está coberto pela nota CLAUDE.md — esse é o ponto
arquitetural mais importante deste plano e ele vive INDEPENDENTE da
implementação shipar (mesmo se NSFW for revertido depois, a nota
fica como rastro pra "tentamos isso, eis o trade-off").

**Sinal de NO-GO retroativo (rare):** se spike achar postinstall
script malicioso em `@tensorflow/tfjs*` OU TF.js fizer phone-home não
mitigável OR model URL não puder ser overridada → abandonar plano,
fechar BACKLOG item com "deferred Phase 6.5+ (precisa fork)", registrar
resultado do spike como evidência permanente.

---

## Cross-references

- `BACKLOG.md` — item "NSFW scanner opt-in via lazy load + same-origin
  model" (commit `8c950c0`).
- `Docs/sessions/barney-nsfw-npm-research-2026-05-23.md` — research
  base (22 packages avaliados; nsfwjs identificado como única opção
  funcional sob §25 escape).
- `Docs/manifesto.md` §17, §22, §24, §25 (v2.2 com escape opt-in),
  §27, §28, §32, §3, §4.
- `CLAUDE.md` — §"Invariantes" #7 (sem scan automático no oficial),
  §"Tecnologias proibidas / decisões já tomadas" (ganha entry após
  PR5).
- `tests/no-scan-automatico-conformance.test.ts` — existing test que
  enforça §25 no source; este plano NÃO removerá esse test (ele
  continua válido — o que muda é que `nsfwjs` é adicionado à
  allow-list explícita dentro dele, restrito a `src/lib/optional-scanners/`).

---

*Ted Mosby · 2026-05-26 · plano arquitetural doc-only · zero linha de
código tocada · próxima ação: user GO no spike OR dispatch direto pra
agent de impl com este doc como input*
