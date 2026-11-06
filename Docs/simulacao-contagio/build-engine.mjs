// Empacota o motor real (src/lib/ranking.ts) num IIFE `DriftEngine` para a simulação rodar em Node puro.
// Uso (na raiz do repo): node Docs/simulacao-contagio/build-engine.mjs
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const stubDb = { name: 'stub-db', setup(b) {
  b.onResolve({ filter: /\/db$/ }, (a) => a.importer.includes(path.join('src', 'lib')) ? { path: 'db-stub', namespace: 'stub' } : null)
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const db = {}', loader: 'js' }))
} }
await build({ entryPoints: [path.join(here, 'entry.ts')], bundle: true, format: 'iife', globalName: 'DriftEngine',
  outfile: path.join(here, 'engine.js'), plugins: [stubDb], target: 'es2020', legalComments: 'none' })
console.log('engine.js ok')
