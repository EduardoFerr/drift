# Barney — Audit de segurança round 9 + round 10 (2026-05-15)

**Data:** 2026-05-15
**Persona:** Barney (peer review crítico, threat modeling, ceticismo)
**Escopo:** 60+ commits entre 2026-05-13 e 2026-05-15 cobrindo UX
swipe/share/long-press, deep-link, error boundary, bfcache, SRI,
ratchets CWV, bundle splits e cleanup de tokens.

> ARTEFATO DE SESSÃO — auditoria pontual. NÃO é norma; decisões só viram
> doutrina se Arquiteto propaga pra `Docs/` raiz.

---

## §1 Escopo e método

**Commits cobertos (recortes do `git log --since='2026-05-13'`):**

- **Round 9 (2026-05-13/14, 40+ commits)** — UX swipe/card, compose
  inline expand, share deep-link (`818eaab`, `8770342`, `b4d9f6d`),
  long-press moderation (`a6e517f`, `2297f14`, `2789040`, `4f893a4`),
  actions fan (`4f93bea`, `fcb98f1`, `ad59bd5`), bundle splits
  (`24302f1`, `23f8e6c`), TM-3 compose warning (`b68b240`), comments
  fix (`4f40901`), ratchet S1 hard (`f3b48eb`), tokens (`1d0f5ed`,
  `1aee96b`, `fde312b`, `b6545ec`).
- **Round 10 (2026-05-15, ~14 commits)** — AppErrorBoundary
  (`ec68878`), SRI (`e6f90a8`), bfcache guard (`302fd07`),
  critical CSS inline (`aaa03e2`), DM helpers split (`d54d20b`),
  nostr-extras lazy chunk (`213f90d`), ratchet S2 700→600 KB
  (`9cd12a9`), a11y WCAG fixes (`b5c4dce`, `0737978`, `2e12760`).

**Método:** leitura de diffs alvo (`git show <sha>`), inspeção de
`src/lib/deep-link.ts`, `src/lib/sync.ts`, `src/lib/events.ts`,
`src/components/UI/AppErrorBoundary.tsx`, `scripts/inject-sri.mjs`,
`vercel.json`. Confronto com invariantes 1–17 do `CLAUDE.md` e
princípios manifesto §15, §17, §24, §25, §27, §28. Sem execução
dinâmica — auditoria estática.

**Restrição:** doc-only. Nenhuma linha em `src/` tocada.

---

## §2 Verdict por área

### 🟢 AppErrorBoundary (`ec68878`)

Class component que envelopa `<App />` em `main.tsx`. Captura via
`getDerivedStateFromError`, fallback com `Recarregar` (plain reload) e
`Limpar cache e recarregar` (drop IndexedDB + OPFS).

**Inspeção:**

- `handleClearAndReload` chama `window.confirm` ANTES com texto
  explícito: *"Isso vai apagar TUDO armazenado localmente (posts,
  identidade, configurações). Se você tem o nsec backupado, pode
  re-importar depois"*. Sem clear silencioso.
- `indexedDB.databases?.()` itera TODAS as bases — inclui a base da
  master key crypto (`drift-master-key` em `crypto.ts`) E OPFS root.
  Comportamento esperado: clear ABSOLUTO. Doc condiz.
- Sem telemetria — `console.error` apenas. Manifesto §17 respeitado.
- Sem suppression do erro original: re-render imediato após `setState`
  do error não esconde a stack do DevTools.

**Vetor avaliado (AT-13 — clickjacking p/ trigger de clear):** atacante
precisa (a) provocar throw no render tree do Drift E (b) levar user
ao click do botão drift-danger. `vercel.json` define
`frame-ancestors 'none'` + `X-Frame-Options: DENY` → IFRAME externo
recusado pelo browser. Vetor requer XSS prévio (que já permitiria
roubo de nsec via crypto API direto — boundary não é o ponto de
defesa). **Risk residual: BAIXO.**

**Verdict:** 🟢 ship. Implementação correta, confirm forte, sem
telemetria, headers cobrem clickjacking.

### 🟢 Share post deep-link (`818eaab`, `8770342`, `b4d9f6d`)

`handleSharePost` constrói `${origin}/?p=${nevent1}`. App.tsx monta
effect que faz `parseDeepLinkSearch(search)` → tenta `getPostById`
local → cai pra `pool.get(activeReadRelays(), {ids:[id]})` →
`onNostrEvent` (porta única §1). `parseDeepLinkSearch` em
`src/lib/deep-link.ts` é pura, 11 unit tests.

**Inspeção:**

- nevent é payload Nostr público (event id + hint de relay + author).
  Compartilhar URL não vaza nada que `note1`/`nevent1` no njump.me já
  não vazasse. Manifesto §28 (compatibilidade Nostr) OK.
