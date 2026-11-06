/* Drift — simulação da Lente no feed (Docs/algoritmos.md §6).
 *
 * Reaproveita o mundo da simulação do contágio (Docs/simulacao-contagio/sim.cjs: 2.250 pessoas,
 * 6 cidades, 24 semanas, fazenda de 2.000 contas) no modelo GLOBAL, que chama o motor real de
 * ranking do app (src/lib/ranking.ts), com o desempate do app (created_at DESC). A cada medição
 * (de 2 em 2 dias), para cada pessoa:
 *   - feed comum (lente desligada): os 8 primeiros da aba (os 50 de maior score, como o app);
 *   - feed com a lente, em cada variante e força.
 * Variantes:
 *   A — a fórmula documentada, ligada como está no código (PprTrustLens.apply): reordena só os
 *       50 da aba por score × viewMultiplier(PPR por sorteio do app, semente pessoa + dia).
 *   B — multiplicador consertado: proximidade exata, sinal certo pra score negativo; pode trazer
 *       pra aba posts da sua rede que estavam fora dos 50.
 *   R — por lugares: cada post da sua rede passa à frente de até força × 50 posts.
 *   M — mistura: com força k%, k de cada 100 lugares vão pra sua rede (na ordem de sempre);
 *       100% = primeiro todos os da sua rede, depois o resto.
 *   C — cronológica (a outra lente do app): os 50 da aba, do mais novo pro mais velho.
 * "Sua rede" na produção = quem você segue (o app só guarda a SUA lista, não a dos seus
 * contatos): PPR exato nesse grafo de um salto dá proximidade 1 a todos que você segue.
 * Malha aberta (padrão): as pessoas reagem ao feed comum; a lente só muda o que cada uma veria.
 * Malha fechada (`--fechada R 100`): as pessoas reagem ao próprio feed com a lente.
 *
 * Uso (na raiz do repo):
 *   node Docs/simulacao-contagio/build-engine.mjs   # motor de ranking (uma vez)
 *   node Docs/simulacao-lente/build-lens.mjs        # funções da lente (uma vez)
 *   node Docs/simulacao-lente/lente.cjs <cenário> [--fechada R 100]   (LENTE_SEMANAS=12 encurta)
 * Resultados em Docs/simulacao-lente/resultados/<cenário>[__fechada_R100].json */
'use strict'
const vm = require('vm'), fs = require('fs'), path = require('path')
const here = __dirname
const load = (file, name) => { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(file, 'utf8'), c); return c[name] }
const E = load(path.join(here, '..', 'simulacao-contagio', 'engine.js'), 'DriftEngine')
const L = load(path.join(here, 'lens.js'), 'DriftLens')
const { runModel, CITIES } = require('../simulacao-contagio/sim.cjs')

const DAY = 86400, T0 = 1790035200
const J = 50 // R: com força 100% e proximidade 1, o post passa à frente de até 50 posts
const WIN = 50 // a aba mostra os 50 primeiros (FEED_INITIAL_LIMIT do app)
const TOP = 8 // o que a pessoa vê de fato (como na simulação do contágio)

const NO_ATK = { atk: { spammer: false, farm: false, brigade: false } }
const SMALL_FARM = { atk: { spammer: false, farm: true, brigade: false }, farmSize: 100 }
const SCEN = {
  sem_ataque: NO_ATK,
  fazenda: {}, // spammer veterano + fazenda de 2.000 contas impulsionando o spam do dono + brigada
  paciente: { followBack: 0.1, farmCamo: 2, farmJoin: 0, farmStart: 28 },
  sybil: { followBack: 0.1, farmJoin: 0, farmStart: 28, farmSpamDirect: 0.05, farmSpamFrom: 28, farmSpamBoost: 20 },
  eclipse: { followBack: 0.1, eclipse: 0.3, censor: 0.5 },
  // rede pequena: 225 pessoas (10% da população de cada cidade) — a aba cobre boa parte dos posts
  pequena_sem_ataque: { popScale: 0.1, ...NO_ATK },
  pequena_sybil: { popScale: 0.1, ...SMALL_FARM, followBack: 0.1, farmJoin: 0, farmStart: 28, farmSpamDirect: 0.05, farmSpamFrom: 28, farmSpamBoost: 5 },
  // mundo "frio": as pessoas impulsionam 10% do que veem (em vez de 80%) — quase tudo fica sem voto,
  // como o Drift hoje; a recência decide a ordem
  frio: { ...NO_ATK, driftProb: 0.1 },
  // uma conta seguida por 10% das pessoas inunda num mundo frio: do dia 21, 30 spams por dia
  inundacao: { atk: { spammer: true, farm: false, brigade: false }, spammerFollowers: 0.1, spammerFlood: 30, driftProb: 0.1 },
  // isca seguida de volta: contas da fazenda (3% de follow-back) postam conteúdo bom para ganhar o seu
  // DRIFT (vínculo conquistado) e depois trazer spam
  isca: { followBack: 0.03, farmContent: 0.1 },
}
const BASE = { seed: 7, weeks: +(process.env.LENTE_SEMANAS || 24), stepDays: 2, farmStart: 14, farmSize: 2000, theta: 0.8, ambient: 3, appOrder: true, atk: { spammer: true, farm: true, brigade: true } }

