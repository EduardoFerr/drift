# RFC: Registry pattern pra `onNostrEvent` em `src/lib/events.ts`

**Status**: Proposed (RFC apenas — não-bloqueante)
**Autor**: Robin (revisão: research / cross-cutting)
**Data**: 2026-05-07
**Persona inputs**: Ted (gatilho do threshold de 3 kinds), Marshall (conformance), Lily (manutenibilidade)

---

## §1 — Problem statement

Hoje `src/lib/events.ts` despacha 5 kinds via combinação de `if isNip22Comment` + `switch (event.kind)`:

```ts
// events.ts:35-68 (resumido)
if (!isDriftKind && !isNip22Comment) return
if (!passesSchemaCheck(event)) return
if (!verifyDriftEvent(event)) return
if (isNip22Comment) { await persistCommentRow(event); return }
switch (event.kind) {
  case DRIFT_KIND.POST:   await persistPost(event); return
  case DRIFT_KIND.SPREAD: await persistSpread(event); return
  case DRIFT_KIND.BURY:   await persistBury(event); return
  case DRIFT_KIND.REPORT: await persistReport(event); return
}
```

`passesSchemaCheck` tem o mesmo formato — switch separado em `events.ts:88-120`. **Há duas máquinas de despacho paralelas que precisam ficar em sync** (uma rejeitando schema, outra persistindo). Adicionar kind novo exige tocar:

1. `DRIFT_KIND` em `src/config/constants.ts` (se proprietário).
2. Novo branch em `passesSchemaCheck`.
3. Novo branch no switch principal de `onNostrEvent`.
4. Nova função `persistFooBar` (idempotente, INSERT OR IGNORE, `invalidateFeed`, `scheduleScoreRecalc`).
5. Migration em `schema.sql` (provavelmente).
6. Test conformance em `tests/manifesto-conformance.test.ts` se a tabela for nova de domínio (espelhar o pattern "INSERT INTO X só em events.ts").
7. Tipos em `src/types/drift.ts`.

**Threshold do Ted**: 3 kinds bastava pra justificar refatoração. Hoje são 5 (4 Drift + NIP-22 reuse). Roadmap do CLAUDE.md reserva 9082 (boost pago) e 9083+ (TBD). Quando 9082 entrar, o switch tem 6 ramos com pipeline idêntico (cheap → expensive → persist → invalidate). Custo marginal por kind cresce linear na quantidade de pontos de edição (7 acima), com risco real de drift entre as duas máquinas (alguém adiciona case no `switch` e esquece o `passesSchemaCheck`).

**Evidência atual** (events.ts é um arquivo de 841 linhas):

- L35-68: dispatcher principal
- L88-120: `passesSchemaCheck` (segundo dispatcher)
- L227-263: `persistPost`
- L265-290: `persistSpread`
- L328-340: `persistBury`
- L367-410: `persistCommentRow`
- L412-472: `persistReport`

Os handlers já são funções coesas — só falta a indireção que evita os dois switches.

**Pressão da invariante #1** (CLAUDE.md): toda escrita em domínio passa por `events.ts`. O conformance test em `tests/manifesto-conformance.test.ts:655-679` faz check **por path literal** (`src/lib/events.ts`). Qualquer registry tem que continuar fazendo o INSERT dentro desse arquivo, não em handler externo. Isso restringe o desenho.

---

## §2 — Proposed API