- Relay malicioso poderia entregar evento arbitrário com `id`
  forjado? NÃO — `onNostrEvent` chama `verifyDriftEvent`
  (Schnorr) ANTES de persistir (`CLAUDE.md` §5 pipeline ordem). Atacante
  precisaria forjar assinatura sobre o id — computacionalmente inviável.
- Nevent malformado: `nip19.decode` lança, captura em `try/catch`,
  `postEventId = null`, App.tsx silencia. Sem crash, sem panic.
- XSS via `?p=`: o parser usa `URLSearchParams.get` + `nip19.decode`.
  Decoded `id` é hex 64-char; passa pra `pool.get` (filter ids) e
  pra `setState`. Sem `innerHTML`, sem `dangerouslySetInnerHTML`,
  sem `document.write`. Path limpo.
- `replaceState` limpa `?p=` após consume → refresh não refetch.
  Comportamento idempotente.

**Verdict:** 🟢 ship. Path criptograficamente seguro (verify Schnorr
fechado), parsing puro testado, sem surface XSS.

### 🟢 bfcache guard (`302fd07`)

`pagehide` sync: fecha subscription, clear flush timer,
`pool.close(activeReadRelays())`. `pageshow` (persisted=true):
`startSync()` de novo.

**Inspeção:**

- Eventos em voo durante pagehide: WS fecha, relay buffer + cursor
  `since` no startSync subsequente repõe. Sem perda de evento ao
  cliente (idempotência §events.ts `INSERT OR IGNORE` cobre dup).
- `pool.close` é da `nostr-tools` SimplePool — fecha sockets clean.
  Não há listener leak documentado upstream. `subscription()`
  unsub fecha o feed-filter local; cycle nav repete startSync com
  guard `if (subscription) return` → sem duplo-subscribe.
- `bfcacheGuardInstalled = true` flag evita re-registrar event
  listeners em cycles. ✓
- `setStatus({active: false})` no pagehide: store reflete realidade.
  Sem `setInterval` introduzido — invariante §10 respeitada
  (flushTimer pré-existente é cancelado, não criado).

**Vetor avaliado (race nav forward→back→forward):** cada `pageshow
persisted` → `startSync` → guard de subscription. Sem duplo WS,
sem listener acumulado.

**Verdict:** 🟢 ship. Lifecycle correto, sem leak, sem violação §10.

### 🟢 SRI (`e6f90a8`)

Script Node puro `scripts/inject-sri.mjs` injeta `integrity="sha384-..."`
em `<script type="module">`, `<link rel="modulepreload">`,
`<link rel="stylesheet">` no `dist/index.html` final.

**Inspeção:**

- Defesa-em-profundidade contra CDN/Vercel parcial-compromise: atacante
  troca bytes do `assets/foo.js` mas não atualiza `index.html` → browser
  recusa. **Mitiga edge-poisoning, NÃO mitiga full-pipeline compromise**
  (atacante que controla deploy edita HTML+JS juntos). `sri-baseline-2026-05-15.md`
  documenta isso como limitação aceita.
- HTML sem SRI (inerente — circular). `Strict-Transport-Security`
  e TLS protegem em trânsito. Aceitável.
- Dynamic imports via `__vitePreload`: NÃO cobertos pelo script
  (Vite injeta `<link>` runtime sem integrity). Lazy chunks ainda
  têm filename-fingerprint + TLS. Doc registra como TODO Fase 6.
  **Risk residual: BAIXO** (chunks lazy só carregam após HTML+entry
  validados — comprometer entry permite injeção, mas SRI no entry
  mitiga isso).
- Service Worker: precache do Workbox tem revision hash próprio.
  Out-of-scope explicado.
- Script é ~120 linhas zero-dep, idempotente (skip se `integrity=` já
  presente), 6 tests Vitest tier S2 cobrem formato + correspondência
  com bytes reais.

**Verdict:** 🟢 ship. SRI baseline correta, gaps documentados, sem
falsa sensação de segurança.

### 🟢 Long-press moderation (`a6e517f`)

5s hold sobre área do card → ModerationModal com block/report.
Slop 20px cancela; tap em `button,a` skipped; vibrate(50) ao gatilho.

**Inspeção:**

- Block é **local-only** (manifesto §24, camada de visualização).
  Sem leak.
- Report emite **kind 9081** público com `reason` — comportamento
  existente, modal só é nova porta UX. Sem novo surface.
- Clickjacking: `frame-ancestors 'none'` + XFO DENY já presentes em
  `vercel.json` → IFRAME terceiro recusado. Atacante precisaria XSS
  prévio (vetor abrangente, não específico do long-press).