// configurações medidas: [nome, variante, força %]
const CONFIGS = [['comum', 'O', 0], ['A50', 'A', 50], ['A100', 'A', 100], ['B50', 'B', 50], ['B100', 'B', 100],
  ['R50', 'R', 50], ['R100', 'R', 100], ['M25', 'M', 25], ['M50', 'M', 50], ['M100', 'M', 100], ['C', 'C', 100],
  ['S50', 'S', 50], ['S100', 'S', 100], ['SEG', 'G', 0]]

function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

const args = process.argv.slice(2)
const scenName = args[0] || 'sem_ataque'
const fi = args.indexOf('--fechada')
const closed = fi >= 0 ? { v: args[fi + 1], k: +args[fi + 2] } : null
if (!SCEN[scenName]) { console.error('cenário desconhecido:', scenName, Object.keys(SCEN)); process.exit(1) }
const scen = SCEN[scenName]

let W = null // mundo (referências vivas de sim.cjs)
let ranked = [] // ranking canônico do dia (posts de até 6 dias, não moderados), na ordem do app
let rankedDay = -1

// ── A pessoa, num dia: o ranking que ela vê, a aba e os candidatos ──────────
// No eclipse, o relay do atacante descarta metade dos posts honestos que chegariam a quem está
// eclipsado (os do atacante passam). O ranking dela é o comum sem esses posts.
let ECL = null
function rankingOf(v) {
  if (!ECL || !ECL[v]) return ranked
  return ranked.filter((x) => {
    const p = W.posts[x.pi]
    return p.spam || p.atk || p.a === v || hash32('in:' + v + ':' + x.pi) % 100 >= 50
  })
}
// "Sua rede" na lente = a leitura do vínculo da aba Contágio (src/lib/contagion-data.ts →
// lensNetworkAuthors): você segue a pessoa e NÃO tem experiência ruim com ela — tie ≥ 5, então uma
// denúncia basta, inclusive para quem você já impulsionou (revisão Barney+Satoshi, R2).
let strikeDay = -1
const strikeCache = new Map()
function strikesOf(v, day) {
  if (strikeDay !== day) { strikeCache.clear(); strikeDay = day }
  let m = strikeCache.get(v)
  if (!m) {
    m = new Map()
    const seenPost = new Set()
    for (const r of W.reportsBy[v]) if (!seenPost.has(r.p)) { seenPost.add(r.p); const a = W.posts[r.p].a; m.set(a, (m.get(a) || 0) + 1) }
    strikeCache.set(v, m)
  }
  return m
}
function inNetwork(v, a, day) {
  if (!W.fol[v].has(a)) return false
  const base = (W.drd[v].get(a)?.size || 0) >= 1 ? 8 : 5
  return base - 5 * (strikesOf(v, day).get(a) || 0) >= 5
}
// S: só vínculo conquistado (você já impulsionou algo que a pessoa escreveu) e não zerado
function inStrong(v, a, day) {
  if (!W.fol[v].has(a) || (W.drd[v].get(a)?.size || 0) < 1) return false
  return 8 - 5 * (strikesOf(v, day).get(a) || 0) >= 5
}
// Candidatos = os 50 da aba + posts da rede da pessoa que estão fora deles (B, R, M).
// Cada um leva `r` = lugar no ranking canônico dela (0 = primeiro).
function view(v, day) {
  const Rv = rankingOf(v)
  const win = []
  const cand = []
  const seg = []
  for (let r = 0; r < Rv.length; r++) {
    const x = Rv[r]
    const inWin = r < WIN
    const net = inNetwork(v, W.posts[x.pi].a, day)
    const strong = net && inStrong(v, W.posts[x.pi].a, day)
    if (inWin) win.push({ pi: x.pi, s: x.s, r })
    if (inWin || net) cand.push({ pi: x.pi, s: x.s, r, net, strong })
    if (W.fol[v].has(W.posts[x.pi].a) && seg.length < WIN) seg.push({ pi: x.pi, s: x.s, r })
  }
  return { win, cand, seg }
}

