# RFC — Token Enforcement Infra (ESLint custom rule + conformance test)

**Status:** Draft (Marshall, Round 3 — UI/UX +50% campaign, post-priority)
**Data:** 2026-05-09
**Owner:** Marshall (schema/conformance/tests)
**Cross-refs:**
- `Docs/sessions/ted-delegation-plan-2026-05-08.md` §4.3 (spec inicial)
- `Docs/sessions/design-qa-baseline-2026-05-08.md` (90 finds)
- `Docs/sessions/design-qa-regression-2026-05-08.md` §3.2 (top 3 residuais
  CL-40/44/49 — 62 hits Identity*+Onboarding)
- `Docs/design-system.md` v0.7 (tokens canônicos drift-*)
- `Docs/rfcs/2026-05-rfc-design-system-v08.md` (paleta v0.8)
- `tests/manifesto-conformance.test.ts` (modelo LOCK_VIA_TEST)
- `tailwind.config.js` (whitelist tokens drift-*)

---

## §1 — Problema

### 1.1 Sintoma (medido)

Round 2 design-QA baseline (2026-05-08) identificou **90 finds** de drift
cromático (slate-* / emerald-* / red-* / yellow-* / hex literais) em
strings JSX de produção. Round 3 regression check (Robin) confirmou que
**62 hits residuais** vivem em 3 clusters S0/S1:

| Cluster | File | Hits | Severidade |
|---|---|---|---|
| CL-40 | `src/components/Identity/IdentityPanel.tsx` | ~30 (slate massa) | S0 |
| CL-44 | `src/components/Identity/IdentitySwitcher.tsx` | ~28 (slate massa) | S0 |
| CL-49 | `src/components/Onboarding/OnboardingOverlay.tsx` | ~16 (slate + emerald) | S1 |

Esses três representam **74% do residual total** após Round 2 cleanup.

### 1.2 Causa-raiz: regressão silenciosa

Hoje **não há gate mecânico** contra reintrodução. O LOCK_VIA_TEST
existente (`tests/manifesto-conformance.test.ts`) cobre vocabulário PT
(`espalhar`/`enterrar`) e protocolo (kinds 9079/9080), mas **não cobre
tokens visuais**. Cada PR pode introduzir `bg-slate-700` novo sem
falhar nada — só QA visual humana detecta, e QA visual não escala.

Resultado observável: ganhos de Round 1 (paleta v0.7 migration ~200
componentes) foram parcialmente erodidos em Round 2/3 por novos
componentes Identity/Onboarding que adotaram slate cru por
copy-paste. Sem enforcement, Round 4 cleanup é Sísifo.

### 1.3 Hot path (post-priority weighting)

User reforçou que componentes de POST são prioridade S0 — qualquer leak
ali é regressão crítica. Files no hot path:

```
src/components/Post/PostViewer.tsx
src/components/Post/CommentCard.tsx
src/components/Post/ThreadView.tsx
src/components/Post/ThreadHeader.tsx
src/components/Post/ReplySheet.tsx
src/components/Post/SubpostLayout.tsx
src/components/Post/SubpostCarousel.tsx
src/components/Post/ReportModal.tsx
src/components/Feed/PostCard.tsx
src/components/Create/ComposeOverlay.tsx
```

Esses 10 files recebem tratamento estrito desde Fase 1 (rule = error,
não warn). Ver §2.4 e §5.

### 1.4 Por que custom rule + conformance test (e não só um)

