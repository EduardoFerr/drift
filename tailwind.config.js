/** @type {import('tailwindcss').Config} */
//
// Drift design tokens — paleta v0.7 (chartreuse + mint).
// Documentação completa em Docs/design-system.md.
//
// CONVENÇÃO LÉXICA (importante):
//   - Tokens `drift-spread` e `drift-bury` são CSS classes de **role
//     semântica do código** (ação positiva/negativa no protocolo,
//     kinds 9079/9080). NÃO renomear pra `drift-drift`/`drift-sink` —
//     vocabulário UI muda em strings PT user-facing, não em
//     identificadores de código. Ver vocabulary mapping em CLAUDE.md.
//   - Tokens `drift-accent` (DRIFT, CTAs) e `drift-accent2` (sub-actions,
//     focus) são tokens de **brand**. Usados onde o mockup chama
//     accent/accent2.
//   - `drift-text` / `drift-muted` são tokens de **type**. Substituem
//     `text-slate-*` em componentes Drift-específicos; slate continua
//     OK pra detalhes neutros (skeletons, decoração).
//
// Mudança 2026-05-04: paleta migrou de purple (#a78bfa) pra chartreuse
// (#e8ff5a) + mint (#5affd4). Hex values atualizados; nomes preservados
// pra evitar refactor cascata em ~200 consumidores.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        drift: {
          // Surface tokens (quase-preto warm + camadas)
          bg: '#0c0c0b',
          surface: '#15151a',
          border: '#2a2a2e',
          // Brand tokens (chartreuse + mint)
          accent: '#e8ff5a',
          accent2: '#5affd4',
          // Type tokens
          text: '#f0f0ea',
          // muted bumped 2026-05-08: #4a4a46 -> #6b6b66 pra atingir
          // WCAG AA contrast (4.5:1+) sobre drift-surface (#15151a).
          // AY-4 do Robin QA #1 confirmava 3.7:1 fail. Bump deliberado
          // pelos 5 personas HIMYM antes de Round 4 enforcement (slate-*
          // → drift-muted purge) pra evitar rework duplo.
          muted: '#6b6b66',
          // Body italic — mockup v0.7. CSS var permite override dinâmico,
          // fallback estático garante render se var sumir.
          body: 'var(--drift-body, #787874)',
          // Role tokens (semântica de protocolo — não renomear)
          spread: '#34d399', // ação positiva (kind 9079, label UI = DRIFT)
          bury: '#f87171', // ação negativa (kind 9080, label UI = SINK)
        },
      },
      fontFamily: {
        // V2 (commit subsequente): fontes locais via @fontsource.
        // 'Syne Variable' = nome canônico do package (variable font
        // único arquivo cobrindo weights 400-800). 'DM Mono' tem
        // weights 300/400/500 + 300-italic bundled.
        // Fallbacks: system stack pra graceful degrade durante FOUT
        // (se woff2 ainda não carregou, monospace fallback).
        display: ['"Syne Variable"', 'Syne', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'SF Mono', 'Fira Code', 'monospace'],
      },
      // Fluid type scale — clamp(min, vw, max). 6 levels canônicos.
      // Drift escala apenas em 320..448 px (max-w-md cap); acima disso o
      // container congela em letterbox e a tipografia também (cap em max).
      // Determinístico (manifesto §7) — mesmo viewport → mesmo render.
      // Decisão de scale + trade-offs em Docs/sessions/text-responsivity-audit-2026-05-08.md §3-4.
      // Espelhado em src/index.css :root (`--t-fluid-*`); LOCK_VIA_TEST
      // garante paridade.
      fontSize: {
        'fluid-xs':      ['clamp(9px, 2.4vw, 10px)',  { lineHeight: '1.4' }],
        'fluid-sm':      ['clamp(10px, 2.8vw, 11px)', { lineHeight: '1.45' }],
        'fluid-base':    ['clamp(11px, 3.2vw, 12px)', { lineHeight: '1.55' }],
        'fluid-lg':      ['clamp(12px, 3.6vw, 13px)', { lineHeight: '1.65' }],
        'fluid-display': ['clamp(13px, 4vw, 16px)',   { lineHeight: '1.2' }],
        'fluid-hero':    ['clamp(20px, 6vw, 30px)',   { lineHeight: '1.08' }],
      },
      // Mockup v0.7 spacing tokens. Valores específicos do design que
      // não caem na escala 4px. CSS vars permitem override; fallback
      // estático mantém render. Use em CardText / SubpostLayout.
      spacing: {
        'card-x': 'var(--card-px, 17px)',
        'card-x-wide': 'var(--card-px-wide, 22px)',
        'card': 'var(--card-pb, 18px)',
      },
      letterSpacing: {
        // Tracking uppercase — usado em meta lines (DRIFT/SUBS/HÁ),
        // labels (CONFIG, MAPA), tag rows (DERIVA, NSFW).
        tag: 'var(--tracking-tag, 2.5px)',
        meta: 'var(--tracking-meta, 1.5px)',
        // Display title (Syne ExtraBold) tracking negativo sutil.
        title: 'var(--tracking-title, -0.3px)',
      },
      lineHeight: {
        // Title display tight (1.08) e body italic generoso (1.65).
        title: 'var(--leading-title, 1.08)',
        body: 'var(--leading-body, 1.65)',
      },
      // Motion duration tokens — RFC `2026-05-rfc-motion-perf-polish.md` §1.1
      // + Ted §4.1 §2.3. 5 níveis cobrem >95% dos call sites de Framer
      // Motion + transition CSS no app. Source-of-truth duplicado em
      // `src/lib/motion.ts` (Framer consome JS); paridade pode ser
      // verificada em test futuro (Marshall §4.3).
      transitionDuration: {
        'motion-micro':    '120ms',
        'motion-fast':     '180ms',
        'motion-base':     '240ms',
        'motion-emphasis': '320ms',
        'motion-card':     '360ms',
      },
      transitionTimingFunction: {
        // 3 easings cobrem 95% dos casos. Ver RFC §1.1.
        'drift-out':    'cubic-bezier(0.0, 0.0, 0.2, 1)',     // ease-out canônico
        'drift-inout':  'cubic-bezier(0.4, 0.0, 0.2, 1)',     // overlay enter/exit
        'drift-spring': 'cubic-bezier(0.32, 0.72, 0, 1)',     // card stack, emphasis
      },
    },
  },
  plugins: [],
}
