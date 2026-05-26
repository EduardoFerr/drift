# Barney coverage audit — 3 commits Lily (UX iniciante) 2026-05-26

> **Persona:** Barney Stinson — peer review crítico, threat-model,
> ceticismo.
> **Escopo:** doc-only audit de cobertura de testes em 3 commits que
> fecharam fricções UX (#3, #4, #6) observadas em 2026-05-23.
> **Output:** lista de gaps P0/P1/P2 com propostas de spec — zero
> código novo, zero teste novo nessa sessão.

---

## 1. Sumário executivo

| Severidade | Total | O que significa |
|:---:|:---:|---|
| **P0** | **3** | Comportamento user-facing crítico sem cobertura. Refactor futuro pode quebrar invisível em prod. |
| **P1** | **6** | Quick-add que fortalece anti-regressão (≤10 LoC test). |
| **P2** | **4** | Nice-to-have — beleza > segurança. |

### Top 3 gaps mais críticos (P0)

1. **`909f953` (Prévia disabled) — `disabled={allEmpty}` no botão NÃO tem
   LOCK_VIA_TEST.** O fix é 90% visual, mas o invariante de segurança
   ("botão dispara `setShowPreview(true)` em estado vazio") depende do
   atributo HTML `disabled`. Se alguém remover `disabled={allEmpty}`
   numa refactor de classNames, o click passa, `<PreviewView>` recebe
   `drafts` vazias e — dependendo da implementação de Preview — pode
   crashar ou abrir overlay vazio sem affordance pra voltar. Coverage
   atual valida copy mas não o gate.

2. **`40a7196` (MapOverlay título) — `ariaLabel` dinâmico
   (`mapa de propagação — ${mapMode}`) não tem teste.** A11y já é gap
   histórico (Robin audit). Esse commit MUDOU a aria-label de estática
   pra template-string interpolada. Se alguém refactorar pra
   `aria-label="mapa"` "porque é mais limpo", screen-reader perde o
   contexto de modo (post/global/network) silenciosamente. Test atual
   só valida o `title` user-facing.

3. **`7712b64` (HintChip tab-dots) — render condicional `if (!tabDotsRule)
   return null` não tem teste de defesa.** O pattern
   `const rule = getHintRule('tab-dots-meaning'); if (!rule) return null`
   parece defensivo, mas se alguém renomear o ID em `guidance.tsx`
   (decisão legítima de futuro PR), o HintChip vira no-op silencioso —
   sem warning, sem fail, só "o chip sumiu". Test existente valida que o
   ID EXISTE em HINT_RULES, mas não valida que o ID lookup no HomeHeader
   bate com o ID definido. Acoplamento string-string sem trava cruzada.

### Recomendação

**Backlog (não dispatch imediato).** Os 3 P0 são reais mas não bloqueiam
nada agora. Quick-add em próximo round de cleanup (1 PR só, +9 LoC test
total). Os P1/P2 podem ficar dormentes — Barney não cria backlog
gordinho por princípio: gap que ninguém vai resolver em 30 dias = NO-GO
de criar.

---

## 2. Per-commit analysis

### `909f953` — Prévia disabled state + copy condicional

**Diff:** `src/components/Create/ComposeOverlay.tsx`, +17/-2 LoC.

**Comportamento crítico identificado:**

1. `disabled={allEmpty}` no `<button>` — gate HTML que impede click.
2. Copy ternary: `'✕ escreva algo'` (vazio) vs `'◐ prévia'` (pronto).
3. Title tooltip ternary: `'escreva algo antes de pré-visualizar'`
   (vazio) vs `'pré-visualizar o post'` (pronto).
4. Classes ternary: `border-dashed border-drift-muted/30
   bg-transparent text-drift-muted/50 cursor-not-allowed` (vazio) vs
   classe accent2 (pronto).
5. `allEmpty = drafts.every(isDraftEmpty)` — pure function source of
   truth pro estado.

**Tests existentes cobrindo:**

- `tests/gps-scope-button-conformance.test.ts` — toca o arquivo mas
  pra outra feature (GpsScopeButton). Zero overlap com botão Prévia.
- `tests/design-system-primitives-conformance.test.ts:21` — só
  menciona ComposeOverlay numa allowlist comment.
- `tests/layout-inference.test.ts` — função pura `inferLayout`, não
  toca botão Prévia.

**Verdict: ZERO testes específicos do botão Prévia.** Nem o estado
anterior (`disabled:opacity-30`) tinha trava. Esse commit perdeu
oportunidade de adicionar uma.

**Gaps:**

- **P0:** `disabled={allEmpty}` precisa LOCK_VIA_TEST. Spec proposta:
  ```ts
  it('botão Prévia tem disabled={allEmpty} (gate HTML, não só visual)', () => {
    expect(COMPOSE).toMatch(/disabled=\{allEmpty\}/)
  })
  ```
  Razão: visual + HTML gate são camadas independentes; visual sozinho
  é teatro de acessibilidade — keyboard/assistive tech ignoram CSS.

- **P1:** Copy condicional ternary precisa trava de string match.
  Iniciantes leem essa copy; renomear "escreva algo" → "digite texto"
  numa refactor de tom não-coordenada é defeito de regressão UX.
  ```ts
  it('botão Prévia copy condicional ✕ escreva algo / ◐ prévia', () => {
    expect(COMPOSE).toMatch(/✕ escreva algo/)
    expect(COMPOSE).toMatch(/◐ prévia/)
  })
  ```

- **P1:** Title tooltip — mesma defesa que copy. Esse é o caminho
  desktop-hover, e ele NUNCA aparece em screenshot manual.
  ```ts
  it('botão Prévia tem title tooltip explicativo no estado vazio', () => {
    expect(COMPOSE).toMatch(/escreva algo antes de pré-visualizar/)
  })
  ```

- **P2:** Diferenciação visual `border-dashed` no estado vazio.
  Cosmético; designer pode mudar token sem cost.

- **P2:** `allEmpty = drafts.every(isDraftEmpty)` — função `isDraftEmpty`
  é pura mas não tem teste unitário próprio (busca: zero matches).
  Vale gap separado em backlog mas fora do escopo deste fix.

**Quick wins:** P0 + 2× P1 = 9 LoC, 3 expects. Tempo total ~3min.

---

### `40a7196` — MapOverlay título dinâmico

**Diff:** `src/App.tsx` (+18/-2), `tests/spread-map-network-mode-conformance.test.ts` (+26).

**Comportamento crítico identificado:**

1. `mapTitle` computed nested-ternary (`mapMode === 'post' ? ... :
   mapMode === 'network' ? ... : 'mapa · global'`). 3 valores
   user-facing.
2. `<FullPageCard title={mapTitle}>` — substitui `title="propagação"`.
3. `aria-label` muda de `"mapa de propagação"` (estática) pra
   `` `mapa de propagação — ${mapMode}` `` (template-string).
4. `mapMode` continua sendo source-of-truth — não duplicado.
5. Allowlist no LOCK: aria-label e comentários ainda podem mencionar
   "propagação".

**Tests existentes cobrindo:**

- `tests/spread-map-network-mode-conformance.test.ts:322-346` — bloco
  novo (este commit). 3 assertions sobre `mapTitle`, ausência de
  `title="propagação"`, e `title={mapTitle}`.
- `tests/useSpreadMap-regionKey.test.ts` — só toca `useSpreadMap`
  hook, nada de overlay header.

**Verdict: cobertura razoável do happy path, mas pula a aria-label e
o fallback default.**

**Gaps:**

- **P0:** `aria-label` dinâmica não tem trava. Se alguém fizer
  ```tsx
  ariaLabel="mapa de propagação"  // "constante é mais simples"
  ```
  o screen-reader perde contexto. Gap silencioso, regressão a11y.
  Spec:
  ```ts
  it('ariaLabel inclui mapMode interpolado pra contexto SR', () => {
    expect(APP).toMatch(/ariaLabel=\{`mapa de propagação\s*—\s*\$\{mapMode\}`\}/)
  })
  ```

- **P1:** Nested-ternary default fallback (`'mapa · global'`). Se o
  union type `SpreadMapMode` ganhar 4ª variante no futuro (ex:
  `'trending'`), o fallback vira "mostra global mesmo sendo trending".
  Defesa via exhaustiveness check ou case explícito:
  ```ts
  it('mapTitle cobre 3 modos (não usa fallback implícito)', () => {
    // Ensure each branch is explicit, not relying on default
    expect(APP).toMatch(/mapMode\s*===\s*['"]post['"]/)
    expect(APP).toMatch(/mapMode\s*===\s*['"]network['"]/)
    // 'global' pode ser default ou explícito — aceitar ambos
    expect(APP).toMatch(/mapa\s*·\s*global/)
  })
  ```

- **P2:** Convergência vocabulário — não há teste que valide que **nav
  bottom também diz "mapa"** (a parte do problema "3 nomenclaturas"
  pressupunha que nav e overlay convergissem). O fix só mexeu no
  overlay; se alguém mudar nav pra "PROPAGAÇÃO" amanhã, divergência
  volta sem warning. Spec:
  ```ts
  it('NavBar bottom mantém label "mapa" (convergência cross-component)', () => {
    expect(APP).toMatch(/NavBar.*mapa|aria-label=['"]mapa['"]/i)
  })
  ```
  Caveat: pode ser frágil dependendo de como NavBar é renderizado.

**Quick wins:** P0 (aria-label) = 4 LoC, 1 expect. ~2min.

---

### `7712b64` — HintChip tab-dots-meaning

**Diff:** `src/App.tsx` (+15), `src/lib/guidance.tsx` (+24),
`tests/guidance-rules-conformance.test.ts` (+49).

**Comportamento crítico identificado:**

1. Nova `GuidanceRule` em `HINT_RULES` com `id: 'tab-dots-meaning'`,
   `title`, `body` factory.
2. `HomeHeader` faz `getHintRule('tab-dots-meaning')` + render
   condicional `if (!tabDotsRule) return null`.
3. `<HintChip rule={tabDotsRule} label="○ = posts novos" />` — passive,
   sem `onActivate`.
4. Capability gate herdado de HintChip (dismiss via X persiste em
   `capabilities_dismissed`).
5. IIFE wrapper `(() => { ... })()` pra evitar destruturar do escopo do
   `HomeHeader` props (legibility).

**Tests existentes cobrindo:**

- `tests/guidance-rules-conformance.test.ts:107-147` (este commit, +49
  LoC): 5 asserts — `EXPECTED_HINT_IDS` contém 2 IDs, shape (id+title+
  body), `getHintRule` lookup OK, title contém '○', App.tsx chama
  `getHintRule('tab-dots-meaning')`.
- `tests/hint-primitives-conformance.test.ts` — valida HintChip
  primitive (exports, DriftChip, capability gate, manifesto §28). NÃO
  valida consumers.

**Verdict: cobertura SÓLIDA pra um commit de +15/+24 LoC. Mas tem 1
gap genuíno e 2 nuances.**

**Gaps:**

- **P0:** Render condicional `if (!tabDotsRule) return null` é silent
  failure. Test atual valida que ID existe HOJE; mas o acoplamento
  consumer→producer é por string literal em 2 lugares ('tab-dots-meaning'
  em App.tsx + em guidance.tsx). Renomear o ID em guidance.tsx isolado
  passa todos os tests da guidance suite (porque eles usam
  `EXPECTED_HINT_IDS` constante local), e o App.tsx só falha o teste
  específico — mas o app silently quebra antes do teste rodar em CI
  velho. Defesa: trazer `tabDotsRule` pra fora do IIFE e fazer
  `assert(tabDotsRule, '...')`, OU adicionar teste de smoke:
  ```ts
  it('HomeHeader getHintRule lookup resolve (não silent-null)', () => {
    // Tem que existir EM guidance.tsx — não pode ser referência morta
    const APP = readFileSync('src/App.tsx', 'utf8')
    const match = APP.match(/getHintRule\(['"]([^'"]+)['"]\)/g) ?? []
    const ids = match.map(m => m.replace(/getHintRule\(['"]/, '').replace(/['"]\)$/, ''))
    for (const id of ids) {
      expect(getHintRule(id)).toBeDefined()
    }
  })
  ```
  Esse é o mais valioso porque generaliza pra todo HintChip consumer
  futuro — Barney aprova padrões anti-regressão amplos sobre testes
  pontuais.

- **P1:** `label="○ = posts novos"` — string user-facing acoplada ao
  chip render, não ao `rule.title`. Hoje os dois batem por convenção,
  mas o chip permite divergência (chip mostra label do consumer, modal/
  overlay mostraria title do rule). Se divergirem, "○ = posts novos" no
  chip + título do hint diferente = user confused.
  ```ts
  it('HintChip label tab-dots bate com rule.title', () => {
    const APP = readFileSync('src/App.tsx', 'utf8')
    expect(APP).toMatch(/label=['"]○ = posts novos['"]/)
    // E title da rule também
    expect(getHintRule('tab-dots-meaning')?.title).toBe('○ = posts novos')
  })
  ```

- **P1:** Body factory function não é renderizada em lugar nenhum hoje
  (chip é passive, sem `onActivate`). É dead-code latente. Defesa: ou
  remove body do hint, ou tem teste que valida que existe consumer
  (zero hoje):
  ```ts
  it('tab-dots-meaning body é dead-code (passive chip) — flag pra futuro DAOP cleanup', () => {
    // Documenta o estado. Quando body for usado, deletar este teste.
    const rule = getHintRule('tab-dots-meaning')
    expect(typeof rule?.body).toBe('function')
    // TODO Ted+Barney DAOP audit próximo round: avaliar se body factory
    // vale a pena manter sem consumer. 'backup-after-post' tem mesma
    // estrutura.
  })
  ```
  Esse é mais Ted/Barney audit pattern que LOCK_VIA_TEST. P2 talvez.

- **P2:** IIFE `(() => { ... })()` no JSX — pattern usado outras vezes
  (backup-after-post chip também). Sem teste de uso consistente. Não
  prioritário.

- **P2:** Capability gate visual smoke — chip renderiza só se
  `!dismissed`. Test atual valida o gate em HintChip primitive mas não
  no consumer. Pode ser overkill.

**Quick wins:** P0 (cross-validation getHintRule consumer→producer)
= ~10 LoC, 1 test bloco. ~5min.

---

## 3. Convergência cross-commit

### Padrão repetido #1: ternários de copy PT-BR

- `909f953` — `allEmpty ? '✕ escreva algo' : '◐ prévia'`
- `40a7196` — `mapMode === 'post' ? 'mapa · este post' : mapMode === 'network' ? 'mapa · sua rede' : 'mapa · global'`
- `7712b64` — não tem ternário, mas tem string user-facing
  `'○ = posts novos'`

**Convergência:** strings condicionais que UI iniciante consome
diretamente. Hoje:
- `909f953`: ZERO LOCK_VIA_TEST das strings.
- `40a7196`: LOCK_VIA_TEST das 3 strings (PASS).
- `7712b64`: LOCK_VIA_TEST do glyph '○' no title + ID, mas não da
  label do consumer.

**Proposta de pattern reutilizável:** helper de teste
`expectStringLock(path, strings: string[])` em `tests/_helpers/` (não
existe ainda — Barney recomenda backlog). Mas isso é nice-to-have, e
ferramentas de teste customizadas em projeto pequeno tendem a virar
shelf-ware (mesma armadilha que `HintToast`/`HintModal` no DAOP audit).
Por enquanto: regex match direto via `readFileSync` (pattern já usado
em `manifesto-conformance.test.ts`).

### Padrão repetido #2: aria-label vs title divergence

- `909f953`: title tooltip + button text divergem por design (correto —
  text é compacto, tooltip é educativo). Mas só title é testado (e
  apenas implicitamente via copy match).
- `40a7196`: title vs aria-label divergem (`'mapa · X'` vs
  `'mapa de propagação — X'`). title testado, aria-label NÃO.
- `7712b64`: chip label = chip title — sem divergência hoje, mas chip
  primitive permite.

**Convergência:** a11y attributes (`aria-label`, `title` desktop hover)
são consistentemente menos testados que copy visível. Gap sistêmico,
não específico desses 3 commits. **Robin audit alvo**: levantar todos
os `aria-label=` em `src/App.tsx` + `src/components/**` e medir
coverage proportion vs visible copy. Provavelmente <30%.

### Padrão repetido #3: consumer↔producer string coupling

- `40a7196`: `mapMode` enum union → 3 títulos. Acoplamento por
  exhaustiveness (TS protege).
- `7712b64`: `getHintRule('tab-dots-meaning')` consumer + rule definition
  producer. Acoplamento por string literal — TS NÃO protege (string
  literal type não é declarado).

Esse é o gap conceitual mais perigoso: TypeScript não bate string
literals em 2 arquivos. Cada `getHintRule()` consumer é refactor-fragile.
Proposta longa-prazo: `HINT_IDS = { TAB_DOTS_MEANING: 'tab-dots-meaning'
} as const` exportado de `guidance.tsx`, e consumers importam o symbol.
Ted/Marshall RFC pequeno.

---

## 4. Recomendação final

### Dispatch imediato? **NÃO.**

Razões:
- Os 3 P0 são gaps reais mas não há **exploit ativo** — não tem PR em
  flight que vá quebrar isso amanhã.
- Lily já tem 2 PRs em vôo (MapOverlay header EV + ModeToggle empty
  state). Adicionar +3 testes pequenos via 4º agent é ruído.
- Ted está em RFC NSFW arquitetura — não-overlap mas adiciona
  coordenação cost.

### Backlog (sim — 5 items).

Adicionar em `BACKLOG.md` seção "Coverage gaps coletados Barney audit
2026-05-26":

1. **[P0]** `disabled={allEmpty}` LOCK_VIA_TEST em
   `tests/compose-overlay-preview-button.test.ts` (novo arquivo
   ~25 LoC) — cobre os 3 P0/P1 de `909f953`.
2. **[P0]** `ariaLabel={...mapMode...}` LOCK em
   `spread-map-network-mode-conformance.test.ts` (+4 LoC) — fecha P0
   `40a7196`.
3. **[P0]** Cross-validation `getHintRule()` consumer→producer em
   `guidance-rules-conformance.test.ts` (+10 LoC) — fecha P0 `7712b64`
   e generaliza pra futuros HintChip consumers.
4. **[P1]** Strings PT-BR ternary lock pra `909f953` ComposeOverlay
   (+5 LoC) — 2 expects.
5. **[Audit]** Robin: aria-label vs visible copy coverage ratio audit
   (proposta em §3 convergência #2). Doc-only, sem timeline.

Items 4 e 5 são *should*, não *must*. Items 1-3 são *must* no próximo
cleanup round.

### Critério de fechamento do backlog item

Quando os 3 P0 forem implementados, validar:
- `npm run test` continua 1954+ pass (sem regressão).
- 3 novos testes específicos passando.
- Total ~40 LoC test, 0 LoC src.

### NO-GO

Barney NÃO recomenda:
- Helper de teste customizado (`expectStringLock` etc.) — shelf-ware
  risk.
- E2E test pra Prévia disabled state — overkill pro problema; vitest
  regex match cobre 95% do valor por 5% do cost.
- Ampliar escopo pra "todos os botões disabled do app" — scope creep
  clássico.

---

*"This isn't just any test gap. This is a LEGEN-...-wait-for-it...-DARY
test gap. Legendary." — Barney, provavelmente*

— Barney Stinson, peer review crítico
*Audit conducted 2026-05-26 · 3 commits · 13 gaps identified · 3 P0 ·
6 P1 · 4 P2 · recomendação: backlog (não dispatch)*
