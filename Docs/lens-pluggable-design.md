# Lentes Pluggable + Shareable — Design Doc

> **Status:** PROPOSED (Sprint N+1 SPIKE)
> **Origin:** Ted persona dispatch 2026-05-20 (audit "promessa vs impl"
> + user brief "lentes ainda não são plugáveis nem compartilháveis")
> **Manifesto refs:** §17 (sem chave mestra), §22 (sem reputação
> subjetiva), §24 (sem afinidade no feed canônico), §28 (privacy mínima)

---

## Motivação

Hoje a Trust Lens é **monolítica hard-coded**:

- 1 algoritmo (PPR Monte Carlo Phase 1)
- 1 fórmula (`viewMultiplier`)
- 1 toggle de strength (0..100%)

Isso entrega o carve-out §24 ("view-layer LOCAL") tecnicamente, mas com
1 única forma de ver. Os 4 problemas:

1. **Sem agência real** — user que prefere "feed cronológico puro" não
   tem opção. Apenas slider 0→100% da MESMA lente.
2. **Sem experimentação** — comunidade não pode propor "lente que
   prioriza posts com imagem" sem PR direto no core.
3. **Sem compartilhamento** — user power que tunou config (decay
   on + strength 75%) não consegue compartilhar a *receita* com amigos.
4. **Risk de over-fitting** — único algoritmo significa que se ele tem
   bug ou viés, todos sofrem igual.

**Goal:** sistema declarativo de lentes onde cada lente é uma
*receita* (não compute) — registrável, escolhível, shareable, sem
violar manifesto.

---

## Boundary atual

```typescript
// src/lib/trust-lens.ts
export function applyLensToPost(input: {
  globalScore: number
  authorNpub: string
  mutualSpreadPost: number
}): number {
  const { strength } = useLensStore.getState()
  const pprScore = getPprForAuthor(input.authorNpub)
  return input.globalScore * viewMultiplier({
    pprScore,
    mutualSpreadPost: input.mutualSpreadPost,
    strength,
  })
}
```

Único ponto de uso: `src/lib/feed.ts` no view boundary do
`getGlobalFeed/getFollowingFeed/getTrendingFeed`.

**Esse é o ponto exato pra extrair a abstração.**

---

## Design proposto

### 1. Strategy Registry

```typescript
// src/lib/lens/types.ts

/** Contexto passado pra cada lens reorder() */
export interface LensContext {
  /** npub do user ativo, ou null se anônimo */
  readonly viewer: string | null
  /** Snapshot read-only do estado relevante */
  readonly now: number
  /** Hooks opcionais — lente decide se usa */
  readonly getPprScore?: (authorPub: string) => number
  readonly getFollows?: () => Set<string>
  // Marshall LOCK: NUNCA passar `db` cru aqui — write isolation
}

/** Resultado da reorder — apenas reordenação + opcionalmente reduction */
export interface LensResult {
  /** Posts reordenados. NUNCA inclui posts novos (lens é view-only). */
  readonly posts: readonly Post[]
  /** Opcional: hint pro inspector ("este post foi reordenado") */
  readonly reorderedIds?: ReadonlySet<string>
}

/** Interface canônica que toda lente implementa */
export interface LensStrategy {
  /** ID estável — referencia em prefs, conformance tests */
  readonly id: string
  /** Nome user-friendly (i18n quando vier) */
  readonly name: string
  /** Versão semver pra evolução de schema do config */
  readonly version: number
  /** Descrição curta pra UI dropdown */
  readonly description: string

  /**
   * Função pura. Recebe posts (deep-cloned) + contexto, retorna nova
   * ordem. NÃO escreve em nada, NÃO chama `db.run`, NÃO touchea
   * window/document.
   */
  reorder(posts: readonly Post[], ctx: LensContext): LensResult

  /**
   * Validação de config user-provided (do shareable LensConfig).
   * Returns sanitized OR throws com mensagem human-readable.
   */
  validateConfig?(config: LensConfig): LensConfig
}
```

### 2. Registry singleton

