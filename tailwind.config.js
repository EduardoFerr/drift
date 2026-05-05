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
          muted: '#4a4a46',
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
    },
  },
  plugins: [],
}
