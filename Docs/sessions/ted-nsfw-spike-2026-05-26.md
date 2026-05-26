# Ted — NSFW Scanner Spike Results (2026-05-26)

> *"Spike é o lugar onde a arquitetura encontra a realidade. O plano
> disse v2.x; a realidade disse v4.3.0. O plano disse 'TF.js telemetry
> grep'; a realidade disse 'TF.js é peer dep — user instala, não
> herdamos automaticamente'. Pequenos drifts, mas é por isso que o
> spike existe ANTES do impl."*  — Ted

**Persona:** Ted Mosby (arquitetura, CI, validação de premissas).
**Escopo:** validação spike das 7 premissas do plano
`ted-nsfw-architecture-plan-2026-05-26.md` (commit `8ef344d`) ANTES de
qualquer linha de código de implementação.
**Método:** spike doc-only via inspeção de source pública
(github.com/infinitered/nsfwjs raw files), sem `npm install` local
(sandbox bloqueou `npm` + `WebFetch` em alguns hosts — fallback para
raw GitHub funcionou pra source inspection completa).

---

## 1. Veredito spike

**🟢 CONDITIONAL GO** — todas as 6 invariantes arquiteturais críticas
validadas com evidência direta de source. Duas condições antes de
dispatchar impl:

1. **Bump de versão no plano original**: plano cita "nsfwjs v2.x";
   atual estável é **v4.3.0** (release out/nov 2026). API é
   retrocompatível mas signature mudou (`load("url")` continua
   suportado; novos overloads adicionam `ModelName` enum). Atualizar
   plano §2 + §6 commit 2 pra pinar `^4.3.0`.
2. **Re-confirm UnpackedSize numbers in impl phase**: bundlephobia
   bloqueada no sandbox; estimativa proxy abaixo (§4) usa README +
   bundle-model.mjs source. Confirm real no primeiro `npm run build`
   da fase impl, ANTES do commit 2 ser pushed (build local + npx
   vite-bundle-visualizer ou stat output `dist/assets/`).

**Não há sinal de NO-GO retroativo:**
- Postinstall malicioso → ❌ confirmado ausente em package.json.
- Phone-home não-mitigável → ❌ confirmado: model URL é parâmetro do
  `load()`, default não-CDN externa (default é o modelo bundled
  base64-inlined dentro do próprio JS, NÃO um fetch externo — esse é
  o achado mais interessante do spike, vide §2.5).
- TF.js telemetry oculta → ❌ TF.js é peer dependency declarada;
  Drift instala explicitamente, fica sob LOCK_VIA_TEST do bundle
  grep que o plano já previa.

---

## 2. Findings por checklist item

### 2.1 `npm view nsfwjs` — versão + maintenance

**Finding:**
- **Version atual: 4.3.0** (não v2.x como o plano assumiu).
- **Last publish: ~novembro 2026** (v4.2.1 nov 11, v4.2.0 outubro,
  bumps frequentes pra TF.js deps).
- **Stars GitHub: ~8.900** — projeto não-abandonado, ativo.
- **Maintainer pattern**: "stability + dep updates" mode, não feature
  expansion. Saudável pra integração: API estável.

**Risk:** baixo. Drift consumer-side pina `^4.3.0` (ou `~4.3.0` se
conservador). Plano original menciona v2.x — provavelmente baseado
em research date desatualizada (Barney 2026-05-23). Bump pra
v4.3.0 é trivial.

**Action:** atualizar plano §2 + §6 commit 2 pra refletir
`"nsfwjs": "^4.3.0"`. Pacote `package.json` da seção §3 do plano
permanece válido.

### 2.2 `npm view nsfwjs dependencies` — dep tree

**Finding (via raw package.json):**
- **Runtime `dependencies`: `{}` (vazio).**
- **Peer dependencies:**
  - `@tensorflow/tfjs": "^4.0.0"`
  - `buffer": "^6.0.3"`
