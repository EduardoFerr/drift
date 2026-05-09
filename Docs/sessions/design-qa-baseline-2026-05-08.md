# Design QA #1 — baseline (2026-05-08)

**Persona**: Robin (curadoria, gaps cross-cutting, docs).
**Escopo**: auditoria visual de TODOS os componentes do Drift contra
`Docs/design-system.md` v0.7 + `tailwind.config.js`. Doc-only — Lily
executa fixes; Robin volta pra QA #2.

**Resultado executivo**: ~110 findings em 33 arquivos. Conformidade
estimada: **~62%** dos componentes usam tokens corretamente; restantes
misturam `slate-*` legacy + hex hardcoded + tons amber/yellow/red
acidentais que deveriam ser `drift-*`. Nenhum blocker encontrado pra
Lily executar — todas as recomendações são localizadas. **§7
(Refactor maior recomendado)**: consolidar 4 padrões diferentes de
botão secundário num `<DriftButton variant>` primitive.

---

## §1 — Design tokens canônicos (recap)

Fonte: `tailwind.config.js` linhas 22-78 + `src/index.css` linhas 31-63.

| Token | Hex (canônico) | Uso semântico |
|---|---|---|
| `drift-bg` | `#0c0c0b` | Background base. Quase-preto warm. |
| `drift-surface` | `#15151a` | Cards, modals, overlays. 1 step lighter. |
| `drift-border` | `#2a2a2e` | Hairlines, dividers, X buttons. |
| `drift-accent` | `#e8ff5a` | Chartreuse-lime. CTAs, DRIFT (↑), active states, branding. |
| `drift-accent2` | `#5affd4` | Mint cyan. Sub-actions, focus rings, indicador "recente". |
| `drift-text` | `#f0f0ea` | Off-white warm. Body text, primary content. |
| `drift-muted` | `#4a4a46` | Secondary text, labels, timestamps, disabled. |
| `drift-body` | `#787874` (default) / CSS var | Body italic em `CardText`. |
| `drift-spread` | `#34d399` | Verde mint legacy. Ação positiva (kind 9079, label UI: DRIFT). |
| `drift-bury` | `#f87171` | Vermelho. Ação negativa (kind 9080, label UI: SINK). |

Tracking tokens (CSS vars):
- `tracking-tag` → 2.5px (tag rows, group titles)
- `tracking-meta` → 1.5px (meta lines)
- `tracking-title` → -0.3px (Syne title)

Spacing tokens:
- `card-x` → 17px (card padding-x default)
- `card-x-wide` → 22px (text layout padding-x)
- `card` → 18px (card padding-bottom)

**Slate continua aceitável** para detalhes neutros (skeletons,
GpsErrorBanner amber tones, decoração não-Drift-específica) — design-system
§2.3. Mas **substituir por drift-* onde semântica Drift importa** é a
direção. **A maioria dos finds CL abaixo é exatamente esse caso**:
slate-* foi usado em contexto onde drift-text/muted/border é
semanticamente correto.

---

## §2 — Padrões aprendidos da sessão atual (não regredir)

Capturados pra Lily não desfazer durante fixes:

1. **SettingsRoot** (App.tsx:1726-1769): group title chartreuse (linha 1721
   `text-drift-accent`); item label drift-text (linha 1745); item hint
   drift-accent2 (linha 1752); chevron + ícone chartreuse (linha 1737,
   1761); item destrutivo todo bury (linhas 1737, 1745, 1752 com `danger`
   ternary). **Padrão de referência pra outros menus**.
2. **FullPageOverlay** (FullPageOverlay.tsx:99-104): title chartreuse Syne
   800; FECHAR border-drift-accent + text-drift-accent2 (linha 76);
   header border-bottom drift-border. **Padrão de header pra todas as
   overlays full-page**.
3. **HomeHeader StatusIndicators** (App.tsx:1183-1250): ícones clicáveis;
   network/GPS reflete estado real (clearnet muted = drift-muted, Tor/
   onion-only = drift-accent; gps off = drift-muted, ativo = drift-accent).
4. **FeedTabs** (FeedTabs.tsx:163-169): dot indicator chartreuse 6px
   top-right de cada label quando `unseenByTab[tab] > 0`.
5. **Image** (Image.tsx:226-253): `lightbox=true` habilita modal
   fullscreen, backdrop preto, X chartreuse top-right.
6. **SubpostLayout** (SubpostLayout.tsx:134): "(sem texto)" placeholder
   removido.
7. **CardText DRIFT/SUBS/HÁ** (SubpostLayout.tsx:262-271): label drift-muted,
   value drift-accent2 (mint).

---

## §3 — Findings de cor (CL-1 … CL-58)

Formato:
- ID, categoria, file:line + snippet
- Descrição factual + esperado conforme tokens
- Severity: S0 (bug visual) / S1 (inconsistente mas funcional) / S2 (polish)
- Effort: E0 (<5min) / E1 (<30min) / E2 (>30min)

**Convenção severity**: S0 = quebra visual evidente (texto ilegível,
contraste WCAG fail, color clash). S1 = mistura inconsistente (slate-*
no lugar de drift-*; deveria migrar pra coerência) com leitura
preservada. S2 = polish (hex hardcoded que poderia virar token).

### UI primitives

#### CL-1 — `text-slate-600` em fallback de erro Image
- **Arquivo**: `src/components/UI/Image.tsx:168`
- **Snippet**: `<div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-600">`
- **Atual**: slate-600 (texto secundário no estado de erro)
- **Esperado**: `text-drift-muted` — semântica de placeholder/erro neutro
- **Severity / Effort**: S1 / E0

#### CL-2 — `text-slate-500` em DialogHost prompt input placeholder
- **Arquivo**: `src/components/UI/DialogHost.tsx:160`
- **Snippet**: `placeholder:text-slate-500`
- **Atual**: slate-500 (placeholder)
- **Esperado**: `placeholder:text-drift-muted` — coerência com pattern Drift (ComposeOverlay.tsx:364 já usa)
- **Severity / Effort**: S1 / E0

#### CL-3 — `text-slate-400` em DialogHost botão cancel
- **Arquivo**: `src/components/UI/DialogHost.tsx:168`
- **Snippet**: `text-slate-400 transition-colors hover:border-drift-text hover:text-drift-text`
- **Atual**: slate-400 idle
- **Esperado**: `text-drift-muted` — botão cancel neutro
- **Severity / Effort**: S1 / E0

#### CL-4 — Hardcoded `bg-slate-800/50` em RelaySettings tag source
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:138`
- **Snippet**: `<span className="rounded bg-slate-800/50 px-1 text-[9px] text-slate-500">`
- **Atual**: slate-800/50 + slate-500
- **Esperado**: `bg-drift-border/40 text-drift-muted` — chip neutro consistente com Drift
- **Severity / Effort**: S1 / E0

#### CL-5 — Hardcoded `text-slate-600`/`text-slate-700` em RelaySettings (múltiplos)
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:104, 112, 114, 119, 126, 138, 160, 169, 187, 194, 198`
- **Snippets variados**: `text-slate-500`, `text-slate-600`, `text-slate-700`, `placeholder:text-slate-700`
- **Atual**: cinza Tailwind hardcoded em ~11 locais (descrições, hints, placeholders, source chip)
- **Esperado**: `text-drift-muted` (subordinado ao token); placeholders → `placeholder:text-drift-muted/60`
- **Severity / Effort**: S1 / E1 (replace_all parcial — diferenciar contexto: placeholders precisam variant `/60`)

#### CL-6 — `text-slate-200` em RelaySettings input fill
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:169, 198`
- **Snippet**: `text-[11px] text-slate-200`
- **Atual**: slate-200 (input value text)
- **Esperado**: `text-drift-text` — coerência com DialogHost.tsx:160 que usa drift-text
- **Severity / Effort**: S1 / E0

#### CL-7 — `text-slate-300` em RelaySettings host name
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:135`
- **Snippet**: `<span className="flex-1 truncate text-slate-300" title={r.lastErr ?? ''}>`
- **Atual**: slate-300 pra URL do relay
- **Esperado**: `text-drift-text` — info primária
- **Severity / Effort**: S1 / E0