// A: PPR Monte Carlo do app (K=1000, L=6, α=0,15), semente = pessoa + dia, lista na ordem em que
// chegou (como o `SELECT ... FROM follows` sem ORDER BY do app). `reverse` = outro aparelho.
function pprMC(v, nowMs, reverse) {
  const vid = W.U[v].id
  let list = [...W.fol[v]].map((u) => ({ target: W.U[u].id, influence: 1 }))
  if (reverse) list = list.reverse()
  const out = L.computePpr({ source: vid, graph: new Map([[vid, list]]), rng: L.createPprRng(vid, nowMs), ...L.PPR_PARAMS })
  const byIdx = new Map()
  for (const u of W.fol[v]) byIdx.set(u, out.get(W.U[u].id) || 0)
  return byIdx
}

// ── Variantes ────────────────────────────────────────────────────
function lensA(win, ppr, k) {
  const P = W.posts
  const sc = win.map((x) => ({ x, sl: x.s * L.viewMultiplier({ pprScore: ppr.get(P[x.pi].a) || 0, mutualSpreadPost: 0, strength: k / 100 }), t: P[x.pi].day }))
  // PprTrustLens.apply: sLocal DESC, depois createdAt DESC (o sort estável mantém o resto)
  sc.sort((a, b) => (b.sl !== a.sl ? b.sl - a.sl : b.t - a.t))
  return sc.map((y) => y.x)
}
function lensB(cand, k) {
  const sc = cand.map((x) => {
    const m = 1 + 1.5 * (k / 100) * (x.net ? 1 : 0)
    return { x, sl: x.s > 0 ? x.s * m : x.s < 0 ? x.s / m : 0 }
  })
  sc.sort((a, b) => b.sl - a.sl || a.x.r - b.x.r)
  return sc.slice(0, WIN).map((y) => y.x)
}
function lensR(cand, k) {
  const sc = cand.map((x) => { const jump = Math.floor((k * J * (x.net ? 10 : 0)) / 1000); return { x, key: x.r - jump, jump } })
  sc.sort((a, b) => a.key - b.key || b.jump - a.jump || a.x.r - b.x.r)
  return sc.slice(0, WIN).map((y) => y.x)
}
// M: a função do APP (src/lib/lens/order.ts → mixNetwork). Cota: entre os p+1 primeiros lugares,
// pelo menos ⌊(p+1)·k/100⌋ são da sua rede (k = 50 → um sim, um não; k = 100 → todos), na ordem de
// sempre. Travas: nunca rebaixa um post da sua rede; post da rede afundado (score < 0) não ganha
// prioridade; a aba mantém os 50 (os da rede que vêm de fora empurram o fim).
// id = pi com zeros à esquerda e createdAt = dia: a ordem canônica do app coincide com a do mundo.
const asPost = (x) => ({ id: 'p' + String(x.pi).padStart(7, '0'), score: x.s, createdAt: W.posts[x.pi].day, authorPub: 'a' + W.posts[x.pi].a, x })
function lensM(cand, k, strongOnly) {
  const tab = cand.filter((x) => x.r < WIN).map(asPost)
  const network = cand.filter((x) => (strongOnly ? x.strong : x.net)).map(asPost)
  return L.mixNetwork({ tab, network, strengthPct: k }).posts.map((p) => p.x)
}
function lensC(win) {
  const P = W.posts
  return win.slice().sort((a, b) => P[b.pi].day - P[a.pi].day || a.r - b.r)
}

function feedFor(conf, vw, ctx) {
  const [, variant, k] = conf
  if (variant === 'O') return vw.win
  if (variant === 'A') return lensA(vw.win, ctx.ppr(), k)
  if (variant === 'B') return lensB(vw.cand, k)
  if (variant === 'R') return lensR(vw.cand, k)
  if (variant === 'M') return lensM(vw.cand, k)
  if (variant === 'S') return lensM(vw.cand, k, true)
  if (variant === 'G') return vw.seg
  return lensC(vw.win)
}

