// Empacota as funções da lente (src/lib/trust/*, src/lib/lens/order.ts) num IIFE `DriftLens`
// para a simulação rodar em Node puro, chamando o MESMO código do app.
// Uso (na raiz do repo): node Docs/simulacao-lente/build-lens.mjs
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
await build({ entryPoints: [path.join(here, 'entry.ts')], bundle: true, format: 'iife', globalName: 'DriftLens',
  outfile: path.join(here, 'lens.js'), target: 'es2020', legalComments: 'none' })
console.log('lens.js ok')
