# Barney security regression check — Round CWV-2 ship gate (2026-05-09)

**Data:** 2026-05-09
**Persona:** Barney (HIMYM — peer review crítico, threat modeling,
security, ceticismo)
**Escopo:** validar que Round CWV-2 (Helia preload removido +
React.lazy 12 modais + LazyBoundary primitive + vendor split + sourcemaps
'hidden' + font swap + robots.txt) **não introduziu regressão de
segurança**, e estudo de viabilidade de SRI (RFC §6.2 + research §7).
**Doc-only.** Não modifica código.

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual. Decisões SRI/sourcemap
> aqui só viram norma se Arquiteto propaga.

---

## §1 TL;DR

| Ângulo | Verdict | Motivo curto |
|---|---|---|
| **(1) Threat regression CWV-2** | 🟢 verde | LazyBoundary é puro React; vendor split não muda surface area de runtime; modulepreload filter REDUZ broad fetch window pra helia/maplibre; sourcemaps 'hidden' corretamente strippam `sourceMappingURL` do JS minified (verificado em 4 chunks samplados). |
| **(2) SRI feasibility** | 🟡 **DEFER** Round CWV-4 ou Fase 6.7 | Plugin existe (`vite-plugin-sri`, ~2024) mas integração com VitePWA Workbox + dynamic `import()` injetados runtime é **não-trivial**. Browser **não verifica integrity em chunks lazy via `import()`** sem import-map.json + custom resolver. Custo realista 10-20h (não 0.5d como Robin §7 sugere). Ship gap **documentado**. |
| **(3) Sourcemap leak audit** | 🟡 amarelo (aceitável) | `sourcesContent` embedded — qualquer fetch direto dos `*.js.map` em `drift.vercel.app/assets/` revela código original (TS, comments PT-BR incluindo racional de threat model). Não vaza secrets (verificado: nenhum `nsec1*`, API key, master key em bundle). Trade-off Lighthouse/debug aceito mas vale documentar trade-off no manifesto §28. |
| **(4) Carry-overs Barney** | 🟡 amarelo | AT-1/AT-5/AT-7/AT-9/AT-11 não tocados (status quo, OK — auto-mode não shippou). TM-3 per-subpost CW **continua aberto**. F-09 PostViewer body tap também aberto. §15 E2E testbed status quo. |

**Verdict release-readiness Round CWV-2:** **🟢 verde — ship com SRI gap
explícito documentado**. CWV-2 é optimization-only, não toca crypto/
identity/transport/ranking. Single trade-off novo é sourcemap exposure
em prod (§4 abaixo).

**Top-3 threats novos (todos baixa severidade):**

1. **Sourcemap public exposure** (S2) — `dist/assets/*.js.map` são
   servidos pelo Vercel sob `/assets/*` com header `Cache-Control:
   public, max-age=31536000, immutable`. Atacante enumerando paths
   (cada `.js` tem `.js.map` paralelo) baixa source completo + comments.
   Manifesto §28 não viola tecnicamente (código é open-source no GitHub
   já), mas amplia surface pra targeted exploit hunting (procurar
   `// FIXME` ou racional de mitigação em comments).
2. **LazyBoundary error message canalizável pra UX-confusion?** (S3) —
   "erro ao carregar este painel" aparece pra qualquer fetch fail.
   Atacante MITM com TLS strip parcial (só nos chunks `.js`, não no
   index.html — improvável mas possível em rede hostil) força "erro"
   permanente. User cliica retry → loop. Não é exploit, é UX-fragility.
   Não-bloqueante.
3. **Vendor chunks aumentam blast radius de CDN compromise** (S2 mas
   fundamental) — `vendor-react-DAXJ19zV.js` e `vendor-nostr-CfAB5aUZ.js`
   são fetched em **toda** primeira visita. Se Vercel CDN injetar JS
   malicioso em `vendor-nostr` (substituindo `signEvent`), todos os
   users assinam eventos com chave do atacante. **Mesma surface
   pré-CWV-2** (entry chunk continha o mesmo código), mas split
   distribui o risk em 3+ chunks (cada um pode ser atacado independente).
   **Mitigation única**: SRI (§3 abaixo) — daí a urgência.