```ts
// src/lib/events.ts (mesmo arquivo — invariante #1 + conformance test)

import type { SignedEvent } from '../types/nostr'

/**
 * Resultado de validação de schema. `null` = rejeitar silenciosamente.
 * Tipo opaco específico do handler — events.ts não inspeciona.
 */
type SchemaParse<T> = T | null

interface KindHandler<TParsed = unknown> {
  /** Kind numérico — chave do registry. */
  kind: number
  /**
   * Validação cheap, ANTES de verifyDriftEvent. Sem db, sem await
   * (Ted invariante #5 — manter ordem cheap→expensive). Retorna parsed
   * struct (passada pra persist) ou null pra rejeitar.
   *
   * Pode ler tags + JSON.parse(content). NÃO pode chamar db ou crypto.
   */
  validateSchema(event: SignedEvent): SchemaParse<TParsed>
  /**
   * Persiste no SQLite. Recebe o parsed da validação (evita re-parse).
   * DEVE ser idempotente (INSERT OR IGNORE). DEVE chamar invalidateFeed()
   * quando muda estado visível em feed. Retorna postId pra debounced
   * recalc (ou null se kind não afeta score — ex: kinds só-side-effect).
   *
   * Roda DENTRO de events.ts (closure) — não viola invariante #1.
   */
  persist(event: SignedEvent, parsed: TParsed): Promise<string | null>
}

/** Map kind → handler. Privado ao módulo. */
const KIND_HANDLERS = new Map<number, KindHandler<any>>()

function registerKindHandler<T>(handler: KindHandler<T>): void {
  if (KIND_HANDLERS.has(handler.kind)) {
    throw new Error(`[events] kind ${handler.kind} already registered`)
  }
  KIND_HANDLERS.set(handler.kind, handler as KindHandler<any>)
}

// Pipeline reescrito — preserva ordem do invariante #5
export async function onNostrEvent(event: SignedEvent): Promise<void> {
  // 1. Cheap: kind check (Map lookup, O(1))
  const handler = KIND_HANDLERS.get(event.kind)
  if (!handler) return

  // 2. Cheap: schema check (sem db, sem crypto)
  const parsed = handler.validateSchema(event)
  if (parsed === null) return

  // 3. Expensive: verify Schnorr
  if (!verifyDriftEvent(event)) return

  // 4. Persist (handler decide INSERT + invalidateFeed)
  const postIdForRecalc = await handler.persist(event, parsed)

  // 5. Debounced recalc (centralizado — handler só sinaliza)
  if (postIdForRecalc !== null) scheduleScoreRecalc(postIdForRecalc)
}
```

**Exemplo: handler do COMMENT (kind 1111) usando o registry**

```ts
// Mesmo arquivo events.ts, abaixo das funções persist atuais
registerKindHandler<ParsedNip22Comment>({
  kind: NIP22_COMMENT_KIND,
  validateSchema(event) {
    if (!getTag(event, 'drift-version')) return null
    if (typeof event.content !== 'string') return null
    if (event.content.length === 0) return null
    if (event.content.length > COMMENT_MAX_CHARS) return null
    const parsed = parseNip22Comment(event)
    if (!parsed) return null
    if (parsed.rootKind !== String(DRIFT_KIND.POST)) return null
    return parsed // passa pra persist sem re-parse
  },
  async persist(event, parsed) {
    // Sanity #1: top-level reply — `e` DEVE === `E`
    if (parsed.parentKind === String(DRIFT_KIND.POST)) {
      if (parsed.parentEventId !== parsed.rootEventId) return null
      if (parsed.parentPubkey !== parsed.rootPubkey) return null
    }
    await db.run(
      `INSERT OR IGNORE INTO comments
       (id, post_id, reply_to, author_pub, content, created_at, raw_event, score, content_warning)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        event.id,
        parsed.rootEventId,
        parsed.parentEventId,
        event.pubkey,
        event.content,
        event.created_at,
        JSON.stringify(event),
        getTag(event, 'content-warning'),
      ],
    )
    await updateUserActivity(event.pubkey, event.created_at)
    bumpCommentCount(parsed.rootEventId, event.id)
    return parsed.rootEventId // → scheduleScoreRecalc no pipeline
  },
})
```

**Ganho**: a parte específica do COMMENT vive numa unidade coesa. Fica óbvio que `validateSchema` é o filtro pré-verify e `persist` é pós-verify. O dois-switches paralelo some — kind é registrado em **um lugar**.

**Custo**: indireção via Map lookup (negligível, O(1) amortizado), e perda do exhaustive switch do TypeScript (`switch(event.kind)` força `default` ou erro de compile com union). Mitigação: adicionar test que itera `KIND_HANDLERS` e verifica que cada `DRIFT_KIND` tem handler registrado (conformance §28-30 compat).

---

## §3 — Invariantes mantidas

### Invariante #1 — única porta de INSERT em domínio

**Mantida.** Handlers são definidos **dentro do mesmo arquivo** `src/lib/events.ts` (módulo-level `registerKindHandler` calls). O conformance test em `tests/manifesto-conformance.test.ts:655` que checa `INSERT INTO comments` por path literal continua passando — o SQL ainda fisicamente reside em `src/lib/events.ts`. Se um handler vivesse em outro arquivo (Alt C abaixo), violaria o conformance test e pioraria o invariante.

**Risco a vigiar**: dev futuro tenta extrair handler pra `src/lib/handlers/comment.ts` "pra organizar melhor" — quebra conformance. Documentar em comentário no topo de events.ts: `// Handlers DEVEM viver neste arquivo. Conformance test trava por path.`