// ── Malha fechada: as pessoas reagem ao próprio feed com a lente ──────
const lensFeedClosed = closed
  ? (v, day) => {
      if (v >= W.NH) return []
      const nowMs = (T0 + (day + 1) * DAY) * 1000
      return feedFor(['x', closed.v, closed.k], view(v, day), { ppr: () => pprMC(v, nowMs, false) }).slice(0, TOP)
    }
  : null

// ── Medição ──────────────────────────────────────────────────────
const NC = CONFIGS.length
const series = [] // por medição: { d, n, m: { conf: métricas }, det }
const flags = [] // por medição (base64): 2 bytes por pessoa — bit c: vê ataque nos 8 primeiros na config c
const flagsF = [] // idem — bit c: metade ou mais dos 8 é de quem ela segue
const featured = [] // pessoas em destaque
const featFeeds = [] // por medição: { [v]: { conf: [pi...] } }
const postInfo = new Map()
const scoreAt = [] // por medição: { pi: [score, lugar no ranking da pessoa] } dos destaques

function pickFeatured() {
  // 3 fundadoras (no app desde o dia 0), em cidades diferentes, com 8+ contatos e sem viagem diária
  const want = [0, 3, 5]
  for (const c of want) for (const i of W.byCity[c]) {
    const u = W.U[i]
    if (u.join === 0 && W.fol[i].size >= 8 && u.pend < 0) { featured.push(i); break }
  }
}

function measure(fr) {
  const day = fr.day - 1
  if (rankedDay !== day) throw new Error('ranking desatualizado na medição')
  if (!featured.length) pickFeatured()
  const NH = W.NH, P = W.posts, U = W.U
  const nowMs = (T0 + (day + 1) * DAY) * 1000
  let topHon = -1 // post honesto de maior score hoje (alcance: quantos o veem nos 8 primeiros)
  for (const x of ranked) { const p = P[x.pi]; if (!p.spam && !p.atk && !p.bait) { topHon = x.pi; break } }
  const acc = CONFIGS.map(() => ({ fromF: 0, same: 0, atk: 0, atkShare: 0, poro: 0, reach: 0, sybF: 0, netLen: 0 }))
  const fl = new Uint16Array(NH), flF = new Uint16Array(NH)
  let n = 0, detShuffle = 0, detDevice = 0, detN = 0
  const ff = {}, sc = {}
  for (let v = 0; v < NH; v++) {
    if (!W.joined(U[v], day)) continue
    n++
    const vw = view(v, day)
    const canonTop = vw.win.slice(0, TOP)
    const canonSet = new Set(canonTop.map((x) => x.pi))
    let pprCache = null
    const ctx = { ppr: () => pprCache || (pprCache = pprMC(v, nowMs, false)) }
    const isFeat = featured.includes(v)
    if (isFeat) ff[v] = {}
    for (let c = 0; c < NC; c++) {
      const tab = feedFor(CONFIGS[c], vw, ctx)
      const top = tab.slice(0, TOP)
      const a = acc[c]
      let f = 0, at = 0, other = 0, otherN = 0, same = 0, seesTop = 0, sybF = 0
      for (const x of top) {
        const p = P[x.pi]
        const followed = W.fol[v].has(p.a)
        if (followed) f++
        if (p.spam || p.atk) { at++; if (followed) sybF = 1 }
        const home = U[p.a].home
        if (home >= 0) { otherN++; if (home !== U[v].home) other++ }
        if (canonSet.has(x.pi)) same++
        if (x.pi === topHon) seesTop = 1
      }
      const len = top.length || 1
      a.fromF += f / len; a.same += same / Math.max(1, canonTop.length); a.atkShare += at / len
      a.poro += otherN ? other / otherN : 0; a.reach += seesTop; a.sybF += sybF
      a.netLen += tab.filter((x) => W.fol[v].has(P[x.pi].a)).length
      if (at) { a.atk++; fl[v] |= 1 << c }
      if (f * 2 >= TOP) flF[v] |= 1 << c
      if (isFeat) {
        ff[v][CONFIGS[c][0]] = top.map((x) => x.pi)
        for (const x of top) sc[x.pi] = [Math.round(x.s * 100) / 100, x.r]
      }
    }
    // determinismo, numa amostra de 1 em cada 15 pessoas:
    //  - "embaralhar": a mesma entrada em outra ordem de chegada dá o mesmo feed? (R, B, M)
    //  - "outro aparelho": a lista de quem a pessoa segue na ordem inversa dá o mesmo feed? (A)
    if (v % 15 === 0 && vw.cand.length > 1) {
      detN++
      const sh = vw.cand.slice().sort((x, y) => hash32('s' + x.pi + ':' + day) - hash32('s' + y.pi + ':' + day))
      const recanon = sh.slice().sort((x, y) => x.r - y.r) // o app reordena pelo canônico antes da lente
      for (const fn of [lensR, lensB, lensM]) if (fn(vw.cand, 100).slice(0, TOP).map((x) => x.pi).join() !== fn(recanon, 100).slice(0, TOP).map((x) => x.pi).join()) { detShuffle++; break }
      const a1 = lensA(vw.win, pprMC(v, nowMs, false), 100).slice(0, TOP).map((x) => x.pi).join()
      const a2 = lensA(vw.win, pprMC(v, nowMs, true), 100).slice(0, TOP).map((x) => x.pi).join()
      if (a1 !== a2) detDevice++
    }
  }
  const m = {}
  CONFIGS.forEach((cf, c) => {
    const a = acc[c]
    m[cf[0]] = { fromF: a.fromF / n, same: a.same / n, atk: a.atk / n, atkShare: a.atkShare / n, poro: a.poro / n, reach: a.reach / n, sybF: a.sybF / n, netLen: a.netLen / n }
  })
  series.push({ d: fr.day, n, m, det: { n: detN, shuffle: detShuffle, device: detDevice } })
  flags.push(Buffer.from(fl.buffer).toString('base64'))
  flagsF.push(Buffer.from(flF.buffer).toString('base64'))
  featFeeds.push(ff)
  for (const pi of Object.keys(sc)) if (!postInfo.has(+pi)) {
    const p = P[+pi], au = U[p.a]
    postInfo.set(+pi, { a: p.a, k: au.kind, h: au.home, d: p.day, sp: p.spam ? 1 : 0, at: p.atk ? 1 : 0, b: p.bait ? 1 : 0 })
  }
  scoreAt.push(sc)
  if (fr.day % 14 === 0) {
    const pc = (x) => (x * 100).toFixed(0).padStart(3) + '%'
    console.log(`dia ${String(fr.day).padStart(3)} n=${n} | rede nos 8: ` + CONFIGS.map((c) => c[0] + pc(m[c[0]].fromF)).join(' ') +
      ' | ataque: ' + CONFIGS.map((c) => c[0] + pc(m[c[0]].atk)).join(' ') + ` | det ${detShuffle}/${detN} disp ${detDevice}/${detN}`)
  }
}

