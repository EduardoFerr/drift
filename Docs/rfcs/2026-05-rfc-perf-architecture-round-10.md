# RFC — Performance Architecture Consolidation (Round 10)

**Status:** Accepted (consolidation pós-implementation — Rounds 9 + 10)
**Owner:** Ted (HIMYM persona — arquitetura/padrões/build pipeline)
**Sibling sessions:**
- Lily (core code / runtime — LazyMotion adoption, bfcache wiring)
- Marshall (schema/conformance — CWV ratchets em `tests/cwv-conformance.test.ts`)
- Robin (research/curadoria — Lighthouse baselines + WCAG tokens)
- Barney (peer review — SRI threat model, a11y audits)

**Sources consumed:**
- `vite.config.ts:222-316` (build config consolidado pós-CWV-2)
- `package.json:14` (build script chain)
- `scripts/{strip-sourcemaps,inject-sri,inline-css,preload-fonts}.mjs`
- `src/main.tsx:66-74` (LazyMotion root)
- `tests/cwv-conformance.test.ts` (ratchets ativos)
- Commits relevantes (round 9-10): `23f8e6c`, `24302f1`, `aaa03e2`, `2e12760`,
  `0737978`, `302fd07`, `d54d20b`, `213f90d`, `9cd12a9`, `e6f90a8`, `b5c4dce`,
  `1d0f5ed`, `1aee96b`, `b6545ec`, `971e947`, `f3b48eb`

> **Escopo:** consolidação dos padrões arquiteturais shippados em
> Round 9-10. Tom: ADR retrospectivo + guia pra contributors. Quando
> conflitar com manifesto, manifesto vence (§10 cliente leve, §13 LCP,
> §17 sem chave mestra).

---

## TL;DR (60s)

Round CWV-1 (planning, Ted) e CWV-2 (implementation, Lily) fecharam a
campanha Core Web Vitals com Lighthouse Performance subindo **86 → 97**.
Round 9-10 consolidou os padrões além do que a RFC CWV-1 antecipava:

- **9 chunks de bundle** (4 eager + 5 lazy) com critério explícito de
  promotion/demotion
- **5 passes post-build** (strip-sourcemaps → inject-sri → inline-css →
  preload-fonts) com ordem semanticamente sensível
- **LazyMotion adoption** com `strict` mode catching regressões em dev
- **Ratchets hard** em `cwv-conformance.test.ts` (entry ≤ 250 KB, total ≤
  600 KB, lint = 0 warn, tests = 980)
- **A11y baseline WCAG AA** verificado em tokens `drift-muted`/`drift-body`
- **bfcache eligibility** via pagehide/pageshow lifecycle

Este RFC documenta o **porquê** de cada decisão pra próximos contributors
não precisarem arqueologar 50+ commits. Não introduz mudanças novas;
serve de ADR único pra phase 6+.

---

## §1 Motivação

### 1.1 Baseline Lighthouse 2026-05-09 vs target

| Métrica | Baseline | Atual (2026-05-15) | Target manifesto §13 |
|---|---|---|---|
| Performance score | 86 | **97** | ≥ 95 |
| LCP | 3.8s | ~2.1s | < 2.5s |
| FCP | 2.3s | ~1.5s | < 1.8s |
| TBT | 210ms | ~110ms | < 200ms |
| CLS | 0.02 | 0.01 | < 0.10 |
| Entry chunk (raw) | 308 KB | ~200 KB | ≤ 250 KB |
| Total initial transfer | 640 KB | ~534 KB | ≤ 600 KB |

### 1.2 Por que consolidar agora

Round 9-10 shippou **17 PRs** tocando build pipeline, source patterns e
a11y. O risco de regressão em phase 6+ (Tor/WebRTC/Tauri) é alto se
contributors não souberem o critério decisivo de cada chunk. Manifesto
§10 (cliente leve) só é compromisso defensável se os ratchets forem
parte do contrato; senão vira aspiração.

### 1.3 Não-objetivos