```typescript
// src/lib/lens/registry.ts

class LensRegistry {
  private strategies = new Map<string, LensStrategy>()
  private activeId: string = 'ppr-trust' // default

  register(strategy: LensStrategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Lens ${strategy.id} already registered`)
    }
    // Freeze pra impedir mutation pós-registro
    Object.freeze(strategy)
    this.strategies.set(strategy.id, strategy)
  }

  getActive(): LensStrategy {
    const s = this.strategies.get(this.activeId)
    if (!s) throw new Error(`No lens registered for ${this.activeId}`)
    return s
  }

  setActive(id: string): void {
    if (!this.strategies.has(id)) {
      throw new Error(`Unknown lens: ${id}`)
    }
    this.activeId = id
  }

  list(): readonly LensStrategy[] {
    return [...this.strategies.values()]
  }
}

export const lensRegistry = new LensRegistry()

// Built-in lenses (registered no boot)
import { PprTrustLens } from './strategies/ppr-trust'
import { ChronologicalLens } from './strategies/chronological'
import { ImageFirstLens } from './strategies/image-first'

lensRegistry.register(new PprTrustLens())     // default — atual
lensRegistry.register(new ChronologicalLens()) // feed puro sem boost
lensRegistry.register(new ImageFirstLens())    // posts c/ imagem boostam
```

### 3. Wiring com feed

```typescript
// src/lib/feed.ts (futuro)
import { lensRegistry } from './lens/registry'

function applyActiveLens(posts: Post[]): Post[] {
  const lens = lensRegistry.getActive()
  const ctx: LensContext = {
    viewer: useBootStore.getState().identity?.npub ?? null,
    now: Date.now(),
    getPprScore: getPprForAuthor,
    getFollows: () => useFollowsStore.getState().following,
  }
  // Deep-clone pra isolation — lens não pode mutar source
  const cloned = posts.map((p) => ({ ...p }))
  return lens.reorder(cloned, ctx).posts as Post[]
}
```

### 4. Shareable config

```typescript
// src/lib/lens/config.ts

export interface LensConfig {
  /** Plugin ID — bate com LensStrategy.id */
  readonly type: string
  /** Schema version — lens valida compat */
  readonly version: number
  /** Parâmetros tuneáveis (strength, decay, etc.) */
  readonly params: Readonly<Record<string, number | string | boolean>>
  /** SHA-256 da canonical JSON pra integridade (opcional) */
  readonly hash?: string
}

export async function exportLensConfig(
  lens: LensStrategy,
  params: LensConfig['params'],
): Promise<LensConfig> {
  const canonical = canonicalJson({ type: lens.id, version: lens.version, params })
  const hash = await sha256Hex(canonical)
  return { type: lens.id, version: lens.version, params, hash }
}

export function importLensConfig(config: LensConfig): void {
  const lens = lensRegistry.list().find((l) => l.id === config.type)
  if (!lens) throw new Error(`Lens '${config.type}' não está registrada`)
  if (lens.version !== config.version) {
    throw new Error(
      `Versão incompatível: lens=${lens.version} config=${config.version}`,
    )
  }
  const sanitized = lens.validateConfig?.(config) ?? config
  // Apply params + setActive
  applyLensParams(lens.id, sanitized.params)
  lensRegistry.setActive(lens.id)
}
```

**Sharing mediums:**

1. **JSON export** — Settings → "Export lens config" gera download `.json`
2. **URL fragment:** `drift://lens?type=ppr-trust&strength=0.75&decay=1` — opens app w/ pre-filled config
3. **QR code** — encoda config compacta em QR (~200 bytes), user escaneia
4. **NIP-XX event** — kind 9095 candidate. User publica como evento Nostr, outros subscribe + recomputam local

**Manifesto §24 preservado:** receita é dado público; compute é local.
Outro user que importa MESMA config + tem MESMO state SQLite chega ao
MESMO resultado (manifesto §7 determinismo).

---

## Threat model

### Risco 1: Lente maliciosa escreve em `posts.score`

**Vetor:** plugin malicioso recebe `posts` array, chama `db.run('UPDATE posts SET score=999')` direto.

**Defesa em camadas:**

1. **API isolation:** `LensContext` NÃO expõe `db`. Lens só recebe
   read-only access via hooks específicos (`getPprScore`, `getFollows`).
