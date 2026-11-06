/* Tabela-resumo das rodadas da simulação da lente.
 * Uso (na raiz do repo): node Docs/simulacao-lente/resumo.cjs [filtro]
 * Média das últimas 6 semanas (21 medições) — ou de todas, se a rodada for mais curta que 12 semanas. */
'use strict'
const fs = require('fs'), path = require('path')
const dir = path.join(__dirname, 'resultados')
const filtro = process.argv[2] ? new RegExp(process.argv[2]) : null
const pc = (x) => (x * 100).toFixed(1).padStart(5)
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && (!filtro || filtro.test(x))).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f)))
  const S = r.series, L = S.slice(-21)
  const avg = (c, k) => L.reduce((s, x) => s + (x.m[c]?.[k] || 0), 0) / L.length
  const det = S.reduce((a, x) => ({ n: a.n + x.det.n, sh: a.sh + x.det.shuffle, dv: a.dv + x.det.device }), { n: 0, sh: 0, dv: 0 })
  console.log(`\n== ${r.name}  (${r.weeks} semanas, ${S.at(-1).n} pessoas; embaralhado ${det.sh}/${det.n}, outro aparelho (A) ${det.dv}/${det.n})`)
  console.log('config  rede8%  igual%  ataque%  sybRede%  outraCid%  alcance%  redeNaAba')
  for (const c of r.configs) console.log(c.padEnd(7), pc(avg(c, 'fromF')), ' ', pc(avg(c, 'same')), ' ', pc(avg(c, 'atk')), '  ', pc(avg(c, 'sybF')), '   ', pc(avg(c, 'poro')), '   ', pc(avg(c, 'reach')), '   ', avg(c, 'netLen').toFixed(1))
}
