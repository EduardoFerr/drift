/* Números da simulação da lente para os docs (média das últimas 6 semanas, % inteiro).
 * Uso (na raiz do repo):
 *   node Docs/simulacao-lente/numeros.cjs                 # mostra os números
 *   node Docs/simulacao-lente/numeros.cjs --aplicar a.md b.md   # troca {{chave}} nos arquivos
 * Chaves: <rodada>.<config>.<métrica>, com rodada ∈ as chaves de RUNS abaixo. */
'use strict'
const fs = require('fs'), path = require('path')
const dir = path.join(__dirname, 'resultados')
const RUNS = {
  sem: 'sem_ataque', peq: 'pequena_sem_ataque', faz: 'fazenda', syb: 'sybil', ecl: 'eclipse', pac: 'paciente',
  peqs: 'pequena_sybil', sybF50: 'sybil__fechada_M50', sybF100: 'sybil__fechada_M100', semF100: 'sem_ataque__fechada_M100',
  frio: 'frio', inu: 'inundacao', isca: 'isca', inuF100: 'inundacao__fechada_M100', iscaF100: 'isca__fechada_M100',
  peqsF100: 'pequena_sybil__fechada_M100',
}
const pct = (x) => (x > 0 && x < 0.005 ? '<1' : String(Math.round(x * 100)))
const vals = {}
for (const [k, name] of Object.entries(RUNS)) {
  const f = path.join(dir, name + '.json')
  if (!fs.existsSync(f)) continue
  const r = JSON.parse(fs.readFileSync(f))
  if (r.weeks !== 24) { console.error('rodada curta, ignorada:', name); continue }
  const L = r.series.slice(-21)
  for (const c of r.configs) for (const m of ['fromF', 'atk', 'sybF', 'poro', 'reach', 'same']) {
    vals[`${k}.${c}.${m}`] = pct(L.reduce((s, x) => s + (x.m[c]?.[m] || 0), 0) / L.length)
  }
  vals[`${k}.det`] = `${r.series.reduce((s, x) => s + x.det.shuffle, 0)}/${r.series.reduce((s, x) => s + x.det.n, 0)}`
  vals[`${k}.detA`] = `${r.series.reduce((s, x) => s + x.det.device, 0)}/${r.series.reduce((s, x) => s + x.det.n, 0)}`
}
const ai = process.argv.indexOf('--aplicar')
if (ai < 0) {
  for (const [k, v] of Object.entries(vals)) if (/\.(comum|A100|B100|R100|M25|M50|M100|C|S100|SEG)\.(fromF|atk|sybF|poro|reach)$|det/.test(k)) console.log(k.padEnd(28), v)
  process.exit(0)
}
let missing = 0
for (const file of process.argv.slice(ai + 1)) {
  let s = fs.readFileSync(file, 'utf8')
  s = s.replace(/\{\{([a-zA-Z0-9]+\.[a-zA-Z0-9]+\.[a-zA-Z]+)\}\}/g, (m, key) => {
    if (vals[key] === undefined) { console.error('sem valor:', key, 'em', file); missing++; return m }
    return vals[key]
  })
  fs.writeFileSync(file, s)
}
console.log(missing ? `faltaram ${missing}` : 'ok')
process.exit(missing ? 1 : 0)