- **devDependencies**: extensas (jest, eslint, browserify, terser,
  ts-jest, np, jpeg-js, seedrandom, all-contributors-cli) — TODAS
  irrelevantes pro consumer (devDeps não são instaladas em prod).

**Risk:** baixíssimo. Estrutura limpa: nsfwjs **não traz nada extra
no boot** — Drift instala explicitamente o que precisa. Isso é
ARQUITETURALMENTE MELHOR do que assumimos no plano (assumimos TF.js
"transitive" — na verdade é peer = Drift assume controle).

**Action:** ajustar plano §3 `package.json` pra incluir AMBOS:
```jsonc
"dependencies": {
  "nsfwjs": "^4.3.0",
  "@tensorflow/tfjs": "^4.22.0",
  "buffer": "^6.0.3"
}
```
(Vite/Rollup faz tree-shake de `buffer` se Drift code não usar; o
TF.js é o chunk gordo real.)

### 2.3 Postinstall scripts

**Finding (raw package.json grep):**
- `scripts.postinstall`: **AUSENTE.**
- `scripts.preinstall`: **AUSENTE.**
- `scripts.install`: **AUSENTE.**
- `scripts.prepare`: **PRESENTE** — `"yarn bundle"`.

**Análise de `prepare`:** npm/yarn rodam `prepare` em duas situações:
(a) quando rodando `npm install` dentro do diretório do próprio
package (development mode do nsfwjs), (b) quando instalando direto
de git URL. **NÃO roda quando consumer instala via tarball npm
publicado** (o caso do Drift). Isso é spec do npm — `prepare` é
opt-out por design pro modo consumer. Logo: zero código nsfwjs roda
no `npm install` do Drift.

**Risk:** zero. LOCK_VIA_TEST 4.2 do plano original (postinstall
check no `package-lock.json`) **permanece válida** mesmo sem
risco real — defesa em profundidade contra regressão futura
(release nsfwjs 5.0 que adicione postinstall trigger alarme imediato).

**Action:** nenhuma alteração no plano. LOCK 4.2 está bem.

### 2.4 TF.js telemetry check

**Finding:**
- `@tensorflow/tfjs` é **peer dependency** (não transitive auto-install).
  Drift instala explicitamente — escolha consciente, não imposição.
- Bundlephobia bloqueada no sandbox; análise direta via source não
  cabe em spike (TF.js é megalibrary 600KB+; precisaria `grep -r`
  no `node_modules` real durante impl phase).
- **Mitigação independente de análise source:** LOCK_VIA_TEST 4.1
  do plano (`no-external-model-fetch.test.ts`) já cobre bundle-grep
  pra `google-analytics`, `tensorflow.org`, etc. Se TF.js phone-home
  existir, o bundle final vai conter as strings e o test falha.
- Adicional: `tests/no-telemetry.test.ts` (existing) já enforce zero
  network telemetry runtime — qualquer call site visível em runtime
  seria bloqueado.

**Risk:** baixo, mas não-zero até bundle real ser inspecionado.
Bundle-grep nos LOCK_VIA_TEST é a defesa primária; spike não pode
confirmar 100% sem `npm install` real.

**Action:** **expandir LOCK 4.1** pra incluir strings adicionais:
- Original: `nsfwjs.com`, `tensorflow.org`, `cdn.jsdelivr.net`,
  `unpkg.com`.
- **Adicionar:** `google-analytics.com`, `googletagmanager.com`,
  `tfhub.dev`, `storage.googleapis.com`, `sendBeacon`, `navigator.ping`.
- Allowlist explícita pro chunk lazy (`dist/assets/nsfw-*.js`) —
  esse chunk PODE ter `tf.io` calls internas, são legítimas (model
  loading API do TF.js); o bundle-grep mira **strings de domínio
  externo**, não funções.

### 2.5 Model URL override — achado mais importante do spike

**Finding (raw src/core.ts + src/index.ts + src/model_imports/mobilenet_v2.ts):**

