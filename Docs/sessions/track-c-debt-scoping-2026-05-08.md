# Track C — débitos pós-merge (scoping)

**Data:** 2026-05-08
**Persona:** Lily (core code, runtime, fluxos de dados, manutenibilidade)
**Escopo auditado:** ThreadView, ReplySheet, CommentCard, ThreadHeader, comments.ts, thread-cursor.ts (5 componentes + 2 lib).
**Estimativa de execução (Ted, prévia):** 3–5h.
**Restrição:** scoping only — sem fixes, sem commit. Cap de 1.5h.

---

## Tabela resumo

| Arquivo | Bugs latentes | Polish UX | TODOs/cleanup | Total | Estimativa exec. (min) |
|---|---:|---:|---:|---:|---:|
| `src/components/Post/ThreadView.tsx` | 4 | 3 | 2 | 9 | 95 |
| `src/components/Post/ReplySheet.tsx` | 3 | 3 | 2 | 8 | 75 |
| `src/components/Post/CommentCard.tsx` | 2 | 2 | 2 | 6 | 50 |
| `src/components/Post/ThreadHeader.tsx` | 1 | 2 | 1 | 4 | 25 |
| `src/lib/comments.ts` | 2 | 0 | 2 | 4 | 40 |
| `src/lib/thread-cursor.ts` | 0 | 0 | 1 | 1 | 5 |
| **Total** | **12** | **10** | **10** | **32** | **~290 min (~4h50)** |

---

## ThreadView.tsx

### Bugs latentes

**TV-B1 — Cleanup do `previousFocusRef` mounta-uma-vez perde re-foco se prop muda (linha 90–96).**
O effect de focus restoration roda só no mount (`[]` deps). Se o componente persistir e `postId` mudar (ex.: navegar de uma thread pra outra sem desmontar), `previousFocusRef.current` não é re-capturado. Hoje o `App` provavelmente desmonta, mas é assumption não-documentada. **Importa**: a11y regression silenciosa. **Fix**: adicionar `postId` como dep ou documentar mount-only com comentário.

**TV-B2 — `dismissCoach` referenciado em `onKey` é stale closure (linha 158, deps em 170).**
O effect de keyboard tem deps `[onClose, replyOpen, coachVisible]` mas chama `dismissCoach()` que lê `coachVisible` via closure. Funciona porque `coachVisible` está nas deps, mas o `setPref` dentro de `dismissCoach` poderia drift se a função for refatorada. **Importa**: trap pra futuro contributor; bug latente quando alguém adicionar lógica em `dismissCoach`. **Fix**: extrair `dismissCoach` em `useCallback` com deps explícitas, ou inline.

**TV-B3 — Effect de truncate de cursor pode causar loop se cursor reset não estabiliza (linha 66–79).**
`useEffect` deps `[cursor, index.byId, onClose]`. Quando trunca via `setCursor(...)`, re-roda. Se `index.byId` mudar entre truncates (sub chega novo durante navegação), cursor pode oscilar. Investigar: provável que `lastValidIdx === path.length - 1` early-return cubra, mas em race com `addCommentToStore` durante truncate é não-trivial. **Importa**: pode levar a render thrash em threads ativas. **Fix**: adicionar log + estresse manual; possivelmente substituir por `useMemo` derivando cursor válido em vez de effect.

**TV-B4 — IIFE no JSX recria `replyTo`/`replyToKind` a cada render (linha 309–327).**
Não é bug funcional, mas o IIFE roda sempre, e re-renderiza `<ReplySheet>` mesmo com `open=false` (e a sheet decide nada-fazer via AnimatePresence). OK pra perf hoje, mas re-cria o `cursor?.path.at(-1)` a cada render do parent. **Investigar**: medir se causa flash em prop de ReplySheet quando `open=true` e cursor muda durante typing. **Fix**: extrair via `useMemo` ou só renderizar `<ReplySheet>` se `replyOpen`.

### Polish UX

**TV-P1 — Swipe sem feedback haptico/visual em ações no-op (linhas 213–217).**
`onPrev`/`onNext`/`onUp` só são passados quando há vizinho. Mas `onDown` sempre passa (vai pra `handleAscend` que pode `exit`). User que tenta ↓ no root recebe close abrupto sem confirm visual. **Esperado**: micro-shake ou toast "fechando…" antes de ascend → exit. **Fix**: condicionar `onDown` ou adicionar pre-exit feedback.