#### CL-8 — Cores legacy `border-red-900/60 text-red-400/80` em remove buttons
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:149`, `src/components/Settings/LocalListsSettings.tsx:166, 215`
- **Snippet**: `className="rounded border border-red-900/60 px-1 py-0.5 text-red-400/80 hover:bg-red-950/30"`
- **Atual**: red-900/60 + red-400/80 + red-950/30 (red Tailwind raw — pré-design-system)
- **Esperado**: tokens `border-drift-bury/60 text-drift-bury hover:bg-drift-bury/10` — coerente com `Toggle.tsx`-pattern + RelaySettings remove em DialogHost.tsx:178 que JÁ usa drift-bury
- **Severity / Effort**: S1 / E1 (3 locations pra mudar)

#### CL-9 — `text-emerald-400` em RelaySettings status check
- **Arquivo**: `src/components/Settings/RelaySettings.tsx:125`
- **Snippet**: `const tone = r.lastErr ? 'text-red-400' : r.lastOkAt ? 'text-emerald-400' : 'text-slate-600'`
- **Atual**: red-400 / emerald-400 / slate-600
- **Esperado**: `text-drift-bury` / `text-drift-spread` / `text-drift-muted` — tokens role-aware
- **Severity / Effort**: S1 / E0

#### CL-10 — `text-slate-300` em MultiTabModal body text
- **Arquivo**: `src/components/UI/MultiTabModal.tsx:38, 45, 51`
- **Snippets**: `className="mb-4 text-[12px] text-drift-text"` ✓ — atual já usa drift-text. PORÉM:
  - linha 45: `text-[11px] uppercase tracking-widest text-drift-text` — botão "fechar esta aba" usa drift-text mas hover é drift-accent → OK
  - linha 51: `text-drift-accent` — botão recarregar usa drift-accent → OK
- **Verdict**: MultiTabModal está limpo. **NÃO HÁ FINDING — anular CL-10**.

#### CL-11 — `bg-yellow-900/30 text-yellow-300` em PostCard content-warning chip
- **Arquivo**: `src/components/Feed/PostCard.tsx:72-75`
- **Snippet**: `<span className="ml-2 rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-300" title="aviso declarado pelo autor (manifesto §27)">⚠ {post.contentWarning}</span>`
- **Atual**: yellow-900/30 + yellow-300 (Tailwind raw)
- **Esperado**: amber tokens (já usados em CommentCard:122-127) — `border-amber-400/60 bg-amber-500/10 text-amber-300` é o padrão estabelecido pra content-warning chips
- **Severity / Effort**: S1 / E0
- **Nota**: amber é cor "atenção mas não bloqueio" — design-system §2.3 reconhece slate como aceitável; amber é equivalente pra warnings. **Mantém amber, mas com pattern consistente entre PostCard, PostViewer, CommentCard**.

#### CL-12 — `text-slate-600` em PostCard meta line
- **Arquivo**: `src/components/Feed/PostCard.tsx:67`
- **Snippet**: `<div className="mb-2 flex items-center justify-between text-[10px] text-slate-600">`
- **Atual**: slate-600
- **Esperado**: `text-drift-muted`
- **Severity / Effort**: S1 / E0

#### CL-13 — `text-slate-400` em PostCard DERIVA value
- **Arquivo**: `src/components/Feed/PostCard.tsx:81`
- **Snippet**: `DERIVA <span className="text-slate-400">{post.score.toFixed(3)}</span>`
- **Atual**: slate-400
- **Esperado**: `text-drift-text` (info primária — score visível) ou `text-drift-accent2` (mint, padrão DERIVA visto em SubpostLayout:264)
- **Severity / Effort**: S1 / E0
- **Decisão recomendada**: drift-accent2 (consistência com CardText.tsx:264 — DRIFT/SUBS/HÁ value mint)

#### CL-14 — `text-slate-200` em PostCard body text
- **Arquivo**: `src/components/Feed/PostCard.tsx:94`
- **Snippet**: `<p className="whitespace-pre-wrap break-words text-sm text-slate-200">`
- **Atual**: slate-200
- **Esperado**: `text-drift-text` — body primário
- **Severity / Effort**: S1 / E0

#### CL-15 — `text-slate-600` em PostCard imagem placeholder
- **Arquivo**: `src/components/Feed/PostCard.tsx:98`
- **Snippet**: `<div className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">`
- **Atual**: slate-600
- **Esperado**: `text-drift-muted`
- **Severity / Effort**: S1 / E0

#### CL-16 — `text-slate-500` em PostCard botão "abrir →"
- **Arquivo**: `src/components/Feed/PostCard.tsx:106-107`
- **Snippet**: `<div className="flex gap-3 text-slate-500">` + `<button ... className="text-slate-500 hover:text-drift-accent">`
- **Atual**: slate-500
- **Esperado**: `text-drift-muted hover:text-drift-accent`
- **Severity / Effort**: S1 / E0 (replace 2 lines)

#### CL-17 — `bg-emerald-900/40 text-emerald-300` em PostCard spread active
- **Arquivo**: `src/components/Feed/PostCard.tsx:121-122` + `src/components/Post/PostViewer.tsx:552-553`
- **Snippets**:
  - PostCard: `'border-drift-spread bg-emerald-900/40 text-emerald-300'`
  - PostViewer: same pattern
- **Atual**: emerald-900/40 + emerald-300 (Tailwind raw)
- **Esperado**: `bg-drift-spread/20 text-drift-spread` (coerente com tokens)
- **Severity / Effort**: S1 / E0
- **Nota**: design-system.md §2.5 explicitamente lista `bg-emerald-900/40` como hex hardcoded a migrar. **Confirmado pra fix**.

#### CL-18 — `bg-red-900/40 text-red-300` em PostCard bury active
- **Arquivo**: `src/components/Feed/PostCard.tsx:144-145` + `src/components/Post/PostViewer.tsx:574-575`
- **Snippet**: `'border-drift-bury bg-red-900/40 text-red-300'`
- **Atual**: red-900/40 + red-300 (Tailwind raw)
- **Esperado**: `bg-drift-bury/20 text-drift-bury`
- **Severity / Effort**: S1 / E0

#### CL-19 — `bg-emerald-950/30` em PostCard spread idle hover
- **Arquivo**: `src/components/Feed/PostCard.tsx:123` + `src/components/Post/PostViewer.tsx:553`
- **Snippet**: `'border-drift-spread/40 text-drift-spread hover:bg-emerald-950/30'`
- **Atual**: emerald-950/30 hover bg
- **Esperado**: `hover:bg-drift-spread/10`
- **Severity / Effort**: S1 / E0

#### CL-20 — `bg-red-950/30` em PostCard bury idle hover
- **Arquivo**: `src/components/Feed/PostCard.tsx:146` + `src/components/Post/PostViewer.tsx:576`
- **Snippet**: `hover:bg-red-950/30`
- **Esperado**: `hover:bg-drift-bury/10`
- **Severity / Effort**: S1 / E0

### PostViewer (modal mode)

#### CL-21 — `text-yellow-300` + `bg-yellow-900/30` em PostViewer content-warning chip
- **Arquivo**: `src/components/Post/PostViewer.tsx:296-302`
- **Snippet**: `<span className="ml-2 rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-300">`
- **Atual**: idêntico ao PostCard (CL-11) — Tailwind raw
- **Esperado**: amber tokens consistente com CommentCard
- **Severity / Effort**: S1 / E0
- **Cross-ref**: CL-11

#### CL-22 — `text-yellow-300` + `border-yellow-500` em pin button hover
- **Arquivo**: `src/components/Post/PostViewer.tsx:314-315`
- **Snippet**: `pinned ? 'border-yellow-500 text-yellow-300' : 'border-drift-border hover:border-yellow-500 hover:text-yellow-300'`
- **Atual**: yellow-500 / yellow-300 (Tailwind raw)
- **Esperado**: `border-drift-accent text-drift-accent` ou (mais semântico) amber tokens — pin é "estado especial protegido", não destrutivo nem positivo. Sugestão: `border-amber-400 text-amber-300` em ambos modos pra coerência com content-warning amber.
- **Severity / Effort**: S2 / E0

#### CL-23 — `border-yellow-500` em mute button hover (PostViewer)
- **Arquivo**: `src/components/Post/PostViewer.tsx:358`
- **Snippet**: `hover:border-yellow-500 hover:text-yellow-300`
- **Atual**: yellow-500/300 raw
- **Esperado**: tokens amber consistente OU drift-muted (mute é "rebaixamento neutro", não "atenção")
- **Severity / Effort**: S2 / E0

#### CL-24 — `border-orange-500 hover:text-orange-300` em block button (PostViewer)
- **Arquivo**: `src/components/Post/PostViewer.tsx:367`
- **Snippet**: `hover:border-orange-500 hover:text-orange-300`
- **Atual**: orange-500/300 (Tailwind raw)
- **Esperado**: drift-bury (block é destrutivo pra meu feed) OU amber (atenção)
- **Severity / Effort**: S2 / E0

#### CL-25 — `border-red-500 hover:text-red-400` em report button (PostViewer)
- **Arquivo**: `src/components/Post/PostViewer.tsx:374`
- **Snippet**: `hover:border-red-500 hover:text-red-400`
- **Atual**: red-500/400 (Tailwind raw)
- **Esperado**: `hover:border-drift-bury hover:text-drift-bury`
- **Severity / Effort**: S1 / E0

#### CL-26 — `text-yellow-300` em PostViewer content-warning placeholder
- **Arquivo**: `src/components/Post/PostViewer.tsx:489`
- **Snippet**: `<span className="text-xs uppercase tracking-widest text-yellow-300">`
- **Atual**: yellow-300 raw
- **Esperado**: `text-amber-300` (consistência amber em CW labels) ou `text-drift-accent` (chartreuse pra warning prominent)
- **Severity / Effort**: S1 / E0
- **Decisão recomendada**: amber-300 (mantém pattern CommentCard.tsx:268)

#### CL-27 — `text-slate-600` em PostViewer revealed CTA hint
- **Arquivo**: `src/components/Post/PostViewer.tsx:498`
- **Snippet**: `<span className="text-[10px] text-slate-600">`
- **Atual**: slate-600
- **Esperado**: `text-drift-muted`
- **Severity / Effort**: S1 / E0