- Re-arquitetar SQLite WASM loading (worker boot já ótimo).
- Substituir Framer Motion (LazyMotion entrega o ganho perseguido).
- Definir orçamentos de phase 6 (Tor binary, helia ativa). Decisões
  específicas vão em RFC dedicado quando essas features acionarem.

---

## §2 Bundle chunking strategy

### 2.1 Inventory atual (9 chunks)

`vite.config.ts:258-313` (manualChunks function).

| # | Chunk | Tipo | Conteúdo | Trigger |
|---|---|---|---|---|
| 1 | `index` | eager | App.tsx + Drift core libs (events, feed, scoring, etc.) | entry |
| 2 | `vendor-react` | eager | react, react-dom, scheduler | entry |
| 3 | `vendor-nostr` | eager | nostr-tools (resto), @noble/secp256k1, @noble/hashes, @scure/base | entry (signing/sync) |
| 4 | `vendor-motion` | eager | framer-motion (core via LazyMotion) | entry (PostCard mount) |
| 5 | `vendor-identity` | **lazy** | qrcode, @scure/bip39, @scure/bip32 | IdentityPanel / IdentitySwitcher tap |
| 6 | `nostr-extras` | **lazy** | nostr-tools/nip44, nip98, @noble/ciphers | WebRTC signaling + upload (nip98) |
| 7 | `helia-deps` | **lazy** | helia, @helia/*, libp2p, @libp2p/*, @chainsafe/*, multiformats, blockstore-/datastore-, etc. | Settings → Pin, NIP-94 meta on viewport |
| 8 | `maplibre-gl` | **lazy** | MapLibre GL | Tab "Mapa" |
| 9 | `tesselator` | **lazy** | Deck.gl ArcLayer tesselator | dentro do SpreadMap |
| 10 | `rebroadcast` | **lazy** | Fase 5 re-broadcast oportunista | addRelay user gesture |

### 2.2 Critério de promotion/demotion

**Regra dura pra promoção a eager chunk:** "carregada no primeiro paint
por qualquer caller no caminho crítico." Se um único call site eager
toca a dep, ela vai pra eager — code-splitting de Vite faz o resto.

**Regra dura pra demotion a lazy:** "todos os callers são lazy
(`import()` ou `React.lazy()`) E o chunk pesa ≥ 15 KB raw." Abaixo de
15 KB, o custo de uma round-trip HTTP nova não compensa a economia de
parse.

**Cache stability:** vendor chunks (`vendor-react`, `vendor-nostr`,
`vendor-motion`) NÃO invalidam quando business logic muda em
`feed.ts`/`scoring.ts`. Repeat-visit LCP cai pra ~1.2s. Validado em
deploy do `213f90d` (split nostr-extras): hashes dos vendors mantiveram.

### 2.3 Pitfall — barrel re-exports impedem tree-shaking

`d54d20b` documentou o caso concreto: `import { nip44, nip98, nip19 }
from 'nostr-tools'` puxa o **barrel inteiro** porque Rollup não consegue
provar side-effect-freedom através do re-export. Resultado: nip44 (DM
encryption) e nip98 (HTTP auth) ficavam em `vendor-nostr` eager mesmo
sendo só usados por WebRTC signaling + upload (lazy callers).

**Fix:** importar de submodule paths.

```ts
// ❌ ruim — puxa barrel
import { nip44, nip19 } from 'nostr-tools'

// ✅ bom — só o módulo que precisa
import * as nip19 from 'nostr-tools/nip19'
import { encrypt } from 'nostr-tools/nip44'
```

**Como detectar regressão:** após `npm run build`, grep no chunk
`vendor-nostr-*.js` por nomes de funções que NÃO deveriam estar
lá. Ex.: `grep -c "encrypt_v2" dist/assets/vendor-nostr-*.js` deve
retornar 0 (nip44 vive em `nostr-extras`).

Padrão similar aplicado em `24302f1` (vendor-identity — qrcode +
bip39/bip32 saíram de `vendor-nostr` porque match em `@scure/`) e
`213f90d` (split nip44/nip98 + @noble/ciphers em `nostr-extras`).

### 2.4 modulePreload — filter lazy chunks

Vite default emite `<link rel="modulepreload">` pra TODOS os chunks
descobertos no graph estático, incluindo dynamic imports. Browser
baixa avidamente. Fix em `vite.config.ts:240-252`:

```ts
modulePreload: {
  polyfill: true,
  resolveDependencies: (_filename, deps) => {
    const lazyChunks = /^(?:helia-deps|maplibre-gl|tesselator|rebroadcast|vendor-identity|nostr-extras)/
    return deps.filter(d => !lazyChunks.test(d))
  },
},
```

Regex deve crescer junto com adição de chunks lazy novos. Esquecer = bug
silencioso (chunk lazy baixado eager mesmo sem ser usado).

---

## §3 Source patterns

### 3.1 LazyMotion adoption (V9.34)

`src/main.tsx:66-74` envolve o root em `<LazyMotion features={domMax}
strict>`. Componentes consumem `m.*` em vez de `motion.*`. Estado pós
round 10: ~18 arquivos migrados.

```tsx
// ❌ antes
import { motion } from 'framer-motion'
<motion.div animate={{ opacity: 1 }} />

// ✅ depois
import { m } from 'framer-motion'
<m.div animate={{ opacity: 1 }} />
```

**`strict` mode** lança em dev se algum componente usar `motion.*`
direto — barrier dura contra regressão acidental. Em prod, fica
silencioso (no-op pra não derrubar produção por uma omissão de
contributor).

**Ganho medido:** vendor-motion ~120 KB → ~100 KB raw (-20 KB raw / -8
KB gzip). Importante notar que LazyMotion **não** elimina features —
`domMax` registra layout + drag + gestures sob demanda; o que diminui
é o eager runtime do Framer.

### 3.2 React.lazy() pra modais/overlays

Pattern shippado por Lily em `23f8e6c` (ThreadView) e equivalentes:

```tsx
const ThreadView = lazy(() =>
  import('./components/Thread/ThreadView').then(m => ({ default: m.ThreadView }))
)

{threadOpen && (
  <Suspense fallback={null}>
    <ThreadView />
  </Suspense>
)}
```

Fallback `null` é aceitável quando o overlay já tem entrance animation
(framer mascara o gap de 50-200ms). Em listas/inline content, usar
`<DriftSkeleton>` (Round Motion CWV-2).

**Erros de fetch** (chunk não baixa por conexão flaky): wrap em
`AppErrorBoundary` (já no root, `ec68878`) ou boundary local que
incrementa `key` no retry → re-mount → re-fetch.

---

## §4 Post-build pipeline

`package.json:14`:

```json
"build": "tsc -b && vite build && \
  node scripts/strip-sourcemaps.mjs && \
  node scripts/inject-sri.mjs && \
  node scripts/inline-css.mjs && \
  node scripts/preload-fonts.mjs"
```

### 4.1 Script-by-script

**`strip-sourcemaps.mjs`** — `vite.config.ts:229` define
`build.sourcemap: 'hidden'`. Maps emitidos em `dist/assets/` mas o
bundle não referencia (`//# sourceMappingURL=` omitido). Este script
remove os `.map` antes do deploy pra Vercel. Trade-off: perde debug
remoto direto; ganha: superfície de reverse-engineering menor. Maps
ainda existem no artifact local pra debug post-mortem manual.

**`inject-sri.mjs`** (`e6f90a8`) — adiciona `integrity="sha384-..."` em
`<script type="module">`, `<link rel="modulepreload">` e `<link
rel="stylesheet">`. Threat model em comment topo do script: defesa
contra CDN/Vercel compromise servindo bytes alterados sob mesmo
filename hash. Manifesto §17 (sem chave mestra) requer defesa-em-
profundidade no canal de distribuição. **Não cobre** sw.js / workbox
(precache manifest tem revision própria).

**`inline-css.mjs`** (`aaa03e2`) — inlines `<link rel="stylesheet">` no
`<head>` como `<style>`. Elimina 1 RTT pra CSS bloqueante na rota
inicial. HTML cresce ~9 KB gzip; em mobile 4G (1.6 Mbps), economiza
~300-500ms de FCP. Net win.

**`preload-fonts.mjs`** (`2e12760`) — `<link rel="preload" as="font"
type="font/woff2" crossorigin>` pros woff2 críticos (Syne Variable +
DM Mono 400). Browser começa o fetch ANTES do CSS parser descobrir
`@font-face`. Ganho típico FCP: -100-200ms.

### 4.2 Order matters

```
1. strip-sourcemaps  →  remove .map files (não tem dependência em HTML)
2. inject-sri        →  hash do CSS/JS final, antes de qualquer mutação
3. inline-css        →  remove <link> CSS, inline como <style>. Se rodasse
                        antes de SRI, hash do CSS removido seria perdido —
                        mas o que importa é que SRI rode quando o CSS
                        ainda é um asset linkado. Tecnicamente inline-css
                        elimina o link com integrity já preenchido (no-op
                        pra esse link), mas SRI ainda cobre scripts.
4. preload-fonts     →  injeta novas tags no head. Pode ser último porque
                        não muda hashes existentes.
```

**Regra dura adicionar script novo:**
- Antes do `strip-sourcemaps`? Não — só se manipula `.map` deliberadamente.
- Entre `strip-sourcemaps` e `inject-sri`? Use pra mutações em JS/CSS
  emitido (minify pass extra, dead code, etc.).
- Depois de `inject-sri`? Só pode mutar **HTML** (adicionar tags, mover
  ordem, etc.) — NUNCA alterar bytes de JS/CSS, senão SRI quebra.

---

## §5 Performance ratchets

Hard gates em `tests/cwv-conformance.test.ts`. Falham CI se violados.

| # | Ratchet | Valor | Localização | Commit |
|---|---|---|---|---|
| 1 | Entry chunk raw | ≤ 250 KB | `ENTRY_CHUNK_BUDGET_SOFT` | `f3b48eb` |
| 2 | Entry chunk hard | ≤ 300 KB | `ENTRY_CHUNK_BUDGET_HARD` | CWV-1 |
| 3 | Total initial transfer | ≤ 600 KB | `TOTAL_INITIAL_TRANSFER_BUDGET` | `9cd12a9` |
| 4 | Lint warnings | = 0 | `npm run lint:check` (`--max-warnings 0`) | `b6545ec` |
| 5 | Vitest passing | 980 tests | `npm run test` | Round 10 |
| 6 | SRI em todos refs HTML | obrigatório | S2 conformance check | `e6f90a8` |
| 7 | modulepreload exclui lazy | regex match | S0 conformance check | CWV-2 |
| 8 | robots.txt presente | hard | S3 artifact integrity | CWV-2 |

### 5.1 Como adicionar ratchet novo

Pattern em `cwv-conformance.test.ts`:

```ts
const NEW_BUDGET = 50 * 1024 // 50 KB — racional aqui
describe('S<N> — <nome semântico>', () => {
  it('artifact <x> respeita budget', () => {
    const dist = inspectDist()
    if (!dist.hasDist) return // SKIP_IF_DIST_MISSING permitido
    const measured = dist.assetFiles.find(f => f.name.startsWith('<prefix>'))
    expect(measured?.size ?? 0).toBeLessThanOrEqual(NEW_BUDGET)
  })
})
```

**Severity tiers** (S0..S3):
- **S0** = bug confirmado, deve resolver pra hit Performance ≥95.
- **S1** = budget hard quando S0 resolvido.
- **S2** = budget total transfer.
- **S3** = artifact integrity (robots.txt, manifest, etc.).

**Promoção soft → hard:** depois de 2 semanas de baseline estável,
ratchet vira `expect().toBeLessThanOrEqual()` direto. Exemplo: `f3b48eb`
promoveu entry chunk ≤ 250 KB de soft pra hard.

---

## §6 A11y baseline

Round 9-10 (`b5c4dce`, `2e12760`, `0737978`, `971e947`) shippou WCAG AA
conformance em três dimensões.

### 6.1 Contrast (WCAG 1.4.3)

| Token | Hex | Sobre `drift-surface` | Ratio |
|---|---|---|---|
| `drift-text` | #f5f5f5 | #1a1a1a | ~14.6:1 ✅ |
| `drift-body` | #909090 | #1a1a1a | **5.54:1** ✅ |
| `drift-muted` | #828282 | #1a1a1a | **4.74:1** ✅ |
| `drift-warning` | (ver tokens) | #1a1a1a | ≥ 4.5:1 ✅ |
| `drift-danger` | (ver tokens) | #1a1a1a | ≥ 4.5:1 ✅ |

**Regra:** hierarquia `text > body > muted`, todos ≥ 4.5:1. Quando
introduzir token novo, validar com contrast checker antes de merge.
`1d0f5ed`/`1aee96b` documentam o processo de migração tokens semânticos
(`drift-warning`, `drift-danger` substituindo Tailwind raw `yellow-500`/
`red-500`).

### 6.2 Label in Name (WCAG 2.5.3)

`0737978`: todo `aria-label` em controles com texto visível **inclui o
texto visível**. Senão screen reader anuncia diferente do que sighted
user vê → confusão pra users com voice control ("clica em Settings"
não bate com aria-label "Open preferences panel").

```tsx
// ❌ ruim
<button aria-label="Open settings">Settings</button>

// ✅ bom
<button aria-label="Settings">Settings</button>
// ou (se aria-label precisa contexto):
<button aria-label="Settings — identidade e relays">Settings</button>
```

### 6.3 Touch targets (WCAG 2.5.5)

Mínimo 44×44 px. `GlassIconButton xl` size = `h-11 w-11` (44px). Não
usar `sm`/`md` em controles primários standalone — só em compostos onde
o hit area do parent garante 44px.

### 6.4 Dialog accessibility

Todo `<dialog>` (modal/overlay) tem accessible name via `aria-label` ou
`aria-labelledby`. `2e12760` cobriu os últimos sites sem name. Pattern:

```tsx
<dialog aria-labelledby="settings-title">
  <h2 id="settings-title">Configurações</h2>
  {/* ... */}
