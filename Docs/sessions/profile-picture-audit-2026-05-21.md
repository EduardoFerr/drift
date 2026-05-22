# Profile Picture — audit Lily 2026-05-21

**Trigger user:** "Backlog: Peça para algum agente investigar a 'imagem
de perfil', aparentemente não funciona definir uma"

**Persona:** Lily (core code, runtime, UX)

---

## TL;DR — Feature INCOMPLETA, não bug

User CONSEGUE publicar foto de perfil. Avatar APARECE em ProfileModal.
Avatar **NUNCA aparece** em posts/feed/comments — porque `rowToPost()`
em `feed.ts` nunca foi terminado pra popular `authorAlias` /
`authorAvatar` do `Post` type. Não é bug; é feature MVP+1 abandonada.

---

## Inventário do flow

| Etapa | Status | Arquivo | Observação |
|---|:---:|---|---|
| UI input | ✅ OK | `EditProfileCard.tsx:168-175` | URL input com trim + validação |
| Publish kind 0 | ✅ OK | `profiles.ts:111-126` | `publishUserMetadata()` assina + broadcast |
| Persist | ✅ OK | `events.ts:764-810` | `persistUserMetadata` LWW + store ping |
| Query local | ✅ OK | `profiles.ts:168-188` | `getUserMetadata(npub)` |
| Hook reativo | ✅ OK | `profiles.ts:225-244` | `useUserMetadata()` re-query |
| ProfileModal render | ✅ OK | `ProfileModal.tsx:299-335` | Avatar OK (com identicon fallback) |
| **Feed posts render** | ❌ **FALHA** | `feed.ts:319-339` | `rowToPost()` NÃO popula `authorAvatar`/`authorAlias` |
| **PostViewer/SubpostLayout** | ❌ **FALHA** | `SubpostLayout.tsx` | Sem header de autor |
| **CommentCard** | ❌ **FALHA** | provavelmente idem | |

---

## Root cause

Type `Post` em `types/drift.ts:143-161` define **opcionais**:
```ts
authorAlias?: string
authorAvatar?: string
```

Mas `feed.ts:rowToPost()` (linhas 319-339) **omite** esses campos.
Resultado: `post.authorAvatar === undefined` SEMPRE. PostViewer +
SubpostLayout nunca renderizam header de autor porque os campos não
existem.

Silent fallback mascarava o bug (UI não quebra, só não mostra avatar
em lugar nenhum exceto ProfileModal).

---

## Fix proposto (~4-6h, NÃO shipar nesta sessão)

1. **feed.ts:rowToPost** — LEFT JOIN `users_metadata` pra popular
   `authorAvatar` (picture) + `authorAlias` (name OR display_name)
   - ~50 LoC
   - Query mais cara: index `users_metadata.npub` já existe
2. **SubpostLayout.tsx** — header com avatar + name nos 3 layouts
   (portrait/landscape/text)
   - ~100 LoC
3. **CommentCard.tsx** — idem comments
   - ~50 LoC
4. **LOCK_VIA_TEST** — avatar no feed === picture no kind 0

**Total:** ~200 LoC + tests. Cabe em P2 da Sprint N+2.

---

## Manifesto compliance se shippar

- §5.3 (opt-in identity) OK — picture já é opt-in via kind 0
- §28 privacy OK — só renderiza picture que o autor publicou
- §22 sem reputação OK — avatar é metadado visual, não input do score

---

## Reopener

Implementar agora (Sprint N+2 P2) OU defer? Honestidade Lily:
- **Implementar agora:** UX melhor (user sente "feature funciona"),
  fecha mismatch entre "publica mas não aparece"
- **Defer:** ~5h custo pra feature cosmética; manifesto não exige

User decide. Plano pronto pra Sprint N+2 inclusion como P2.