**TV-P2 — Coach 3s timeout sem progress bar / sem opção de "não mostrar mais" explícita.**
Linha 99–106 dismissa em 3s, persistindo `thread_coach_seen=true`. User que olhou rápido perde info; não tem como reabrir. **Esperado**: link "como navegar?" no header pra reexibir, ou settings toggle. **Fix**: adicionar entry em prefs UI (Fase 5+).

**TV-P3 — `containerRef.current?.focus()` no mount pode roubar focus de input ativo no Feed.**
Linha 92. Se user abriu ThreadView por click em link, ok. Se abriu por kbd shortcut enquanto digitava em outro input, focus muda silenciosamente. **Fix**: validar `document.activeElement` antes ou capturar via `requestIdleCallback`.

### TODOs/cleanup

**TV-T1 — Variable shadowing `currentNode` (linha 173 + 311).**
Declarado no escopo do componente e shadow-redeclarado dentro do IIFE. Lint provavelmente não pega porque escopo é diferente, mas confunde. **Fix**: renomear interno pra `currentNodeForReply`.

**TV-T2 — Comentário órfão "(ReplyPlaceholder removido…)" (linhas 397–398).**
Histórico de migração C.4.4. Não documenta nada útil agora. **Fix**: remover.

---

## ReplySheet.tsx

### Bugs latentes

**RS-B1 — `restoreFocusRef` pode capturar elemento desmontado (linhas 142–145).**
Quando ReplySheet abre via FAB de ThreadView, `document.activeElement` é o FAB. Se ThreadView desmontar (raro mas possível em race com cursor truncate → `onClose`), o `prev.focus()` em `useEffect` cleanup falha silenciosamente (try/catch já cobre, mas focus vai pro body). **Importa**: a11y degradation. **Fix**: validar `document.contains(prev)` antes do focus.

**RS-B2 — `handleFile` sem cancellation se user fecha sheet durante upload (linha 149–169).**
Se `setUploading(true)` e user dismisse, o async continua, eventualmente chama `setBlobMeta` em componente que está em exit animation ou desmontado. React vai logar warning "state update on unmounted". **Importa**: warning em console + memory leak curto. **Fix**: AbortController passado pra `uploadBlob` ou flag `mounted` ref.

**RS-B3 — Drag-down dismiss bypassa `pending` check em algumas paths (linha 330–332).**
`onDragEnd` checa `!pending`, OK. Mas o backdrop click também checa (linha 316). Se `pending=true`, drag funciona mas não fecha — sheet fica "stuck". **Investigar**: visual feedback durante pending de que drag não vai fechar. **Fix**: desabilitar drag quando pending (`drag={pending ? false : 'y'}`).

### Polish UX

**RS-P1 — `placeholder="sua resposta…"` sem indicação de Cmd/Ctrl+Enter.**
Linha 379. Shortcut documentado em comentário mas não na UI. **Esperado**: hint "⌘↵ pra publicar" perto do botão. **Fix**: adicionar `<span>` no footer.

**RS-P2 — `aria-keyshortcuts="Escape"` no botão close mas não no submit (linha 363).**
Inconsistência a11y. **Fix**: adicionar `aria-keyshortcuts="Meta+Enter Control+Enter"` no botão "publicar".

**RS-P3 — Image preview sem alt input (linha 487–507).**
NIP-94 suporta `alt` (mostrado em CommentCard linha 117), mas ReplySheet não permite digitar. Acessibility gap pra autores que querem documentar imagem. **Fix**: input opcional "descrição da imagem (alt)".

### TODOs/cleanup

**RS-T1 — Magic number `80` (px) em drag threshold (linha 331).**
Sem constante nomeada. **Fix**: `const DRAG_DISMISS_THRESHOLD_PX = 80`.

**RS-T2 — Magic placeholder `'📎'` para reply só-imagem (linha 211).**
Comentário explica mas merece constante exportada (`COMMENT_IMAGE_ONLY_PLACEHOLDER`) — testes podem assertar. **Fix**: extrair pra `lib/protocol.ts` ou top-of-file.

---

## CommentCard.tsx

### Bugs latentes

**CC-B1 — `applyContentFiltersComment` chamado com `usePrefsStore()` retorna o state inteiro, sem selector (linha 52).**
Selector ausente faz componente re-renderizar em qualquer mudança em prefs (relays, theme, etc.), mesmo irrelevantes pra CW. **Importa**: render thrash em ThreadView ativo enquanto user toca settings paralelo. **Fix**: usar selector estável `usePrefsStore(s => ({ blur: s.cw_blur_*, mute: s.muted, block: s.blocked }))` com `shallow`.