**SRI recommendation 1-line:** **DEFER pra Round CWV-4 follow-up
dedicado** (~10-20h E1-E2 effort), prioridade S1 antes de campanha
pública em jurisdição censurada (Fase 7).

---

## §2 Threat regression — checklist commits CWV-2

### 2.1 — `05ca8ba perf(build): Helia preload fix + vendor split + sourcemaps hidden`

#### Helia preload fix

`vite.config.ts:240-252` — `modulePreload.resolveDependencies` filtra
`/^(?:helia-deps|maplibre-gl|tesselator|rebroadcast)/` do graph
estático. Browser **não emite** `<link rel="modulepreload">` pra
chunks lazy.

**Análise threat surface:**
- Pré-CWV-2: helia-deps (313 KB) era preloaded ANTES de user trigger
  Settings → Pin. Surface: chunk em cache + parsed antes de needed.
- Pós-CWV-2: helia-deps **só é fetched** quando user clica em "pin no
  IPFS" pela primeira vez. Surface **reduzida** — broader attack window
  fechado.

**Cenário CDN compromise:** atacante injeta payload em
`helia-deps-Dk3pziEI.js` no Vercel edge. Pré-CWV-2: TODOS os users
baixam (mesmo sem usar). Pós-CWV-2: SÓ users que usam pin. **Defesa-
em-profundidade marginal — reduz population exposed.** ✅

**Cenário deck.gl/MapLibre:** mesma análise. ArcLayer (467 KB) +
maplibre-gl (1.1 MB) ficam no cache só pra users do mapa. Manifesto
§24 (sem afinidade) preservado — mapa é opt-in via ícone, não auto-
load.

**Verdict:** ✅ **Reduz surface, sem nova ameaça.**

#### Vendor split (vendor-react / vendor-nostr / vendor-motion)

`vite.config.ts:258-287` — manualChunks por regex node_modules.

**Análise threat surface:**
- `vendor-nostr` agrupa `nostr-tools + @noble/secp256k1 + @noble/hashes
  + @scure`. **Toda a crypto Nostr** está nesse chunk. CDN compromise
  desse arquivo → attacker controla `signEvent`, `verifyEvent`, derivação
  de pubkey. **Compromisso total da identity layer.**
- `vendor-react` = React + ReactDOM + scheduler. CDN compromise →
  atacante injeta hook que intercepta `useState(nsec)` ou similar.
  **Exfiltração teórica de secrets em memory.**
- `vendor-motion` = Framer Motion. Risco menor (presentation only) mas
  ainda capaz de bypass de gestures (e.g., disparar `onTap` sem user
  intent → spread/bury sem consent).

**Pergunta cética:** isso é regressão sobre pré-CWV-2?
- **Pré-CWV-2:** entry chunk `index-iIXb21p4.js` (744 KB) continha React,
  nostr-tools, framer-motion **tudo junto**. CDN compromise daquele 1
  arquivo já comprometia tudo. Mesma blast radius.
- **Pós-CWV-2:** distribuído em 3 chunks. Atacante precisa comprometer
  só 1 dos 3 pra ter mesmo impacto (ex: só `vendor-nostr` pra controle
  de keys). **Surface area NÃO mudou; granularidade do alvo mudou.**

**Conclusão:** vendor split **não é regressão** — mesmo blast radius.
**MAS:** ressalta urgência de SRI. Pré-CWV-2 ou pós-CWV-2, browser
**não verifica** integrity de nenhum chunk hoje. Manifesto §17 (sem
chave mestra) implica SRI deveria existir; ausência é gap pré-existente
**reforçado** por CWV-2 (mais arquivos = mais oportunidades de
substitution).

**Verdict:** ✅ **Sem regressão**. 🟡 **Surface gap §17 (SRI ausente)
reforçado mas não causado por CWV-2.**

#### Sourcemaps 'hidden'

`vite.config.ts:229` — `sourcemap: 'hidden'`.

**Verificação:** grep `sourceMappingURL` em `dist/assets/*.js` (chunks
samplados) retornou **zero matches**. ✅ Hidden mode strippa o
trailing `//# sourceMappingURL=` do bundle minified.