- Conflito com gestos: skipped quando `target.closest('button,a')`
  e quando pointer está sobre imagem (`2789040`). Lightbox livre.
- `navigator.vibrate?.(50)`: optional-chained, fingerprintable? Sim
  marginalmente, mas vibrate é world-readable e Drift PWA já roda
  permissions API normal. Sem novo vetor.
- `isMine` skip evita modal em post próprio. UX só.

**Verdict:** 🟢 ship. Block é local, report já existia, nenhum poder
global adicionado. Manifesto §17 e §24 preservados.

### 🟢 TM-3 compose warning (`b68b240`)

Warning informativo no compose quando draft tem imagem sem
`content-warning` tag.

**Inspeção (linha-por-linha, 18 linhas):**

- Renderiza só durante compose. **Não persiste** no SQLite. **Não
  emite telemetria.** **Não hash da imagem.** Manifesto §25 + §27 +
  §28 respeitados.
- Não bloqueia publicação — author publica anyway. Auto-classificação
  voluntária (§27) preservada.
- Sem ML, sem scan. §7 invariante intacto.

**Verdict:** 🟢 ship. Educacional, opt-out implícito, zero surface
new threat.

### 🟢 addCommentToStore wire-up (`4f40901`)

`persistCommentRow` (dentro de `events.ts`) passou a chamar
`addCommentToStore` após `INSERT OR IGNORE`.

**Inspeção:**

- Grep `addCommentToStore` em `src/`: 1 definição em `comments.ts`,
  1 import em `events.ts`, 1 call em `events.ts` (linha 514).
  **Nenhum outro caller.** Invariante §1 preservada (porta única
  continua sendo `events.ts`).
- `addCommentToStore` é idempotente (dedup por id) — relays
  duplicados não viram dup na store.
- Wrap `try/catch` com `console.warn` — falha não-fatal não trava
  o pipeline `onNostrEvent`.
- Optimistic local NÃO foi adicionado aqui — store só é atualizada
  após o INSERT real (i.e., após verifyDriftEvent + persist).
  Invariante §2 respeitada.

**Verdict:** 🟢 ship. Wire-up está fechado em `events.ts`, sem
expansão de surface, idempotente.

### 🟢 Ratchets CWV (S1 hard 250 KB `f3b48eb`, S2 hard 700→600 KB `383574c`+`9cd12a9`)

Hard thresholds promovidos de warning. Defesa em profundidade contra
creep de dep maliciosa/gigante.

**Inspeção:**

- Lint `--max-warnings 0` (já vigente) + S1/S2 hard formam **3
  ratchets ativos** contra supply-chain creep. Adicionar `cripto-malicioso`
  silenciosa quebraria entry budget no CI.
- Bundle splits (`24302f1` vendor-identity, `23f8e6c` ThreadView lazy,
  `213f90d` nostr-extras) reduzem entry footprint sem alterar
  semântica. Sem novo network surface — chunks lazy carregam só do
  mesmo origin pós-entry-validation.

**Verdict:** 🟢 ship. Ratchets fortalecem postura.

### 🟢 Tokens drift-warning/drift-danger (`1d0f5ed`, `1aee96b`, `fde312b`, `b6545ec`)

Migração de classes Tailwind inline pra tokens semânticos.

**Inspeção:** zero impacto de segurança. Doc-system / design tokens.
Lint warnings 236→0 fecham o ratchet.

**Verdict:** 🟢 ship.

---

## §3 Gaps abertos / follow-ups recomendados

1. **CSP `connect-src 'self' wss: https:`** — wildcard `wss:` permite
   qualquer relay. Aceitável dado relays dinâmicos (§17 invariante:
   sem hardcode), MAS considere allowlist runtime via meta-CSP
   `connect-src` quando `relays_user` está fechado (Fase 6+).
   Trade-off: rigidez vs portabilidade.
2. **CSP sem `'strict-dynamic'` nem nonce** — script-src `'self'`
   bloqueia inline scripts ✓, mas qualquer XSS que conseguir injetar
   `<script src="/assets/...">` apontando pra chunk legítimo poderia
   confundir. Considere nonce-based CSP Fase 6 (requer SSR ou
   build-time HTML mutation pra injetar nonces).
3. **Dynamic imports sem SRI** — documented gap (`sri-baseline-2026-05-15.md`).
   Lazy chunks (`ThreadView`, `vendor-identity`, `nostr-extras`) carregam
   sem integrity attribute. Resolver via `build.modulePreload.resolveDependencies`
   ou patch de `__vitePreload`. Promover pra Round 11 antes da
   campanha em jurisdição censurada.
