# Per-subpost content-warning gap (TM-3)

**Data:** 2026-05-08
**Persona:** Marshall (HIMYM — schema, types, conformance, data flow)
**Origem:** Barney TM-3 em `barney-test-posts-2026-05-08.md` §5
**Status:** **bug confirmado — verdict (b)**. Não fix nesta sessão; doc pra triage.

---

## §1 Finding (1 frase)

Content-warning hoje é uma **propriedade do post inteiro**, não dos
subposts individuais — um autor pode publicar 2 subposts com subpost 1
inocente + subpost 2 NSFW (sem CW marcado) e o leitor com `hide_nsfw`
ativo só verá o blur se o autor marcar o post inteiro como NSFW.

---

## §2 Evidência arquitetural

### §2.1 Schema (`src/types/drift.ts`)

```ts
// linha 71-94
export interface Subpost {
  id: string
  type: SubpostType
  text: string | null
  imageUrl: string | null
  order: number
  meta?: BlobMeta
  layout?: LayoutKind
  // ❌ NÃO HÁ campo `contentWarning` nem `cw`
}

// linha 143-161
export interface Post {
  id: string
  ...
  contentWarning: ContentWarning | string | null  // ✅ a nivel post
  ...
}
```

`Subpost` não tem nenhum campo de classificação de conteúdo. Único campo
de aviso vive em `Post.contentWarning`.

### §2.2 Protocolo (`src/lib/protocol.ts:91`)

```ts
// createPost — único path de publicação
if (input.contentWarning) tags.push(['content-warning', input.contentWarning])
```

CW vai como **uma única tag** no kind 9078 (a nivel do evento Nostr —
um evento = um post = um CW). Spec NIP-36 / Drift §27 não prevê
classificação por subpost; a tag é singular.

### §2.3 UI Compose (`src/components/Create/ComposeOverlay.tsx`)

```ts
// linha 117-119 — state ÚNICO compartilhado entre todos os subposts
const [contentWarning, setContentWarning] = useState<ContentWarning | null>(null)

// linha 382 — comentário inline
{/* Content warning picker (compartilhado entre todos os subposts). */}
<ContentWarningRow value={contentWarning} onChange={setContentWarning} />
```

UI explicitamente trata CW como propriedade global do post — picker
único no rodapé do compose, fora da iteração por subpost. Não há toggle
NSFW/spoiler/etc. no editor de cada subpost.

### §2.4 Renderização (`src/lib/feed.ts:357`)

```ts
export function applyContentFilters(post: Post, prefs: UserPrefs): RenderHint {
  ...
  const cw = post.contentWarning  // ⬅ lê só do post, não dos subposts
  if (!cw) return { blur: false, hide: false, reason: null }
  ...
}
```

`PostViewer.tsx:117` chama `applyContentFilters(post, prefs)` UMA vez
por post — gera um `RenderHint` que aplica blur/hide a todo o card,
independente de qual subpost o user está vendo via swipe ←→.

### §2.5 SubpostLayout (`src/components/Post/SubpostLayout.tsx`)

```bash
$ grep -n "contentWarning|hint|blur" SubpostLayout.tsx
39: TAG synthesis: post.category || post.location?.city || post.contentWarning.
109: "⚠ NSFW" (contentWarning), "DERIVA" (fallback).
115: if (parts.length === 0 && post.contentWarning) {
```

SubpostLayout só lê `post.contentWarning` pra synthesizeTag (chip
visual no header do subpost). Não recebe `RenderHint` por subpost,
não aplica blur granular, não conhece classificação per-subpost.

---

## §3 Atack scenario (TM-3 cenário concreto)

1. Atacante A cria post com 2 subposts:
   - Subpost 1: foto inocente de gato + texto "look at this cat"
   - Subpost 2: imagem NSFW + texto "and now bait"
2. Atacante NÃO marca content-warning (`contentWarning = null`).
3. Post chega no feed do leitor B com prefs default
   (`show_nsfw_default: false`, `hide_spoilers: true`).
4. `applyContentFilters({contentWarning: null}, prefs)` retorna
   `{blur: false, hide: false}` — sem moderação visual.
5. Subpost 1 renderiza como esperado.
6. User B faz swipe → e vê subpost 2 NSFW sem nenhum aviso.

**Workaround atual:** B precisa reportar o post (kind 9081) e esperar
threshold dinâmico (manifesto §26) zerar o score (=-999). Latência da
ordem de minutos a horas dependendo de como pesos de reporters
agregam — janela de exposição grande.

**Mitigação parcial existente:** se autor for de boa fé e marcar o
post inteiro como NSFW pra cobrir o subpost 2, o blur é aplicado
**a todos os subposts** (subpost 1 também fica blurred até user
clicar reveal). Isso é semanticamente correto pelo schema atual mas
representa atrito UX desnecessário pra subposts mistos.

---

## §4 Proposta de fix

Duas alternativas, ranked por preferência do Marshall:

### Opção A — disjunção implícita: aceitar a granularidade do post

**Mudança schema:** nenhuma. CW continua a nivel do post.