### Invariante #5 — ordem do pipeline

**Mantida e mais explícita.** Pipeline central em `onNostrEvent` força a ordem:

1. Map.get (cheap)
2. handler.validateSchema (cheap, sync, sem db)
3. verifyDriftEvent (expensive)
4. handler.persist (db writes + invalidateFeed)
5. scheduleScoreRecalc

Tipo `SchemaParse<T>` proíbe async em validateSchema por contrato (não tem `Promise<T | null>`, é `T | null`). Test pode adicionar lint check: `validateSchema` body sem `await` (igual o test que faz pra `applyCommentReceived` em conformance.test.ts:640).

### Invariante #6 — debounced recalc

**Mantida.** `scheduleScoreRecalc` permanece centralizado no pipeline; handler retorna `postId` (ou null se não-aplicável, ex: kind futuro que só tenha side-effect sem post associado). Hoje `persistPost` chama `scheduleScoreRecalc(postId)` direto; com registry o pipeline chama. Comportamento idêntico (mesmo debounce, mesma janela 100ms).

**Observação Lily**: `persistReport` hoje chama `maybeModerate` (não `scheduleScoreRecalc`). No registry, REPORT handler retornaria `null` pra recalc e faria `maybeModerate` dentro do `persist`. Comportamento preservado.

### Invariante #7 — determinismo (manifesto §7)

**Mantida.** `validateSchema` é puro por contrato (sync, sem db). Persist tem `Date.now()` em alguns casos (ex: `maybeModerate(postId, Date.now())` em persistReport) — isso já não era puro, e o registry não muda. As funções *negócio* puras (`calculateScore`, `selectLatestActionByUser`, `applyCommentReceived`) continuam fora do registry, em `scoring.ts`/`weight.ts`/`moderation.ts`.

---

## §4 — Migration path

Recomendação: **strangler-pattern incremental, 1 PR por kind**, na seguinte ordem (mais simples → mais complexo):

1. **PR 1 — infra** (sem mover kinds):
   - Adiciona tipos `KindHandler<T>`, `SchemaParse<T>`, função `registerKindHandler`.
   - Adiciona Map `KIND_HANDLERS` mas **não** muda `onNostrEvent`.
   - Adiciona test que valida estrutura do registry (vazio ou com seed).
   - Verde no CI sem mudar comportamento.

2. **PR 2 — BURY** (handler mais simples: 1 tag, 1 INSERT, 1 invalidate, recalc).
   - Migra BURY pro registry; mantém switch antigo com case BURY removido.
   - Pipeline `onNostrEvent` ganha branch híbrido: `if registry.has(kind) use registry; else fallback switch`.
   - Tests existentes verdes.

3. **PR 3-6 — SPREAD, REPORT, COMMENT, POST** (um por vez, mesma estrutura).
   - Cada PR remove o `case` correspondente do switch e adiciona handler.
   - POST por último porque é o mais complexo (subposts, location, content-warning, seenPostIds, bumpUnseenCount).