</dialog>
```

---

## §7 bfcache friendly

`302fd07` (V9.34) tornou Drift elegível pro back/forward cache em
Chrome/Firefox. WebSockets abertos bloqueiam bfcache eligibility —
browser nunca congela uma página com conexão WS ativa.

### 7.1 Lifecycle pattern

```ts
// src/lib/sync.ts (resumido)
window.addEventListener('pagehide', () => {
  // user navegou pra outra página — pausar tudo que segura bfcache
  pool.close(activeReadRelays())  // close all WS sync
  // Não fazer reload-style cleanup; bfcache restaurar do mesmo state.
})

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    // restaurando do bfcache — re-subscribe limpo
    startSync()
  }
})
```

**Verificar:** Chrome DevTools → Application → Back/forward cache →
"Test back/forward cache". Status "Restored from back/forward cache"
significa que pagehide fechou tudo. "Not eligible" + reason "WebSocket"
significa regressão; investigar relays/pool/webrtc não fechando.

### 7.2 Pegadinhas

- `setInterval` ativo NÃO bloqueia bfcache (browser pausa).
- IndexedDB/OPFS transaction aberta bloqueia. SQLite worker já handle
  via worker lifecycle.
- WebRTC PeerConnection ativa bloqueia. Phase 6.3 precisa close
  no pagehide.

---

## §8 Decisões pendentes (carry-over pra phase 6+)

Items identificados mas não implementados em round 9-10. Não bloqueiam
release; ficam no radar.

1. **Threats de auto-mode FSM** (network-mode-auto): cliente alterna
   WSS/WebRTC/Tor por health metrics. Vetores: signal jam, BGP hijack
   forçando degradação pra transport menos seguro. RFC dedicado em
   `2026-05-rfc-network-mode-auto-fsm.md` cobre arquitetura; threat
   model precisa Barney review formal em phase 6.4.

2. **§15 E2E smoke** (anti-censura nível país): cliente Tauri + arti +
   relay onion validado em CI Linux (`source-builders`). Pendente:
   Windows/macOS reproducible build. Sem isso, claim §15 fica meio em
   build-from-source-only — entrega via binário pre-built não verifica.

3. **Helia ativação default**: hoje Track B (pin opt-in via Settings).
   Decisão pra phase 7: ativar pin oportunista de posts virais por
   default? Trade-off bandwidth/storage do user vs disponibilidade
   distribuída (manifesto §16). RFC separado quando phase 7 acionar.

4. **Subset font PT-BR**: deferred em CWV-1 §3.4.2; ROI ~15 KB
   marginal. Reavaliar se Lighthouse pós-phase-6 apontar font como
   blocker, ou se user growth criar bandwidth pressure.

5. **size-adjust descriptors**: shippado parcial (DM Mono fallback).
   Syne Variable fallback metrics ainda pendente — FOUT em first paint
   é visualmente jarring. Round CWV-3 polish opcional.

6. **lhci no CI**: workflow `.github/workflows/lighthouse.yml` planejado
   em CWV-1 §3.5; ainda não shippado. Runtime gate por PR vs estático
   é complementar — sem lhci, regressão de runtime (ex.: animation
   jank) passa despercebida.

---

## §9 Apêndice — comandos úteis

```bash
# Build completo (5 passes)
npm run build