#### CL-28 — `hover:text-[#ff6b6b]` hex hardcoded em ActionsMenu danger hover
- **Arquivo**: `src/components/Post/PostViewer.tsx:769`
- **Snippet**: `'text-drift-bury hover:text-[#ff6b6b]'`
- **Atual**: hex `#ff6b6b` em hover (variação manual de drift-bury)
- **Esperado**: `hover:text-drift-bury/80` ou `hover:opacity-80` — usar token, não hex
- **Severity / Effort**: S2 / E0

### SwipeHandler

#### CL-29 — Hex hardcoded `#ff4f4f` em swipe hint bury
- **Arquivo**: `src/components/Post/SwipeHandler.tsx:271`
- **Snippet**: `return ${base} border-2 border-[#ff4f4f] text-[#ff4f4f] rotate-[5deg]`
- **Atual**: `#ff4f4f` hex (~drift-bury mas não exato — drift-bury é `#f87171`)
- **Esperado**: `border-drift-bury text-drift-bury` ou ajustar token se quiser variação
- **Severity / Effort**: S1 / E0
- **Nota**: design-system §4.5 (Swipe indicators) ESPECIFICA este token e diz "border 2px #ff4f4f (= drift-bury)". Discrepância intencional documentada — mas migrar pra token deixa code consistente sem perder semântica.

#### CL-30 — Hardcoded RGB em SwipeHandler border feedback
- **Arquivo**: `src/components/Post/SwipeHandler.tsx:79-85`
- **Snippets**:
  - `rgba(52, 211, 153, ${alpha})` (drift-spread literal)
  - `rgba(248, 113, 113, ${alpha})` (drift-bury literal)
  - `rgba(167, 139, 250, ${alpha})` (lilás navegação — sem token)
  - `rgba(31, 41, 55, 1)` (border default — gray Tailwind)
- **Atual**: 4 RGBA hex literais
- **Esperado**: usar CSS var `var(--drift-spread)` etc. via `useMotionValue` ou inline style. Default border `rgba(31, 41, 55, 1)` deveria ser `var(--drift-border)` (`#2a2a2e`).
- **Severity / Effort**: S2 / E1 (requer refactor de useTransform — talvez aceitar status quo se motion preference precisa hex)
- **Cross-ref**: design-system.md §2.5 lista isso como dívida explícita.

### CommentCard (Marshall mexendo agora — VERIFY POST-MARSHALL)

CommentCard está em fluxo ativo do Marshall. Os finds abaixo são
descritos como auditoria; **VERIFICAR PÓS-MARSHALL** se ainda valem.

#### CL-31 — `text-yellow-300` em HiddenPlaceholder (comment moderado)
- **Arquivo**: `src/components/Post/CommentCard.tsx:287`
- **Snippet**: `<span className="font-mono text-[11px] uppercase tracking-meta text-yellow-300">`
- **Atual**: yellow-300 raw
- **Esperado**: `text-amber-300` (consistência amber pra CW/moderation labels) — design-system não inclui yellow-* nos tokens
- **Severity / Effort**: S1 / E0 — VERIFY POST-MARSHALL

#### CL-32 — `text-amber-200` em CW blur "toque pra revelar"
- **Arquivo**: `src/components/Post/CommentCard.tsx:196`
- **Snippet**: `<span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-meta text-amber-200">`
- **Atual**: amber-200 (Tailwind raw, não token Drift)
- **Esperado**: amber é aceitável (slate-equivalent pra warnings — design-system §2.3) MAS sugerir adicionar drift-warning como token se padrão se repete em 5+ locais
- **Severity / Effort**: S2 / E0

### ThreadView (Marshall mexendo agora — VERIFY POST-MARSHALL)

#### CL-33 — Sem findings críticos no ThreadView.tsx
- **Arquivo**: `src/components/Post/ThreadView.tsx`
- **Verdict**: usa drift-* tokens corretamente (drift-bg/90 backdrop, drift-text, drift-muted, drift-accent, drift-accent2, drift-border, drift-surface). Single point of attention: linha 296 `border-drift-accent2/40 bg-drift-surface` — child shadow card consistente com pattern.
- **Severity / Effort**: nenhum — VERIFY POST-MARSHALL

### ThreadHeader (Marshall mexendo agora — VERIFY POST-MARSHALL)

#### CL-34 — ThreadHeader limpo em tokens
- **Arquivo**: `src/components/Post/ThreadHeader.tsx`
- **Verdict**: usa drift-* corretamente. Padrão de breadcrumb em drift-text/muted, badges em drift-accent/accent2, close button em drift-border + drift-accent hover. **Conformidade alta**.
- **Severity / Effort**: nenhum — VERIFY POST-MARSHALL

### ReplySheet (Marshall mexendo agora — VERIFY POST-MARSHALL)

#### CL-35 — `text-slate-400` em ReplySheet char count
- **Arquivo**: `src/components/Post/ReplySheet.tsx:563`
- **Snippet**: `${overLimit ? 'text-drift-bury' : 'text-slate-400'}`
- **Atual**: slate-400 idle
- **Esperado**: `text-drift-muted`
- **Severity / Effort**: S1 / E0 — VERIFY POST-MARSHALL

#### CL-36 — `border-amber-400` em CW chips ReplySheet
- **Arquivo**: `src/components/Post/ReplySheet.tsx:537`
- **Snippet**: `'border-amber-400 bg-amber-500/15 text-amber-300'`
- **Atual**: amber-400/500/300 raw (mesmo pattern que ComposeOverlay)
- **Esperado**: amber é aceitável; pattern consistente entre ComposeOverlay + ReplySheet → OK
- **Severity / Effort**: S2 / E0 (consolidar em drift-warning token se virar 5+ ocorrências) — VERIFY POST-MARSHALL

### ReportModal

#### CL-37 — Cores tailwind raw em REASONS color
- **Arquivo**: `src/components/Post/ReportModal.tsx:45-59`
- **Snippets**:
  - `'border-red-700/60 hover:bg-red-950/30 text-red-300'` (illegal)
  - `'border-orange-700/60 hover:bg-orange-950/30 text-orange-300'` (harassment)
  - `'border-yellow-700/60 hover:bg-yellow-950/30 text-yellow-300'` (spam)
- **Atual**: red/orange/yellow Tailwind raw mappeando severity
- **Esperado**: drift-bury / amber-* / drift-muted — mas o trio é semanticamente "severity ladder" (red/orange/yellow). Sugestão: manter raw; é único contexto onde 3 níveis são necessários e o design-system não cobre escala de severity.
- **Severity / Effort**: S2 / E0 (manter status quo — exceção justificada)

#### CL-38 — `text-slate-400`/`text-slate-500` em ReportModal multiple
- **Arquivo**: `src/components/Post/ReportModal.tsx:85-86, 87-89, 109, 115, 156, 159, 171, 197`
- **Snippets**: `text-slate-400`, `text-slate-500`, `text-slate-300`
- **Atual**: slate cinzas em descrições, hint, bordas hover
- **Esperado**: `text-drift-muted`, `text-drift-text` (subordinado ao contexto)
- **Severity / Effort**: S1 / E1 (~8 lugares)

#### CL-39 — `border-yellow-700/40 bg-yellow-950/20` em AuthoritiesBlock
- **Arquivo**: `src/components/Post/ReportModal.tsx:202-225`
- **Snippets**: `border-yellow-700/60`, `bg-yellow-950/20`, `text-yellow-300`, `text-yellow-200/80`
- **Atual**: yellow Tailwind raw em bloco "denuncie a autoridades"
- **Esperado**: amber tokens (consistência com CW pattern). Sugestão: `border-amber-500/60 bg-amber-500/10 text-amber-300`
- **Severity / Effort**: S1 / E1 (5 spans/blocks)

### IdentityPanel

#### CL-40 — Massa de `text-slate-*` em IdentityPanel
- **Arquivo**: `src/components/Identity/IdentityPanel.tsx:48-72, 153-156, 168, 187, 196, 211, 218, 225, 234, 250, 270, 285, 305, 334, 342, 360, 380, 387, 462, 467, 475`
- **Snippets variados**: `text-slate-200/300/400/500/600/700`, `placeholder:text-slate-700`
- **Atual**: ~30 usos de slate-* hardcoded no IdentityPanel (3 tabs: Backup/Import/Passkey)
- **Esperado**: substituir slate-* por drift-* equivalente (slate-700 → drift-muted; slate-500 → drift-muted; slate-400 → drift-muted; slate-300 → drift-text; slate-200 → drift-text)
- **Severity / Effort**: S1 / E1 (~30 lugares — replace_all com cuidado pra não quebrar `text-slate-200` que é diferente de `placeholder:text-slate-700`)

#### CL-41 — `bg-emerald-950/20 text-emerald-300` em Passkey ativo
- **Arquivo**: `src/components/Identity/IdentityPanel.tsx:483`
- **Snippet**: `<div className="mb-3 rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-[11px] text-emerald-300">`
- **Atual**: emerald-* raw
- **Esperado**: `border-drift-spread/60 bg-drift-spread/10 text-drift-spread`
- **Severity / Effort**: S1 / E0