const t0 = Date.now()
const cfg = {
  ...BASE, ...scen,
  onWorld: (w) => {
    W = w
    if (scen.eclipse) { ECL = new Uint8Array(w.NH); const k = Math.round(scen.eclipse * 1000); for (let x = 0; x < w.NH; x++) ECL[x] = hash32('eclipse:' + x) % 1000 < k ? 1 : 0 }
  },
  onGlobal: (day, r) => { ranked = r; rankedDay = day },
  lensFeed: lensFeedClosed,
}
runModel(E, cfg, 'global', measure)
const name = scenName + (closed ? `__fechada_${closed.v}${closed.k}` : '') + (BASE.weeks !== 24 ? `__${BASE.weeks}sem` : '')
const outDir = path.join(here, 'resultados')
fs.mkdirSync(outDir, { recursive: true })
const people = []
for (let i = 0; i < W.NH; i++) people.push([W.U[i].home, W.U[i].join, ECL ? ECL[i] : 0])
fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify({
  name, scen: { ...scen }, closed, weeks: BASE.weeks, configs: CONFIGS.map((c) => c[0]), featured, people,
  featuredInfo: featured.map((v) => ({ v, home: W.U[v].home, follows: W.fol[v].size, fol: [...W.fol[v]] })),
  series, flags, flagsF, featFeeds, scoreAt, postInfo: Object.fromEntries(postInfo),
  cities: CITIES.map((c) => ({ name: c.name, pop: c.pop, x: c.x, y: c.y })),
}))
console.log(name, ((Date.now() - t0) / 1000 | 0) + 's')