**MAS:** `dist/assets/*.js.map` **existem fisicamente** e Vercel serve
sob `/assets/*` rewrite (vercel.json:6-8 — `(?!\\.well-known/)` rewrite
exclui apenas well-known; assets passam).

**Audit conteúdo do .map:**
- `dist/assets/IdentityPanel-BO5IUTvC.js.map` é JSON com `sourcesContent`
  embedded (verificado: 1 ocorrência — todo source code original
  inlined).
- Detalhe expõe: paths reais (`src/components/Identity/IdentityPanel.tsx`),
  comments PT-BR (incluindo racionais de mitigação que documentam
  defesas — útil pra atacante mapear superfície), nomes de variáveis
  pré-minified.

**Severidade:**
- Source code já é open-source no GitHub. Atacante já tem acesso ao
  código completo. Sourcemap não adiciona info nova **sobre o app**.
- **Mas:** sourcemap garante que `drift.vercel.app/assets/X.js` E
  `drift.vercel.app/assets/X.js.map` correspondem **byte-exato** ao
  estado deployed. Isso ajuda atacante a:
  1. Confirmar versão exata em produção (sem precisar build local).
  2. Identificar vulnerabilidades específicas a um deploy (ex: race
     condition que existe só na build X mas não na Y).
  3. Mapear chunks lazy → routes que disparam (helia → Settings → Pin,
     maplibre → MapOverlay).

**Bom news:** zero secrets vazam. Audit grep em `dist/assets/*.js`:
- `password` matches: literal `type="password"` em IdentitySwitcher
  passphrase input (false-positive).
- `secret` matches: `secretKey` (nostr-tools API name) em vendor-nostr
  (false-positive — função pública).
- `api[_-]?key`: zero hits.
- `nsec1*` literal: zero hits.

