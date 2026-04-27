/**
 * Gera PNGs do drift-icon.svg pra manifest PWA + apple-touch-icon.
 *
 * Por que essa abordagem (resvg-js puro) e não @vite-pwa/assets-generator:
 * o assets-generator depende de sharp, que tem problema de binário em
 * Windows + Node 24. resvg-js é Rust nativo + bindings testados, funciona
 * cross-platform sem dor.
 *
 * Por que PNG é necessário (vs SVG declarado no manifest): Chrome Android
 * historicamente exige PNG raster pra "Adicionar à tela inicial" funcionar.
 * SVG no manifest é spec mas a heurística de instalabilidade do Chrome
 * Android requer ao menos 1 PNG 192+ e 1 PNG 512+.
 *
 * Ícones gerados:
 *  - pwa-64x64.png        — favicon
 *  - pwa-192x192.png      — manifest icon (purpose: any)
 *  - pwa-512x512.png      — manifest icon (purpose: any)
 *  - pwa-maskable-512.png — manifest icon (purpose: maskable, com padding)
 *  - apple-touch-icon.png — 180x180 pra iOS
 *
 * Roda manualmente quando o SVG muda: `node scripts/gen-pwa-icons.mjs`
 */

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SVG_PATH = resolve(ROOT, 'public/drift-icon.svg')
const PUBLIC_DIR = resolve(ROOT, 'public')

const svg = readFileSync(SVG_PATH, 'utf8')

const targets = [
  { name: 'pwa-64x64.png', size: 64, padding: 0, bg: '#08080f' },
  { name: 'pwa-192x192.png', size: 192, padding: 0, bg: '#08080f' },
  { name: 'pwa-512x512.png', size: 512, padding: 0, bg: '#08080f' },
  // Maskable: padding 20% pra que o ícone fique visível em qualquer máscara
  // (círculo, squircle, etc.) sem cortar o conteúdo.
  { name: 'pwa-maskable-512.png', size: 512, padding: 0.2, bg: '#08080f' },
  // Apple touch icon: 180x180 é o tamanho recomendado pra iOS desde iOS 7.
  { name: 'apple-touch-icon.png', size: 180, padding: 0, bg: '#08080f' },
]

function svgWithPadding(originalSvg, padding) {
  if (padding === 0) return originalSvg
  // Aplica padding em volta do conteúdo via wrapping em outro SVG com
  // viewBox maior. Original é 512x512.
  const innerSize = 512
  const outerSize = Math.round(innerSize / (1 - 2 * padding))
  const offset = Math.round((outerSize - innerSize) / 2)
  // Envolvemos com bg sólido pra que regiões fora do conteúdo sejam
  // preenchidas (importante pra maskable — máscara assume bg cheio).
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outerSize} ${outerSize}" width="${outerSize}" height="${outerSize}">
  <rect width="${outerSize}" height="${outerSize}" fill="#08080f"/>
  <g transform="translate(${offset} ${offset})">
    ${originalSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
  </g>
</svg>`
}

for (const target of targets) {
  const inputSvg = svgWithPadding(svg, target.padding)
  const resvg = new Resvg(inputSvg, {
    fitTo: { mode: 'width', value: target.size },
    background: target.bg,
  })
  const png = resvg.render().asPng()
  const outPath = resolve(PUBLIC_DIR, target.name)
  writeFileSync(outPath, png)
  console.log(`✓ ${target.name} (${target.size}x${target.size}, ${png.length} bytes)`)
}

console.log('\nÍcones gerados em public/. Atualize vite.config.ts pra referenciá-los.')