- **ESLint rule** dá feedback em IDE em tempo real, fail-fast no
  `--fix`/save, codemod-friendly. Mas roda só em arquivos editados no
  PR — pode pular casos onde a violação já existia mas só agora é
  contada (Robin's residual baseline, p.ex.).
- **Conformance test** roda full-tree em CI, oferece snapshot
  baseline-driven (gradual ratchet — count vai descendo, nunca
  subindo), e cabe naturalmente no padrão LOCK_VIA_TEST do projeto.

Os dois juntos: rule = preventivo (catch on write); conformance =
auditoria (catch on merge). Ambos baratos.

---

## §2 — ESLint rule custom: `drift/no-tailwind-non-drift-tokens`

### 2.1 Setup atual

Levantamento do repo (2026-05-09):

```
$ ls .eslintrc* eslint.config.*
(no matches)

$ cat package.json | jq '.scripts.lint'
"tsc -b --noEmit"
```

**Observação crítica:** Drift **não tem ESLint configurado hoje**. O
script `npm run lint` é só `tsc --noEmit`. Adicionar ESLint é
pré-requisito desta RFC.

### 2.2 Reuso vs custom

Investigado:

- **`eslint-plugin-tailwindcss`** (popular, 2k stars) — foca em ordering
  de classes, classnames duplicadas, e validação contra `tailwind.config`.
  Tem regra `no-custom-classname` que avisa quando classe não está em
  `tailwind.config`. **Não serve direto:** `slate-*` etc. **estão** em
  Tailwind core (não custom), então `no-custom-classname` ignora. Para
  Drift queremos o inverso — proibir o que é "core mas não-drift".
- **`eslint-plugin-better-tailwindcss`** — similar, mesma limitação.
- **Custom rule** é o caminho. ~150-200 LOC TypeScript. Leve, sem
  dependência de terceiros além de `@typescript-eslint/utils`.

### 2.3 Comportamento da regra

**Allowlist** (não falha):

- Qualquer classe começando com `drift-` (drift-bg, drift-surface,
  drift-accent, drift-spread, drift-bury, drift-text, drift-muted,
  drift-border, drift-body — i.e. tokens declarados em
  `tailwind.config.js` `theme.extend.colors.drift`)
- `transparent`, `currentColor`, `inherit`
- Grayscale neutro: `white`, `black`, `text-white`, `bg-black`,
  `border-white`, etc. (Tailwind defaults sem cor).
- Tokens de layout sem cor: `flex`, `grid`, `p-*`, `m-*`, `text-sm`,
  `font-mono` etc. — nada relacionado a cor passa pelo radar da regra.
- Modificadores `hover:`, `focus:`, `active:`, `dark:`, `md:`, etc. —
  unwrap antes de checar.
- Classes arbitrary com hex `[#xxxxxx]` — **flagged** mas com severidade
  separada (ver §2.5 hex literais).

**Blocklist** (falha = `error` em hot path / `warn` global Fase 1):

Classes Tailwind core de cor que **não** começam com `drift-` ou neutro:

```
slate-* | gray-* | zinc-* | neutral-* | stone-*    (greys core)
red-*   | orange-* | amber-* | yellow-*            (warm)
lime-*  | green-* | emerald-* | teal-*             (greens)
cyan-*  | sky-* | blue-* | indigo-*                (blues)
violet-* | purple-* | fuchsia-* | pink-* | rose-*  (warms 2)
```

Aplicada sobre prefixos: `text-`, `bg-`, `border-`, `ring-`,
`divide-`, `from-`, `to-`, `via-`, `placeholder-`, `caret-`,
`accent-`, `decoration-`, `outline-`, `shadow-` (quando shadow tem cor
explícita: `shadow-slate-500`).

### 2.4 Whitelist por path (escape hatches documentados)

```ts
// drift/no-tailwind-non-drift-tokens.config.ts
export const PATH_WHITELIST: PathRule[] = [
  // Design system primitives podem usar qualquer token (são a fonte).
  { pattern: 'src/components/UI/**', severity: 'off' },
  // Skeleton decorativo pode usar slate neutro (sem brand).
  { pattern: 'src/components/UI/DriftSkeleton.tsx', severity: 'off' },
  // SwipeHandler tem hex em feedback animation — dívida documentada
  // em design-system.md §2.5. Allow `[#xxxxxx]` arbitrary até purge.
  { pattern: 'src/components/Post/SwipeHandler.tsx',
    severity: 'warn', allowArbitraryHex: true },
  // GpsErrorBanner amber — off-pattern justified (warn, não error).
  { pattern: 'src/components/Feed/GpsErrorBanner.tsx', severity: 'warn' },
  // BootView pre-CSS-loaded (CL-58 Robin). Inline styles.
  { pattern: 'src/components/Boot/BootView.tsx', severity: 'warn' },
]

// Hot path — POST components em strict mode desde Fase 1.
export const HOT_PATH: string[] = [
  'src/components/Post/PostViewer.tsx',
  'src/components/Post/CommentCard.tsx',
  'src/components/Post/ThreadView.tsx',
  'src/components/Post/ThreadHeader.tsx',
  'src/components/Post/ReplySheet.tsx',
  'src/components/Post/SubpostLayout.tsx',
  'src/components/Post/SubpostCarousel.tsx',
  'src/components/Post/ReportModal.tsx',
  'src/components/Feed/PostCard.tsx',
  'src/components/Create/ComposeOverlay.tsx',
]
// Em hot path: severity = 'error' SEMPRE (override de Fase 1 warn-mode).
```

**Decisão de severidade resolve por precedência:**
1. Hot path → `error` (sem exceção, mesmo em Fase 1)
2. Path whitelist → severidade declarada
3. Default → `warn` em Fase 1, `error` em Fase 3

### 2.5 Hex literais

Caso especial: `className="bg-[#0c0c0b]"` ou `style={{ color: '#f87171' }}`.

- Em JSX `className=""`: detecta token `[#xxxxxx]` em arbitrary value.
  Reporta com mensagem "Hex literal em className. Use token drift-*
  (ver tailwind.config.js theme.extend.colors.drift)."
- Em `style={{ ... }}`: detecta valores literais string `#xxxxxx`.
  Mesma mensagem. Whitelist via `// drift-allow-hex: <reason>` comment
  na linha imediatamente acima (escape hatch auditável).

### 2.6 Stub de implementação (~180 LOC)

```ts
// eslint-rules/no-tailwind-non-drift-tokens.ts
import { TSESTree, ESLintUtils } from '@typescript-eslint/utils'

const BLOCKED_COLORS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const PROPERTY_PREFIXES = [
  'text', 'bg', 'border', 'ring', 'divide', 'from', 'to', 'via',
  'placeholder', 'caret', 'accent', 'decoration', 'outline',
]
const NEUTRAL_OK = new Set([
  'white', 'black', 'transparent', 'current', 'inherit',
])

const VARIANT_RE = /^(?:hover|focus|active|disabled|dark|sm|md|lg|xl|2xl|group-hover|peer-focus|first|last|odd|even):/
const HEX_RE = /\[#[0-9a-fA-F]{3,8}\]/g
const STYLE_HEX_RE = /^#[0-9a-fA-F]{3,8}$/

interface Options {
  hotPath: string[]
  whitelist: Array<{ pattern: string; severity: 'off' | 'warn' | 'error'; allowArbitraryHex?: boolean }>
  defaultSeverity: 'warn' | 'error'
}

export const rule = ESLintUtils.RuleCreator(
  (name) => `https://drift.docs/rfcs/2026-05-rfc-token-enforcement#${name}`
)({
  name: 'no-tailwind-non-drift-tokens',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow non-drift Tailwind color tokens in JSX className' },
    schema: [{ type: 'object', additionalProperties: true }],
    messages: {
      blocked: 'Token "{{cls}}" não é drift-* — use tokens declarados em tailwind.config.js (theme.extend.colors.drift). Cluster: {{cluster}}',
      hexLiteral: 'Hex literal "{{hex}}" em className/style. Use token drift-* ou adicione comment `// drift-allow-hex: <reason>` acima.',
    },
  },
  defaultOptions: [{}] as [Options],
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/')
    // 1. Resolve path-based severity (hotPath > whitelist > default)
    const isHotPath = HOT_PATH.some((p) => filename.endsWith(p))
    const wl = PATH_WHITELIST.find((w) => micromatch.isMatch(filename, w.pattern))
    if (!isHotPath && wl?.severity === 'off') return {}
    const effectiveSeverity = isHotPath
      ? 'error'
      : (wl?.severity ?? context.options[0]?.defaultSeverity ?? 'warn')

    function checkClassName(value: string, node: TSESTree.Node): void {
      const tokens = value.split(/\s+/).filter(Boolean)
      for (const raw of tokens) {
        const cls = raw.replace(VARIANT_RE, '')
        // Hex arbitrary
        if (HEX_RE.test(cls)) {
          if (!(wl?.allowArbitraryHex)) {
            context.report({ node, messageId: 'hexLiteral', data: { hex: cls } })
          }
          continue
        }
        // Drift OK
        if (cls.startsWith('drift-') || /^(?:text|bg|border|ring)-drift-/.test(cls)) continue
        // Neutral OK
        const lastSegment = cls.split('-').pop()!
        if (NEUTRAL_OK.has(lastSegment)) continue
        // Property prefix?
        const m = cls.match(/^([a-z]+)-([a-z]+)-/)
        if (!m) continue
        const [, prop, color] = m
        if (!PROPERTY_PREFIXES.includes(prop)) continue
        if (BLOCKED_COLORS.includes(color)) {
          context.report({
            node, messageId: 'blocked',
            data: { cls, cluster: clusterFor(filename) },
          })
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== 'className') return
        if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
          checkClassName(node.value.value, node)
        }
        // template literals + classNames(...) helper handled too
        if (node.value?.type === 'JSXExpressionContainer') {
          walkStringLiteralsInExpr(node.value.expression, (s, n) => checkClassName(s, n))
        }
      },
      // style={{ color: '#f87171' }} — flag hex literais
      Property(node) {
        if (node.value.type === 'Literal' && typeof node.value.value === 'string'
          && STYLE_HEX_RE.test(node.value.value)) {
          // Check for `// drift-allow-hex:` escape hatch on prev line
          const sourceCode = context.getSourceCode()
          const prevToken = sourceCode.getTokenBefore(node, { includeComments: true })
          const allowed = prevToken?.type === 'Line' && /drift-allow-hex:/.test(prevToken.value)
          if (!allowed) {
            context.report({ node, messageId: 'hexLiteral', data: { hex: node.value.value } })
          }
        }
      },
    }
  },
})
```

**Custos estimados:**
- Implementação: ~180 LOC TS + tests unit (~80 LOC).
- Effort Lily Round 4 Fase 1: 4-6h (incluindo plumbing ESLint setup
  inicial — `.eslintrc.cjs`, `package.json` script update, plugin
  registration via `eslint-plugin-local-rules` ou monorepo workspace
  `drift-eslint-plugin/`).

### 2.7 Test do próprio rule

`tests/eslint-rule-no-tailwind-non-drift-tokens.test.ts` (Vitest +
`@typescript-eslint/rule-tester`):

```ts
import { RuleTester } from '@typescript-eslint/rule-tester'
import { rule } from '../eslint-rules/no-tailwind-non-drift-tokens'

