# Drift — Design System

> **Status:** v0.7 (em construção via tracks V0–V6 do redesign 2026-05-04).
> **License:** MIT (mesmo que código).
> **Fonte canônica de tokens:** `tailwind.config.js`. CSS vars em
> `src/index.css` espelham; LOCK_VIA_TEST garante paridade.

Este documento é a referência única pra decisões visuais do Drift.
Se o mockup HTML local diverge, **manifesto + este doc vencem**.

---

## 1. Vocabulary

Drift mantém **separação léxica** entre camada UI (user-facing) e
camada protocolo/código:

| Camada | Termo | Onde aparece |
|---|---|---|
| Protocol | **SPREAD** (kind 9079) / **BURY** (kind 9080) | Manifesto, protocol-spec.md, function names (`spreadPost`, `buryPost`), CSS classes (`drift-spread`, `drift-bury`), TypeScript discriminants (`'spread' \| 'bury'`), comments técnicos |
| UI | **DRIFT** (verbo da ação ↑) / **SINK** (verbo da ação ↓) / **DERIVA** (substantivo, métrica) | Strings JSX user-facing, labels de botão, toasts, onboarding copy |

**Por quê separar:** protocolo é eterno (kinds gravados em eventos
imutáveis); UI copy é mutável (rebranding, i18n). Renomear `spreadPost`
pra `driftPost` quebraria grep, git blame, e refs em PRs históricos
sem ganhar nada — UI já comunica DRIFT pro user via strings JSX.

**Precedente OSS:** Mastodon usa `boost` (UI) + `reblog`/`Announce`
(API/ActivityStreams) há 8 anos. Funciona porque **glossário canônico
existe num lugar** — esse doc.

**Guard ativo (LOCK_VIA_TEST):** `tests/manifesto-conformance.test.ts`
contém:
- `vocab UI: zero 'espalha\|enterra' em src/**/*.tsx em strings JSX`
- `vocab spec: protocol-spec.md preserva SPREAD/BURY associado a 9079/9080`

Reaparecimento de "espalhar"/"enterrar" em UI nova ou de "DRIFT"/"SINK"
em spec quebra build.

---

## 2. Tokens

### 2.1 Surface (background + camadas)

| Token | Hex | Uso |
|---|---|---|
| `drift-bg` | `#0c0c0b` | Background base. Quase-preto warm. `theme-color` sync em 4 fontes. |
| `drift-surface` | `#15151a` | Cards, modals, overlays. 1 step lighter. |
| `drift-border` | `#2a2a2e` | Hairlines, dividers, X buttons. |

### 2.2 Brand (chartreuse + mint)

| Token | Hex | Uso |
|---|---|---|
| `drift-accent` | `#e8ff5a` | DRIFT (↑), CTAs, active states, decorative letter override (subordinado a border). Chartreuse-lime. |
| `drift-accent2` | `#5affd4` | Sub-actions (subpost nav), focus rings, indicator de "recente". Mint cyan. |

**Contraste WCAG AA:**
- `drift-accent` sobre `drift-bg`: ~16:1 ✓ (AAA)
- `drift-accent2` sobre `drift-bg`: ~13:1 ✓ (AAA)
- Text `drift-text` sobre `drift-bg`: ~17:1 ✓ (AAA)

### 2.3 Type

| Token | Hex | Uso |
|---|---|---|
| `drift-text` | `#f0f0ea` | Body text, primary content. Off-white warm. |
| `drift-muted` | `#4a4a46` | Secondary text, labels, timestamps, disabled. |

Slate (Tailwind default) continua OK pra detalhes neutros (skeletons,
GpsErrorBanner amber tones, decoração não-Drift-específica). Não
fazemos migração total slate→drift-text/muted — só onde semântica
Drift importa.

### 2.4 Role (semântica de protocolo)

| Token | Hex | Uso |
|---|---|---|
| `drift-spread` | `#34d399` | Ação positiva (kind 9079 — label UI: DRIFT). Cor verde mint legacy. |
| `drift-bury` | `#f87171` | Ação negativa (kind 9080 — label UI: SINK). Vermelho. SwipeHandler badge `i-sink` border. |