#### CL-42 — `bg-red-950/20 text-red-300/400` em IdentityPanel error/disable
- **Arquivo**: `src/components/Identity/IdentityPanel.tsx:173, 365, 474, 489`
- **Snippets**: `border-red-900/60 bg-red-950/20 text-red-300` (error block + disable button)
- **Atual**: red-* raw
- **Esperado**: `border-drift-bury/60 bg-drift-bury/10 text-drift-bury`
- **Severity / Effort**: S1 / E0 (4 instances)

#### CL-43 — `border-yellow-900/60 text-yellow-300/70` em IdentityPanel warnings
- **Arquivo**: `src/components/Identity/IdentityPanel.tsx:233, 370, 452-453`
- **Snippets**: `border-yellow-900/60 bg-yellow-950/10 text-yellow-300/70` (warning blocks)
- **Atual**: yellow-* raw
- **Esperado**: amber tokens (consistência) — `border-amber-500/60 bg-amber-500/10 text-amber-300`
- **Severity / Effort**: S1 / E0 (3 blocks)

### IdentitySwitcher

#### CL-44 — Massa de `text-slate-*` em IdentitySwitcher
- **Arquivo**: `src/components/Identity/IdentitySwitcher.tsx:199, 216, 231, 233, 236, 246, 263, 322, 331, 336, 353, 362, 369, 376, 391, 396, 405, 411, 432, 435, 449, 452, 469, 479, 480, 486, 493, 498`
- **Snippets variados**: ~28 ocorrências de slate-200/300/400/500/600/700
- **Atual**: slate-* hardcoded em descrições, npub display, tab labels, button text, placeholder
- **Esperado**: drift-text / drift-muted equivalente
- **Severity / Effort**: S1 / E2 (>30min — replace_all com diff por contexto: text-slate-200 → text-drift-text; text-slate-400/500 → text-drift-muted; placeholder-slate-700 → placeholder-drift-muted/60)

#### CL-45 — `text-yellow-300/400/500/600` em BIP39 phrase warnings/display
- **Arquivo**: `src/components/Identity/IdentitySwitcher.tsx:396, 427, 432, 435`
- **Snippets**: `text-yellow-400`, `bg-yellow-950/20 border-yellow-700/60`, `text-yellow-200`, `text-yellow-600`, `text-yellow-300`
- **Atual**: yellow-* raw em bloco "anote estas 12 palavras"
- **Esperado**: amber tokens (consistência com warning pattern)
- **Severity / Effort**: S1 / E0

#### CL-46 — `text-emerald-400` chip "IPFS" em LocalListsSettings (CL-46 cross-link)
- **Arquivo**: `src/components/Settings/LocalListsSettings.tsx:158`
- **Snippet**: `<span className="rounded bg-emerald-950/30 px-1 text-emerald-400" title={...}>IPFS</span>`
- **Atual**: emerald-950/30 + emerald-400
- **Esperado**: `bg-drift-spread/15 text-drift-spread`
- **Severity / Effort**: S1 / E0

#### CL-47 — `text-yellow-300` em LocalListsSettings pin emoji
- **Arquivo**: `src/components/Settings/LocalListsSettings.tsx:151`
- **Snippet**: `<span className="text-yellow-300">📌</span>`
- **Atual**: yellow-300
- **Esperado**: `text-amber-300` ou `text-drift-accent` (yellow não é token)
- **Severity / Effort**: S2 / E0

#### CL-48 — Massa de `text-slate-*` em LocalListsSettings
- **Arquivo**: `src/components/Settings/LocalListsSettings.tsx:117-119, 135, 152, 155, 165, 187, 207, 212`
- **Snippets**: slate-300/400/500/600
- **Esperado**: drift-text / drift-muted
- **Severity / Effort**: S1 / E1

### OnboardingOverlay

#### CL-49 — Massa de `text-slate-*` em OnboardingOverlay
- **Arquivo**: `src/components/Onboarding/OnboardingOverlay.tsx:46, 64, 68, 72, 87, 108, 119, 122, 128, 137, 183, 197, 198, 207, 213, 215`
- **Snippets**: slate-300/500/600/700
- **Atual**: ~16 ocorrências em corpo dos steps + skip button + nav arrows
- **Esperado**: drift-text / drift-muted (depending on contexto)
- **Severity / Effort**: S1 / E1

#### CL-50 — `text-emerald-400` em OnboardingOverlay regras step
- **Arquivo**: `src/components/Onboarding/OnboardingOverlay.tsx:120, 124, 127, 131`
- **Snippet**: `<span className="text-emerald-400">✓</span>`
- **Atual**: emerald-400 raw
- **Esperado**: `text-drift-spread` (kind 9079 verde) — coerência semântica
- **Severity / Effort**: S1 / E0 (4 instances replace_all)

#### CL-51 — `bg-slate-700/60` em OnboardingOverlay progress bar
- **Arquivo**: `src/components/Onboarding/OnboardingOverlay.tsx:182`
- **Snippet**: `'bg-drift-accent/60' : i === step ? 'bg-drift-accent' : 'bg-slate-700/60'`
- **Atual**: slate-700/60 pra progress dot inativo
- **Esperado**: `bg-drift-border` ou `bg-drift-muted/40` — coerência tokens
- **Severity / Effort**: S1 / E0

### ProfileModal

#### CL-52 — `text-slate-200/500/600` em ProfileModal stats/labels
- **Arquivo**: `src/components/Profile/ProfileModal.tsx:79, 81, 85, 114-119, 169, 173`
- **Snippets**: slate-200/500/600 em label/npub/createdAt/footer counts
- **Esperado**: drift-text / drift-muted
- **Severity / Effort**: S1 / E1

#### CL-53 — `text-amber-300` + `text-green-300` + `text-slate-300` em TierBadge
- **Arquivo**: `src/components/Profile/ProfileModal.tsx:135-141`
- **Snippets**:
  - established: `text-amber-300 border-amber-300/40` 🏆
  - active: `text-slate-300 border-slate-300/40` ⭐
  - new: `text-green-300 border-green-300/40` 🌱
- **Atual**: 3 tons distintos pra weight tiers
- **Esperado**: padronizar — amber = drift-warning (manter), slate-300 → drift-text, green-300 → drift-spread
- **Severity / Effort**: S1 / E0

### Settings (SettingsCards, RelaySettings ja cobertos)

#### CL-54 — `text-amber-500/70` em NetworkModeCard PWA warning
- **Arquivo**: `src/components/Settings/SettingsCards.tsx:354`
- **Snippet**: `<p className="font-mono text-[10px] leading-relaxed text-amber-500/70">`
- **Atual**: amber-500/70
- **Esperado**: amber é aceitável (warning) — manter, mas verificar se pattern é consistente. Linha 423-425 usa `text-amber-200/red-200`. Consolidar pra `text-amber-300` (estabelecido em CW chips) ou definir variants `text-amber-200` warning bold / `text-amber-300` warning normal.
- **Severity / Effort**: S2 / E0

#### CL-55 — `border-amber-700/60 bg-amber-950/30` (e variants red) em SettingsCards Alert
- **Arquivo**: `src/components/Settings/SettingsCards.tsx:421-425`
- **Snippets**:
  - error: `border-red-700/60 bg-red-950/30 text-red-300`
  - warn: `border-amber-700/60 bg-amber-950/30 text-amber-300`
- **Atual**: red/amber raw em wrapper Alert — mas pattern consistente
- **Esperado**: ou manter (alerts genéricos) ou migrar pra `border-drift-bury/60 bg-drift-bury/10 text-drift-bury` no error case
- **Severity / Effort**: S2 / E0

#### CL-56 — `border-yellow-700/60 bg-yellow-950/20 text-yellow-300` em DiagnosticCard rebuild button
- **Arquivo**: `src/components/Settings/SettingsCards.tsx:681`
- **Snippet**: `className="w-full rounded border border-yellow-700/60 bg-yellow-950/20 px-3 py-3 ... text-yellow-300"`
- **Atual**: yellow-* raw (consistência com pattern de "destrutivo mas com warning")
- **Esperado**: amber-* tokens — yellow não é parte do design-system
- **Severity / Effort**: S1 / E0

### SpreadMap

#### CL-57 — `text-slate-300/400/500/600` em SpreadMap stats/placeholder
- **Arquivo**: `src/components/Feed/SpreadMap.tsx:520, 524, 568, 570, 575`
- **Snippets**: slate-300/400/500/600 em stats/attribution/placeholder
- **Esperado**: drift-text / drift-muted
- **Severity / Effort**: S1 / E0 (5 lines)

### App.tsx

