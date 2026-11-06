/* Gera a página animada da simulação da lente a partir de Docs/simulacao-lente/resultados/.
 * Uso (na raiz do repo): node Docs/simulacao-lente/pagina.cjs <saida.html>
 * A página é publicada como artifact; o HTML não é versionado (só este gerador). */
'use strict'
const fs = require('fs'), path = require('path')
const dir = path.join(__dirname, 'resultados')
const out = process.argv[2] || path.join(__dirname, 'lente.html')

const SCEN = [
  ['sem_ataque', 'sem ataque', '2.250 pessoas em 6 cidades, 24 semanas, ninguém atacando.'],
  ['fazenda', 'fazenda', 'Um spammer veterano, uma fazenda de 2.000 contas que impulsiona o spam do dono todo dia e uma brigada que denuncia post honesto.'],
  ['paciente', 'fazenda paciente', 'A fazenda cria as contas no primeiro dia, camufla o histórico impulsionando posts honestos e só ataca no dia 28. 10% das pessoas seguem de volta as contas que as seguem.'],
  ['sybil', 'contas falsas seguidas', 'Cada conta da fazenda segue 20 pessoas reais e 10% seguem de volta. A partir do dia 28, as contas postam spam e a fazenda impulsiona cada um.'],
  ['eclipse', 'eclipse', '30% das pessoas só usam relays do atacante, que some com metade dos posts honestos que iriam para elas. 10% seguem de volta contas da fazenda.'],
  ['pequena_sem_ataque', 'rede pequena', '225 pessoas (10% de cada cidade), sem ataque. Parecido com o Drift hoje: a aba cobre boa parte dos posts.'],
  ['pequena_sybil', 'rede pequena + contas falsas', '225 pessoas e uma fazenda de 100 contas, 10% seguidas de volta, postando spam impulsionado.'],
  ['frio', 'mundo frio', 'Como o Drift de hoje: as pessoas impulsionam só 10% do que veem (em vez de 80%). Quase todo post fica com zero pontos e a idade decide a ordem.'],
  ['inundacao', 'conta que inunda', 'Mundo frio. Uma conta seguida por 10% das pessoas posta 30 vezes por dia a partir do dia 21.'],
  ['isca', 'isca seguida de volta', 'Contas da fazenda (3% seguidas de volta) postam conteúdo bom para ganhar impulsos e depois trazem spam.'],
]
const VARIANTS = [
  ['M', 'mistura', true, 'Com força k, k de cada 100 cards vão para quem você segue, na ordem de sempre. Nunca rebaixa post seu nem sobe post afundado. É a regra que vai para o app.'],
  ['A', 'a fórmula de antes', false, 'Ligada como estava escrita: multiplica a pontuação de quem você segue por até 2,5 e só reordena os 50 posts da aba.'],
  ['B', 'multiplicador', false, 'A de antes consertada: proximidade exata e sinal certo para pontuação negativa; pode trazer posts da sua rede de fora dos 50.'],
  ['R', 'por lugares', false, 'Cada post de quem você segue passa à frente de até força × 50 posts.'],
  ['S', 'só quem você já impulsionou', false, 'Mistura, mas só com quem você segue E já impulsionou algo dela. Testada como defesa contra conta falsa seguida de volta.'],
  ['C', 'cronológica', false, 'A outra lente do app: os mesmos 50 posts da aba, do mais novo para o mais velho.'],
]
const CONFIGS = ['comum', 'A50', 'A100', 'B50', 'B100', 'R50', 'R100', 'M25', 'M50', 'M100', 'C', 'S50', 'S100', 'SEG']
// bits 16.. do pacote (Uint32): "metade ou mais dos 8 é de quem a pessoa segue" nestas configs
const F_CONF = ['comum', 'M25', 'M50', 'M100', 'R100', 'S50', 'S100', 'SEG']
const NAMES = ['Ana', 'Davi', 'Flor']

const r3 = (x) => Math.round(x * 1000) / 1000
const load = (n) => { const f = path.join(dir, n + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null }

const data = { configs: CONFIGS, fconf: F_CONF, variants: VARIANTS.map(([k, label, rec, desc]) => ({ k, label, rec, desc })), scen: [], closed: {} }
for (const [key, label, desc] of SCEN) {
  const r = load(key)
  if (!r) { console.error('faltando:', key); continue }
  if (!data.cities) data.cities = r.cities
  const idx = (c) => r.configs.indexOf(c)
  // Buffer.from(base64) pode morar num pool compartilhado: copiar só os bytes dele
  const u16 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
  const packed = r.flags.map((b64, t) => {
    const a = u16(b64)
    const f = u16(r.flagsF[t])
    if (a.length !== r.people.length) throw new Error(`flags com ${a.length} pessoas, esperado ${r.people.length}`)
    const o = new Uint32Array(a.length)
    for (let i = 0; i < a.length; i++) {
      let v = 0
      CONFIGS.forEach((c, j) => { if (a[i] & (1 << idx(c))) v |= 1 << j })
      F_CONF.forEach((c, j) => { if (f[i] & (1 << idx(c))) v |= 1 << (16 + j) })
      o[i] = v >>> 0
    }
    return Buffer.from(o.buffer).toString('base64')
  })
  const series = r.series.map((s) => {
    const m = {}
    for (const c of CONFIGS) { const x = s.m[c]; m[c] = [r3(x.fromF), r3(x.atk), r3(x.sybF), r3(x.poro), r3(x.reach), r3(x.same)] }
    return { d: s.d, n: s.n, m }
  })
  const featured = r.featuredInfo.map((f, i) => ({ v: f.v, name: NAMES[i], home: f.home, follows: f.follows, fol: f.fol }))
  // posts dos destaques: quem é o autor para cada pessoa em destaque
  const posts = {}
  for (const [pi, p] of Object.entries(r.postInfo)) {
    posts[pi] = { h: p.h, d: p.d, k: p.sp || p.at ? 'atk' : p.b ? 'isca' : 'hon', f: featured.map((f) => (f.fol.includes(p.a) ? 1 : 0)) }
  }
  const feeds = r.featFeeds.map((ff) => featured.map((f) => {
    const o = {}
    for (const c of CONFIGS) o[c] = (ff[f.v] && ff[f.v][c]) || []
    return o
  }))
  data.scen.push({ key, label, desc, people: r.people, series, flags: packed, featured: featured.map(({ fol, ...rest }) => rest), posts, feeds, scores: r.scoreAt })
}
for (const [key, label] of [['sybil__fechada_M100', 'contas falsas · mistura 100%'], ['sybil__fechada_M50', 'contas falsas · mistura 50%'], ['sem_ataque__fechada_M100', 'sem ataque · mistura 100%'], ['pequena_sybil__fechada_M100', 'rede pequena + falsas · mistura 100%'], ['inundacao__fechada_M100', 'conta que inunda · mistura 100%'], ['isca__fechada_M100', 'isca · mistura 100%']]) {
  const r = load(key)
  if (!r) { console.error('faltando (malha fechada):', key); continue }
  data.closed[key] = { label, series: r.series.map((s) => ({ d: s.d, m: Object.fromEntries(CONFIGS.map((c) => [c, [r3(s.m[c].fromF), r3(s.m[c].atk), r3(s.m[c].sybF), r3(s.m[c].poro), r3(s.m[c].reach)]])) })) }
}

const html = fs.readFileSync(path.join(__dirname, 'pagina.html'), 'utf8').replace('/*__DATA__*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'))
fs.writeFileSync(out, html)
console.log('ok', out, (fs.statSync(out).size / 1e6).toFixed(2) + ' MB')