4. **AppErrorBoundary não cobre erros em event handlers / promises** —
   React boundaries não capturam async throw fora do render. Crashes
   em `onNostrEvent` (background) caem em `console.error` global, sem
   UI feedback. Considere `window.addEventListener('unhandledrejection')`
   handler que sinaliza no boundary (sem telemetria).
5. **Long-press não checa `isMine` em sub-elementos da árvore** — se
   houver re-render onde `isMine` muda durante hold em flight, o
   timer pode disparar com estado stale. Pequeno: revisar se
   `cancelLongPress` é chamado no `useEffect` cleanup.
6. **`indexedDB.databases?.()` não suportado em Firefox** — clear-cache
   no boundary degrada silenciosamente em FF. UX gap, não security
   gap. Considere fallback explícito ou warning "FF: limpe via
   Storage settings".

---

## §4 Confronto com invariantes do manifesto

Checklist:

- ✅ **§1 — onNostrEvent única porta INSERT domínio.** `addCommentToStore`
  validado como chamado APENAS de `events.ts:persistCommentRow`.
  Deep-link `?p=` resolve via `pool.get → onNostrEvent`. Sem nova porta.
- ✅ **§2 — Optimistic UI nunca alimenta SQLite.** Deep-link só seta
  `deepLinkedPost` (React state) após `getPostById` confirmar SQLite.
  Sem injeção otimista no banco.
- ✅ **§3 — Funções puras pra negócio.** `parseDeepLinkSearch` é pura,
  11 tests. SRI hash computation é pure side-effect-isolated em script
  Node (não runtime).
- ✅ **§4 — SQLite em Web Worker.** Sem mudança.
- ✅ **§5 — Pipeline `onNostrEvent` ordem.** Sem mudança.
- ✅ **§6 — Recalc de score debounced.** Sem mudança.
- ✅ **§7 — Sem scan automático.** TM-3 compose warning é informativo,
  zero ML, zero hash. §25 preservado.
- ✅ **§8 — nsec nunca persiste em claro.** `handleClearAndReload` apaga
  master key + nsec criptografado **com confirm prévio**. Sem
  exfiltration; sem leak.
- ✅ **§9 — Identidade portável.** AppErrorBoundary documenta
  "re-importa nsec depois". Path manifesto §3 explícito no confirm.
- ✅ **§10 — Sem poll.** bfcache guard é event-based (`pagehide`/
  `pageshow`). Sem novo `setInterval`.
- ✅ **§11 — Sem afinidade no feed.** Sem mudança.
- ✅ **§12 — Sem chave mestra.** Block local (§24), report kind 9081
  (§26 comunitário). Nenhum endpoint global de delete/ban introduzido.
- ✅ **§13 — Cliente não deleta dados moderados.** Sem mudança.
- ✅ **§14 — Compat Nostr.** nevent1 deep-link funciona em qualquer
  cliente NIP-19. URL Drift é wrapper, não substituto.
- ✅ **§15 — Multi-identidade.** Sem mudança no path
  `active_identity` / `setActiveIdentity`.
- ✅ **§16 — Funções puras com tests.** `parseDeepLinkSearch` +
  `computeInitialFromExit` + `buildFanItems` + SRI conformance =
  +29 tests novos.
- ✅ **§17 — Relays dinâmicos.** Sem hardcode novo; bfcache guard usa
  `activeReadRelays()`.

---

## §5 Recomendação final

🟢 **SHIP.**

Rounds 9+10 são compactos, defensivos e respeitam o manifesto inteiro:

- Nenhum princípio §17 (sem chave mestra), §25 (sem scan), §28 (compat
  Nostr) foi tensionado.
- Headers HTTP em `vercel.json` (CSP completo, COOP/COEP, XFO DENY,
  frame-ancestors none, Permissions-Policy estrito) cobrem vetores
  clickjacking + XSS-mitigation para as features novas (long-press,
  deep-link, error boundary).
- 3 ratchets ativos (lint, S1 250 KB, S2 600 KB) endurecem postura
  supply-chain.
- SRI fecha gap aberto desde 2026-05-09 (Barney CWV-regression).
- AppErrorBoundary fecha gap de white-screen + força confirm em
  destrutivos (§8 manifesto).
- Long-press moderation é local-block + report kind 9081, sem nova
  porta de poder.

**Itens 1–6 do §3 são follow-ups, não blockers.** Recomendo abrir
issue tracker pra (3) dynamic-import SRI e (4) unhandledrejection
handler antes da Fase 6 sair pra usuários em jurisdição censurada.

Verdict: **🟢 ship com follow-ups documentados.** Zero 🔴, zero 🟡.

---

*Última edição: 2026-05-15 — Barney. Persona Drift, não pessoa.*