#### CL-58 — Massa de `text-slate-*` em App.tsx (BootView, DiagnosticPanel, EndOfFeed, InstallModal, etc)
- **Arquivo**: `src/App.tsx:1414, 1429, 1435, 1846, 1882, 1901, 2052, 2064-2073, 2102-2118, 2154, 2199-2206, 2211-2213`
- **Atual**: ~25 ocorrências slate-200/300/400/500/600/700 espalhadas em 5 inline components (BootView, DiagnosticPanel, EndOfFeed, InstallModal, Check helper, kindColor map)
- **Esperado**: substituir por drift-text / drift-muted / drift-* tokens
- **Severity / Effort**: S1 / E2 (>30min — replace_all parcial; alguns slates são em estados específicos como `text-slate-400` pra "info inativa" → drift-muted, mas fora do BootView que é antes de tokens carregarem; verificar caso a caso)
- **Nota crítica**: BootView aparece ANTES do CSS estar 100% carregado em alguns paths. Slate-* funciona como Tailwind base — `drift-*` depende de tailwind.config.js + index.css carregar. Validar que tokens funcionam em estado pre-boot antes de migrar BootView. **Marcar pra investigação**.

---

## §4 — Findings de detalhes/component (CP-1 … CP-25)

### CP-1 — Border radius inconsistente: `rounded` vs `rounded-sm` vs `rounded-[3px]`
- **Categoria**: border radius
- **Arquivos**:
  - `rounded-sm` (4px): SwipeHandler.tsx:266, ComposeOverlay.tsx:329, 407, ReplySheet.tsx:535
  - `rounded` (4px default): maioria
  - `rounded-[3px]`: DotsIndicator.tsx:60 (active dot — design-system §4.6 ESPECIFICA)
  - `rounded-full`: DotsIndicator.tsx:58, NavBar.tsx:86, FeedTabs.tsx:122
  - `rounded-2xl` ou `rounded-t-2xl`: ReplySheet.tsx:438 (bottom sheet)
- **Decisão**: `rounded` é default; `rounded-sm` aparece em ComposeOverlay.tsx:329/407 e ReplySheet.tsx:535 mas semanticamente `rounded` seria consistente. **Sugestão**: padronizar `rounded` (4px) em CTAs/cards/chips; `rounded-full` apenas em badges/dots/profile pictures.
- **Severity / Effort**: S2 / E1

### CP-2 — Padding inconsistente em CTAs: `px-3 py-1` vs `px-3 py-1.5` vs `px-3 py-2` vs `px-3 py-[5px]`
- **Categoria**: padding scale
- **Arquivos exemplos**:
  - `px-3 py-1`: ReportModal.tsx:115, 122, 174, IdentityPanel.tsx:166, 196, IdentitySwitcher.tsx:254-313
  - `px-3 py-1.5`: PostViewer.tsx:421 (CommentCard reveal)
  - `px-3 py-2`: DialogHost.tsx:168, IdentityPanel.tsx:330, OnboardingOverlay.tsx:223 (e muitos)
  - `px-3 py-[5px]`: FullPageOverlay.tsx:76 ✓ — design-system §4.4 mockup pattern
- **Decisão**: design-system §3.2 não formaliza padding scale, mas mockup usa `px-3 py-[5px]` em CTAs uppercase tag (.btn-x). `px-3 py-2` é aceitável pra CTAs maiores (DRIFT button, modal action). `px-3 py-1` é SUB.
- **Severity / Effort**: S2 / E2 — **propõe formalizar scale em design-system §3.2** antes de fix:
  - CTA tag (uppercase tracking-wide): `px-3 py-[5px]`
  - CTA primary/secondary normal: `px-3 py-2`
  - SUB-CTA: `px-2 py-1`

### CP-3 — Tipografia: tracking-widest vs tracking-tag vs tracking-meta vs tracking-[2px] vs tracking-[1.5px] inconsistente
- **Categoria**: typography
- **Arquivos exemplos**:
  - `tracking-widest` (legacy Tailwind, ~0.1em ≈ 1.6px@10px): NavBar.tsx:115, FeedTabs.tsx:80, IdentityPanel.tsx:46-72, MultiTabModal.tsx:45, 51 (e muitos)
  - `tracking-tag` (CSS var 2.5px): SubpostLayout.tsx:245, CommentCard.tsx:117, 268, ReportModal subtitle
  - `tracking-meta` (CSS var 1.5px): SubpostLayout.tsx:262, CommentCard.tsx:130, 240, etc.
  - `tracking-[2px]`: FullPageOverlay.tsx:76 ("FECHAR" CTA), App.tsx:1490 ("fechar mapa"), App.tsx:1722 (group titles), ComposeOverlay.tsx:220
  - `tracking-[1px]`: ComposeOverlay.tsx:233 ("- SUB"), App.tsx:1248
  - `tracking-[0.2em]`: DialogHost.tsx:133, IdentityPanel.tsx:46, OnboardingOverlay.tsx:196, ModalHeader.tsx:46 (≈3.2px)
- **Decisão**: design-system §2.4 + tailwind.config.js define `tracking-tag` (2.5px) e `tracking-meta` (1.5px). **Migração recomendada**:
  - Group/section titles (uppercase 9-10px) → `tracking-tag` (2.5px)
  - Inline meta lines (timestamps, "DRIFT", "SUBS") → `tracking-meta` (1.5px)
  - CTA tag uppercase (small caps button) → `tracking-[2px]` ou `tracking-meta` — escolha consistente
  - `tracking-widest` = LEGACY (1.6px@10px) → migrar pra `tracking-meta`
  - `tracking-[0.2em]` = LEGACY (3.2px@16px) → migrar pra `tracking-tag`
- **Severity / Effort**: S1 / E2 — DRY win; ~50+ usages pra rever

### CP-4 — Animation duration: 0.15 / 0.18 / 0.2 / 0.22 / 0.24 / 0.25 / 0.28 / 0.32 inconsistente
- **Categoria**: animation
- **Arquivos exemplos**:
  - `duration: 0.15`: DialogHost.tsx:112, OnboardingOverlay.tsx:166
  - `duration: 0.18`: DialogHost.tsx:127, OnboardingOverlay.tsx:194, ReplySheet.tsx:418, CommentCard.tsx:148-164
  - `duration: 0.2`: SlideUpOverlay.tsx:81 backdrop
  - `duration: 0.22`: ReplySheet.tsx:429, CommentCard.tsx:173
  - `duration: 0.25`: FullPageOverlay.tsx:90, SlideUpOverlay.tsx:97 modal, UpdatePrompt.tsx:72
  - `duration: 0.24`: ThreadView.tsx:350
  - `duration: 0.28`: ThreadView.tsx:242
  - `duration: 0.32`: PostViewer.tsx:818, ThreadView.tsx:307, EmbeddedWrapper PostViewer.tsx:840
  - `transition-colors` Tailwind default: 150ms (duration-150)
- **Decisão**: design-system não formaliza scale de duration. Recomendar:
  - microinterações (hover, fade chip): 150ms
  - feedback (small modal, dismiss, badge): 200ms
  - overlay enter/exit (FullPage, SlideUp): 250ms
  - card transition (PostViewer enter, ThreadView): 300ms
- **Severity / Effort**: S2 / E2 — **propõe formalizar em design-system §4.x**

### CP-5 — Typography: `font-display` vs `font-mono` em titles inconsistentes
- **Categoria**: typography
- **Casos**:
  - `font-display` em titles ✓ (correto): FullPageOverlay.tsx:100, ComposeOverlay (DRIFT btn), SubpostLayout title, SwipeHandler hints, PostViewer header bulky, App.tsx logo
  - `font-mono` em uppercase tag titles ✓ (correto): NavBar labels, FeedTabs labels, group titles, CTAs uppercase
  - **Inconsistência**: alguns titles usam `font-display` em um caso e `font-mono` em similar. Ex:
    - `font-mono` em ProfileModal heading "perfil" (ModalHeader.tsx:46) ❌ — design-system §3.2 diz `font-display Syne 700 20-30px` em title de card. ModalHeader usa `font-display text-xs` ✓ na linha 46. **OK**.
    - PostViewer header bulky linha 290: `font-display font-bold uppercase tracking-wider` ✓ (autor name)
- **Verdict**: convenção é geralmente respeitada. Único caso ambíguo é UI tag-style buttons que usam `font-mono` (correto pra Mono UI labels).
- **Severity / Effort**: nenhum — closed

### CP-6 — Skeleton/loading patterns
- **Categoria**: skeleton consistency
- **Arquivos**:
  - Image.tsx:164: `<div className="absolute inset-0 animate-pulse bg-gradient-to-br from-drift-surface to-drift-bg" />`
  - PostCard.tsx loading: não há skeleton inline; relay status icons usam `text-slate-600` raw
  - SpreadMap Placeholder.tsx:568: `<div ... rounded border border-dashed border-drift-border bg-drift-surface/40>` — pattern diferente
- **Verdict**: Image skeleton é único; outros componentes não têm loading state padronizado.
- **Recomendação**: documentar pattern de skeleton em design-system §4.x e padronizar em FeedTabs (refresh anim já usa `animate-spin` ✓), ThreadView (.LoadingState ✓), ReportModal, etc.
- **Severity / Effort**: S2 / E1