**CC-B2 — `overrideHidden` controla DOIS placeholders distintos (linha 98–103).**
Mesmo state `overrideHidden` é set tanto pelo `HiddenPlaceholder.onReveal` quanto pelo `CwHiddenPlaceholder.onReveal`. Se um comment for hidden+CW, revelar o CW também desbloqueia o moderation hide (e vice-versa). **Importa**: pode acidentalmente expor conteúdo moderado em comment com CW. **Fix**: states separados (`overrideMod`, `overrideCw`).

### Polish UX

**CC-P1 — Sem transition entre placeholder e conteúdo revelado (linhas 97–143).**
Click "ver oculto" troca de árvore JSX abruptamente. **Esperado**: fade-in suave (Framer Motion `<AnimatePresence>`). **Fix**: wrap em motion.div com layout.

**CC-P2 — `↳ N respostas` sem indicação interativa (linha 148).**
Texto estático no footer. User não sabe se é clicável (não é — gesture é swipe). Ambíguo. **Fix**: visual hint mais claro de gesture-only ("swipe ↑ ver respostas") ou tornar clicável também.

### TODOs/cleanup

**CC-T1 — Helper `truncate` e `timeAgo` duplicados (linhas 209–220).**
`timeAgo` provavelmente já existe em outro componente (PostViewer? meta?). Não confirmei mas é alta confiança. **Investigar/Fix**: `lib/format.ts` único.

**CC-T2 — Prop `postId` usada apenas em `data-post-id` debug attr (linha 71).**
Comentário diz "só pra debug/title". Se for só debug, considerar dev-only. **Fix**: condicionar via `import.meta.env.DEV`.

---

## ThreadHeader.tsx

### Bugs latentes

**TH-B1 — Botão "+N novos" disabled quando `onRefreshNew` undefined (linha 89–98).**
Hoje ThreadView não passa `onRefreshNew` (ver TV chamada linha 200–205, sem prop). Botão sempre disabled mas visível, sugerindo ação. **Importa**: dead UI confunde user. **Fix**: implementar handler em ThreadView (chama `loadThread(postId)` + reset `openedAt`) ou esconder badge quando handler ausente.

### Polish UX

**TH-P1 — Breadcrumb truncado via `truncate` CSS sem tooltip do path completo.**
Linha 58. Em paths longos user perde contexto. **Fix**: `title={breadcrumb.join(' › ')}` no container.

**TH-P2 — Sem live-region pra `+N novos` aparecer/sumir (a11y).**
Screen reader não anuncia novos comments durante navegação. **Fix**: `aria-live="polite"` no wrapper do badge.

### TODOs/cleanup

**TH-T1 — `breadcrumb.map((label, i) => key={i})` — index como key.**
Linha 64. Se breadcrumb labels mudarem ordem (improvável mas) React não reconcilia bem. **Fix**: usar `cursor.path[i]` como key.

---

## comments.ts

### Bugs latentes

**CM-B1 — `addCommentToStore` ignora silenciosamente postId desconhecido (linha 260–264).**
Se store ainda não tem o entry (loadThread não rodou), o comment é descartado. Comentário diz "loadThread vai pegar do banco" — mas só se onNostrEvent INSERT já tiver completado antes. Há race entre INSERT e a próxima loadThread. **Investigar**: provavelmente OK porque onNostrEvent → invalidate → loadThread re-roda; mas vale assertar com test. **Fix**: adicionar test de race ou comentário documentando ordem.

**CM-B2 — `slice(0, COMMENTS_LOAD_CAP)` mantém os MAIS ANTIGOS, descarta cauda (linha 271–275).**
Comentário linha 271 explica decisão ("preservar ordering estável"). Mas isso significa que em thread de 200+ comments, NOVOS chegam via subscribe mas são DROPPED imediatamente após cap. User vê comments congelados em t=opening. **Importa**: regressão UX em threads virais. **Fix**: revisar política — talvez ring buffer ou cap só no SELECT inicial e sem cap em adds.

### TODOs/cleanup

**CM-T1 — `void postId` em `siblingsOf` (thread-cursor.ts linha 83) — comentário aqui no review mas é em outro arquivo, ignorar.**
(Mover pra TC-T1.)

**CM-T1 — Constante `NIP22_COMMENT_KIND = 1111` duplicada (linha 43).**
Comentário admite "single source of truth segue em events.ts". Cheira a tech debt. **Fix**: importar de `lib/protocol.ts` (que já exporta) e quebrar ciclo se houver via re-export pequeno.

**CM-T2 — Test helpers `_activeSubCount`/`_refcountOf`/`_resetSubsForTest` exportados em prod bundle (linhas 356–381).**
Underscore prefix é convenção, mas não tree-shaken. **Fix**: gate via `if (import.meta.env.DEV || import.meta.vitest)` ou mover pra `__test__/` helpers.