Estes tokens **não são renomeados** apesar do rebrand UI. Ver §1
(separação léxica).

### 2.5 Semantic UI intent (Round 10, 2026-05-14)

Distintos dos role tokens — não carregam semântica de protocolo. Sinalizam
intent de UI (aviso, ação destrutiva). Reutilizam hex de role tokens
quando faz sentido (ex.: `drift-danger` = mesma cor de `drift-bury` por
ergonomia, mas o significado é "ação destrutiva genérica" não "bury").

| Token | Hex | Uso |
|---|---|---|
| `drift-warning` | `#fbbf24` | Avisos não-bloqueantes — CW chips, banners informativos, long-press progress, content-warning suggestion no compose. Amber 400 — contraste WCAG AA sobre `drift-surface` e `drift-bg`. |
| `drift-danger` | `#f87171` | Ações destrutivas — botões Bloquear/Denunciar, dialogs `dangerous: true`, hover de delete CTAs. Mesma cor de `drift-bury` (mesma paleta, intent diferente). |

Migração legacy `yellow-*`/`red-*`/`amber-*` → `drift-warning`/`drift-danger`
completa em Round 10 (commits `1d0f5ed`, `1aee96b`, `b6545ec`). Hard ratchet
`eslint . --max-warnings 0` impede regressões.

### 2.6 Tokens depreciados / legacy a auditar (histórico)

Hardcoded hex/RGB ainda presente em SwipeHandler — `rgba(52, 211, 153, ...)`
inline em `style={...}` durante drag hint border. Não é Tailwind class
então passa pelo lint rule. Migração futura — usar CSS var `--drift-spread`
quando inline style precisar de alpha dinâmico.

---

## 3. Tipografia

### 3.1 Fontes

| Family | Uso | Status |
|---|---|---|
| Syne | **Display**: logo, título de card, decorative letter, badges DRIFT/SINK | V2 (pendente bundle local) |
| DM Mono | **Body/UI**: labels, body text, stats, captions, mono-friendly content | V2 (pendente bundle local) |

**Por quê Syne + DM Mono:** mistura display geometric + mono cria
identidade editorial-magazine. Nenhum app social usa essa combinação
hoje (X/Bluesky/Threads usam sans-serif neutro). Diferenciação = parte
do compromisso anti-bolha (manifesto §24).

**Privacy-first:** fontes bundled localmente (`public/fonts/*.woff2`),
zero requests pra `fonts.googleapis.com` ou `fonts.gstatic.com`.
LOCK_VIA_TEST: `tests/manifesto-conformance.test.ts` scan zero matches
pra Google Fonts URLs.

### 3.2 Hierarquia

V0.7 não define type scale formal (rem-based) ainda. Convenção atual:
- Logo: Syne 800 25px
- Title de card: Syne 700 20-30px (varia por layout)
- Stat header: DM Mono 10px, letter-spacing 1.5-2px, uppercase
- Body: DM Mono 12-13px line-height 1.65
- Decorative letter: Syne 800 100px, letter-spacing -6px, color `var(--drift-border)`, opacity 0.55, `aria-hidden`

V5 polish formaliza scale se houver inconsistência.

---

## 4. Patterns

### 4.1 Slide-up overlay

Padrão único pra modals/overlays (ProfileModal, IdentityPanel,
SubpostEditor, ReportModal, MultiTabModal, IdentitySwitcher, futuras
sub-overlays Settings):

- `transform: translateY(22px) → 0`
- `opacity: 0 → 1`
- `transition: 0.25s ease-out`
- Header: title + X button border `1px solid drift-border`
- Background: `drift-bg`

**V3.0 extrai `<SlideUpOverlay>`** (`src/components/UI/SlideUpOverlay.tsx`)
consumido por todos os 6+ modals. DRY mandatório pelo HIMYM Round 1
(Lily quantificou: ~300 linhas redundantes em 10 modals previstos).

### 4.2 Card stack (Tinder-style)