4. **PR 7 — cleanup**:
   - Remove o switch fallback.
   - Remove `passesSchemaCheck` exportado (se ninguém mais consome — checar imports).
   - Adiciona conformance test: "todo `DRIFT_KIND` + `NIP22_COMMENT_KIND` tem handler registrado em events.ts".
   - Adiciona conformance test: "validateSchema bodies sem `await`/`db.run`" (defesa contra invariante #5).

**Por que não big bang**: events.ts é caminho crítico — kind check + verify roda em todo evento de relay (~centenas/min em sessões ativas). Migrar 5 handlers num PR único + revisar = janela de regressão grande. Strangler permite revert pontual (REPORT quebrou? Reverter PR 4 sem tocar nos outros handlers já migrados).

**Backward-compat durante transição**: branch híbrido no PR 2 (`if KIND_HANDLERS.has(event.kind)` → registry; senão → switch). Custo: 1 condicional extra por evento (negligível). Permite verde contínuo entre PRs.

**Tests**: cada PR de migração mantém os tests existentes verdes. Test novo do PR 7 ("todo kind tem handler") trava regressão futura — adiciona kind no `DRIFT_KIND` sem registrar handler = test vermelho.

**Cap esforço total**: ~6h de execução (1h infra + 4×30min handlers simples + 1h POST + 1h cleanup/tests). Dentro do orçamento Ted/Lily.

---

## §5 — Trade-offs e alternativas

### Alt A — Manter switch (status quo)

**Quando vale**: se Drift fica congelado em 5 kinds (sem 9082, sem 9083+) — o switch escala fine até ~8-10 kinds. switch tem **exhaustive check do TypeScript** se `event.kind` for narrow union (hoje não é, é `number`, mas dá pra refinar). Zero indireção, debug stack trace direto.

**Quando NÃO vale**: roadmap CLAUDE.md já reserva 9082 (boost pago, manifesto §18) e 9083+ (TBD). Quando 9082 entrar com pipeline idêntico (cheap → expensive → INSERT → invalidate), são 3 lugares pra editar (DRIFT_KIND, passesSchemaCheck, switch persist). E o segundo switch (`passesSchemaCheck`) continua sendo a fonte real de drift — alguém vai adicionar case num e esquecer no outro. Já passou perto: COMMENT (kind 1111) hoje tem **fluxo separado** (`if isNip22Comment` antes do switch) porque adicionar case `1111:` no switch principal sem adicionar em `passesSchemaCheck` daria comportamento bizarro. A complexidade do "vale a pena unificar?" já bateu na cara do dev.

### Alt B — Registry proposto (recomendado)

Detalhes em §2-§4. Pontos fortes:

- Unifica os dois switches num registro único por kind.
- Custo marginal de adicionar kind: 1 lugar (registerKindHandler call) + migration + types + conformance test (que já era inevitável).
- Documentação executável: o handler é a especificação do kind.

Pontos fracos:

- Perde exhaustive check do switch (mitigado por test "todo kind tem handler").
- Indireção via Map (debug ligeiramente mais opaco — mitigado por nomes claros: `KIND_HANDLERS.get(9078)` é tão legível quanto `case DRIFT_KIND.POST`).
- ~30 linhas de boilerplate de tipos e função register (uma vez só).

### Alt C — Cada kind em arquivo próprio sem registry (file-based dispatch)

Ex: `src/lib/handlers/post.ts`, `spread.ts`, etc., cada um exportando `validateSchema` e `persist`. `events.ts` importa tudo e mantém switch.

**Por que rejeitar**:

1. **Quebra invariante #1 + conformance test**. O test em `tests/manifesto-conformance.test.ts:655-679` valida que `INSERT INTO comments` aparece **só em** `src/lib/events.ts`. File-based dispatch viola isso por construção. Pra preservar, precisaria reescrever o conformance test pra aceitar `src/lib/handlers/*.ts` — mas aí o invariante "única porta" vira "alguma porta dentro de uma whitelist", o que dilui a intenção (atacante/dev distraído tem alvos múltiplos).
2. Resolve só metade do problema: o switch principal continua existindo em events.ts. Ganha-se separação física (5 arquivos) mas perde-se concentração analítica (revisor agora abre 5 arquivos pra avaliar pipeline).
3. Não casa com o estilo do codebase: features cross-cutting (sync, scoring, moderation) já vivem cada uma em UM arquivo — split por kind seria padrão novo sem ganho proporcional.

### Recomendação: Alt B com honestidade sobre o ROI

Vale fazer **antes do kind 9082** entrar. Hoje (5 kinds) o switch ainda é gerenciável; o argumento forte é o **custo marginal futuro** + **eliminação dos dois switches paralelos**. Se 9082 estiver longe (>6 meses), a prioridade é baixa — mas ainda assim faz sentido fazer junto com 9082 pra evitar adicionar o 6º case e *depois* refatorar (dois passes).

**No-go honesto**: se 9082 nunca vier (decisão produto: Drift fica nos 4 kinds + COMMENT) e 9083+ for vaporware, manter switch é a escolha certa. Nesse cenário o registry vira over-engineering: 30 linhas de tipos + Map + 5 handlers boilerplate pra resolver problema que não vai escalar. Ted prefere honestidade, então registro: **se o roadmap de kinds congelar, esta RFC vira no-go retroativo**.

---

## §6 — Não-objetivos

Esta RFC NÃO propõe e NÃO resolve:

- **Lazy loading de handlers**. Todos handlers são imported eagerly em events.ts. Lazy loading via dynamic import quebraria o conformance "INSERT só em events.ts" e introduziria latência no primeiro evento de cada kind. Drift não tem tantos kinds que justifique split-loading.
- **Plugin system de terceiros pra adicionar kinds**. Manifesto §17 (sem chave mestra) — cliente oficial não aceita plugin de moderação/scan. Por extensão, registry é interno: terceiros forkam o cliente, não plugam handlers em runtime. `registerKindHandler` é função privada do módulo (não exportada).
- **Mudar invariante #1**. Handlers continuam fazendo `db.run` direto (não há indireção tipo `repository pattern` ou ORM). Conformance test continua valendo por path literal.
- **Mudar pipeline order** (invariante #5). Cheap→expensive→persist→invalidate é imutável; registry só re-organiza quem implementa cada passo.
- **Centralizar `invalidateFeed`**. Continua sendo decisão do handler (ex: `persistReport` chama dentro do `try`/`finally` da moderação; `persistPost` chama antes do recalc por causa de UI optimistic). Tentar centralizar no pipeline geraria invalidações desnecessárias ou faltantes.
- **Refatorar `recalculateScore` ou `applyCommentsContribution`**. São funções de score (puras + db read), fora do registry — apenas chamadas via `scheduleScoreRecalc`.
- **Migrar para event sourcing puro com replay**. Drift já é event sourcing; o que está em discussão é só a forma de despachar o `apply` de cada evento na materialização local.

---

## §7 — Decisão recomendada

**Recomendação: GO condicional.**

- **Go-now**: se kind 9082 (boost pago) está no roadmap concreto pra Fase 6 ou 7. Faz sentido pré-lançar registry pra que 9082 entre como handler #6 já no padrão novo, evitando refatorar o switch *depois* que ele tem 6 cases.
- **Go-with-9082**: se 9082 é ~3-6 meses fora, fazer registry **junto** com o PR de 9082. Evita stranger pattern pra modificação especulativa.
- **No-go retroativo**: se Drift congelar em 5 kinds permanentemente (decisão produto), manter switch. ~30 linhas de boilerplate sem ganho proporcional.

**Encaixe de fase**: Fase 6 (cliente nativo) ou Fase 7 (distribuição), antes de 9082. Não é Fase 5.x (operacional fechada).

**Estimativa de execução** (se go): ~6h total, distribuídas em 7 PRs strangler:
- 1h — PR 1 (infra: tipos + Map + register, sem comportamento novo)
- 30min × 4 — PRs 2-5 (BURY, SPREAD, REPORT, COMMENT)
- 1h — PR 6 (POST — handler mais complexo)
- 1h — PR 7 (cleanup + conformance tests novos: "todo kind tem handler", "validateSchema sem await")

Cada PR tem footprint pequeno (50-100 linhas), CI verde contínuo, revert pontual possível. Apto pra Lily executar em sessões curtas, paralelizadas com outras tarefas Fase 6.

---

*Robin · 2026-05-07 · revisão pendente: Ted (arquitetura), Marshall (conformance/types), Barney (security — verificar que validateSchema não pode ser bypassed por handler malformado)*