2. **Deep clone:** posts passados pra `reorder()` são `{ ...p }`
   (shallow clone) — mutações em propriedades primitive não vazam
   pro source. (Trade-off: arrays/objects nested ainda compartilham
   refs; lens precisa documentar isso.)
3. **Conformance test:** `tests/lens-plugin-isolation.test.ts` —
   `MaliciousLens` que tenta mutar SQLite via try/catch, assert state
   inalterado pós-`reorder()`.
4. **Object.freeze no register:** strategy não pode mutar a si mesma
   pós-registro (impede prototype pollution).

### Risco 2: Lente vaza dados locais

**Vetor:** plugin envia `npub` + `follows` pra servidor externo via
`fetch()`.

**Defesa:**

1. **Pure function discipline:** `reorder()` documentado como pure.
   Lints + code review.
2. **CSP (futuro):** Content-Security-Policy bloqueia
   `connect-src` desconhecido. Já parcial via PWA manifest.
3. **Conformance test:** `tests/lens-plugin-purity.test.ts` —
   mock `fetch`, registra lens, chama `reorder()`, assert fetch NÃO
   foi chamado.

### Risco 3: Lente quebra determinismo

**Vetor:** plugin usa `Math.random()` em vez de seeded RNG → mesma
config + mesmo state produz resultados diferentes em cada call.

**Defesa:**

1. **Conformance test:** `tests/lens-plugin-determinism.test.ts` —
   chama `reorder()` 2× com mesmos inputs, assert outputs idênticos.
2. **Convenção:** se lens precisa randomness, deve receber RNG via
   `ctx` (futuro extensão).

---

## Migração: PprTrustLens refatorada

Step-by-step pra preservar bit-exactness:

```typescript
// src/lib/lens/strategies/ppr-trust.ts
import type { LensStrategy, LensContext, LensResult } from '../types'
import { useLensStore } from '../../trust-lens' // legacy store, mantido
import { viewMultiplier } from '../../trust/ppr'

export class PprTrustLens implements LensStrategy {
  readonly id = 'ppr-trust'
  readonly name = 'Sua Lente (PPR Trust)'
  readonly version = 1
  readonly description = 'Reordena baseado em quem você segue e drifts mútuos'

  reorder(posts: readonly Post[], ctx: LensContext): LensResult {
    const { strength } = useLensStore.getState()
    if (strength === 0) return { posts } // bit-exact off-state

    const reordered = [...posts]
      .map((p) => ({
        post: p,
        sLocal: p.score * viewMultiplier({
          pprScore: ctx.getPprScore?.(p.authorPub) ?? 0,
          mutualSpreadPost: 0, // simplificação; PR seguinte adiciona
          strength,
        }),
      }))
      .sort((a, b) => b.sLocal - a.sLocal)
      .map((x) => x.post)

    return { posts: reordered }
  }
}
```

LOCK_VIA_TEST conformance: snapshot de `reorder()` com fixture conhecido
produz mesmo array pre/pós refactor (bit-exact migration).

---

## Milestones

| Fase | Duração | Output |
|---|---|---|
| **SPIKE** (sprint N+1) | 2-3d | Este doc + `lens/types.ts` + `PprTrustLens` skeleton + 3 conformance tests |
| **POC** (sprint N+2) | 4-5d | `LensRegistry` + 2 lentes alt (Chronological, ImageFirst) + UI dropdown Settings + 8-10 conformance tests |
| **SHIP** (sprint N+3) | 2-3d | `exportLensConfig` / `importLensConfig` + URL fragment + QR opt + doc user-facing + decisão política qual lens default |

---

## Decisões abertas

| Decisão | Opções | Recomendação |
|---|---|---|
| Default lens em novo user | (a) ppr-trust (atual) (b) chronological (mais neutro) | (b) chronological — manifesto §24 sugere que default deveria ser "sem afinidade" |
| Lens config sharing format | (a) só JSON (b) JSON + URL (c) JSON + URL + NIP-XX | (b) ship — NIP-XX defer pra próxima fase |
| Como sandbox lens externa | (a) iframe sandboxed (b) Web Worker (c) só built-in lenses | (c) MVP — externas defer Fase 7+ com WASM modules |
| Threading | (a) main thread (b) Web Worker | (a) MVP — worker defer (já backlogged) |