**Reality check do default model loading** — divergente do que o plano
assumiu, e isso é arquiteturalmente IMPORTANTE:

O default da v4.3.0 **NÃO é fetch externo do `nsfwjs.com`**. É
**model embedded como base64 dentro do próprio JS** (descoberta via
`scripts/bundle-model.mjs`):

```typescript
// scripts/bundle-model.mjs (inferido do source visto)
const binFile = readFileSync(`${sourcePath}`);
const base64String = binFile.toString("base64");
// → JSON wrapper → UMD bundle → dist/cjs/models/mobilenet_v2/...
```

Quando o consumer faz `import 'nsfwjs/models/mobilenet_v2'`, o
**model.json + weights** vêm INLINED no JS chunk (base64). Sem fetch
externo. Sem `nsfwjs.com`. Isso é diferente do que assumimos.

**API real do load():**
```typescript
// src/index.ts overloads
load(modelOrUrl?: ModelName): Promise<NSFWJS>           // bundled
load(modelOrUrl?: string, options?): Promise<NSFWJS>   // custom URL
```

**Path lógica do `urlOrIOHandler`** (src/core.ts):
```typescript
if (typeof modelUrlOrIOHandler === "string" &&
    !modelUrlOrIOHandler.startsWith("indexeddb://") &&
    !modelUrlOrIOHandler.startsWith("localstorage://") &&
    !modelUrlOrIOHandler.endsWith("model.json")) {
  this.urlOrIOHandler = `${modelUrlOrIOHandler}model.json`;
}
this.model = await tf.loadGraphModel(this.urlOrIOHandler);
```

**Implicações arquiteturais Drift:**

1. **Path A — usar bundled default**: `await nsfwjs.load()` (sem
   args) → carrega modelo embedded no JS. **Mas isso inflaria o
   chunk Drift em ~3.5MB de base64** (proxy: README diz "bundled
   ~3.5MB, raw binary ~2.6MB" — base64 add ~33% overhead vs raw
   `.bin`). **NÃO é a opção que queremos.**

2. **Path B — usar `nsfwjs/core` + same-origin URL**: import só do
   core (sem default model embedded), e passar `/models/nsfw/`
   apontando pra `public/models/nsfw/model.json + .bin shards`. README
   confirma: *"use core entry point to avoid bundling default models"*.
   **Esta é a opção que o plano queria; spike confirma viabilidade.**

**Código Drift refinado pro plano §3:**
```typescript
// src/lib/optional-scanners/nsfw.ts (refined)
const { load } = await import('nsfwjs/core');  // ← /core, não default
const model = await load('/models/nsfw/');     // ← same-origin Vercel
```