PostViewer card tem 2 shadow cards atrás:
- Shadow 1: `scale(0.96) translateY(7px) opacity(0.4)`
- Shadow 2: `scale(0.92) translateY(14px) opacity(0.18)`
- Border `1px solid drift-border`, border-radius 4px
- Background `drift-surface`

V3.1 implementa.

### 4.3 Tab indicator slide

FeedTabs (Global/Seguindo/Trending) com indicator bottom-edge:
- `transition: cubic-bezier(0.34, 1.56, 0.64, 1) 280ms` (elastic overshoot)
- Active tab font weight 500 + `drift-text`; inativos `drift-muted`

V3.2 implementa.

### 4.4 NavBar plus central

3-button navbar (mapa esquerda / + central / config direita):
- Botão central 48×48 disco `drift-accent`
- `box-shadow: 0 0 22px rgba(232, 255, 90, 0.22)` (glow)
- Hover/focus: scale 0.95
- Botões laterais SVG outline + DM Mono label `drift-muted`

V3.3 implementa.

### 4.5 Swipe indicators (badges in-card)

Durante drag em PostViewer:
- `i-drift` (top-left): bg `drift-accent`, color `drift-bg`, Syne 800, rotate -5deg, padding 5px 12px
- `i-sink` (top-right): border `2px solid #ff4f4f` (= `drift-bury`), color `drift-bury`, rotate 5deg
- `i-sub` (center, swipe horizontal): border `2px solid drift-accent2`, color `drift-accent2`
- Opacity = `Math.min(Math.abs(dx)/82, 1)`

V3.5 implementa.

### 4.6 Dots indicator (subpost pagination)

5px círculos:
- Inativos: `drift-border`
- Ativo: `width: 14px; border-radius: 3px; background: drift-accent` (não círculo, retângulo arredondado)
- Transition 200ms ease

V5 polish.

### 4.7 Noise overlay (film grain)

Global em `body::after`:
- SVG turbulence inline: `<svg viewBox="0 0 200 200">...feTurbulence baseFrequency="0.75" numOctaves="4"...</svg>` como data URI
- Opacity 0.025
- `z-index: 999`, `pointer-events: none`
- ~2KB inline, GPU-friendly (filter url ref)

V5 polish. Toggle em Settings → Content → "Reduzir efeitos visuais"
(a11y) considerado.

---

## 5. Theme color sync

`theme_color` / `background_color` aparecem em **5 fontes da verdade**.
LOCK_VIA_TEST garante paridade.

| Fonte | Campo | Valor |
|---|---|---|
| `tailwind.config.js` | `theme.extend.colors.drift.bg` | `#0c0c0b` |
| `src/index.css` | `:root --drift-bg` | `#0c0c0b` |
| `vite.config.ts` | manifest `theme_color` + `background_color` | `#0c0c0b` |
| `index.html` | `<meta name="theme-color">` | `#0c0c0b` |
| `src-tauri/tauri.conf.json` | `app.windows[0].backgroundColor` | `#0c0c0b` |

**Mudança de paleta = atualizar 5 lugares. Test em
`manifesto-conformance.test.ts` falha se divergem.**

---

## 6. Decisões do mockup REJEITADAS

Mockup `drift.html` é **conceito visual**, não contrato. Estas
features do mockup foram descartadas por conflito com manifesto:

| Mockup | Conflito | Decisão |
|---|---|---|
| `bump()` random +10-80 em swipe (linha 559) | Manifesto §22 (score determinístico) | DERIVA exibe `post.score` real (`src/lib/scoring.ts`); LOCK_VIA_TEST garante regex coupling |
| Toggle "AUTO-DRIFT" em Settings (linha 310) | Manifesto §22 (afinidade automática) ou §12 (chave mestra disfarçada se for auto-spread) | Não implementado. Settings não inclui. |
| Toggle "MODO ANÔNIMO" (linha 311) | Ambíguo (location off? multi-id? network_mode?) | Substituído por toggles concretos: location_granularity slider + IdentitySwitcher + network_mode radio |

---

## 7. Sequência de tracks

