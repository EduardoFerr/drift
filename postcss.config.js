export default {
  plugins: {
    tailwindcss: {},
    // OKLCH/oklab fallback pra Safari < 16.2 — gera rgb() lado-a-lado
    // do oklch() em themes.css. Tema/gradientes usam `oklch(...)` por
    // interpolação perceptualmente uniforme (Robin v4 + evilmartians).
    // `preserve: true` mantém o oklch() original; navegadores modernos
    // usam ele, antigos caem no rgb() emit anterior.
    '@csstools/postcss-oklab-function': { preserve: true },
    autoprefixer: {},
  },
}