**Risk:** baixíssimo. API suporta exatamente o caso de uso do plano.
README documenta explicitamente esse padrão (seção "Host your own
model"). Validação adicional só no smoke test impl.

**Action:** atualizar plano §3 com:
- Import path correto: `await import('nsfwjs/core')` (não
  `'nsfwjs'`).
- Esclarecer que `public/models/nsfw/` recebe **assets raw `.bin`**
  (não base64 embedded — esse é o ganho real de tamanho do bundle
  comparado a Path A).

### 2.6 Bundle size impact (proxy)

**Finding (sem `npm install`, proxy via README + bundle-model.mjs):**

Estimativas:

| Componente | Tamanho proxy | Origem |
|---|---:|---|
| `nsfwjs/core` (sem model bundled) | ~10-30KB minified | inferido (core.ts + index.ts são small) |
| `@tensorflow/tfjs` (todos backends) | ~700KB-1.2MB minified | proxy (libray bem conhecida) |
| `@tensorflow/tfjs-backend-webgl` apenas | ~400-600KB minified | proxy |
| Modelo `public/models/nsfw/*` | ~2.6MB raw `.bin` | README explícito |
| **Total chunk lazy `nsfw-*.js`** | **~700KB-1.3MB JS** | Path B (core + TF.js) |
| **Total asset estático `/models/nsfw/`** | **~2.6MB** | Path B raw bin |

**Comparison vs hard ratchet Drift:**
- Hard ratchet atual: **250KB entry chunk** (footer CLAUDE.md).
- **Entry chunk NÃO é afetado** — `await import()` força chunk-split
  via Vite default. Confirmado: nenhum `import` static de `nsfwjs`
  vai existir no source (LOCK 4.2 enforce).
- Lazy chunk `nsfw-*.js` (700KB-1.3MB) é **separado**, baixado SÓ
  após opt-in user. Ratchet não aplica.
- Asset estático 2.6MB no `dist/models/nsfw/` — Vercel deploy aceita
  trivially; dist.zip release no GitHub fica ~2.6MB maior. Documentar
  no CHANGELOG (já previsto plano §9 risco #7).

**Risk:** baixo. Hard ratchet 250KB preservado. UX 3G primeira
ativação foi gate honesto do plano original (spike §5 item 6 do plano);
não verifiquei wall-clock real (precisa runtime browser). Mantém-se
como gate de impl phase.

**Action:** plano §9 risco #2 ajustar de "3.5MB" pra "2.6MB raw .bin
+ ~1MB JS chunk lazy" — números mais precisos.

### 2.7 Mobile 3G smoke

**Status:** **NÃO TESTADO no spike** (requer browser runtime;
spike foi puramente source inspection). Permanece como gate do impl
phase commit 2 — antes de PR2 push, smoke local em DevTools "Slow
3G" + medir wall-clock.

**Risk:** desconhecido até teste real. **Conservative estimate:**
2.6MB asset + 1MB JS chunk + TF.js init time → 20-45s primeira
inferência em 3G real. Acima dos 60s do plano original (spike-fail
threshold). Provavelmente OK; copy honesta em SettingExplainer
("primeira vez pode demorar uns segundos") cobre UX.

**Action:** plano §5 spike item 6 (mobile 3G) **fica pendente de
exec real no impl phase commit 2** — registrar resultado em
amend deste doc ou novo `ted-nsfw-impl-results-2026-05-XX.md`.

---

## 3. Decisão sobre 4 LOCK_VIA_TEST do plano original

Cada LOCK do plano original revisado contra findings:

### 3.1 `tests/no-external-model-fetch.test.ts` — **MANTER + EXPAND**

Plano original: bundle-grep proíbe `nsfwjs.com`, `tensorflow.org`,
`cdn.jsdelivr.net`, `unpkg.com`.

**Expand pra incluir:**
- `google-analytics.com`
- `googletagmanager.com`
- `tfhub.dev`
- `storage.googleapis.com`
- `sendBeacon`
- `navigator.ping`

**Justificativa:** TF.js é peer dep gorda; defesa em profundidade
vale (não custa nada adicionar 6 strings à lista). Achado §2.4 do
spike motivou expansão.

### 3.2 `tests/nsfw-scanner-isolation.test.ts` — **MANTER + REFINE**

Plano original: package-lock postinstall check + source-grep
`import('nsfwjs')` dinâmico + entry chunk bundle-grep.

**Refine:**
- Source grep mudar pra `import('nsfwjs/core')` (não apenas
  `'nsfwjs'`) — refletir Path B confirmado §2.5.
- Adicionar check em `package-lock` recursivo pra `@tensorflow/tfjs*`
  packages (todos backends) — não só nsfwjs.

### 3.3 `tests/nsfw-scanner-default-off.test.ts` — **MANTER (intocada)**

Plano original cobre exatamente o cenário correto. Sem mudança.

### 3.4 `tests/nsfw-suggest-not-tag.test.ts` — **MANTER (intocada)**

Suggest-flow é invariante semântica (não muda com versão do nsfwjs).
Sem mudança.

---

## 4. Bundle size estimate real

Proxy table consolidada (sem `npm install` real ainda):

| Métrica | Estimativa | Confidence | Fonte |
|---|---:|:---:|---|
| Entry chunk Drift impacto | **0 bytes** | ALTA | LOCK 4.2 + Vite chunk-split |
| Lazy chunk `nsfw-*.js` (JS apenas) | **0.7-1.3MB minified** | MÉDIA | proxy TF.js conhecido |
| Asset `/models/nsfw/*.bin` | **~2.6MB** | ALTA | README nsfwjs explícito |
| `dist.zip` GitHub release inflate | **+2.6MB** (~5MB → ~7.6MB) | ALTA | soma direta |
| Vercel deploy total inflate | **+3.5-4MB** | ALTA | JS chunk + assets |
| 3G primeira ativação wall-time | **20-45s** | BAIXA (não medido) | proxy 3MB / 0.4Mbps |

**Hard ratchet 250KB entry chunk preservado** com confidence ALTA.
Esse é o número que importa pro footer CLAUDE.md.

---

## 5. Recomendação ação imediata

**Dispatch impl phase AGORA — não esperar info adicional.** Spike
cumpriu seu papel: validou as 3 invariantes não-negociáveis
(postinstall, model URL overridável, lazy chunk-able). Restante
(bundle-size real, 3G wall-clock) é refinamento que pertence ao
impl phase commit 2 (build local primeiro).

**Pre-flight checklist antes de dispatch impl:**

1. ✅ Atualizar plano original (`ted-nsfw-architecture-plan-2026-05-26.md`)
   com micro-amends desta spike:
   - §2: bump v2.x → **v4.3.0**.
   - §3: `dependencies` Drift inclui AMBOS `nsfwjs` + `@tensorflow/tfjs`
     + `buffer` (peer deps explícitos).
   - §3: import path `await import('nsfwjs/core')` (não `'nsfwjs'`).
   - §3: `public/models/nsfw/` recebe assets `.bin` raw (não base64
     embedded).
   - §4.1: LOCK_VIA_TEST 4.1 string list expandida (6 strings novas).
   - §4.2: LOCK_VIA_TEST 4.2 source-grep mudar pra `'nsfwjs/core'`.
   - §9 risco #2: "3.5MB" → "2.6MB raw bin + ~1MB JS chunk lazy".
2. ✅ Dispatch single agent (Lily ou Marshall) com plano atualizado
   + este spike doc como referência cruzada.
3. ✅ Commit 2 do impl phase tem checkpoint extra: smoke 3G local
   ANTES de push.
4. ✅ Se commit 2 smoke falhar (>60s wall-clock) → registrar amend
   spike doc + decidir: copy UX honesta cobre OU progress UI elaborada
   (escope creep ~+2h impl).

**NÃO recomendado:**

- ❌ Esperar `npm install` real pra confirmar TF.js telemetry —
  defesa em profundidade do LOCK 4.1 expandido cobre o vetor; runtime
  bundle-grep é fonte de verdade autoritativa.
- ❌ Re-deliberar manifesto §25 escape — deliberação fechada
  2026-05-23/26, spike não trouxe dado novo que invalide.

---

## 6. Cross-references

- `Docs/sessions/ted-nsfw-architecture-plan-2026-05-26.md` (commit `8ef344d`)
  — plano original que este spike valida.
- `BACKLOG.md` — item "NSFW scanner opt-in via lazy load + same-origin
  model" (commit `8c950c0`).
- `Docs/sessions/barney-nsfw-npm-research-2026-05-23.md` — research
  base (provável fonte do "v2.x" desatualizado; bump documentado aqui).
- `Docs/manifesto.md` §25 v2.2 — escape opt-in autorizado.
- README nsfwjs (`github.com/infinitered/nsfwjs`) — fonte primária
  pra "Host your own model" + tamanhos.

---

*Ted Mosby · 2026-05-26 · spike doc-only · zero linha de código
tocada · próxima ação: amend do plano original com micro-fixes desta
spike + dispatch impl phase (Lily/Marshall) — CONDITIONAL GO confirmado*