### CP-7 — Touch targets ≥ 44×44px (a11y mobile)
- **Categoria**: accessibility (touch)
- **Findings**:
  - `h-7 w-7` (28×28) em PostViewer.tsx:427 (botão ⋮ menu) — **abaixo de 44px**, mas tem `p-2` aplicado externamente? **NÃO**, `flex h-7 w-7 items-center justify-center` — total 28px. WCAG 2.5.5 AA exige 44×44.
  - `h-7 w-7` em PostViewer.tsx:439 (comments button) — mesmo problema
  - `h-[27px] w-[27px]` em ComposeOverlay.tsx:277 (csub circle) — 27px, abaixo de 44px
  - `px-2 py-1` em removre/unblock buttons (LocalListsSettings.tsx:166, 213, RelaySettings.tsx:148) — total ~28×24 abaixo
  - `px-1 py-0.5` em RelaySettings.tsx remove/pause/active buttons — ~16×12 — **abaixo de 44px crítico**
  - Toggle switch (`h-5 w-9` SettingsCards.tsx:73) — 20px tall, abaixo de 44px (mas é toggle, não botão tradicional)
- **Severity / Effort**: S0 / E1 — vários botões pequenos demais pro mobile WCAG AA. Lily decide se aumentar targets ou aceitar (posicionando próximo de targets maiores conta como exception).
- **Sugestão**: NavBar buttons já são 44+ via `py-3`. Aplicar mínimo `min-h-[44px]` em buttons inline críticos (removre, pin, etc).

### CP-8 — Focus rings inconsistentes
- **Categoria**: a11y focus
- **Findings**:
  - Maioria usa `focus-visible:ring-1 focus-visible:ring-drift-accent2` ✓
  - PostViewer.tsx:178-179 usa `focus-visible:ring-2 focus-visible:ring-drift-bury focus-visible:ring-offset-2` em DANGER OK button
  - SettingsCards.tsx:62 usa `focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg` — adiciona offset+offset-color (mais visível)
  - ComposeOverlay.tsx:243 (DRIFT button) usa `focus:ring-2 focus:ring-drift-accent2 focus:ring-offset-2` — destaque maior em CTA primário
  - **Inconsistência**: `focus:` vs `focus-visible:` (mais correto pra keyboard) — alguns lugares só `focus`, outros `focus-visible`. Mistura cria comportamento inconsistente em mouse vs keyboard.
- **Severity / Effort**: S1 / E1 — recomendar padronizar `focus-visible:` (não `focus:`) globalmente. design-system §2.x menciona `:focus-visible` como pattern.

### CP-9 — `text-slate-200` vs `text-drift-text` em inputs (consistência)
- **Categoria**: input typography
- **Findings**:
  - DialogHost.tsx:160 input: `text-drift-text` ✓
  - RelaySettings.tsx:169, 198 inputs: `text-slate-200` ❌
  - IdentityPanel.tsx:360 textarea: `text-slate-300` ❌
  - IdentitySwitcher.tsx:331, 362, 369, etc inputs: `text-slate-200` ❌
  - ComposeOverlay.tsx:364 textarea: `text-drift-text` ✓
  - ReplySheet.tsx:497 textarea: `text-drift-text` ✓
- **Verdict**: 50/50 split. Padronizar `text-drift-text` em todos os inputs/textareas.
- **Severity / Effort**: S1 / E1

### CP-10 — `data-post-id` debug attribute em CommentCard
- **Arquivo**: `src/components/Post/CommentCard.tsx:96, 106`
- **Snippet**: `const debugProps = import.meta.env.DEV ? { 'data-post-id': postId } : {}` (linha 96), spread no `<article>` (linha 106)
- **Verdict**: debugProps gated em DEV — não impacta visual prod. **OK**, mas verificar pós-Marshall.
- **Severity / Effort**: nenhum — closed

### CP-11 — Decorative letter (Syne 800 100px) absolute positioning
- **Arquivo**: `src/components/Post/SubpostLayout.tsx:446-459`
- **Detalhes**: opacity 0.55 + position absolute + bottom -18px + right -10px + letterSpacing -6px
- **Verdict**: design-system §3.2 ESPECIFICA exatos esses valores. **Conforme**.
- **Severity / Effort**: nenhum — confirmed

### CP-12 — Card stack shadow scale/translate consistente
- **Categoria**: spacing/transform
- **Arquivos**:
  - PostViewer.tsx:454-464: `translateY(14px) scale(0.92) opacity(0.18)` + `translateY(7px) scale(0.96) opacity(0.4)` ✓ (design-system §4.2 ESPECIFICA)
  - App.tsx:765-771: idêntico ✓
  - ThreadView.tsx:274-296: `translateY(14px) scale(0.92) opacity(0.18)` ✓
- **Verdict**: pattern consistente entre 3 locations. **Conforme design-system §4.2**.
- **Severity / Effort**: nenhum — confirmed

### CP-13 — `gap-1.5` (6px) vs `gap-2` (8px) vs `gap-1` (4px) inconsistente
- **Categoria**: spacing scale
- **Findings**: variam entre 4-8px sem padrão claro. Maioria `gap-2` em CTAs row, `gap-1` em meta inline.
- **Severity / Effort**: S2 / E2 — formalizar padrão se houver edge cases problemáticos. Atual está OK funcional.

### CP-14 — `font-mono text-[10px]` vs `font-mono text-[11px]` vs `font-mono text-[12px]` em meta lines
- **Categoria**: typography scale
- **Atual**: 3 sizes muito próximos sem regra clara
- **Recomendação**: design-system §3.2 menciona "Body: DM Mono 12-13px line-height 1.65". Meta lines (DRIFT/SUBS/HÁ stat) = 9-10px. CTA labels = 10-11px. Body card text = 12-13px.
  - 9px: meta inline tags (DERIVA, SUBS) ✓ (SubpostLayout.tsx:245, 262)
  - 10px: CTAs uppercase tag ("FECHAR", "+ no post"), navbar labels, group titles
  - 11px: body content (paragraphs in modals)
  - 12-13px: card body text (post content, comment content)
- **Severity / Effort**: S1 / E2 — formalizar scale na design-system §3.2

### CP-15 — Border thickness inconsistente: `border` (1px) vs `border-2` (2px) vs `border-[1.5px]`
- **Categoria**: border thickness
- **Findings**:
  - `border-[1.5px]`: ComposeOverlay (csub buttons, layout chips, ReplyImagePicker, drop area), ReplySheet CW chips
  - `border-2`: SwipeHandler container, ThreadView FAB, PostViewer reveal CTA, EmptyState button, FAB ↵
  - `border` (1px default): maioria
- **Recomendação**: estabilizar pattern:
  - 1px: card borders (drift-border subtle hairline)
  - 1.5px: chip/option borders (active/inactive distinguishable)
  - 2px: prominent CTAs (FAB, primary action highlight)
- **Severity / Effort**: S2 / E1

### CP-16 — Border-radius `rounded-2xl` apenas em ReplySheet
- **Arquivo**: `src/components/Post/ReplySheet.tsx:438`
- **Snippet**: `rounded-t-2xl border border-b-0 border-drift-border bg-drift-surface`
- **Verdict**: bottom sheet pattern (top corners arredondados). Único uso. **OK** se pattern futuro de bottom sheets é consistente. Documentar.
- **Severity / Effort**: S2 / E0

### CP-17 — Icon size inconsistente em StatusIndicators e similar
- **Categoria**: icon scale
- **Findings**:
  - StatusIndicators (App.tsx:1191, 1205, 1218, 1232): `size={14}` ✓
  - NavBar action icons: `size={18}` ✓
  - SettingsRoot ícones (App.tsx:1740): `size={18}` ✓ (consistent)
  - PostViewer ⋮ button (App.tsx via PostViewer.tsx:431): `text-[14px] leading-none` (emoji ⋮)
  - Sizes: 14 (status), 18 (action/menu), 22 (logo) — pattern claro
- **Severity / Effort**: nenhum — closed

### CP-18 — Inline emojis vs SVG icons
- **Categoria**: iconography
- **Findings**: pin (📌, 📍), comments (💬), block (⊘), mute (🔇), warning (⚠), bury action (↓), etc — emoji nativos. Por outro lado UserIcon, MapIcon, KeyIcon — SVG components.
- **Decisão**: design-system §7 indica V6 vai migrar emojis pra ícones SVG. Atual é mix transitório. **Aceitar como dívida documentada**.
- **Severity / Effort**: S2 / E2 (V6 polish — fora do escopo Lily fixes)

### CP-19 — `whitespace-pre-wrap` vs `whitespace-pre` em pre/code
- **Categoria**: text rendering
- **Findings**:
  - `whitespace-pre-wrap break-words`: PostCard.tsx:94, PostViewer (subpost text), CommentCard.tsx:205 — pattern consistente em body text
  - `whitespace-pre-wrap break-all`: BootView.tsx pre, App.tsx:2130 — pra hex/long strings
  - `whitespace-pre-wrap`: DialogHost message
- **Verdict**: pattern consistente. break-words = palavras quebráveis; break-all = hex/long-string sem espaços. **OK**.
- **Severity / Effort**: nenhum — confirmed

### CP-20 — Modal max-width: `max-w-md` vs `max-w-sm` vs `max-w-lg` vs `max-w-[340px]`
- **Categoria**: layout scale
- **Findings**:
  - `max-w-md` (28rem = 448px): default em SlideUpOverlay, FullPageOverlay, NavBar, App root
  - `max-w-sm`: SlideUpOverlay opção
  - `max-w-lg`: SlideUpOverlay opção
  - `max-w-[340px]`: DialogHost.tsx:128 — alert/confirm dialogs