---

## thread-cursor.ts

### TODOs/cleanup

**TC-T1 — Parâmetro `postId` não-usado em `siblingsOf` + `nextSibling`/`prevSibling` (linhas 73–84, 95, 113).**
Comentário "preservado pra futura expansão" + `void postId` pra silenciar lint. Honesto, mas se a expansão não veio em 2 fases, é YAGNI. **Investigar**: quando esperamos cross-post sibling? Se não, dropar param. **Fix**: remover param ou documentar com TODO datado.

---

## Priorização final

### P0 — bugs / regressões (devem ir antes de qualquer release)

- **CC-B2** (overrideHidden ambíguo) — risco de expor conteúdo moderado.
- **RS-B2** (upload sem cancel em close) — warning + leak.
- **TH-B1** (botão "+N novos" dead) — UI dead, confunde user.
- **CM-B2** (cap descarta cauda) — regressão UX em threads virais.
- **CC-B1** (selector ausente em prefs) — render thrash.

### P1 — polish que afeta UX core

- **TV-P1** (swipe ↓ no root sem confirm).
- **RS-P1** (shortcut Cmd+Enter invisível).
- **RS-P3** (sem alt em image preview).
- **CC-P1** (transition reveal).
- **TV-P2** (coach sem reabrir).
- **TH-P2** (live-region pra +N).

### P2 — cleanup nice-to-have

- **TV-T1** (shadowing currentNode), **TV-T2** (comentário órfão).
- **RS-T1**, **RS-T2** (magic numbers/strings).
- **CC-T1** (timeAgo dup), **CC-T2** (postId só-debug).
- **TH-T1** (key=i), **TH-P1** (tooltip breadcrumb).
- **CM-T1**, **CM-T2** (kind dup, test helpers).
- **TC-T1** (postId YAGNI).
- **TV-B1**, **TV-B2**, **TV-B4** (latentes; investigar antes de fix).
- **CM-B1**, **TV-B3**, **RS-B1** (latentes; investigar).
- **RS-B3**, **RS-P2** (drag pending feedback, aria-keyshortcuts submit).

---

## Recomendação de execução (3–5h)

**Subset proposto pra sessão de execução** (~3h45):

1. **P0 inteiro** (~1h45):
   - CC-B2 (15min) — split state.
   - RS-B2 (20min) — AbortController + mounted ref.
   - TH-B1 (20min) — wire `onRefreshNew` em ThreadView (loadThread + reset openedAt).
   - CM-B2 (30min) — revisar política de cap; provavelmente remover cap em adds e manter só no SELECT inicial; adicionar test.
   - CC-B1 (15min) — selector com shallow.

2. **P1 prioritário (UX core)** (~1h15):
   - TV-P1 (15min) — confirm visual antes de exit.
   - RS-P1 (10min) — hint Cmd+Enter no footer.
   - CC-P1 (15min) — AnimatePresence reveal.
   - TH-P2 (10min) — aria-live polite.
   - RS-P3 (25min) — input alt opcional + propagar pro imeta (verificar Track B suporta).

3. **P2 quick wins** (~45min):
   - TV-T2 (5min), RS-T1 (5min), TH-T1 (5min) — refactors triviais.
   - CC-T1 (15min) — extrair `lib/format.ts:timeAgo`.
   - CM-T1 (15min) — quebrar duplicação NIP22_COMMENT_KIND.

**Deixar pra sessão futura** (~1h–1h30 estimado):
- Itens "investigar" (TV-B1, TV-B2, TV-B3, TV-B4, RS-B1, CM-B1) — precisam stress test ou logs antes de mudar; sem repro confirmada, fix arrisca regressão.
- Itens cosmetic (TV-T1, RS-T2, CC-T2, TH-P1, RS-B3, RS-P2, CM-T2, TC-T1) — não bloqueiam usuário.

**Buffer**: 15–30min pra `npm run test` + `tsc --noEmit` + revisão visual no `npm run dev`.

---

## Notas finais

- Confiança alta em P0 (todos com repro mental claro).
- 6 itens classificados como "investigar" — não execute sem repro; vale 30–60min de stress test antes de tocar.
- Estimativa total agressiva (~290min) cabe em 4h45 + buffer = quase no teto de 5h. Se sessão for de 3h, recomendo só P0 + 2-3 itens P1 escolhidos.
- Nenhum dos 32 itens é breaking change de protocolo / schema. Todos são UI/runtime/cleanup. Seguros pra patch release.
