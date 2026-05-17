/** @type {import('tailwindcss').Config} */
//
// Drift design tokens — multi-tema via CSS vars.
//
// Fonte da verdade: `src/styles/themes.css` define `[data-theme="X"]`
// blocks (Cinder default, Rosenholz, Velatura). Este config aponta as
// utilities Tailwind (`bg-drift-bg`, `text-drift-text`, etc.) pra
// `var(--drift-X)` — Tailwind v3 converte hex auto em alpha modifier;
// pra CSS vars precisaria `<alpha-value>` placeholder, mas como os
// valores são tipicamente sólidos em utilities tipo `bg-drift-bg`,
// mantemos formato `var(--drift-X)` simples.
//
// CONVENÇÃO LÉXICA:
//   - `drift-spread` (kind 9079) / `drift-bury` (kind 9080) — role tokens
//     do protocolo. NÃO renomear pra `drift-drift`/`drift-sink`. UI
//     traduz pra DRIFT/SINK só em strings PT user-facing.
//   - `drift-accent` (CTAs primários) / `drift-accent2` (sub-actions,
//     focus) — brand tokens. Variam por tema.
//   - `drift-text` / `drift-muted` / `drift-body` — type tokens com
//     hierarquia de luminance enforced (text > body > muted).
//   - `drift-warning` (avisos não-destrutivos) / `drift-danger` (CTAs
//     destrutivos UI). Em Rosenholz são hex distintos; em outras
//     paletas podem coincidir mas semântica é independente.
//
// História:
//   - 2026-05-04: paleta migrou purple (#a78bfa) → chartreuse (#e8ff5a) + mint
//   - 2026-05-17: refactor pra CSS vars + 3 paletas com identidade editorial
//     (Cinder default substitui chartreuse). Curadoria: Robin v4 com
//     research Anthropic/Mercury/Rosé Pine/Catppuccin/Morandi.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        drift: {
          // Surface tokens
          bg: 'var(--drift-bg)',
          surface: 'var(--drift-surface)',
          'surface-1': 'var(--drift-surface-1)',
          'surface-2': 'var(--drift-surface-2)',
          'surface-3': 'var(--drift-surface-3)',
          'surface-4': 'var(--drift-surface-4)',
          border: 'var(--drift-border)',
          // Brand tokens
          accent: 'var(--drift-accent)',
          accent2: 'var(--drift-accent2)',
          // Type tokens
          text: 'var(--drift-text)',
          muted: 'var(--drift-muted)',
          body: 'var(--drift-body)',
          // Role tokens (protocolo kind 9079/9080)
          spread: 'var(--drift-spread)',
          bury: 'var(--drift-bury)',
          // Intent tokens (UI semântico)
          warning: 'var(--drift-warning)',
          danger: 'var(--drift-danger)',
        },
      },
      boxShadow: {
        // Per-theme shadows tinted by bg hue (definidas em themes.css)
        'drift-sm': 'var(--shadow-sm)',
        'drift-md': 'var(--shadow-md)',
        'drift-lg': 'var(--shadow-lg)',
        'drift-glow': 'var(--shadow-glow)',
        'drift-drag': 'var(--drag-shadow)',
      },
      backgroundImage: {
        // Per-theme gradients (OKLCH interpolation, fallback via PostCSS)
        'drift-canvas': 'var(--gradient-canvas)',
        'drift-accent-soft': 'var(--gradient-accent-soft)',
        'drift-edge': 'var(--gradient-edge)',
        'drift-signature': 'var(--gradient-signature)',
        'drift-hairline': 'var(--gradient-hairline)',
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
        'drift-out':       'cubic-bezier(0.0, 0.0, 0.2, 1)',     // ease-out canônico
        'drift-inout':     'cubic-bezier(0.4, 0.0, 0.2, 1)',     // overlay enter/exit
        'drift-spring':    'cubic-bezier(0.32, 0.72, 0, 1)',     // card stack, emphasis
        // Per-theme signature easing — variável CSS sobrescrita por [data-theme].
        // Cinder: cubic-bezier(0.32, 0.72, 0.32, 1) — brasa decay
        // Rosenholz: cubic-bezier(0.16, 1, 0.3, 1) — página virando
        // Velatura: cubic-bezier(0.4, 0, 0.2, 1) — tato físico
        'drift-signature': 'var(--ease-signature)',
      },
    },
  },
  plugins: [],
}