- **Verdict**: 340px em DialogHost é exception justificada (dialogs pequenos). **OK**.
- **Severity / Effort**: nenhum — closed

### CP-21 — Z-index inconsistente: `z-30` / `z-40` / `z-50` / `z-[60]` / `z-[100]`
- **Categoria**: layout layering
- **Findings**:
  - `z-30`: NavBar.tsx:72, PostViewer.tsx:428 (menu button)
  - `z-40`: SlideUpOverlay.tsx:82, FullPageOverlay.tsx:94, OnboardingOverlay.tsx:167
  - `z-50`: PostViewer modal mode line 819, UpdatePrompt.tsx:73, GpsErrorBanner.tsx:85, ReplySheet.tsx:419
  - `z-[60]`: Image lightbox.tsx:232, ThreadView.tsx:232
  - `z-[100]`: DialogHost.tsx:113
- **Decisão**: parece pattern claro (NavBar < overlays < modals < dialogs). **OK** mas documentar em design-system.
- **Severity / Effort**: S2 / E0 (doc apenas)

### CP-22 — `sm:border-x` e `sm:flex` inconsistente entre overlays full-page
- **Categoria**: responsive
- **Findings**:
  - App root: `sm:border-x` ✓ (App.tsx:665)
  - NavBar: `sm:border-x` ✓ (NavBar.tsx:72)
  - FullPageOverlay: `sm:border-x` ✓ (linha 94)
  - SlideUpOverlay: NÃO tem `sm:border-x` (rounded border default OK pra modal)
- **Verdict**: pattern consistente (FullPage = side borders em sm; SlideUp = box). **OK**.
- **Severity / Effort**: nenhum — confirmed

### CP-23 — Dialog placeholders vs `placeholder:text-drift-muted`
- **Categoria**: input style
- **Findings**:
  - DialogHost.tsx:160: `placeholder:text-slate-500` ❌
  - RelaySettings.tsx:169, 198: `placeholder:text-slate-700` ❌
  - IdentitySwitcher.tsx:331-498: `placeholder:text-slate-700` ❌ (~7 ocorrências)
  - IdentityPanel.tsx:360: `placeholder:text-slate-700` ❌
  - ComposeOverlay.tsx:364: `placeholder:text-drift-muted` ✓
  - ReplySheet.tsx:497: `placeholder:text-drift-muted/60` ✓
- **Verdict**: ComposeOverlay + ReplySheet estabelecem o pattern correto (`placeholder:text-drift-muted` ou `placeholder:text-drift-muted/60`). Outros 4 components não seguem.
- **Severity / Effort**: S1 / E1 (~10 placeholders pra ajustar)

### CP-24 — Botão cancelar pattern inconsistente
- **Categoria**: button variants
- **Findings** (cancel/secondary action):
  - DialogHost.tsx:168: `border border-drift-border ... text-slate-400 hover:border-drift-text hover:text-drift-text` — drift-border + slate-400 → drift-text hover
  - ReportModal.tsx:115: `border border-drift-border ... text-drift-muted hover:border-drift-text hover:text-drift-text` — drift-border + drift-muted hover drift-text
  - IdentitySwitcher.tsx:337: `border border-drift-border ... text-slate-500 hover:border-slate-500` — slate-500 + hover slate-500 (sem texto change)
  - ComposeOverlay.tsx:220 (CANCELAR): `border border-drift-border ... text-drift-muted ... hover:text-drift-text` — drift-border + drift-muted hover drift-text ✓
- **Verdict**: 4 padrões diferentes. ComposeOverlay + ReportModal compatíveis; DialogHost usa slate; IdentitySwitcher usa slate sem hover-color-change.
- **Recomendação**: padronizar pattern de "secondary cancel button":
  ```
  border border-drift-border px-3 py-2 font-mono text-[10px] uppercase tracking-meta
  text-drift-muted transition-colors hover:border-drift-text hover:text-drift-text
  focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2
  ```
- **Severity / Effort**: S1 / E1

### CP-25 — Padding card inconsistente: `p-2` / `p-3` / `p-4` / `p-5`
- **Categoria**: padding scale
- **Atual**: 4 níveis sem regra clara
- **Recomendação**: design-system §3.2 não formaliza. Sugerir:
  - `p-2`: chips/inline badges/tags
  - `p-3`: secondary cards (RelaySettings row, AlertBlock)
  - `p-4`: primary cards (PostCard, BootView Check, content blocks dentro de overlays)
  - `p-5`: modal overlays (FullPageOverlay body, SlideUpOverlay body)
- **Severity / Effort**: S2 / E2

---

## §5 — Findings de a11y/UX cross-cutting (AY-1 … AY-9)

### AY-1 — `aria-label` faltando em emoji-only buttons
- **Arquivos**:
  - PostViewer.tsx:323-378: pin (📍/📌), follow (➕/✓), mute (🔇), block (⊘), report (⚠), close (✕) — TODOS têm `aria-label` ✓
  - ProfileModal Stat tooltip (não-interactive — OK)
  - LocalListsSettings.tsx:151 `<span className="text-yellow-300">📌</span>` — span decorativo, sem aria-* (OK)
  - SubpostLayout.tsx:417 `<span aria-hidden="true">{meta.icon}</span>` — aria-hidden ✓
- **Verdict**: **conformidade alta**. Não detectei buttons emoji-only sem aria-label.
- **Severity / Effort**: nenhum — closed

### AY-2 — Foco visível em hover-only states
- **Findings**:
  - SettingsCards.tsx Toggle.tsx:62 — `focus:ring-1 focus:ring-drift-accent2` ✓
  - Maioria dos botões inline tem `focus-visible:` ou `focus:` ring
  - **Exceções**:
    - PostViewer.tsx Footer (linhas 538-585): MyAction buttons sem `focus-visible:ring-*` explícito — só `disabled:opacity-40`. Resort to body global `:focus-visible` (index.css:87)
    - ProfileModal `<Stat>` (não-interactive, OK)
- **Verdict**: cobertura ~90%; alguns botões dependem de fallback global `:focus-visible` no index.css. **Aceitável** mas explicit > implicit.
- **Severity / Effort**: S2 / E1

### AY-3 — `aria-live` regions
- **Findings positivos**:
  - GpsErrorBanner: `role="status"` ✓
  - UpdatePrompt: `role="status" aria-live="polite"` ✓
  - ThreadHeader: `aria-live="polite" aria-atomic="true"` ✓ (newCount badge)
  - EndOfFeed.tsx:1445: `aria-live="polite"` ✓ (statusMsg)
  - ThreadView Empty/Loading: `role="status" aria-live="polite"` ✓
  - ReplySheet: `aria-live={overLimit ? 'assertive' : 'off'}` ✓
- **Verdict**: bem coberto.
- **Severity / Effort**: nenhum — closed

### AY-4 — Contraste WCAG (drift-muted text)
- **Análise**:
  - drift-muted (`#4a4a46`) sobre drift-bg (`#0c0c0b`): ratio ~4.05:1 — passa AA (4.5:1 falha; AA pra texto large 18pt+ passa em 3:1)
  - drift-muted sobre drift-surface (`#15151a`): ratio ~3.7:1 — falha AA pra texto normal
  - Texto típico onde drift-muted é usado: 9-12px (small) → exige 4.5:1
- **Severity**: S0 (acessibilidade) / E2 — **considerar bumpar drift-muted**:
  - `#4a4a46` → `#5a5a56` (ratio ~4.7:1) — leve adjusto, mantém visual "muted"
  - OU usar drift-muted apenas em backdrops drift-bg (não drift-surface)
- **Decisão pra Lily**: trade-off design vs a11y; consultar Arquiteto se ajustar token. **BLOCKER POTENCIAL**.

### AY-5 — `cursor-zoom-in` em Image lightbox + outras affordances
- **Findings**: Image.tsx:151 usa `cursor-zoom-in`; lightbox usa `cursor-zoom-out` (linha 232). **Pattern correto**.
- **Severity / Effort**: nenhum — closed

### AY-6 — Touch targets revisited (cross-ref CP-7)
- **Findings críticos**:
  - RelaySettings.tsx:148 botões pause/remove — `px-1 py-0.5` = ~16×12px → **WCAG AAA fail (24px), AA fail (44×44px)**
  - LocalListsSettings.tsx:166, 215 botões unpin/unblock — `px-1 py-0.5` mesmo problema
  - PostViewer.tsx:312-378 buttons — `px-2 py-1` = ~24×24, abaixo de 44×44
  - ComposeOverlay csub circles 27×27 — abaixo de 44×44
- **Recomendação**: aplicar `min-h-[44px] min-w-[44px]` ou aumentar padding em buttons inline críticos.
- **Severity / Effort**: S0 / E1 — refletir em §6 quick wins (parcialmente)

### AY-7 — `keyboard-shortcuts` aria
- **Findings positivos**:
  - ReplySheet: `aria-keyshortcuts="Escape"`, `aria-keyshortcuts="Meta+Enter Control+Enter"` ✓
  - ThreadView FAB: `aria-keyshortcuts="Enter"` ✓
  - ThreadHeader close: `aria-keyshortcuts="Escape"` ✓