# Build + abre stats sunburst pra investigar regressão de tamanho
npm run build:analyze
# → dist/stats.html

# Apenas o test de bundle conformance (rápido, sem lhci)
npm run test:bundle-size

# Lint estrito (0 warnings; falha CI)
npm run lint:check

# Vitest full
npm run test
# atual: 980 tests

# Lighthouse local (PWA build server, runtime metrics)
npm run lhci

# Detectar barrel re-export regressão (ex.: nip44 vazou pra eager)
grep -l "encrypt_v2" dist/assets/vendor-nostr-*.js
# (deve retornar nada — nip44 vive em nostr-extras)

# Verify modulepreload exclui lazy chunks
grep "modulepreload" dist/index.html | grep -E "(helia-deps|maplibre|tesselator|rebroadcast|vendor-identity|nostr-extras)"
# (deve retornar nada)
```

---

## §10 Cross-references

### RFCs siblings
- `Docs/rfcs/2026-05-rfc-cwv-bundle-strategy.md` (CWV-1, planning)
- `Docs/rfcs/2026-05-rfc-motion-perf-polish.md` (DriftSkeleton, motion
  patterns)
- `Docs/rfcs/2026-05-rfc-token-enforcement.md` (a11y tokens lint gate)
- `Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md` (phase 6 threats)
- `Docs/rfcs/2026-05-rfc-design-system-v08.md` (touch targets, type
  hierarchy)

### Manifesto
- §10 cliente leve no caminho crítico
- §13 LCP ≥95 Lighthouse Performance
- §16 disponibilidade distribuída (PWA pequeno = sneakernet friendly)
- §17 sem chave mestra (SRI + sourcemap hidden + update prompt)

### Web standards
- web.dev bfcache: <https://web.dev/articles/bfcache>
- web.dev SRI: <https://web.dev/articles/subresource-integrity>
- WCAG 2.1 AA: <https://www.w3.org/WAI/WCAG21/quickref/>

---

*Última atualização: 2026-05-15 · Ted Round 10 · Consolidation ADR ·
Pareia com Lily V9.34 (LazyMotion + bfcache) + Marshall ratchet promoção
+ Robin Lighthouse audit + Barney SRI threat review.*