const ruleTester = new RuleTester()
ruleTester.run('no-tailwind-non-drift-tokens', rule, {
  valid: [
    { code: '<div className="bg-drift-surface text-drift-text" />' },
    { code: '<div className="bg-transparent border-white" />' },
    { code: '<div className="hover:text-drift-accent" />' },
    { code: '<div className="flex items-center p-4" />' },
    // Whitelisted path
    { filename: 'src/components/UI/DriftSkeleton.tsx',
      code: '<div className="bg-slate-800" />' },
  ],
  invalid: [
    { code: '<div className="bg-slate-700" />',
      errors: [{ messageId: 'blocked' }] },
    { code: '<div className="text-emerald-400" />',
      errors: [{ messageId: 'blocked' }] },
    { code: '<div className="bg-[#1a1a1a]" />',
      errors: [{ messageId: 'hexLiteral' }] },
    // Hot path: SEMPRE error mesmo em modo warn
    { filename: 'src/components/Post/PostViewer.tsx',
      code: '<div className="bg-slate-700" />',
      errors: [{ messageId: 'blocked', severity: 2 }] },
  ],
})
```

---

## §3 — Conformance test estático (`tests/design-system-conformance.test.ts`)

### 3.1 Modelo

Espelha o test `Vocabulary UI guard` em
`tests/manifesto-conformance.test.ts` (linhas ~338-430). Mesma
estratégia: walk `src/**/*.tsx` + strip comments + regex-based scan +
assert offenders array == [].

### 3.2 Estrutura

```ts
// tests/design-system-conformance.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const HOT_PATH = [
  'components/Post/PostViewer.tsx',
  'components/Post/CommentCard.tsx',
  // ... (10 files)
]
const WHITELIST_PATHS = [
  'components/UI/',
  'components/Boot/BootView.tsx',
  'components/Post/SwipeHandler.tsx',
  'components/Feed/GpsErrorBanner.tsx',
]
const BLOCKED_COLOR_RE =
  /\b(?:text|bg|border|ring|divide|from|to|via|placeholder|caret|accent|decoration|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g
const HEX_LITERAL_RE = /['"`]#[0-9a-fA-F]{3,8}['"`]/g

describe('Design system conformance — slate/emerald/red leak guard', () => {
  it('zero non-drift color tokens em hot path POST components (S0)', () => {
    const offenders = scanFiles(HOT_PATH.map((p) => join('src', p)), BLOCKED_COLOR_RE)
    expect(offenders, formatOffenders(offenders, 'POST hot path')).toEqual([])
  })

  it('non-drift token count <= baseline em src/** (snapshot ratchet)', () => {
    const baseline = JSON.parse(readFileSync(
      join(__dirname, 'design-system-baseline.json'), 'utf8'))
    const offenders = scanAllSrc(BLOCKED_COLOR_RE, WHITELIST_PATHS)
    const counts: Record<string, number> = {}
    for (const o of offenders) counts[o.file] = (counts[o.file] ?? 0) + 1
    for (const [file, baselineCount] of Object.entries(baseline.files)) {
      const actual = counts[file] ?? 0
      expect(actual,
        `${file}: count=${actual} > baseline=${baselineCount}. ` +
        `Você adicionou novo slate-*/etc. Use tokens drift-* ou edite o baseline.`
      ).toBeLessThanOrEqual(baselineCount as number)
    }
    // Strict: arquivo NOVO não pode ter offenses (baseline=0 implícito)
    for (const [file, actual] of Object.entries(counts)) {
      if (!(file in baseline.files)) {
        expect(actual, `${file}: NEW file with ${actual} offenders — adicione tokens drift-*`).toBe(0)
      }
    }
  })

  it('zero hex literais em strings JSX/style (exceto whitelist)', () => {
    const offenders = scanAllSrc(HEX_LITERAL_RE, [...WHITELIST_PATHS,
      'components/Post/SwipeHandler.tsx'])
    expect(offenders, formatOffenders(offenders, 'hex literais')).toEqual([])
  })
})
```

### 3.3 Baseline ratchet

`tests/design-system-baseline.json` é checked-in:

```json
{
  "_comment": "Snapshot de offenses por arquivo. Conformance test falha se count subir. Nunca aumentar manualmente — só descer (após migration codemod).",
  "_generated": "2026-05-09",
  "files": {
    "src/components/Identity/IdentityPanel.tsx": 30,
    "src/components/Identity/IdentitySwitcher.tsx": 28,
    "src/components/Onboarding/OnboardingOverlay.tsx": 16,
    "src/components/Identity/IdentityRecover.tsx": 4,
    "...": 0
  }
}
```

**Regra de update:** baseline só desce. Script helper
`scripts/update-design-baseline.mjs` recomputa de zero e falha se
algum count subiu vs versão git anterior:

```bash
$ node scripts/update-design-baseline.mjs
✓ IdentityPanel.tsx: 30 → 12 (-18, OK)
✓ IdentitySwitcher.tsx: 28 → 0  (-28, OK)
✗ ComposeOverlay.tsx: 0 → 3 (+3, REJECT — hot path file)
exit 1
```

### 3.4 Por que ratchet em vez de hard zero?

Migration big-bang dos 62 hits residuais é ~1-2h de codemod, mas
risco de regressão visual em Identity flow é alto (revisão por
componente recomendada). Ratchet permite migration incremental sem
bloquear PRs não-relacionados. Fase 3 (§5) elevará para hard zero
após codemod mass-migrate.

---

## §4 — Build gate (CI)

### 4.1 Estado atual

`.github/workflows/ci.yml` roda hoje:
1. `tsc -b --noEmit` (script `npm run lint`)
2. `vitest run` (script `npm run test`)
3. `vite build` (script `npm run build`)

### 4.2 Adições propostas

**Fase 1 (Round 4 early):**

```yaml
# .github/workflows/ci.yml — adicionar step
- name: ESLint (drift custom rules)
  run: npx eslint 'src/**/*.{ts,tsx}' --max-warnings 9999
  # max-warnings alto inicialmente — só bloqueia errors (hot path)
```

`package.json`:
```json
"scripts": {
  "lint": "tsc -b --noEmit && eslint 'src/**/*.{ts,tsx}'",
  "lint:strict": "tsc -b --noEmit && eslint 'src/**/*.{ts,tsx}' --max-warnings 0"
}
```

**Fase 3 (Round 5 ship):**

```yaml
- name: ESLint strict (drift custom rules)
  run: npm run lint:strict
  # max-warnings 0 → CI falha em qualquer warn novo
```

### 4.3 Conformance test

Já roda via `npm run test` (vitest run). **Sem mudança em CI** —
apenas adicionar o arquivo `tests/design-system-conformance.test.ts`
e o baseline JSON.

---

## §5 — Roll-out plan

### 5.1 Visão geral (3 fases)

| Fase | Round | Owner | O que ship | Severity |
|---|---|---|---|---|
| 1 | R4 early | Lily | ESLint setup + custom rule + conformance test (baseline atual) | hot path = error; resto = warn |
| 2 | R4 late | Marshall | Codemod mass-migrate slate-*→drift-muted; purge POST hot path **primeiro**, depois Identity/Onboarding | (severidades inalteradas) |
| 3 | R5 ship | Marshall + Lily | Elevar default warn → error; baseline → 0; CI `--max-warnings 0` | tudo = error |

### 5.2 Fase 1 — Setup + warn mode global, error em hot path

**Owner:** Lily. **Effort:** 4-6h.

Tasks:
1. `npm i -D eslint @typescript-eslint/parser @typescript-eslint/utils
   @typescript-eslint/rule-tester eslint-plugin-react micromatch`
2. Criar `.eslintrc.cjs` com config base TS + React + custom plugin
   local (`eslint-rules/index.ts`).
3. Implementar `eslint-rules/no-tailwind-non-drift-tokens.ts` (§2.6).
4. Criar `tests/eslint-rule-no-tailwind-non-drift-tokens.test.ts` (§2.7).
5. Criar `tests/design-system-conformance.test.ts` (§3.2).
6. Gerar baseline: `node scripts/update-design-baseline.mjs --init`.
7. Update `package.json` scripts (§4.2 Fase 1).
8. Update `.github/workflows/ci.yml` (§4.2 Fase 1).

**Saída esperada:**
- POST hot path verde (0 offenses — Round 1/2 já limpou esses files).
  Se algum aparecer, é fail imediato; Lily corrige no mesmo PR.
- Identity/Onboarding com warns visíveis em local + CI, mas sem fail.

**Risco Fase 1:** se hot path tiver offense escondida não detectada
até agora (improvável — Round 2 baseline scan cobriu), CI falha logo
e Lily migra inline. Mitigação: rodar conformance test localmente
ANTES de abrir PR de setup.

### 5.3 Fase 2 — Codemod purge

**Owner:** Marshall. **Effort:** 3-4h.

Tasks:
1. Implementar `scripts/codemod-slate-to-drift.mjs` (§6 abaixo).
2. **Batch 1 (POST hot path) — primeiro.** Inclui qualquer offense
   silenciosa em `Post/*` (esperado: 0; mas roda anyway para
   sanity).
3. Verificação visual: `npm run dev`, smoke test PostViewer +
   CommentCard + ThreadView + ComposeOverlay em mobile + desktop.
4. Commit isolado: "fix(post): codemod slate-*→drift-* in POST hot
   path". CI verde.
5. **Batch 2 (Identity cluster — CL-40, CL-44).** ~58 hits.
6. Verificação visual: identidade flow completo (login, switch,
   panel, recover). Comparação side-by-side com print do baseline.
7. Commit: "fix(identity): codemod slate-*→drift-* in IdentityPanel
   + IdentitySwitcher (CL-40+44)".
8. **Batch 3 (Onboarding — CL-49).** ~16 hits.
9. Verificação visual: onboarding flow completo (mobile primeiro).
10. Commit: "fix(onboarding): codemod slate-*→drift-* in
    OnboardingOverlay (CL-49)".
11. Update `tests/design-system-baseline.json` para refletir ~0
    contagens.

**Por que POST primeiro mesmo com 0 offenses esperadas:**
- Validar que codemod não quebra hot path antes de tocar Identity.
- Se algum slate residual estiver escondido em PostViewer, queremos
  saber em batch isolado (rollback fácil).
- Sinal pro time: "post é S0; cleanup começa por aí".

**Risco Fase 2:** codemod pode estragar utility classes não-cor que
parecem cor (`text-slate-300/50` em opacity modifier). Mitigação:
codemod faz dry-run print antes de write; humano revisa diff por
batch antes de commit.

### 5.4 Fase 3 — Elevate to error, ship

**Owner:** Marshall + Lily co-pilot. **Effort:** 1-2h.

Tasks:
1. `eslint-rules/no-tailwind-non-drift-tokens.ts` — mudar
   `defaultSeverity` de `warn` para `error`.
2. `package.json` — script `lint` agora == `lint:strict` (i.e.
   `--max-warnings 0`).
3. `tests/design-system-baseline.json` — todas as files com count 0
   (após Fase 2 limpou).
4. Conformance test "non-drift token count <= baseline" agora
   efetivamente "= 0" para todos os files não-whitelisted.
5. Update CI workflow para usar `npm run lint:strict` no main step.
6. Update `Docs/design-system.md` §X — declarar enforcement formal.

**Risco Fase 3:** PRs em flight quando o flip acontece podem ter
warns que viram errors, bloqueando merge. Mitigação: comunicação
prévia (#engineering channel + PR comment template), e janela de
graça de 1 sprint onde Lily ajuda a limpar PRs em flight.

### 5.5 Effort total

| Fase | Effort | Owner |
|---|---|---|
| Fase 1 (setup + rule + conformance) | 4-6h | Lily |
| Fase 2 (codemod + 3 batches purge) | 3-4h | Marshall |
| Fase 3 (flip warn→error) | 1-2h | Marshall + Lily |
| **Total** | **8-12h** | (split entre R4 + R5) |

---

## §6 — Codemod helper

### 6.1 Estratégia

Regex-based, não jscodeshift. Justificativa:

- Tailwind classnames são strings simples; AST overhead não compensa.
- jscodeshift tem cost de ramp-up + dependência adicional.
- Match table 1:1 (slate-700 → drift-surface, etc.) com fallback
  manual quando ambíguo.

### 6.2 Mapping table

```js
// scripts/codemod-slate-to-drift.mjs
const MAPPING = {
  // Surface greys (slate-* / gray-* → drift surface tokens)
  'bg-slate-900':  'bg-drift-bg',
  'bg-slate-800':  'bg-drift-surface',
  'bg-slate-700':  'bg-drift-border',
  'bg-slate-950':  'bg-drift-bg',
  'border-slate-800': 'border-drift-border',
  'border-slate-700': 'border-drift-border',
  'border-slate-600': 'border-drift-border',
  // Type
  'text-slate-100': 'text-drift-text',
  'text-slate-200': 'text-drift-text',
  'text-slate-300': 'text-drift-text',
  'text-slate-400': 'text-drift-muted',
  'text-slate-500': 'text-drift-muted',
  'text-slate-600': 'text-drift-muted',
  // Role tokens (semantic — não simplificar com slate→drift-muted!)
  'bg-emerald-400': 'bg-drift-spread',
  'bg-emerald-500': 'bg-drift-spread',
  'text-emerald-400': 'text-drift-spread',
  'border-emerald-500': 'border-drift-spread',
  'bg-red-400': 'bg-drift-bury',
  'bg-red-500': 'bg-drift-bury',
  'text-red-400': 'text-drift-bury',
  'text-red-500': 'text-drift-bury',
  'border-red-500': 'border-drift-bury',
  // Yellow/amber → caso a caso (Drift v0.7 não tem warning token; ver §7)
  // 'text-yellow-*': MANUAL
}

const AMBIGUOUS = [
  /\btext-yellow-\d+\b/,    // sem token drift correspondente — flag p/ humano
  /\btext-amber-\d+\b/,     // idem
  /-(?:slate|gray)-\d+\/(?:\d+)/, // opacity variants — caso a caso
]
```

### 6.3 Execução

```bash
# Dry run primeiro (sempre)
$ node scripts/codemod-slate-to-drift.mjs --dry --batch=post-hot-path
[DRY] src/components/Post/PostViewer.tsx: 0 changes
[DRY] src/components/Post/CommentCard.tsx: 0 changes
...
0 files changed, 0 lines.

# Identity batch
$ node scripts/codemod-slate-to-drift.mjs --dry --batch=identity
[DRY] src/components/Identity/IdentityPanel.tsx: 30 changes
  L42  bg-slate-800 → bg-drift-surface
  L43  text-slate-300 → text-drift-text
  ...
[AMBIGUOUS] L67: text-yellow-400 — no mapping. Edit manually or extend MAPPING.
30 mapped, 0 ambiguous.

# Apply
$ node scripts/codemod-slate-to-drift.mjs --batch=identity
✓ Applied. Run `npm run test` + visual smoke.
```

### 6.4 Casos onde codemod NÃO resolve

- `text-yellow-*` / `text-amber-*` em GpsErrorBanner, PowerOff
  banner — não há token drift-warning ainda. Ted's v0.8 RFC pode
  introduzir; até lá, casos viram warn whitelisted (§2.4).
- Opacity variants `text-slate-400/60` — codemod opta por mapeamento
  base (slate-400 → drift-muted) mas opacity stripping pode mudar
  visual. Codemod deixa esses como AMBIGUOUS pra revisão humana.
- Hex literais — não cobertos pelo codemod (nenhum mapping table
  faz sentido). Manualmente migrar pra tokens drift-* lookup em
  `tailwind.config.js`.

### 6.5 Por que purge POST antes de Identity

User reforçou que post é S0. Fluxo:

1. POST hot path → primeiro (mesmo com 0 offenses esperadas — sanity).
2. Verificação visual + smoke test passes.
3. Aí sim Identity batch (58 hits) — sabendo que codemod não quebrou
   hot path.
4. Onboarding por último (16 hits).

Sequência preserva o princípio "post é hot path" mesmo no plano de
remediação, e dá ponto de retorno seguro se Identity migration der
problema (revert do batch isolado).

---

## §7 — Cross-references e questões em aberto

### 7.1 Convergência com Ted v0.8 RFC

- Ted's `Docs/rfcs/2026-05-rfc-design-system-v08.md` introduz tokens
  novos (esperado: drift-warning para amber/yellow casos legítimos).
  Quando v0.8 fechar, atualizar §6.2 mapping com `text-yellow-* →
  text-drift-warning`. **Bloqueia parcialmente Fase 3** se v0.8 não
  shipou — sem token drift-warning, GpsErrorBanner fica warn
  permanente.
- Convergir com Lily se ela introduzir primitives novos em
  `src/components/UI/` na Fase 1 — esses files são whitelisted, não
  precisa migration mas precisa estar em mind do codemod scope.

### 7.2 Convergência com a11y (AY-4 drift-muted contrast)

- Robin's regression doc menciona AY-4: contraste de `drift-muted`
  (#4a4a46 sobre #0c0c0b) está borderline. Se decisão for bumpar
  token, codemod batch 2 deve esperar — caso contrário Identity
  migration vira "drift-muted" que depois precisa re-migrar pra
  novo valor. **Mitigação:** alinhamento Marshall+Lily+Robin antes
  de Fase 2 batch 2.

### 7.3 Falsos positivos esperados

Top 3 padrões que podem disparar falso positivo na regra:

1. **Comments contendo classnames de exemplo:**
   ```tsx
   // antes era bg-slate-700, migrado pra bg-drift-surface
   ```
   Mitigação: regra checa apenas JSXAttribute / Property AST nodes,
   nunca comments. Bypass natural. ✓
2. **Strings em props não-className** (ex.: `aria-label="text-red-500
   color"`). Mitigação: regra só dispara em `name === 'className'`. ✓
3. **classnames helper com expressões:**
   ```tsx
   <div className={clsx('bg-slate-800', cond && 'text-red-400')} />
   ```
   Mitigação: walker desce em string literals dentro de
   CallExpressions. Custo: ~30 LOC adicionais no rule (já contado
   nas ~180 LOC).

### 7.4 Por que NÃO usar PostCSS/Tailwind purge time check

Considerado: hook em build pra escanear class output após
Tailwind processing. Rejeitado:
- Roda só em build, não em IDE — feedback latente.
- Não distingue arquivos hot path de whitelisted.
- Tailwind resolve `bg-slate-800` da mesma forma que `bg-drift-bg`
  (alias é só nome em config; output é hex). Sem AST do source,
  perde-se file/path origin.

ESLint AST + conformance test grep cobrem todos os casos com
overhead aceitável.

### 7.5 Não-fazer (out of scope)

- **NÃO** introduzir token `drift-warning` nesta RFC. Decisão é Ted's
  (v0.8 RFC).
- **NÃO** remediar SwipeHandler hex hardcoded — dívida documentada
  em design-system §2.5; whitelisted aqui (§2.4).
- **NÃO** auto-fix do ESLint rule. Decisão consciente: muito risco
  de quebra visual silenciosa. Codemod é opt-in com dry-run obrigatório.
- **NÃO** estender enforcement pra spacing tokens (p-*, m-* etc.).
  Escopo é color regression only.

---

## §8 — Sumário executivo

**Problema:** 62 hits de slate-*/emerald-*/red-* em CL-40/44/49 cluster
erodem ganhos de Round 1/2. Sem gate mecânico, regressão silenciosa
continua. Hot path POST components (10 files) precisam tratamento
strict desde dia 1.

**Solução:** ESLint custom rule `drift/no-tailwind-non-drift-tokens`
(~180 LOC) + conformance test ratchet (~150 LOC) + codemod helper
(~120 LOC). Roll-out 3 fases (warn → purge → error).

**Effort:** 8-12h total split (Lily 4-6h Fase 1, Marshall 3-4h Fase 2,
duo 1-2h Fase 3).

**Viabilidade ESLint rule:**
- Custom necessário (plugins existentes não cobrem inverso de
  "non-drift core tokens proibidos").
- ESLint precisa ser instalado (não está hoje — `npm run lint` é
  só `tsc`). Setup ~1-2h dentro de Fase 1.
- Tooling maduro: `@typescript-eslint/utils` + `RuleTester` cobrem
  testing.

**Riscos top 3:**
1. Token `drift-warning` ausente (Ted v0.8 RFC pendente) força
   `text-yellow-*` whitelist permanente até v0.8 ship — atrasa Fase 3.
2. Codemod opacity variants ambiguous — humano em loop por batch.
3. PRs em flight no flip Fase 3 — janela de graça mitiga.

**Não-bloqueador:**
- Manifesto §7 (determinismo) não tocado — enforcement de visual
  tokens não afeta funções puras.
- Manifesto §17 (sem chave mestra) reforçado: enforcement aumenta
  visibilidade auditável de mudanças visuais (CI fails são públicos).

---

*RFC pronta para revisão. Próximo passo: alinhamento Marshall+Ted
sobre token drift-warning timing (bloqueador parcial Fase 3),
depois delegação Round 4 §4.3 Lily kick-off.*