---

## §6 — Composição de lentes (Set Theory)

> **Adicionado 2026-05-21** após user brief: "Além da lente padrão,
> deve-se poder plugar lentes de outros, e fazer interseção, união...
> etc igual teoria de conjuntos."

User não está limitado a 1 lente ativa. Pode **compor lentes** usando
operações de teoria de conjuntos sobre o resultado de cada lente
(`LensResult.posts`).

### Operações canônicas

Cada lente roda `reorder()` produzindo `LensResult.posts: readonly Post[]`.
Composição opera sobre essas listas como conjuntos ordenados:

| Operação | Símbolo | Semântica | Resultado |
|---|:---:|---|---|
| **União** | `A ∪ B` | "Mostre se aparece em A OU B" | Conjunto union; ordem usa `score` médio entre lentes |
| **Interseção** | `A ∩ B` | "Mostre só se aparece em A E B" | Conjunto intersection; ordem usa max-rank |
| **Diferença** | `A − B` | "Mostre os de A, exceto os de B" | Subtract; útil pra "minha lente menos a do amigo" |
| **Diferença simétrica** | `A △ B` | "Mostre só os de A OU B, mas NÃO os de ambos" | XOR; explora divergência |
| **Complemento** | `¬A` (em U) | "Inverter A no universo U" | Pega tudo fora de A; útil pra debug |

### Modelo: `LensExpression` composição declarativa

```typescript
// src/lib/lens/composition.ts

export type LensExpression =
  | { kind: 'lens'; id: string; config?: LensConfig }    // folha
  | { kind: 'union'; left: LensExpression; right: LensExpression }
  | { kind: 'intersection'; left: LensExpression; right: LensExpression }
  | { kind: 'difference'; left: LensExpression; right: LensExpression }
  | { kind: 'symmetric'; left: LensExpression; right: LensExpression }
  | { kind: 'complement'; inner: LensExpression }
```

Composição é **árvore**, não cadeia — permite paralelismo + caching.
Profundidade max recomendada: 4 níveis (após isso, custo de compute
> ganho cognitivo).

### Resolução

```typescript
export function evaluateLensExpression(
  expr: LensExpression,
  universe: readonly Post[],
  ctx: LensContext,
): LensResult {
  switch (expr.kind) {
    case 'lens': {
      const lens = lensRegistry.get(expr.id)
      const params = expr.config?.params ?? {}
      return lens.reorder(universe, { ...ctx, params })
    }
    case 'union': {
      const a = evaluateLensExpression(expr.left, universe, ctx)
      const b = evaluateLensExpression(expr.right, universe, ctx)
      return composeUnion(a, b)
    }
    case 'intersection': {
      const a = evaluateLensExpression(expr.left, universe, ctx)
      const b = evaluateLensExpression(expr.right, universe, ctx)
      return composeIntersection(a, b)
    }
    // ... difference, symmetric, complement
  }
}
```

### Ordering rules (manifesto §7 determinismo)

**Crítico:** composição precisa ser **determinística cross-device**.
Mesma expressão + mesmo universe + mesmo state → mesmo array de saída
(ordem inclusive).

Regras:

1. **Union (A ∪ B):** para cada post, score = `(rankA + rankB) / 2`
   onde `rankX = posição em X` (ou `Infinity` se ausente). Tie-break:
   ordem em A.
2. **Intersection (A ∩ B):** subset. Ordem: max-rank entre A e B
   (post bem-rankeado em ambas sobe).
3. **Difference (A − B):** filter pure. Ordem preservada de A.
4. **Symmetric (A △ B):** = `(A ∪ B) − (A ∩ B)`. Ordem: ranking médio.
5. **Complement (¬A em U):** = `U − A`. Ordem: por `Post.id` lexico
   (sem ranking; mostra "tudo que A esconde").

### Shareable expressions

`LensExpression` é JSON-serializable → mesma infra de sharing do
`LensConfig`:

```jsonc
{
  "kind": "intersection",
  "left": {
    "kind": "lens",
    "id": "ppr-trust",
    "config": { "type": "ppr-trust", "version": 1,
                "params": { "strength": 0.75 } }
  },
  "right": {
    "kind": "lens",
    "id": "image-first",
    "config": { "type": "image-first", "version": 1, "params": {} }
  }
}
```

