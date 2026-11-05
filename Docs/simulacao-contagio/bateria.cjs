/* Bateria de cenários do modelo de contágio (ver Docs/spec-revisao-contagio.md).
 * Uso, na raiz do repo:
 *   node Docs/simulacao-contagio/build-engine.mjs           # uma vez: gera engine.js a partir de src/lib/ranking.ts
 *   node Docs/simulacao-contagio/bateria.cjs 0 4 [filtro] &  # worker 0 de 4 (rode 0..3 em paralelo); filtro = regex no nome
 *   node Docs/simulacao-contagio/bateria.cjs resumo          # tabela: média das últimas 6 semanas, pico e dias de surto
 * Cada rodada leva 1–15 min (2.250 pessoas, 24 semanas; camuflagem e visão parcial são as mais lentas).
 * Resultados em ./resultados/<modelo>__<cenário>.json. */
'use strict'
const vm = require('vm'), fs = require('fs'), path = require('path')
const here = __dirname, out = path.join(here, 'resultados')

// Presets dos modelos (Docs/spec-revisao-contagio.md §2). Todos: limiar 0,8, janela 48 h.
const V5 = { unknownSlot: false, knownMin: 3, mutualNeedsMeet: true, earnOwn: 1 }
const V6 = { ...V5, vouch: true, lockstep: true, sinkLearn: true, probation: true, lockAbs: 15 }
const MODEL = {
  global: {}, // motor real (urna global): runModel(..., 'global')
  v1: { unknownSlot: true, knownMin: 1 },
  v2: { unknownSlot: true, knownMin: 3 },
  v3: { unknownSlot: false, knownMin: 3, mutualNeedsMeet: true },
  v4: { unknownSlot: false, knownMin: 3, mutualNeedsMeet: true, mutualEarn: true },
  v5: V5,
  v6: V6,
  v7: { ...V6, weakCap: 0.5 },
  // primeira versão da aba (antes da revisão em par): SINK e denúncia puniam, teto só no DRIFT,
  // "quem trouxe" também em post direto e corte do vínculo que trouxe spam em 40% das vezes
  fase1_v0: { unknownSlot: false, mutualNeedsMeet: true, earnOwn: 1, weakCap: 0.5, ambient: 0, noEncounters: true, sinkLearn: true },
  // o que está no app (aba Contágio): sem mapa nem encontro físico; teto também na vacina e na
  // quarentena; só a denúncia pune (autor + quem trouxe); post direto sem "quem trouxe"; sem corte
  // automático do vínculo que trouxe spam (o app não tem esse gesto: limite conservador)
  fase1: { unknownSlot: false, mutualNeedsMeet: true, earnOwn: 1, weakCap: 0.5, ambient: 0, noEncounters: true, sinkLearn: true, negCap: true, implVia: true, strikeOn: 'report', cutProb: 0 },
}
const NO_ATK = { atk: { spammer: false, farm: false, brigade: false } }
const CAMO = { followBack: 0.1, farmCamo: 2 }
const SCEN = {
  base: {}, sem_ataque: NO_ATK, sem_mobilidade: { mobility: false }, sem_mob_sem_ataque: { mobility: false, ...NO_ATK },
  followback_3: { followBack: 0.03 }, followback_10: { followBack: 0.1 },
  enganados_10: { deceivedPct: 0.1 }, enganados_isca: { deceivedPct: 0.1, farmerBait: 0.5 },
  isca: { followBack: 0.03, farmContent: 0.1 },
  camuflagem: CAMO, revezamento: { ...CAMO, farmRot: 1 / 3 }, paciente: { ...CAMO, farmJoin: 0, farmStart: 28 },
  visao30: { followBack: 0.1, vis: 0.3 }, eclipse30: { followBack: 0.1, eclipse: 0.3, censor: 0.5 },
  erro_honesto: { honestError: 0.05 },
  // difamação: a fazenda (seguida de volta por 10%) enterra e denuncia todo post honesto que vê
  difamacao: { followBack: 0.1, badmouth: { sink: true, report: true } },
  // SINK de gosto: cada pessoa enterra 5% / 10% dos posts honestos que vê
  gosto5: { ...NO_ATK, tasteSink: 0.05 }, gosto10: { ...NO_ATK, tasteSink: 0.1 },
  gosto10_isca: { followBack: 0.03, farmContent: 0.1, tasteSink: 0.1 },
  seed_11: { seed: 11 }, seed_23: { seed: 23 }, seed_42: { seed: 42 }, seed_99: { seed: 99 },
}
const MAIN = ['base', 'sem_ataque', 'sem_mobilidade', 'followback_10', 'isca', 'enganados_isca', 'camuflagem', 'revezamento', 'paciente', 'visao30', 'eclipse30']
const RUNS = []
for (const m of ['v2', 'v5', 'v6', 'v7', 'fase1_v0']) for (const s of MAIN) RUNS.push([`${m}__${s}`, m, SCEN[s]])
for (const s of [...MAIN, 'difamacao', 'gosto10', 'gosto10_isca']) RUNS.push([`fase1__${s}`, 'fase1', SCEN[s]])
// Decisão de 05/11/2026 (Docs/spec-revisao-contagio.md §4.6): o que vira experiência ruim —
// SINK e denúncia ('both'), só a denúncia ('report') ou denúncia + SINK só contra quem trouxe
// ('viaSink'). Base: fase1_v0 com o teto simétrico, como na rodada da decisão.
for (const opt of ['both', 'report', 'viaSink']) for (const s of ['isca', 'enganados_isca', 'difamacao', 'gosto5', 'gosto10', 'gosto10_isca'])
  RUNS.push([`decisao_${opt}__${s}`, 'fase1_v0', { ...SCEN[s], negCap: true, strikeOn: opt }])