```
V_pre0  Extract App.tsx (FeedTabs/NavBar/PostCard)
   ↓
V1      Tokens + design-system.md (este doc) + LOCK_VIA_TEST theme_color
   ↓
V0      Vocab UI swap (espalha→drift, enterra→sink) + LOCK_VIA_TEST vocab guard
   ↓
V2      Fontes locais Syne + DM Mono + LOCK_VIA_TEST zero Google Fonts
   ↓
V3.0    Primitives (SlideUpOverlay, ModalHeader, Chip, DotsIndicator)
   ↓
V3.1–V3.5  Components reskin (PostViewer / FeedTabs / NavBar / Overlays / SwipeHandler)
   ↓
V4      Three-layout system (TAG `["layout", idx, value]`) + HIMYM 2-round pré + registry pattern
   ↓
V5      Polish (dots indicator stylized + noise overlay + microcopy)
   ↓
V6      Ícones rebrand (DEFERIDO até V1 ≥2 semanas em prod)
```

Cada track é shippable independente (test gate por track).

---

## 8. Primitives Registry (UI atoms+molecules)

Single source of truth pros componentes reusáveis em `src/components/UI/`.
Adicionar novo primitive aqui ao shipping. LOCK_VIA_TEST quando aplicável
trava classnames / a11y shape contra regressão de theme/contrast.

| Primitive | Arquivo | LOCK_VIA_TEST | Shipped | Uso típico |
|---|---|---|---|---|
| `DriftButton` | `UI/DriftButton.tsx` | `design-system-primitives-conformance` | V1 | Botão primário/ghost/danger |
| `DriftChip` | `UI/DriftChip.tsx` | (mesmo) | V1 | Tag, badge, label compacto |
| `DriftCard` | `UI/DriftCard.tsx` | (mesmo) | V1 | Container card (3 variants) |
| `Toggle` | `UI/Toggle.tsx` | — | V1 | Switch boolean controlled |
| `DriftAlert` | `UI/DriftAlert.tsx` | `drift-alert-conformance` | 2026-05-15 | Alerta com tone |
| `DriftSkeleton` | `UI/DriftSkeleton.tsx` | — | V1 | Loading placeholder |
| `SlideUpOverlay` | `UI/SlideUpOverlay.tsx` | — | 2026-05-08 | Bottom sheet + focus trap |
| `ModalHeader` | `UI/ModalHeader.tsx` | — | 2026-05-08 | Header padrão de overlays |
| `FullPageCard` | `UI/FullPageCard.tsx` | — | 2026-05-12 | Card fullscreen com close |
| `DotsIndicator` | `UI/DotsIndicator.tsx` | — | 2026-05-08 | Pílula de dots p/ subposts |
| `GlassIconButton` | `UI/GlassIconButton.tsx` | `glass-icon-button` | 2026-05-15 | Botão ⋮ glass effect |
| `HintChip` | `UI/HintChip.tsx` | `hint-primitives-conformance` | 2026-05-17 | Hint ambient (DAOP PR3). HintToast/HintModal irmãos removidos 2026-05-23 (shelf-ware) |
| `SettingExplainer` | `UI/SettingExplainer.tsx` | `setting-explainer-conformance` | 2026-05-18 | Wrapper canônico settings |
| `AccordionGroup` | `UI/AccordionGroup.tsx` | `accordion-group-conformance` | 2026-05-19 | 1-aberto-por-vez collapse |
| `RadioGroupButton` | `UI/RadioGroupButton.tsx` | `radio-group-button-conformance` | 2026-05-20 | Radio em forma de botões; Velatura-safe |

**Regra de extração:** se mesmo pattern aparece em ≥2 callsites com
≥10 LoC duplicadas, considere primitive. LOCK_VIA_TEST trava
classnames críticos (especialmente active/error states que podem
regredir em theme switches).

---

## Histórico

- **2026-05-04**: criado em V1, baseado em mockup `drift.html`. Paleta
  v0.7 chartreuse + mint substitui purple v0.6. Documentação de
  vocabulary split (UI vs protocol).
- **2026-05-20**: §8 Primitives Registry adicionado pós pair-review
  Robin+Lily — primitives discoverable sem grep no source.
