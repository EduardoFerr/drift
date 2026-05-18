# Map open/close animation — HIMYM deliberação

**Data:** 2026-05-18
**Trigger:** user reclamou que animação atual (fade + scale 0.98→1, 200ms) está "feia" — pediu "imitar aspecto real, como efeito sanfona e colapsando, ou do topo ou do centro" + dispatch HIMYM com pesquisa prévia.

**Personas dispatchadas (paralelo):**
- Robin (research): padrões em apps mobile referência + Framer Motion implementação
- Lily (UX): audit visual + comparação de 4 abordagens

---

## 1. Diagnóstico convergente

Animação atual sofre de:
- **Sem ancoragem espacial** — mapa surge no centro sem conectar ao gesto (tap no botão 🗺 top-right)
- **Scale 0.98→1 é abaixo do threshold perceptual de Weber-Fechner** — user registra como fade puro
- **Sem materialidade** — Drift tem identidade editorial/neo-brutalist soft; modal iOS genérico contradiz

---

## 2. Robin — padrões observados

| App | Pattern |
|---|---|
| Google Maps (Material 3) | Container transform (chip cresce até preencher destino), `emphasized` cubic-bezier 300ms |
| Apple Maps | Push-up sheet, mapa estável de fundo (HIG: depth + hierarquia) |
| Twitter/X | Fade + slight scale 0.96→1 (~250ms), origin ~chip position |
| Linear / Read.cv | `layoutId` shared element transition (Framer nativo) |
| Strava / Komoot | Vertical reveal from top via `clipPath inset(0 0 100% 0)` — sanfona descendo, ~400ms |

**Recomendação Robin:** clipPath radial-from-button (origin top-right do botão 🗺) — dá causalidade visual.

---

## 3. Lily — comparação das 4 abordagens

| Abordagem | Pros | Contras |
|---|---|---|
| A. **Sanfona vertical (clipPath inset from top)** | Materialidade forte (persiana/papel); editorial; reversível natural | Child content precisa contra-animação ou estica |
| B. Expand from button (origin top-right) | Ancoragem perfeita ao trigger | Scale 0.1→1 parece "balão"; cartoon |
| C. Zoom out from center | Familiar Google Maps | Sem origem espacial; é o que existe hoje exagerado; clichê |
| D. Sheet from top (translateY) | Linguagem de gaveta | Conflita com swipe-down-to-close; muito "notificação" |

**Recomendação Lily:** A — sanfona vertical via clipPath. Razões:
- Casa com editorial/papel (desdobrar é metáfora física honesta)
- Neo-brutalist soft (bordas duras do clip)
- Mapa = camada espacial — desdobrar revela território
- Reversibilidade trivial (close = clip de volta ao topo)

---

## 4. Decisão sintetizada (Lily vence)

Robin propôs clipPath **radial** from button; Lily contraproposta clipPath **inset from top**. Lily ganha porque:
- "Ancoragem espacial via clip-top já comunica 'vem de cima' — adicionar origin do botão duplica metáforas e confunde"
- Radial em paleta monocromática vira "cartoon"; inset preserva linguagem de papel/cards retos
- Reversibilidade do inset é literal (close = clip-up, mirror exato)

---

## 5. Tuning aplicado

| Parâmetro | Valor | Justificativa |
|---|---|---|
| **Open duration** | 320ms | Mapa é conteúdo denso, precisa weight |
| **Open easing** | `cubic-bezier(0.16, 1, 0.3, 1)` | expo-out — decelera no fim, sensação de "assentar" sem bounce |
| **Close duration** | 220ms | 70% do open — heurística Material/Apple (sair menos importante que entrar) |
| **Close easing** | `cubic-bezier(0.7, 0, 0.84, 0)` | expo-in — acelera, "vai embora rápido" |
| **Inner stagger** | translateY -16→0, delay 80ms | Conteúdo assenta DEPOIS da persiana — dá camadas |
| **Reduced motion** | Crossfade 150ms (sem clipPath) | WCAG 2.3.3 + perf em devices low-end |
| **will-change** | `clip-path` | Hint pro GPU compositing layer (overhead aceitável vs jank) |

---

## 6. Trade-offs aceitos

- **GPU compositing layer permanente** — `will-change: clip-path` mantém layer mesmo idle. Alternativa (remover via `onAnimationComplete`) seria ideal mas Framer Motion não tem hook idle simples. Layer custa < 50KB GPU memory por instância, aceitável.
- **Safari iOS < 16** — clipPath animado tem bugs históricos (Robin flagged). Hoje irrelevante (Safari 17+ majoritário); registrar se reaparecer.
- **Reverse mirror** — close usa clipPath invertido (não scale-down genérico). Mantém metáfora.

---

## 7. Shipado em [0b4e8e4]

`src/components/Post/PostViewer.tsx`:
- `useReducedMotion()` no PostViewer scope (era só em EmbeddedWrapper)
- Map overlay `m.div` ganha clipPath inset states (4 branches: open/close × normal/reduced)
- Inner content `m.div` adicionado pra counter-anim (translateY + delay)
- `style={{ willChange: 'clip-path' }}` hint GPU

Verificado via Claude preview tool (drift-dev-http):
- Mid-anim: clipPath transitioning visível
- Final state: `inset(0px 0px 0%)` ✓ + willChange `clip-path` ✓
- Close: overlay desmonta limpo após exit transition

---

## Próximos shippeáveis afetados

Nenhum diretamente. Animação isolada no PostViewer. Se outros overlays (ThreadView, ReportModal) precisarem mesmo tratamento, abstrair pra primitive `<ClipPathReveal>` em próxima sessão.