**Mudança UX:** ComposeOverlay valida no `handlePublish`:
- Se algum subpost tem imagem **e** o user não marcou CW global,
  warning leve antes de publicar ("subposts com imagem sem aviso —
  prosseguir?").
- Não bloqueia publish (manifesto §27 — auto-classificação é
  voluntária). Só lembra.

**Manifesto compatibility:** §27 explícito diz "autor declara, leitor
filtra". Reinforça-se a responsabilidade do autor sem forçar nada.

**Cost estimate:**
- ComposeOverlay.tsx: +1 modal de confirmação. ~30 LOC.
- Sem schema migration.
- Sem mudança em events.ts/feed.ts/SubpostLayout.tsx.
- 1 test em ComposeOverlay (warning aparece quando esperado).

**Total: ~1h dev + 15min testes.**

### Opção B — granularidade real per-subpost

**Mudança schema:**
```ts
export interface Subpost {
  ...
  contentWarning?: ContentWarning | string | null  // ⬅ novo campo
}
```

`createPost` serializa CW per-subpost no JSON content
(`{subposts: [{...cw}, ...]}`) — outros clientes Nostr ignoram
silenciosamente (NIP-01 não regula payload de aplicação).

**Mudança protocolo:**
- Tag global `content-warning` continua existindo; vira disjunção
  ("se qualquer subpost tem CW, post tem CW na tag global pro
  filtering compatível com clientes não-Drift").
- Reader Drift novo prefere o per-subpost se presente.

**Mudança UI Compose:** ContentWarningRow movida pra **cada subpost**
em vez de footer global. State `Map<draftId, CW>` ou campo na
DraftSubpost.

**Mudança renderer:**
- `applyContentFilters` ganha variant `applyContentFiltersSubpost(subpost, post, prefs): RenderHint`
- PostViewer calcula `RenderHint` ao trocar `subpostIdx` (não só
  ao mudar `post`).
- SubpostLayout recebe `hint?: RenderHint` opcional; quando
  presente, sobrepõe blur class no card render.

**Manifesto compatibility:** §27 ainda OK — auto-classificação fica
mais granular, não mais coercitiva. §29 (compat com Nostr) preservado
(tag global garante backward compat).

**Cost estimate:**
- types/drift.ts: +1 campo opcional. ~5 LOC.
- protocol.ts: serialize per-subpost. ~10 LOC.
- events.ts: parse per-subpost. ~10 LOC.
- feed.ts: nova função `applyContentFiltersSubpost`. ~30 LOC + tests.
- ComposeOverlay.tsx: per-subpost picker + state shape. ~50 LOC.
- PostViewer.tsx: re-calc hint on subpost change. ~10 LOC.
- SubpostLayout.tsx: opcional blur overlay. ~15 LOC.
- Tests: +5 cases (parse retro, render hint per subpost, etc).
- Migration concern: posts antigos com tag global continuam funcionando
  via fallback no parser (CW global aplica a todos os subposts).

**Total: ~4-6h dev + 1h testes + 1h QA visual em ComposeOverlay.**

---

## §5 Recomendação

**Marshall recomenda Opção A** pra triage imediato. Razões:

1. **Custo/benefício:** Opção B muda 7 arquivos pra fechar um vetor que
   o manifesto §27 explicitamente delegou ao autor + leitor. Atacante
   determinado pode sempre publicar conteúdo problemático em post
   text-only sem CW — schema mais granular não fecha o vetor base,
   só reduz uma instância dele.

2. **Threshold §26 já cobre o pior caso:** posts realmente abusivos
   (NSFW não-consentido, harassment) viram score = -999 via reports
   comunitários — schema simples não impede esse mecanismo.

3. **§27 v2.2:** "auto-classificação voluntária" + "filtros locais
   opt-in (blur por default)" — texto canônico não menciona
   granularidade per-subpost. Adicionar é interpretação mais estrita
   do que o manifesto exige.

4. **Aceleração via review fora da Fase atual:** se Opção B for
   priorizada, vira RFC própria (`Docs/rfcs/2026-XX-rfc-per-subpost-cw.md`)
   com Ted/Barney/Lily review estruturado — risco de schema break
   exige peer review formal, não só fix em sprint.

**Decisão Arquiteto requerida:** A vs B vs deferir TM-3 (aceitar como
"limitação documentada" sem fix). Em qualquer caso, este doc fica
como referência arquitetural pra futuros TMs do Barney sobre content
sharding.

---

## §6 Cross-references

- `Docs/manifesto.md` §27 (auto-classificação voluntária)
- `Docs/manifesto.md` §26 (moderação threshold dinâmico)
- `Docs/sessions/barney-test-posts-2026-05-08.md` §5 TM-3 (origem)
- `src/types/drift.ts:71-94` (Subpost schema sem CW)
- `src/lib/protocol.ts:85-128` (createPost — single tag)
- `src/lib/feed.ts:357-387` (applyContentFilters — post-level)
- `src/components/Create/ComposeOverlay.tsx:117-119, 382-386` (UI single picker)
- `src/components/Post/PostViewer.tsx:117` (hint application)

---

*Marshall · 2026-05-08 · Audit only (sem fix). Verdict (b): per-subpost
CW NÃO existe; fix proposta em §4 aguarda decisão Arquiteto.*