Sharing: JSON / URL fragment / QR / NIP-XX event 9095. Mesma receita
+ mesmo state SQLite local em 2 clientes = mesma ordem (§7).

### Exemplos de composições úteis

| Expressão | Significado prático |
|---|---|
| `ppr-trust(0.75)` | "Lente do João" (a default dele) |
| `ppr-trust(0.75) ∪ image-first` | "Minha lente PLUS posts com imagem" |
| `ppr-trust ∩ chronological` | "Quem eu sigo, em ordem cronológica" |
| `meu-feed − amigo.json` | "O que eu vejo, MENOS o que meu amigo vê" |
| `lente-comunidade-X △ lente-comunidade-Y` | "Onde X e Y divergem" |
| `¬amigo.json` | "Tudo que meu amigo NÃO veria" (debug / curiosidade) |

### Threat model — composição

Cada operação tem mesma defesa do `LensStrategy` base:
- **API isolation:** composição recebe `readonly Post[]`, nunca write
- **Determinism test:** evaluação 2× com mesma expr+universe = mesmo output
- **Limite de profundidade:** rejeitar expressões com depth > 8 (DOS protection)

**Cuidado novo:** complemento (`¬A`) em universe vazio retorna vazio.
Documentar. Conformance test #N: `complement(any_lens, [])` retorna `[]`.

### Limits do MVP

- Composição binária (operações 2-ary). Generalização N-ary fica pra
  POC futuro (`union([A, B, C])`).
- Sem "weighted union" no MVP (ex: `0.7·A + 0.3·B`). Pode entrar
  como operation custom no Sprint N+3.
- Plugin externo NÃO pode adicionar novos operadores no MVP — só
  built-in (`union`, `intersection`, `difference`, `symmetric`,
  `complement`).

### Manifesto compliance da composição

| § | Como composição preserva |
|---|---|
| **§7 Determinismo** | Ordering rules acima são bit-exact reproduzíveis |
| **§17 Sem chave mestra** | Receita é declarativa; nenhum operador "secreto" do fundador |
| **§22 Sem reputação subjetiva** | Composição opera sobre ordens locais; nada exportado |
| **§24 Sem afinidade canônica** | Mesmo que A∪B, resultado vive APENAS no view boundary |
| **§28 Privacy mínima** | Receita compartilhada é code-only; nenhum dado pessoal embutido |

### Roadmap composição (atualiza milestones gerais)

| Fase | Adição vs milestones base |
|---|---|
| **SPIKE** (Sprint N+1) | + esboço de `LensExpression` type + 2 operadores (union, intersection) sketched em design |
| **POC** (Sprint N+2) | + `evaluateLensExpression` impl + 3 operadores ship'd + UI "combinar lentes" simples (2 dropdowns + operador) + 5 conformance tests |
| **SHIP** (Sprint N+3) | + complemento + symmetric + UI tree-editor + share expression via URL/QR/NIP-XX 9095 |

---

## Compatibilidade retro

- `useLensStore.setStrength()` continua funcionando — internamente
  vira `applyLensParams('ppr-trust', { strength })` + `setActive('ppr-trust')`
- Conformance test #19 (strength=0 → bit-exact off-state) preserved
- `LensInspector` UI continua mostrando chip "lente" — adicionada
  layer pra exibir qual lens está ativa

---

## Manifesto compliance

| § | Como o design preserva |
|---|---|
| **§7 Determinismo** | `reorder()` é pure function; conformance test trava |
| **§17 Sem chave mestra** | Cliente não impõe "lente oficial" — user escolhe |
| **§22 Sem reputação subjetiva** | Receita compartilhada é code-public, não dado pessoal |
| **§24 Sem afinidade canônica** | Lens é local-only; nunca escreve em `posts.score` (test #2) |
| **§28 Privacy mínima** | LensConfig só inclui params explicitamente (nenhum behavioral signal exportado) |

---

*Doc criado 2026-05-20 (Ted dispatch). Status: PROPOSED. Atualizar para
APPROVED após Marshall + Barney pair-review. Implementação começa em
Sprint N+1 SPIKE.*