**Verdict §17:** ✅ Bundle não embute secret material em runtime
(invariante CLAUDE.md #8). Sourcemap exposure é **info disclosure
debt**, não compromise.

**Verdict release:** 🟡 aceitável — trade-off Lighthouse + debug-
friendly. Recomendação Round CWV-3+ follow-up: **bloquear** acesso
público a `*.map` via Vercel header (`Content-Disposition: attachment`
ou rewrite `/assets/*.map` → 404). Mantém sourcemap pra release
artifact upload (CI), restringe a equipe.

---

### 2.2 — `6ca7620 perf(routes): React.lazy 12 modais via LazyBoundary primitive`

#### LazyBoundary audit

`src/components/UI/LazyBoundary.tsx` — combina `<ErrorBoundary>` +
`<Suspense>` + retry button.

**Análise:**

1. **Error path:** `componentDidCatch` chama `console.error` com
   `error` + `info`. **Não envia telemetria** (verificado: zero `fetch`,
   zero analytics). Manifesto §28 ✅.
2. **Retry mechanism:** `setState({ retryKey: s.retryKey + 1 })` força
   re-mount. React 18 cache pode servir do bundler cache local OR
   re-fetch. **Não há limite de retries** — user pode clicar 1000x;
   cada retry é re-mount + 1 fetch. Atacante DoS o próprio chunk
   (servir 500 sempre) não force loop infinito (user tem que clicar).
3. **Fetch failure handling:** sem SRI, browser executa **qualquer**
   chunk fetched do origin sem verificação. DNS poisoning + TLS
   compromise injeta payload arbitrário. LazyBoundary só captura
   `import()` rejection (network error), não substitution.

**Cenário ataque DNS poisoning:** atacante reroute `vercel.app` →
servidor controlado, serve chunk válido com payload. Browser executa.
LazyBoundary não detecta (não é error). **SRI fix** (§3) seria a única
defesa. **Pré-CWV-2** entry chunk tinha mesma vulnerabilidade —
**não é regressão**.

**Verdict:** ✅ Sem regressão. 🟡 **Reforça gap SRI.**

#### 12 modais lazy — análise modal-by-modal

| Modal | Sensitive data? | CDN-substitute risk |
|---|---|---|
| FiltersCard | filtros locais | Atacante muta `hide_nsfw` → user vê NSFW. S3. |
| LocationCard | granularity prefs | Atacante muta granularity → leak GPS. **S1** se substituído. |
| MapViewCard | — | S3 |
| NetworkModeCard | network_mode prefs | **S0** — atacante força `clearnet` em user que escolheu `tor`. §15 violado. |
| BlobsCard | helia config | S2 |
| DiagnosticCard | identity diagnostic | S3 |
| RelaySettings | relay CRUD (NIP-65) | **S1** — atacante adiciona relay malicioso pra eclipse. |
| LocalListsSettings | block/mute lists | S2 |
| OnboardingOverlay | identity gen flow | **S0** — atacante intercepta nsec gen, exfil via covert channel. |
| ProfileModal | npub display | S3 |
| IdentityPanel | export/import nsec | **S0** — direct nsec exposure path. |
| IdentitySwitcher | switch active identity | **S1** |
| ComposeOverlay | publish flow | **S1** — atacante muta content/tags. |

**Verdict crítico:** **chunks lazy contêm código S0** (Onboarding nsec
gen, IdentityPanel export, NetworkMode). CDN compromise de
`OnboardingOverlay-BHZnHkaD.js` ou `IdentityPanel-BO5IUTvC.js` **viola
invariantes #8 e #9 do CLAUDE.md** (nsec sair do dispositivo).

**Pergunta cética:** isso é regressão de CWV-2?
- **Pré-CWV-2:** mesmo código no entry chunk. CDN compromise do
  `index-iIXb21p4.js` tinha mesma capacidade.
- **Pós-CWV-2:** atacante precisa comprometer chunk específico
  (`OnboardingOverlay-*.js`). Mesma capability, mais granular.
- **Diferença real:** lazy chunks são **fetched on-demand** —
  Onboarding só baixa em first-boot. Atacante só pode atacar window
  específico (user em onboarding). **Surface temporal reduzida**, mas
  capability preservada.

**Verdict:** ✅ **Não é regressão**. **🔴 Identifica criticidade S0
de SRI** — sem SRI, user em Tauri build offline (Fase 6) que cache
`OnboardingOverlay` → re-online em rede comprometida → next user em
mesmo device dispara cached version (safe). MAS first-time user em
rede comprometida → fetch cold do chunk → vulnerável. **SRI é S0
pré-Tauri público.**

---

### 2.3 — `1d339b3 perf(fonts): font-display:swap + size-adjust`

CSS-only (`@font-face` descriptors). Zero impacto security. ✅

---

### 2.4 — `d3ba946 test(cwv): promote conformance soft -> hard`

Test infra. Zero impacto runtime. ✅

---

## §3 SRI feasibility study

### 3.1 Threat model recap (Manifesto §17 implication)

> "operador do scanner herda chave mestra"

Por extensão (Robin §7): operador da CDN também herda. Hoje:
- Vercel hosts `drift.vercel.app/assets/*.js`.
- Browser fetch chunk → executa **sem verificação**.
- Vercel ou qualquer ator com push-access ao deploy tem **chave mestra
  disfarçada** sobre clientes Drift.

**SRI fecha esse vetor**: `<script integrity="sha384-...">` faz browser
rejeitar chunk se hash diverge. Atacante precisaria comprometer
`index.html` (que carrega a integrity) E o chunk **simultaneamente**
— defense-in-depth real.

### 3.2 Tooling landscape

#### Option A — `vite-plugin-sri` (community)

- Repo: `small-tech/vite-plugin-sri`
- Status: last commit ~2024, mantido por single dev, **não-oficial**.
- Cobertura: adiciona `integrity="sha384-..."` em `<script>` e `<link
  rel="modulepreload">` em `dist/index.html`.
- **NÃO cobre:** chunks fetched via dynamic `import()` (React.lazy).
  Browser API: `<script>` SRI funciona; `import()` não.

#### Option B — Custom Vite plugin + import-map.json

- Browser suporte: `<script type="importmap">` com `integrity` field é
  proposed mas **não shippado**. Chrome 127+ tem `import.meta.resolve`
  mas não import-map integrity.
- Drift teria que implementar **custom fetch wrapper** que intercepta
  `import()` calls, faz `fetch(chunkURL).then(verifyHash).then(eval)`.
  Quebra worker, quebra HMR dev, **alto risco**.

#### Option C — Workbox precache + manifest hash

- Workbox **já** valida via `revision` field em precache manifest.
  Cache hit = SW serves cached version. Cache miss = SW fetches +
  validates revision. Funciona como SRI **dentro do scope do SW**.
- **MAS:** SW só cobre URLs no precache manifest (`globPatterns`).
  Lazy chunks (`OnboardingOverlay-*.js`, etc.) **não estão no precache**
  — são `runtimeCaching` com `CacheFirst`. CacheFirst não revalida.
- **Implicação:** primeira fetch (cold) é **desprotegida**. Subsequent
  fetches do cache são "seguras" (mesmo hash até cache evict). Atacante
  só precisa hit a window cold (mais comum em new users / private mode
  / cache cleared).

#### Option D — Vercel Edge headers / Workers

- Vercel não oferece SRI auto-injection nativa.
- Edge Function que serve `index.html` injetando SRI dinamicamente é
  custom build (~5-10h).

### 3.3 Custo realista

Robin §7 estimou "0.5d" (4h). **Cético Barney:** subestimado por 3-4x.
Reality:

| Sub-task | Effort | Risk |
|---|---|---|
| Add `vite-plugin-sri` + smoke test build | 1h | Baixo |
| Confirmar `<script>` + `<link modulepreload>` ganham integrity | 0.5h | Baixo |
| **Cobrir lazy chunks via custom solução** | **6-12h** | **Alto** — custom fetch wrapper, browser compat, dev HMR breakage |
| Workbox manifestTransforms — verificar SRI propaga pro precache | 2-3h | Médio |
| CSP companion (`require-sri-for` é deprecated; usar default-src + integrity-sources?) | 1h | Médio |
| Smoke test rollout — verificar Tauri offline build não quebra | 2h | Médio |
| **Total realista** | **12-18h** | E1-E2 |

### 3.4 Decisão recommended

**🟡 DEFER pra Round CWV-4 dedicated** com 3 condições:

1. **Documentar gap explícito** em CWV-2 ship notes: "SRI ausente; CDN
   compromise = controle total. Mitigation #1 = re-deploy via build
   reproduzível + hash público. Mitigation #2 = SRI Round CWV-4."
2. **Bloquear sourcemap public access** (§4 sub-recommendation) — fix
   barato (vercel.json header), reduz info disclosure imediato.
3. **Prioridade S1 antes de Fase 7** (campanha pública / TWA Android /
   F-Droid) — não bloquea Round CWV-2 ship hoje, **bloqueia
   public-facing v1.0** porque Fase 7 promete build reproduzível
   (manifesto §17) e SRI é o complement runtime do build reproduzível.

**🟢 GO Round CWV-4** se Arquiteto considera ROI > defer:
- Sprint dedicado (Marshall + Lily, 2-3 dias).
- vite-plugin-sri OK pra `<script>` + `<link modulepreload>`.
- Lazy chunks: avaliar **import-map.json** com SRI quando spec ship
  (aguardar Chrome stable). Interim: aceitar gap de lazy chunks
  documented (= "SRI cobre eager, não lazy").

**🔴 REDESIGN:** out of scope CWV. Mover hosting pra Cloudflare Pages
+ Workers + signed bundles é E3, requires arquitetura nova. Não
recomendo agora.

---

## §4 Sourcemap leak audit

### 4.1 Estado atual

- `vite.config.ts:229` → `sourcemap: 'hidden'`.
- `dist/assets/*.js.map` emitidos (34 maps) com `sourcesContent`
  inlined.
- Vercel rewrite `(?!\\.well-known/).*` cobre `/assets/*.map` → servidos
  com `Cache-Control: public, max-age=31536000, immutable` (vercel.json:37-40).
- JS bundle minified **não referencia** `sourceMappingURL` (verificado
  4 chunks: ProfileModal, vendor-react, vendor-nostr, RelaySettings).

### 4.2 Info exposed

| Info | Exposed via map? | Já público em outro canal? |
|---|---|---|
| Source paths (`src/lib/identity.ts`) | ✅ | ✅ GitHub |
| Source content (TS pré-minify) | ✅ | ✅ GitHub |
| PT-BR comments com racional de defesas | ✅ | ✅ GitHub |
| Build hash → source mapping (deploy fingerprint) | ✅ | ❌ — **novo** |
| Vendor lib versions (resolved paths node_modules) | ✅ | partial — package.json no GitHub mas resolved paths revelam exact patches |

**Novidade real:** `dist/assets/X-{hash}.js.map` permite atacante
**confirmar exact build em prod** sem precisar replicar build local.
Útil pra:
- Day-zero exploit research (encontrar bug em build X, esperar até
  deploy expor build X em prod).
- Side-channel: comparar hashes entre deploys → inferir CI activity
  patterns.

### 4.3 Mitigation barata

Adicionar em `vercel.json`:

```json
{
  "source": "/assets/(.*)\\.map",
  "headers": [
    { "key": "X-Robots-Tag", "value": "noindex" },
    { "key": "Cache-Control", "value": "private, no-store" }
  ]
}
```

Ou stronger — bloquear completo:

```json
{
  "source": "/assets/(.*)\\.map",
  "headers": [
    { "key": "X-Frame-Options", "value": "DENY" }
  ],
  "rewrites": [
    { "source": "/assets/(.*)\\.map", "destination": "/404" }
  ]
}
```

(rewrite de `.map` → 404 mantém artifact pra CI upload via release
workflow, bloquea acesso público.)

**Custo:** 30min. Recomendação Round CWV-3 follow-up imediato.

### 4.4 Verdict

🟡 **Aceitável Round CWV-2 ship** com TODO Round CWV-3 de bloquear
public access. Manifesto §28 (privacidade pelo mínimo) interpretado
permissivo: source é open-source, exposure marginal. **Mas:** build
fingerprint exposure é novidade — bloqueia em CWV-3.

---

## §5 Carry-overs Barney status update

### Gap 1 — AT-11 fundamental (auto-mode signal of switch)

**Status:** ⏸️ Status quo. CWV-2 não toca auto-mode. Queue Round Tauri
auto.

### Gap 2 — AT-7 Tor bridge enumeration (Fase 6.4)

**Status:** ⏸️ Status quo. CWV-2 não toca transport.

### Gap 3 — TM-3 per-subpost CW

**Status:** 🟡 **continua aberto**. Não shippado em CWV-2. Plano Ted
incluiu em Round 5 Opção A; verificar próxima sessão se shippou.
**Não agravado por CWV-2.**

### Gap 4 — AT-1, AT-5, AT-9, AT-10, AT-14 contra impl real

**Status:** ⏸️ Status quo. Auto-mode não shippou; re-audit espera.

### Gap 5 — F-09 PostViewer body tap

**Status:** 🟡 continua aberto. CWV-2 não toca PostViewer. Round 5+
backlog.

### Gap 6 — §15 E2E testbed Phase A

**Status:** ⏸️ Status quo.

### Gap 7 — ESLint whitelist `src/components/UI/**` blanket-off

**Status:** ⏸️ Round 6 Marshall tracking.

### Gap 8 — **NOVO** Sourcemap public access

**Status:** 🟡 **introduzido em CWV-2**. Mitigation §4.3 — Round CWV-3
imediato.

### Gap 9 — **NOVO** SRI ausência

**Status:** 🟡 **reforçado em CWV-2** (não causado, mas surface gap
agora distribuído em 4-5 chunks vs 1 entry). Mitigation §3 — Round
CWV-4 dedicated.

---

## §6 Verdict ship/regress

### 🟢 Ship Round CWV-2 com 2 ressalvas explícitas

**Critérios atendidos:**

1. ✅ **Threat regressions zero em domínio crítico** (§17/§22/§24/§28).
   CWV-2 é optimization-only.
2. ✅ **§15 IP leak preservado.** Não toca transport/webrtc.
3. ✅ **Invariante #8 preservada** (nsec não em runtime). Bundle audit
   confirma zero secrets.
4. ✅ **Reduced motion + a11y** preservados (font swap não afeta).
5. ✅ **LazyBoundary corretamente sandboxed** — sem telemetria, sem
   SQLite write, sem retry loop hostil.
6. ✅ **Helia preload removido** REDUZ surface (helia só fetched on
   demand).

**Ressalvas (não-bloqueadoras hoje, S1 pré-Fase 7):**

1. 🟡 **Sourcemap public exposure** (introduzido CWV-2). Round CWV-3
   imediato adiciona Vercel header bloqueando `/assets/*.map`. Custo
   30min.
2. 🟡 **SRI ausência** (gap pré-existente, reforçado CWV-2 via vendor
   split). Round CWV-4 dedicated, ~12-18h. Bloqueia v1.0 público
   (Fase 7) por compromisso §17.

**Recomendação operacional:**

- **SHIP CWV-2 conforme status.** 4 commits são clean.
- **Round CWV-3 imediato** (≤1h): bloquear `*.map` público em
  vercel.json + audit final commit.
- **Round CWV-4 dedicated** (~2-3 dias): SRI baseline. Spec já
  documentada em RFC §6.2 + Robin §7. Barney acompanha.
- **NÃO regredir** CWV-2.

**Próximas atividades Barney:**
- Pré-CWV-4: identificar custom fetch wrapper pattern pra lazy chunks
  SRI (research browser support).
- Pré-Fase 6.7 (build reproduzível): confirmar SRI hashes
  determinísticos byte-exato em build re-rodado (Linux + macOS + Windows).
- Pós-CWV-3: smoke test prod `curl drift.vercel.app/assets/index-X.js.map`
  retorna 404.

---

## §7 Cross-references

### Sessão CWV (companion docs)
- [`Docs/rfcs/2026-05-rfc-cwv-bundle-strategy.md`](../rfcs/2026-05-rfc-cwv-bundle-strategy.md) §6.2 — Ted SRI defer rationale.
- [`Docs/sessions/cwv-research-2026-05-09.md`](./cwv-research-2026-05-09.md) §7 — Robin SRI baseline proposal.
- [`Docs/sessions/barney-pending-review-2026-05-08.md`](./barney-pending-review-2026-05-08.md) — pending Barney pré-CWV.
- [`Docs/sessions/barney-security-regression-round5-2026-05-08.md`](./barney-security-regression-round5-2026-05-08.md) — Round 5 ship gate.
- [`Docs/sessions/auto-mode-threat-model-2026-05-08.md`](./auto-mode-threat-model-2026-05-08.md) — AT-1..14 catalogados.

### Manifesto §s relevantes
- §17 sem chave mestra — **central** (CDN compromise = chave mestra
  disfarçada do operator).
- §28 privacidade pelo mínimo — sourcemap exposure trade-off.
- §15 anti-censura por país — preservado, sem toque.
- §22/§24 ranking — não tocado.

### Código auditado (CWV-2)
- `vite.config.ts:222-291` — sourcemap hidden + modulePreload filter +
  manualChunks.
- `src/components/UI/LazyBoundary.tsx:1-97` — full audit.
- `src/App.tsx:40-120` — 14 React.lazy() declarações.
- `src/components/Post/PostViewer.tsx:49-52` — 2 React.lazy() (ReportModal,
  SpreadMap).
- `vercel.json:9-49` — CSP + headers (CSP `script-src 'self'` correto;
  `*.map` rewrite gap).
- `dist/assets/*.js` — bundle audit grep secrets (zero leaks
  encontrados).
- `dist/assets/*.js.map` — sourcemap audit (sourcesContent embedded
  confirmado).

---

*Barney · 2026-05-09 · regression check Round CWV-2 · ship 🟢 verde com
2 ressalvas (sourcemap public access S2 → CWV-3 imediato; SRI ausência
S1 → CWV-4 dedicated) · top-3 threats novos S2-baixos · SRI defer
recommended com 3 condições · 7 carry-overs Barney status quo · 2 novos
gaps registrados.*