// A mesma decisão refeita sobre a config final (sem corte de vínculo: o app não tem o gesto),
// e a config final com corte de 40% para medir quanto um gesto de "deixar de seguir quem trouxe" valeria.
for (const opt of ['both', 'viaSink']) for (const s of ['isca', 'enganados_isca', 'difamacao', 'gosto10', 'gosto10_isca'])
  RUNS.push([`fase1_${opt}__${s}`, 'fase1', { ...SCEN[s], strikeOn: opt }])
for (const s of ['isca', 'enganados_isca', 'gosto10_isca']) RUNS.push([`fase1_corte40__${s}`, 'fase1', { ...SCEN[s], cutProb: 0.4 }])
// Gesto do app "não trazer mais por X" (cutMode 'bring': só deixa de trazer, mantém
// os posts diretos), usado em 0/20/40% dos spams vistos, com denúncia em 35% e 10%.
for (const r of [35, 10]) for (const c of [0, 20, 40]) for (const s of ['isca', 'enganados_isca', 'gosto10_isca', 'sem_ataque'])
  RUNS.push([`gesto_r${r}_c${c}__${s}`, 'fase1', { ...SCEN[s], cutMode: 'bring', cutProb: c / 100, reportProb: r / 100 }])
for (const m of ['v3', 'v4']) for (const s of ['base', 'sem_ataque', 'sem_mobilidade', 'followback_3', 'enganados_10']) RUNS.push([`${m}__${s}`, m, SCEN[s]])
for (const s of ['seed_11', 'seed_23', 'seed_42', 'seed_99']) RUNS.push([`v2__${s}`, 'v2', SCEN[s]])
RUNS.push(['v6__erro_honesto', 'v6', SCEN.erro_honesto], ['v6_recupera__enganados_isca', 'v6', { ...SCEN.enganados_isca, sinkDecay: 30 }])
RUNS.push(['global__base', 'global', {}], ['v1__base', 'v1', {}])

const BASE = { seed: 7, weeks: 24, stepDays: 2, farmStart: 14, farmSize: 2000, theta: 0.8, ambient: 3, atk: { spammer: true, farm: true, brigade: true } }

if (process.argv[2] === 'resumo') {
  const p = (x) => (x * 100).toFixed(1).padStart(6)
  console.log('rodada'.padEnd(34), ' ataque  pico  surto  alcance  poro  vazio zerados det')
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.json')).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(out, f))), F = r.frames, L = F.slice(-21)
    const a = (k) => L.reduce((s, x) => s + (x.m[k] || 0), 0) / L.length
    const D = F.filter((x) => x.m.det >= 0)
    console.log(r.name.padEnd(34), p(a('withAtk')), p(Math.max(...F.map((x) => x.m.withAtk))), String(F.filter((x) => x.m.withAtk > 0.05).length * 2 + 'd').padStart(6),
      p(a('reach')), p(a('poro')), p(a('empty')), p(a('zeroed')), `${D.reduce((s, x) => s + x.m.det, 0)}/${D.length * 40}`)
  }
  process.exit(0)
}

const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(here, 'engine.js'), 'utf8'), ctx)
const { runModel } = require('./sim.cjs')
fs.mkdirSync(out, { recursive: true })
const w = +process.argv[2] || 0, W = +process.argv[3] || 1, filtro = process.argv[4] ? new RegExp(process.argv[4]) : null
RUNS.filter(([n]) => (!filtro || filtro.test(n)) && !fs.existsSync(path.join(out, n + '.json'))).forEach(([name, m, scen], i) => {
  if (i % W !== w) return
  const t = Date.now()
  const r = runModel(ctx.DriftEngine, { ...BASE, ...MODEL[m], ...scen }, m === 'global' ? 'global' : 'contagio')
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ name, model: m, scen, frames: r.frames.map((f) => ({ d: f.day, m: f.m })) }))
  console.log(name, ((Date.now() - t) / 1000 | 0) + 's')
})