- **Verdict**: bem coberto.
- **Severity / Effort**: nenhum — closed

### AY-8 — Focus trap em modals
- **Findings**:
  - DialogHost ESC + Enter handlers ✓
  - ThreadView focus restore ✓
  - ReplySheet `handleTrapKey` impl manual ✓
  - SlideUpOverlay/FullPageOverlay: NÃO têm focus trap explícito (dependendo do conteúdo, pode escapar)
- **Severity / Effort**: S1 / E2 — adicionar focus trap utility nos primitives Wrapper.

### AY-9 — Reduced motion respect
- **Findings**:
  - ThreadView: `useReducedMotion()` ✓ (motion-reduce:hidden em shadow cards, motion-reduce:backdrop-blur-none em backdrop)
  - ReplySheet: `useReducedMotion()` ✓
  - CommentCard: AnimatePresence ✓ (Framer respeita reduced motion globally)
  - **Outros componentes** (PostViewer, FullPageOverlay, SlideUpOverlay): NÃO usam useReducedMotion explicitamente — dependem de Framer global config
- **Severity / Effort**: S2 / E1 — auditar Framer global config (ou adicionar useReducedMotion onde anim duration > 200ms)

---

## §6 — Quick wins pra Lily (top 5, S0/S1 + E0)

Lista priorizada de fixes que Lily pode shipar em 1 sessão pra
resolver alta densidade de finds:

1. **CL-9 + CL-17 + CL-18 + CL-19 + CL-20**: substituir `bg-emerald-900/40 text-emerald-300`/`bg-red-900/40 text-red-300` em PostCard + PostViewer spread/bury active states pelos tokens `bg-drift-spread/20 text-drift-spread`/`bg-drift-bury/20 text-drift-bury` (e variants `/10` pra hover). E0 — replace_all em 2 arquivos.

2. **CL-50**: `<span className="text-emerald-400">✓</span>` em OnboardingOverlay → `<span className="text-drift-spread">✓</span>` (4 instances replace_all). Coerência semântica com kind 9079.

3. **CL-2 + CL-3 + CP-23**: padronizar `placeholder:text-drift-muted/60` em RelaySettings, IdentityPanel, IdentitySwitcher, DialogHost (~10 placeholders, replace_all). Idiomatic Drift.

4. **CL-4 + CL-46**: chips "source" / "IPFS" no LocalListsSettings + RelaySettings — `bg-slate-800/50 text-slate-500` → `bg-drift-border/40 text-drift-muted`; `bg-emerald-950/30 text-emerald-400` → `bg-drift-spread/15 text-drift-spread`.

5. **CL-13 + CL-14 + CL-12**: PostCard meta line + body text + DERIVA value migrar slate-* pra drift-* — 3 lines em PostCard.tsx que afetam visual de cada card no feed (high-visibility win).

**Total estimated effort**: ~30-45min se Lily faz tudo de uma vez. Resolve ~20 finds + alinha PostCard com pattern de SubpostLayout.

---

## §7 — Refactor maior recomendado: `<DriftButton>` primitive

**Justificativa**: a auditoria revelou ≥4 padrões distintos de
"botão secondary":

1. **DialogHost cancel** (DialogHost.tsx:168): `border-drift-border + text-slate-400 + hover:border-drift-text hover:text-drift-text`
2. **ReportModal cancel** (ReportModal.tsx:115): `border-drift-border + text-drift-muted + hover:border-drift-text hover:text-drift-text`
3. **IdentitySwitcher cancel** (IdentitySwitcher.tsx:337): `border-drift-border + text-slate-500 + hover:border-slate-500`
4. **ComposeOverlay CANCELAR** (ComposeOverlay.tsx:220): `border-drift-border + text-drift-muted + hover:text-drift-text`

**E ≥3 padrões distintos de "botão primary"**:

1. **DialogHost OK** (DialogHost.tsx:179): `bg-drift-accent + text-drift-bg + hover:opacity-90 + focus-visible:ring-2`
2. **ComposeOverlay DRIFT** (ComposeOverlay.tsx:243): `bg-drift-accent + font-display + tracking-[2px] + focus:ring-2`
3. **ReportModal continuar** (ReportModal.tsx:122): `border-drift-accent + text-drift-accent + hover:bg-drift-accent/10` (variant border-only)

**E ≥3 padrões distintos de "botão danger"**:

1. **DialogHost danger OK** (DialogHost.tsx:178): `border-drift-bury + bg-drift-bury/10 + text-drift-bury + hover:bg-drift-bury hover:text-drift-bg`
2. **ReportModal denunciar** (ReportModal.tsx:178): `border-red-700 + bg-red-950/30 + text-red-300` ❌ (não-token)
3. **PostViewer ActionsMenu danger** (PostViewer.tsx:769): `text-drift-bury + hover:text-[#ff6b6b]` (hex hardcoded)

**Proposta**: introduzir `<DriftButton>` primitive com variants:

```tsx
type DriftButtonVariant = 'primary' | 'ghost' | 'cancel' | 'danger' | 'danger-prominent'
type DriftButtonSize = 'sm' | 'md'

<DriftButton variant="primary" size="md" onClick={...}>publicar</DriftButton>
<DriftButton variant="ghost">cancelar</DriftButton>
<DriftButton variant="danger" onClick={handleBlock}>bloquear</DriftButton>
```

**Cada variant encapsula**: padding, border, bg, text color, hover,
focus-visible, disabled. Resolve ~20 finds CL secundários e elimina
deriva visual entre cards.

**Effort**: ~3h pra criar primitive + migrar 4-6 call sites principais.
Trabalho separado, fora do escopo Lily atual. **Decisão Arquiteto**:
fazer agora ou marcar como dívida pra v0.8 do design-system?

---

## §8 — Veredito final

**Conformidade global**: ~62% — maioria dos componentes usa drift-*
tokens em pelo menos 60% das classes. As 38% restantes são
predominantemente:
- `text-slate-*` legacy (deveria virar drift-text/drift-muted) — ~70 ocorrências
- `bg-emerald-*` / `bg-red-*` raw (deveria virar drift-spread/drift-bury com alpha) — ~10 ocorrências
- `text-yellow-*` raw em CW labels (deveria virar amber tokens consistente — ~15 ocorrências)
- Hex hardcoded (`#ff4f4f`, `#ff6b6b`, `rgba(31, 41, 55, 1)`) — ~5 ocorrências

**Prioridades pra Lily**:

1. **Quick wins §6** (~30-45min) — resolve ~20 finds high-visibility
2. **CL-40 (IdentityPanel slate purge)** + **CL-44 (IdentitySwitcher slate purge)** — biggest density of slate-* legacy (~58 finds combined). E2 effort but high return.
3. **CL-58 (App.tsx slate purge)** — BootView/DiagnosticPanel/EndOfFeed — verificar BootView pré-CSS-loaded edge case antes de migrar.
4. **CP-7 / AY-6 (touch targets)** — críticos pra a11y mobile WCAG AA. Lily decide se aumenta inline ou aceita exception.

**Blockers** (decisão Arquiteto requerida):

- **AY-4 (drift-muted contraste)**: drift-muted sobre drift-surface = 3.7:1, falha WCAG AA. Bumpar token `#4a4a46` → `#5a5a56` é decisão de design-system v0.7.1 — afeta ~50 components. Consultar Arquiteto **ANTES** de Lily migrar slate-500/600 → drift-muted (porque resolveria a uma vez se tomar decisão antes).

- **§7 (DriftButton primitive)**: Arquiteto decide se quer consolidar agora (3h trabalho separado) ou deferir pra design-system v0.8.

**Não-blockers** mas dependentes de design-system updates:

- **CP-2 (padding scale)**: formalizar em §3.2 antes de Lily padronizar
- **CP-3 (tracking scale)**: formalizar em §2.4 (já há base — só falta migration regra)
- **CP-4 (animation duration scale)**: formalizar em §4.x novo

---

## Stats finais

| Categoria | S0 | S1 | S2 | Total |
|---|---|---|---|---|
| **Cor (CL)** | 0 | 39 | 18 | 57* |
| **Component (CP)** | 1 | 9 | 15 | 25 |
| **A11y (AY)** | 2 | 1 | 6 | 9 |
| **Total** | **3** | **49** | **39** | **91** |

\* CL-10 anulado pós-verificação (MultiTabModal está limpo). Total final = 90 findings.

| Effort | Count |
|---|---|
| E0 (<5min) | ~52 |
| E1 (<30min) | ~28 |
| E2 (>30min) | ~10 |

**Estimativa total Lily** (sem refactor §7 e sem decisões Arquiteto):
~6-8h spread em 2-3 sessões. Quick wins §6 entrega valor visível
imediato em <1h.

**Próxima ação Robin**: aguardar Lily executar fixes; QA #2
verifica se finds desapareceram + nenhum regression introduzida +
status de marcado-pra-pós-Marshall (CL-31, CL-32, CL-33, CL-34, CL-35,
CL-36).

---

*Robin · 2026-05-08 · 90 findings · ~6h Lily executar quick wins + S1
prioridades · Refactor §7 (DriftButton) ainda em decisão Arquiteto*
