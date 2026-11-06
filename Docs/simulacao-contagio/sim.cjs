/* Drift — simulação do modelo de contágio (ver Docs/spec-revisao-contagio.md).
 * Mundo: 6 cidades (250..500 pessoas, 2.250 no total), 24 semanas, um passo por dia;
 * a localização do dia é casa, trabalho/estudo em outra cidade ou viagem.
 * runModel(E, cfg, 'global' | 'contagio'): 'global' chama o motor real do app
 * (src/lib/ranking.ts empacotado por build-engine.mjs); 'contagio' é o modelo local.
 * Determinística (cfg.seed). Todas as variantes ficam atrás de flags em cfg — com as
 * flags desligadas o resultado é idêntico ao das versões anteriores (regressão
 * conferida a cada acréscimo):
 *   modelo:  unknownSlot, knownMin, mutualNeedsMeet, mutualEarn, earnOwn, minSrc,
 *            vouch (aval), lockstep + lockAbs (sobreposição), sinkLearn + sinkDecay,
 *            probation (período de experiência), weakCap (teto p/ vínculos fracos),
 *            negCap (o teto vale também na vacina e na quarentena), implVia (post direto
 *            não tem "quem trouxe"), strikeOn (o que vira experiência ruim: 'both' = SINK ou
 *            denúncia; 'report' = só denúncia, como no app; 'viaSink' = denúncia, e SINK só
 *            contra quem trouxe), cutProb (chance de cortar o vínculo que trouxe spam;
 *            padrão 0,4), cutMode ('all' = o corte tira a pessoa de tudo, como deixar de
 *            seguir; 'bring' = gesto do app "não trazer mais por X": só deixa de trazer,
 *            mantém posts diretos), cutNeg (no modo 'bring', o SINK e a denúncia de quem
 *            foi cortado: ausente = vínculo inteiro; 'weak' = entram no balde dos fracos,
 *            com teto, como no app desde a revisão de 05/11/2026; 'none' = não contam),
 *            reportProb (chance de denunciar o spam visto; padrão 0,35), breaker
 *            (disjuntor por idade), labelers, ambient (itens do mapa), noEncounters
 *   ataque:  atk{spammer,farm,brigade}, followBack, deceivedPct, farmContent (isca),
 *            farmerBait, farmCamo (camuflagem), farmRot (revezamento), farmJoin (paciente),
 *            badmouth{sink,report} (difamação: a fazenda enterra e denuncia post honesto),
 *            farmSpamDirect + farmSpamFrom (contas da fazenda postando spam direto, a
 *            partir do dia), baitDiscovery (funil do Global: chance diária de seguir e
 *            impulsionar uma isca recente)
 *   mundo:   mobility, remote, vis + visMode + visScale (visão parcial), eclipse + censor,
 *            honestError (erro honesto), tasteSink (SINK de gosto em post honesto)
 *   métricas novas: honHid (fração de leitores com algum post honesto que entraria e foi
 *            escondido por vacina ou quarentena), honHidN (quantos, por leitor).
 *   Flags e métrica de cutNeg/farmSpamDirect/baitDiscovery/honHid: revisão adversarial
 *   (Barney+Satoshi) de 05/11/2026. */
'use strict'

const CITIES = [
  { name: 'A', pop: 250, x: 0, y: 0 },
  { name: 'B', pop: 300, x: 25, y: 12 },
  { name: 'C', pop: 350, x: 10, y: 38 },
  { name: 'D', pop: 400, x: 110, y: 40 },
  { name: 'E', pop: 450, x: 60, y: 140 },
  { name: 'F', pop: 500, x: 780, y: 260 },
]
const DIST = CITIES.map((a) => CITIES.map((b) => Math.hypot(a.x - b.x, a.y - b.y)))

function mkRng(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}
function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function runModel(E, cfg, model, onFrame) {
  const rnd = mkRng(cfg.seed)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const DAY = 86400, T0 = 1790035200, DAYS = cfg.weeks * 7, STEP = cfg.stepDays

  // ── Pessoas ───────────────────────────────────────────────────
  const U = []
  const byCity = CITIES.map(() => [])
  CITIES.forEach((c, ci) => {
    for (let i = 0; i < c.pop; i++) {
      const founder = i < Math.round(c.pop * 0.2)
      const u = { idx: U.length, id: 'h' + U.length, kind: 'honesto', home: ci,
        join: founder ? 0 : Math.floor(rnd() * 42), act: 0.3 + 0.6 * rnd(), pend: -1, cow: [] }
      U.push(u); byCity[ci].push(u.idx)
    }
  })
  const NH = U.length
  // gravidade: vizinha mais provável quanto mais perto e maior
  const gravity = (from, longOnly) => {
    const w = CITIES.map((c, j) => (j === from ? 0 : (longOnly ? (DIST[from][j] > 200 ? 1 : 0.02) : 1) * c.pop / Math.pow(DIST[from][j] + 10, longOnly ? 0.6 : 1.6)))
    const tot = w.reduce((a, b) => a + b, 0)
    let r = rnd() * tot
    for (let j = 0; j < w.length; j++) { r -= w[j]; if (r <= 0) return j }
    return w.length - 1
  }
  // pendulares: 25% trabalham/estudam em outra cidade (curta/média)
  for (const u of U) if (rnd() < 0.25 && cfg.mobility !== false) {
    const j = gravity(u.home, false)
    if (DIST[u.home][j] < 200) u.pend = j
  }
  // colegas fixos no local de trabalho/estudo (5): da cidade de destino ou outros pendulares pro mesmo lugar
  for (const u of U) {
    const workCity = u.pend >= 0 ? u.pend : u.home
    for (let k = 0; k < 5; k++) u.cow.push(pick(byCity[workCity]))
  }

  const add = (u) => { u.idx = U.length; U.push(u); return u }
  const atk = cfg.atk
  const spammer = atk.spammer ? add({ id: 'spammer', kind: 'spammer', home: 0, join: 0, act: 0.8, pend: -1, cow: [] }) : null
  const farmer = atk.farm ? add({ id: 'fazendeiro', kind: 'fazenda', home: -1, join: cfg.farmJoin ?? cfg.farmStart, act: 1, pend: -1, cow: [] }) : null
  const farm = []
  if (atk.farm) for (let i = 0; i < cfg.farmSize; i++) farm.push(add({ id: 'f' + i, kind: 'fazenda', home: -1, join: cfg.farmJoin ?? cfg.farmStart, act: 1, pend: -1, cow: [] }))
  const conc = [], feeders = []
  if (atk.brigade) {
    for (let i = 0; i < 3; i++) conc.push(add({ id: 'c' + i, kind: 'brigada', home: -1, join: 14, act: 1, pend: -1, cow: [] }))
    for (let i = 0; i < 300; i++) feeders.push(add({ id: 'k' + i, kind: 'brigada', home: -1, join: 14, act: 1, pend: -1, cow: [] }))
  }
  const N = U.length

  // ── Grafo social ──────────────────────────────────────────────
  const fol = Array.from({ length: N }, () => new Set()) // fol[v] = quem v segue
  const cut = Array.from({ length: N }, () => new Set()) // vínculos cortados por rastreamento
  const enc = Array.from({ length: N }, () => new Map()) // encontros físicos: u → último dia
  const follow = (v, u) => { if (v !== u) fol[v].add(u) }
  for (const u of U.slice(0, NH)) {
    const same = byCity[u.home]
    for (let k = 0; k < 6; k++) follow(u.idx, pick(same))
    const coin = rnd() < 0.5
    const nOther = cfg.remote ? cfg.remote : 1 + (coin ? 1 : 0)
    for (let k = 0; k < nOther; k++) follow(u.idx, pick(byCity[cfg.remote ? (u.home + 1 + Math.floor(rnd() * (CITIES.length - 1))) % CITIES.length : gravity(u.home, false)]))
  }
  for (let v = 0; v < NH; v++) for (const u of [...fol[v]]) if (rnd() < 0.5) fol[u].add(v)
  if (spammer) for (let k = 0; k < 10; k++) follow(pick(byCity[0]), spammer.idx)
  const deceived = []
  if (farmer) for (let k = 0; k < Math.round(NH * (cfg.deceivedPct ?? 0.02)); k++) { const v = Math.floor(rnd() * NH); follow(v, farmer.idx); deceived.push(v) }

  // fazenda adaptada: cada conta segue 20 pessoas reais; uma fração segue de volta
  let followBacks = 0
  if (farm.length && cfg.followBack) for (const f of farm) for (let k = 0; k < 20; k++) { const v = Math.floor(rnd() * NH); follow(f.idx, v); if (rnd() < cfg.followBack) { follow(v, f.idx); followBacks++ } }
  const joined = (u, day) => day >= u.join
  const drd = Array.from({ length: N }, () => new Map()) // drd[v]: autor → Set(dias)
  const neg = Array.from({ length: N }, () => new Map()) // neg[v]: autor/contato → dias de experiências ruins (SINK/denúncia)
  const negAdd = (v, u, day) => { const a = neg[v].get(u); if (a) a.push(day); else neg[v].set(u, [day]) }
  const negK = (v, u, day) => { const a = neg[v].get(u); if (!a) return 0; if (!cfg.sinkDecay) return a.length; let k = 0; for (const d of a) if (day - d <= cfg.sinkDecay) k++; return k }
  const postDr = [] // pi → contas que deram DRIFT, em ordem de chegada
  const meet = (a, b, day) => { if (a !== b) { enc[a].set(b, day); enc[b].set(a, day) } }

  // ── Viagens agendadas ─────────────────────────────────────────
  const tripCity = new Int8Array(NH).fill(-1), tripUntil = new Int16Array(NH)

  // ── Eventos ───────────────────────────────────────────────────
  const posts = [] // {id, a, day, city, spam, atk}
  const postsBy = Array.from({ length: N }, () => [])
  const recentAct = Array.from({ length: N }, () => []) // {p, day, up}
  const lastAct = new Map() // `${u}|${p}` → {up, day}
  const reportsBy = Array.from({ length: N }, () => [])
  const cityLog = CITIES.map(() => []) // {p, carrier, day}
  const lastActive = new Float64Array(N)
  // pro motor global
  const gSpreads = [], gBuries = [], gReports = []
  let eseq = 0

  const newPost = (u, day, city, spam = false, bait = false) => {
    const p = { id: 'p' + posts.length, i: posts.length, a: u.idx, day, city, spam, atk: !bait && u.kind !== 'honesto' && u.kind !== 'spammer', bait }
    posts.push(p); postsBy[u.idx].push(p.i)
    if (city >= 0) cityLog[city].push({ p: p.i, carrier: u.idx, day })
    lastActive[u.idx] = day
    return p
  }
  const actOn = (u, p, day, up, city) => {
    const key = u.idx + '|' + p.i
    lastAct.set(key, { up, day })
    recentAct[u.idx].push({ p: p.i, day, up })
    lastActive[u.idx] = day
    if (up) { let d = drd[u.idx].get(p.a); if (!d) drd[u.idx].set(p.a, (d = new Set())); d.add(day); (postDr[p.i] || (postDr[p.i] = [])).push(u.idx) }
    const t = T0 + day * DAY + 12 * 3600 + (eseq % 3600)
    ;(up ? gSpreads : gBuries).push({ post_id: p.id, user_pub: U[u.idx].id, created_at: t, event_id: 'e' + eseq++ })
    if (up && city >= 0) cityLog[city].push({ p: p.i, carrier: u.idx, day })
  }
  const report = (u, p, day, reason) => {
    reportsBy[u.idx].push({ p: p.i, day })
    gReports.push({ post_id: p.id, reporter_pub: U[u.idx].id, reason, created_at: T0 + day * DAY + 13 * 3600 })
  }

  // ── Localização do dia ────────────────────────────────────────
  const loc = new Int8Array(N)
  function setLocations(day) {
    const weekday = day % 7 < 5
    for (let i = 0; i < NH; i++) {
      const u = U[i]
      if (tripCity[i] >= 0 && day < tripUntil[i]) { loc[i] = tripCity[i]; continue }
      tripCity[i] = -1
      // nova viagem? média 6%/sem, longa 3%/sem
      const r = cfg.mobility === false ? 1 : rnd()
      if (r < 0.03 / 7) { tripCity[i] = gravity(u.home, true); tripUntil[i] = day + 2 + Math.floor(rnd() * 4); loc[i] = tripCity[i]; continue }
      if (r < 0.09 / 7) { const j = gravity(u.home, false); tripCity[i] = j; tripUntil[i] = day + 2 + Math.floor(rnd() * 3); loc[i] = j; continue }
      loc[i] = weekday && u.pend >= 0 ? u.pend : u.home
    }
    for (const f of farm) loc[f.idx] = Math.floor(rnd() * CITIES.length) // fazenda "teleporta" pelo GPS
    if (farmer) loc[farmer.idx] = Math.floor(rnd() * CITIES.length)
    if (spammer) loc[spammer.idx] = 0
  }

  // ── Modelo de contágio: feed de v ─────────────────────────────
  const THETA = cfg.theta, THETA_Q = 1.0
  const BRING = cfg.cutMode === 'bring' // gesto "não trazer mais por X"
  function tie(v, u, day) {
    if (!BRING && cut[v].has(u)) return 0
    let s = 0
    if (fol[v].has(u) && cfg.earnOwn && (drd[v].get(u)?.size || 0) >= cfg.earnOwn) s = 0.8
    else if (fol[v].has(u)) s = fol[u].has(v) && (!cfg.mutualNeedsMeet || (!cfg.noEncounters && enc[v].has(u)) || (cfg.mutualEarn && (drd[v].get(u)?.size || 0) >= 2 && (drd[u].get(v)?.size || 0) >= 2)) ? 0.8 : 0.5
    const e = enc[v].get(u)
    if (!cfg.noEncounters && e !== undefined && day - e <= 30) s = Math.max(s, 1.0)
    if (cfg.sinkLearn && s > 0) { const k = negK(v, u, day); if (k) s = Math.max(0, s - 0.5 * k) }
    return s
  }
  function contacts(v, day) {
    const out = new Map()
    for (const u of fol[v]) { const s = tie(v, u, day); if (s > 0) out.set(u, Math.round(s * 10)) }
    for (const [u] of enc[v]) if (!out.has(u)) { const s = tie(v, u, day); if (s > 0) out.set(u, Math.round(s * 10)) }
    return out
  }
  let lwDay = -1
  const lwCache = new Map()
  const VIS = cfg.vis ? Math.floor(cfg.vis * 4294967296) : 0, VK = 4
  const seen = (c, u, pi) => { if (!VIS || c < 0) return true; let h = Math.imul(u ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(pi + c * 0x01000193, 0xc2b2ae35); h ^= h >>> 16; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15; return (h >>> 0) < VIS }
  const seenAcct = (c, x) => { if (!VIS || c < 0) return true; let h = Math.imul(x ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(c + 7, 0xc2b2ae35); h ^= h >>> 16; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15; return (h >>> 0) < VIS }
  const ACC = VIS && cfg.visMode === 'account'
  // limiares de contagem escalados pela fração vista (Marshall): contagens encolhem com q², Jaccard com q
  const Q = VIS && cfg.visScale ? cfg.vis : 1
  const T_ABS = cfg.lockAbs ? Math.max(2, Math.round(cfg.lockAbs * Q * Q)) : 0, T_INT = Math.max(2, Math.round(5 * Q * Q)), T_H = Math.max(2, Math.round(5 * Q)), J_LO = 0.4 * Q, J_HI = 0.8 * Q
  function hist(u, day, c = 0) { const h = new Set(); for (const a of recentAct[u]) if (a.up && a.day < day && day - a.day <= 30 && seen(c, u, a.p)) h.add(a.p); return h }
  function lockW(u, day, c = 0) {
    if (lwDay !== day) { lwCache.clear(); lwDay = day }
    const key = (c + 1) * N + u
    let w = lwCache.get(key)
    if (w !== undefined) return w
    const H = hist(u, day, ACC ? -1 : c)
    w = H.size < T_H && cfg.probation ? 5 : 10 // período de experiência: conta sem histórico vale metade
    if (H.size >= T_H) {
      const co = new Map()
      for (const pi of [...H].sort((a, b) => b - a).slice(0, 8)) {
        const D = postDr[pi] || []
        for (const x of (D.length <= 64 ? D : D.slice(0, 32).concat(D.slice(-32)))) if (x !== u && (ACC ? seenAcct(c, x) : seen(c, x, pi))) co.set(x, (co.get(x) || 0) + 1)
      }
      let maxJ = 0
      for (const [x] of [...co].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5)) {
        const H2 = hist(x, day, ACC ? -1 : c)
        let inter = 0
        for (const p of H) if (H2.has(p)) inter++
        if (inter < T_INT) continue
        // sobreposição absoluta: camuflagem dilui a proporção, mas não apaga os spams que todas impulsionam juntas
        if (T_ABS && inter >= T_ABS) maxJ = Math.max(maxJ, J_HI)
        maxJ = Math.max(maxJ, inter / (H.size + H2.size - inter))
      }
      w = maxJ >= J_HI ? 0 : maxJ <= J_LO ? 10 : Math.round(10 * (J_HI - maxJ) / (J_HI - J_LO))
    }
    lwCache.set(key, w)
    return w
  }
  const LAB = cfg.labelers || null
  const ECLK = cfg.eclipse ? Math.round(cfg.eclipse * 1000) : 0
  const eclArr = new Uint8Array(N)
  if (ECLK) for (let x = 0; x < NH; x++) eclArr[x] = hash32('eclipse:' + x) % 1000 < ECLK ? 1 : 0
  const ECL = (x) => eclArr[x] === 1
  const CEN = Math.round((cfg.censor || 0) * 100)
  // relay do atacante descarta parte do que honestos mandam ao eclipsado e parte do que o eclipsado publica
  const dropped = (v, vE, u, pi) => ECLK > 0 && u < NH && ((vE && hash32('in:' + v + ':' + pi) % 100 < CEN) || (ECL(u) && hash32('out:' + u + ':' + pi) % 100 < CEN))
  const badLabel = (u) => u < NH && (hash32('rotulo-falso:' + u) % 100) < 5 // labeler malicioso rotula 5% dos honestos
  function lwEff(u, day, c) {
    const w = lockW(u, day, c)
    if (!LAB) return w
    const flags = (lockW(u, day, -1) === 0 ? LAB.n - LAB.bad : 0) + (badLabel(u) ? LAB.bad : 0)
    return flags >= LAB.need ? Math.min(w, 3) : w
  }
  const vouches = (u, w, day) => (enc[u].has(w) || (drd[u].get(w)?.size || 0) >= 1) && negK(u, w, day) < 2
  function feedContagion(v, day, opt = {}) {
    const vE = ECL(v)
    const C = contacts(v, day)
    const weakS = new Map(), young = new Map(), src = new Map(), score = new Map(), vac = new Map(), quar = new Map(), via = new Map(), direct = new Set()
    const vacW = new Map(), quarW = new Map() // negativos de vínculos fracos (só com cfg.negCap)
    let bmS = 0, bmW = 0 // força das contas da fazenda que o leitor segue (bad-mouthing)
    let cs = [...C]
    if (opt.shuffle) cs = cs.sort(() => opt.r() - 0.5)
    for (const [u, s0] of cs) {
      const s = cfg.lockstep && !vE ? Math.floor(s0 * lwEff(u, day, VIS ? v % VK : 0) / 10) : s0 // eclipsado: sem dados de co-impulsionadores nem rótulos
      const uE = ECL(u)
      const cutN = BRING && cut[v].has(u)
      if (cutN && cfg.cutNeg === 'none') { if (fol[v].has(u)) for (const pi of postsBy[u]) { if (day - posts[pi].day <= 3 && !dropped(v, vE, u, pi)) { direct.add(pi) } } continue }
      const weakNeg = cfg.negCap && (s0 <= 5 || (cutN && cfg.cutNeg === 'weak'))
      if (cfg.badmouth && s > 0 && U[u].kind === 'fazenda' && U[u].id !== 'fazendeiro') { if (weakNeg) bmW += s; else bmS += s }
      for (const a of recentAct[u]) {
        if (day - a.day > 2) continue
        if (a.up) {
          if (s <= 0 || dropped(v, vE, u, a.p) || (BRING && cut[v].has(u))) continue
          if (cfg.weakCap && s0 <= 5) weakS.set(a.p, (weakS.get(a.p) || 0) + s) // vínculo fraco: só follow
          else score.set(a.p, (score.get(a.p) || 0) + s)
          src.set(a.p, (src.get(a.p) || 0) + 1)
          if (cfg.breaker && day - U[u].join < cfg.breaker.age) young.set(a.p, (young.get(a.p) || 0) + s)
          if (!via.has(a.p) || via.get(a.p)[1] < s || (via.get(a.p)[1] === s && u < via.get(a.p)[0])) via.set(a.p, [u, s])
        } else if (!vE && !uE) { const m = weakNeg ? vacW : vac; m.set(a.p, (m.get(a.p) || 0) + s) }
      }
      if (!vE && !uE) for (const r of reportsBy[u]) if (day - r.day <= 14) { const m = weakNeg ? quarW : quar; m.set(r.p, (m.get(r.p) || 0) + s) }
      if (fol[v].has(u) && (BRING || !cut[v].has(u))) for (const pi of postsBy[u]) {
        if (day - posts[pi].day <= 3 && !dropped(v, vE, u, pi)) { direct.add(pi); if (!cfg.implVia && !via.has(pi)) via.set(pi, [u, 10]) }
      }
    }
    const cand = []
    const WCAP = cfg.weakCap ? Math.round(cfg.weakCap * 10) : 0
    const tot = (pi) => (score.get(pi) || 0) + Math.min(weakS.get(pi) || 0, WCAP)
    const keys = new Set([...score.keys(), ...weakS.keys(), ...direct])
    // a fazenda dá SINK e denuncia todo post honesto que chega a quem a segue
    const target = (p) => !p.spam && !p.atk && !p.bait
    const negOf = (strongM, weakM, pi, p, on) => {
      const hit = on && target(p)
      const w = (weakM.get(pi) || 0) + (hit ? bmW : 0)
      return (strongM.get(pi) || 0) + (hit ? bmS : 0) + (cfg.negCap ? Math.min(w, WCAP) : w)
    }
    const BM = cfg.badmouth || {}
    for (const pi of keys) {
      const p = posts[pi]
      if (p.a === v || day - p.day > 4) continue
      const qv = negOf(quar, quarW, pi, p, BM.report), vv = negOf(vac, vacW, pi, p, BM.sink)
      const sc = (direct.has(pi) ? 10 : 0) + tot(pi) - vv
      const thr = cfg.breaker && (young.get(pi) || 0) * 2 > tot(pi) ? cfg.breaker.theta * 10 : THETA * 10
      const wouldEnter = direct.has(pi) || (tot(pi) >= thr && (src.get(pi) || 0) >= (cfg.minSrc || 1))
      if (qv >= THETA_Q * 10) { if (opt.stat && target(p) && wouldEnter) opt.stat.quarHidden++; continue }
      if (!wouldEnter) continue
      if (sc <= 0) { if (opt.stat && target(p)) opt.stat.vacHidden++; continue }
      cand.push({ pi, s: sc / (day - p.day + 0.5), via: via.get(pi)?.[0] ?? -1, ch: direct.has(pi) ? 'dir' : 'cont' })
    }
    cand.sort((a, b) => b.s - a.s || a.pi - b.pi)
    const feed = cand.slice(0, 8 - Math.min(3, cfg.ambient))
    // Ambiente (mapa): o que está na cidade onde v passa o dia. Mostra, não transmite.
    const city = loc[v]
    if (city >= 0 && cfg.ambient > 0) {
      // "Conhecido" = contato direto, ou seguido por >= KNOWN_MIN contatos meus
      // (contágio complexo também no mapa: um único laço de 2º grau não basta).
      const two = new Set(C.keys())
      if (cfg.knownMin <= 1) { for (const u of C.keys()) for (const w of fol[u]) two.add(w) }
      else {
        const cnt = new Map()
        for (const u of C.keys()) for (const w of fol[u]) if (!cut[u].has(w) && (!cfg.vouch || vouches(u, w, day))) cnt.set(w, (cnt.get(w) || 0) + 1)
        for (const [w, c] of cnt) if (c >= cfg.knownMin) two.add(w)
      }
      const inFeed = new Set(feed.map((x) => x.pi))
      const known = [], unknown = []
      const seen = new Set()
      const log = cityLog[city]
      for (let i = log.length - 1; i >= 0 && log[i].day >= day - 2; i--) {
        const { p: pi, carrier } = log[i]
        if (inFeed.has(pi) || seen.has(pi) || posts[pi].a === v) continue
        if ((quar.get(pi) || 0) >= THETA_Q * 10 || (vac.get(pi) || 0) >= 10) continue
        seen.add(pi)
        if (two.has(posts[pi].a) || two.has(carrier)) known.push(pi)
        else unknown.push(pi)
      }
      for (const pi of known.slice(0, cfg.ambient - (cfg.unknownSlot ? 1 : 0))) feed.push({ pi, s: 0, via: -1, ch: 'ambK' })
      if (unknown.length && cfg.unknownSlot) {
        let best = unknown[0], bh = Infinity
        for (const pi of unknown) { const h = hash32(pi + ':' + v + ':' + day); if (h < bh) { bh = h; best = pi } }
        feed.push({ pi: best, s: 0, via: -1, ch: 'ambU' })
      }
    }
    return { feed: feed.slice(0, 8), hidden: quar }
  }

  // ── Modelo global: motor real ─────────────────────────────────
  let gTop = [] // [{pi}]
  let gOut = null
  const histEdges = new Map() // `${s}|${a}` (posts com > 21 dias)
  let histDay = 0
  function recomputeGlobal(day) {
    const nowSec = T0 + (day + 1) * DAY
    const cutoff = day - 21
    // resume histórico: arestas spreader→autor de posts antigos
    while (histDay <= cutoff) { histDay++ }
    const recentPosts = [], keep = new Set()
    const reported = new Set(gReports.map((r) => r.post_id))
    for (const p of posts) if (p.day > cutoff || reported.has(p.id)) { keep.add(p.id); recentPosts.push({ id: p.id, author_pub: U[p.a].id, created_at: T0 + p.day * DAY + 12 * 3600 }) }
    const sp = [], bu = []
    for (const s of gSpreads) {
      if (keep.has(s.post_id)) sp.push(s)
      else { const a = posts[+s.post_id.slice(1)].a; histEdges.set(s.user_pub + '|' + a, 1) }
    }
    for (const b of gBuries) if (keep.has(b.post_id)) bu.push(b)
    const authorsHist = new Set()
    for (const k of histEdges.keys()) {
      const [s, a] = k.split('|')
      if (!authorsHist.has(a)) { authorsHist.add(a); recentPosts.push({ id: 'H' + a, author_pub: U[+a].id, created_at: T0 }) }
      sp.push({ post_id: 'H' + a, user_pub: s, created_at: T0 + 3600, event_id: 'h' + k })
    }
    const users = []
    for (let i = 0; i < N; i++) if (joined(U[i], day)) users.push({ npub: U[i].id, last_active: T0 + lastActive[i] * DAY + 12 * 3600 })
    const anchors = new Map()
    for (let i = 0; i < N; i++) if (joined(U[i], day)) anchors.set(U[i].id, T0 + U[i].join * DAY + 3 * 3600)
    gOut = E.computeRanking({ nowMs: nowSec * 1000, posts: recentPosts, spreads: sp, buries: bu, comments: [], reports: gReports, users, anchors, moderation: {} })
    const ranked = []
    for (const p of posts) {
      if (day - p.day > 6) continue
      const r = gOut.posts.get(p.id)
      if (!r || r.moderated) continue
      ranked.push({ pi: p.i, s: r.score })
    }
    ranked.sort((a, b) => b.s - a.s || a.pi - b.pi)
    gTop = ranked.slice(0, 8)
  }

  function feedOf(v, day) {
    if (model === 'contagio') return feedContagion(v, day).feed
    return gTop
  }

  // ── Loop ──────────────────────────────────────────────────────
  const reach = new Map() // pi → Set(viewers)
  const reachCities = new Map()
  const victims = []
  const frames = []
  let lastAttack = 0

  for (let day = 0; day < DAYS; day++) {
    setLocations(day)
    // encontros: colegas (pendulares em dia útil + locais), vizinhos, viajantes
    const weekday = day % 7 < 5
    for (let i = 0; i < NH; i++) {
      const u = U[i]
      if (!joined(u, day)) continue
      if (weekday) for (let k = 0; k < 2; k++) { const c = pick(u.cow); if (joined(U[c], day) && loc[c] === loc[i]) meet(i, c, day) }
      if (rnd() < 0.15) { const n = pick(byCity[loc[i]]); if (joined(U[n], day) && loc[n] === loc[i]) meet(i, n, day) }
      if (tripCity[i] >= 0 && rnd() < 0.6) { const n = pick(byCity[loc[i]]); if (joined(U[n], day)) meet(i, n, day) }
    }
    const baitRecent = cfg.baitDiscovery ? posts.filter((p) => p.bait && day - p.day <= 2).map((p) => p.i) : null
    // pessoas reais
    for (let i = 0; i < NH; i++) {
      const u = U[i]
      if (!joined(u, day) || rnd() > u.act) continue
      lastActive[i] = day
      if (rnd() < 0.1) newPost(u, day, loc[i])
      const feed = feedOf(i, day).slice()
      if (model === 'global') {
        // no modelo global, além do top 8 a pessoa "passeia" pelo mapa da cidade onde está
        const log = cityLog[loc[i]]
        for (let k = 0; k < 2 && log.length; k++) { const e = log[Math.max(0, log.length - 1 - Math.floor(rnd() * Math.min(300, log.length)))]; if (e.day >= day - 2) feed.push({ pi: e.p, via: -1 }) }
      }
      if (cfg.baitDiscovery && baitRecent.length && rnd() < cfg.baitDiscovery) {
        const b = posts[baitRecent[Math.floor(rnd() * baitRecent.length)]]
        if (b.a !== i) { follow(i, b.a); if (!lastAct.has(i + '|' + b.i) && rnd() < 0.8) actOn(u, b, day, true, loc[i]) }
      }
      if (!feed.length) continue
      const k = 1 + (rnd() < u.act ? 1 : 0)
      for (let j = 0; j < k; j++) {
        const it = feed[Math.floor(Math.pow(rnd(), 1.6) * feed.length)]
        const p = posts[it.pi]
        if (p.a === i || lastAct.has(i + '|' + p.i)) continue
        if ((p.spam || p.atk) && cfg.honestError && rnd() < cfg.honestError) actOn(u, p, day, true, loc[i]) // engano: impulsiona o spam
        else if (p.spam || p.atk) {
          const sunk = rnd() < 0.5
          if (sunk) actOn(u, p, day, false, loc[i])
          const rep = rnd() < (cfg.reportProb ?? 0.35)
          if (rep) report(u, p, day, 'spam')
          if (model === 'contagio' && it.via >= 0 && rnd() < (cfg.cutProb ?? 0.4)) cut[i].add(it.via) // rastreamento de contato (sorteio sempre feito: mesma sequência com qualquer cutProb)
          // v6: experiência ruim baixa o vínculo com o autor e com quem trouxe (crédito à la Ostra)
          const mode = cfg.strikeOn || 'both'
          const viaOk = it.via >= 0 && it.via !== p.a && it.ch === 'cont'
          if (cfg.sinkLearn && mode === 'both' && (sunk || rep)) { negAdd(i, p.a, day); if (it.via >= 0 && it.via !== p.a) negAdd(i, it.via, day) }
          if (cfg.sinkLearn && mode !== 'both' && rep) { negAdd(i, p.a, day); if (viaOk) negAdd(i, it.via, day) }
          if (cfg.sinkLearn && mode === 'viaSink' && sunk && !rep && viaOk) negAdd(i, it.via, day)
        } else if (cfg.tasteSink && rnd() < cfg.tasteSink) {
          // SINK de gosto em post honesto ("não quero ver isso aqui"); quem pune depende de strikeOn
          actOn(u, p, day, false, loc[i])
          const tmode = cfg.strikeOn || 'both'
          if (cfg.sinkLearn && tmode === 'viaSink' && it.ch === 'cont' && it.via >= 0 && it.via !== p.a) negAdd(i, it.via, day)
          else if (cfg.sinkLearn && tmode === 'both' && !cfg.tasteNoStrike) { negAdd(i, p.a, day); if (it.via >= 0 && it.via !== p.a) negAdd(i, it.via, day) }
          else if (cfg.sinkLearn && cfg.tasteStrikeViaOnly && it.ch === 'cont' && it.via >= 0 && it.via !== p.a) negAdd(i, it.via, day)
        } else if (rnd() < 0.8) actOn(u, p, day, true, loc[i])
      }
    }
    // spammer veterano: bom comportamento 3 semanas, depois spam diário
    if (spammer) { lastActive[spammer.idx] = day; if (day < 21) { if (rnd() < 0.3) newPost(spammer, day, 0) } else newPost(spammer, day, 0, true) }
    // fazenda: dono posta spam diário; 2000 chaves dão DRIFT, cada uma "em" uma cidade
    if (farmer && day >= cfg.farmStart) {
      const sp = newPost(farmer, day, loc[farmer.idx], true)
      for (const f of farm) if (!cfg.farmRot || rnd() < cfg.farmRot) actOn(f, sp, day, true, loc[f.idx])
      // fazenda adaptada ao v5: contas postam isca (conteúdo bom) para ganhar DRIFT de quem as segue
      if (cfg.farmContent) for (const f of farm) if (rnd() < cfg.farmContent) newPost(f, day, loc[f.idx], false, true)
      if (cfg.farmSpamDirect && day >= (cfg.farmSpamFrom ?? 0)) for (const f of farm) if (rnd() < cfg.farmSpamDirect) newPost(f, day, loc[f.idx], true)
      // fazendeiro adaptado ao aval: posta isca para os enganados darem DRIFT nele; a fazenda impulsiona tudo
      if (cfg.farmerBait && rnd() < cfg.farmerBait) { const b = newPost(farmer, day, loc[farmer.idx], false, true); for (const f of farm) actOn(f, b, day, true, loc[f.idx]) }
      // camuflagem contra o lockstep: cada conta dá DRIFT em posts honestos aleatórios para diversificar o histórico
      if (cfg.farmCamo) {
        const pool = []
        for (let k = posts.length - 1; k >= 0 && posts[k].day >= day - 2; k--) if (!posts[k].spam && !posts[k].atk && !posts[k].bait) pool.push(k)
        if (pool.length) for (const f of farm) for (let c = 0; c < cfg.farmCamo; c++) actOn(f, posts[pool[Math.floor(rnd() * pool.length)]], day, true, loc[f.idx])
      }
    }
    // fazenda paciente: antes de atacar, camufla o histórico com DRIFTs em posts honestos
    if (cfg.farmCamo && cfg.farmJoin !== undefined && day >= cfg.farmJoin && day < cfg.farmStart) {
      const pool = []
      for (let k = posts.length - 1; k >= 0 && posts[k].day >= day - 2; k--) if (!posts[k].spam && !posts[k].atk && !posts[k].bait) pool.push(k)
      if (pool.length) for (const f of farm) for (let c = 0; c < cfg.farmCamo; c++) actOn(f, posts[pool[Math.floor(rnd() * pool.length)]], day, true, loc[f.idx])
    }
    // brigada: 300 chaves endossam 3 concentradores; toda semana denunciam o post honesto mais visto
    if (conc.length && day >= 14) {
      if (day === 14) { for (const c of conc) newPost(c, day, -1); const cp = postsBy[conc[0].idx].concat(postsBy[conc[1].idx], postsBy[conc[2].idx]); feeders.forEach((f, i) => actOn(f, posts[cp[i % 3]], day, true, -1)) }
      for (const c of conc) lastActive[c.idx] = day
      for (const f of feeders) lastActive[f.idx] = day
      if (day % 7 === 0) {
        let best = -1, bestN = -1
        for (const [pi, set] of reach) { const p = posts[pi]; if (p.spam || p.atk || day - p.day > 7) continue; if (set.size > bestN) { bestN = set.size; best = pi } }
        if (model === 'global' && gTop.length) { const h = gTop.find((x) => !posts[x.pi].spam && !posts[x.pi].atk); if (h) best = h.pi }
        if (best >= 0) { victims.push(best); for (const c of conc) report(c, posts[best], day, 'illegal'); for (let i = 0; i < 50; i++) report(feeders[i], posts[best], day, 'illegal') }
      }
    }
    if (model === 'global' && (day + 1) % STEP === 0) recomputeGlobal(day)

    if ((day + 1) % STEP !== 0) continue
    // ── Medição (todas as pessoas reais que já entraram) ──────────
    const chan = { dir: 0, cont: 0, ambK: 0, ambU: 0, top: 0 }
    let n = 0, withAtk = 0, atkShare = 0, poro = 0, empty = 0, hiddenVictimViewers = 0
    let honSum = 0, honEmpty = 0, farmC2 = 0, honHid = 0, honHidN = 0
    let zeroed = 0, edges = 0
    if (cfg.sinkLearn) for (let v = 0; v < NH; v++) { if (!joined(U[v], day)) continue; for (const u of fol[v]) { if (u >= NH) continue; edges++; if (negK(v, u, day) > 0 && tie(v, u, day) === 0) zeroed++ } }
    const tStart = Date.now()
    let lockFP = 0, lockHon = 0, lockTP = 0, lockFarm = 0
    if (cfg.lockstep && lwDay === day) for (const [key, w] of lwCache) { const u = key % N; if (u < NH) { lockHon++; if (w < 10) lockFP++ } else if (U[u].kind === 'fazenda') { lockFarm++; if (w < 10) lockTP++ } }
    let mutedHonest = 0, labeledHonest = 0, eclN = 0, eclAtk = 0, nonN = 0, nonAtk = 0
    if (LAB && LAB.bad >= LAB.need) for (let v = 0; v < NH; v++) if (badLabel(v)) labeledHonest++
    if (cfg.sinkLearn) for (let v = 0; v < NH; v++) for (const [u] of neg[v]) if (u < NH && negK(v, u, day) >= 2) mutedHonest++
    const vloc = new Int8Array(NH), vflag = new Uint8Array(NH)
    const frameFeeds = []
    for (let i = 0; i < NH; i++) {
      const u = U[i]
      vloc[i] = loc[i]
      if (!joined(u, day)) continue
      let f = 1
      if (loc[i] !== u.home) f |= 8
      n++
      const st = { quarHidden: 0, vacHidden: 0 }
      const res = model === 'contagio' ? feedContagion(i, day, { stat: st }) : { feed: gTop, hidden: null }
      if (st.quarHidden + st.vacHidden > 0) honHid++
      honHidN += st.quarHidden + st.vacHidden
      const feed = res.feed
      frameFeeds.push([i, feed])
      if (feed.length < 3) empty++
      let a = 0, other = 0, hon = 0
      { let fc = 0; for (const [cu] of contacts(i, day)) if (U[cu].kind === 'fazenda' && U[cu].id !== 'fazendeiro') fc++; if (fc >= 2) farmC2++ }
      for (const it of feed) {
        const p = posts[it.pi]
        if (!p.spam && !p.atk) hon++
        if (p.spam || p.atk) { a++; chan[it.ch || 'top']++ }
        const home = U[p.a].home
        if (home >= 0 && home !== u.home) other++
        let set = reach.get(it.pi); if (!set) reach.set(it.pi, (set = new Set())); set.add(i)
        let cs = reachCities.get(it.pi); if (!cs) reachCities.set(it.pi, (cs = new Set())); cs.add(u.home)
      }
      honSum += hon; if (hon === 0) honEmpty++
      if (a) { withAtk++; f |= 2 }
      if (ECLK) { if (eclArr[i]) { eclN++; if (a) eclAtk++ } else { nonN++; if (a) nonAtk++ } }
      atkShare += feed.length ? a / feed.length : 0
      poro += feed.length ? other / feed.length : 0
      if (res.hidden) for (const vp of victims) if ((res.hidden.get(vp) || 0) >= 10) { hiddenVictimViewers++; break }
      vflag[i] = f
    }
    // melhor post honesto da última semana
    let best = -1, bestN = 0
    for (const [pi, set] of reach) { const p = posts[pi]; if (p.spam || p.atk || day - p.day > 7) continue; if (set.size > bestN) { bestN = set.size; best = pi } }
    if (best >= 0) for (const [i, feed] of frameFeeds) if (feed.some((x) => x.pi === best)) vflag[i] |= 4
    // brigada: quantos posts-alvo ficaram escondidos
    let victimsHidden = 0
    if (model === 'global' && gOut) victimsHidden = victims.filter((pi) => gOut.posts.get(posts[pi].id)?.moderated).length
    else victimsHidden = hiddenVictimViewers > 0 ? 1 : 0
    // determinismo (contágio): 40 pessoas, contatos em ordem embaralhada
    let det = -1
    if (model === 'contagio' && frames.length % 4 === 0) {
      det = 0
      const r2 = mkRng(day * 7919)
      for (let k = 0; k < 40; k++) {
        const v = Math.floor(r2() * NH); if (!joined(U[v], day)) continue
        const a = feedContagion(v, day).feed.map((x) => x.pi).join(','), b = feedContagion(v, day, { shuffle: true, r: r2 }).feed.map((x) => x.pi).join(',')
        if (a !== b) det++
      }
    }
    const fr = {
      day: day + 1, n, ms: Date.now() - tStart,
      m: { honHid: honHid / n, honHidN: honHidN / n, honLen: honSum / n, honEmpty: honEmpty / n, farmC2: farmC2 / n, zeroed: edges ? zeroed / edges : 0,
        withAtk: withAtk / n, atkShare: atkShare / n, poro: poro / n, empty: empty / n,
        reach: bestN / n, reachCities: best >= 0 ? reachCities.get(best).size : 0,
        victims: victims.length, victimsHidden, hiddenViewers: hiddenVictimViewers, det,
        cut: cut.reduce((s, x) => s + x.size, 0), deceived: deceived.length, followBacks, lockFP, lockHon, lockTP, lockFarm, mutedHonest, labeledHonest, atkEcl: eclN ? eclAtk / eclN : 0, atkNon: nonN ? nonAtk / nonN : 0, chan },
      loc: vloc, flag: vflag, best,
    }
    frames.push(fr)
    onFrame && onFrame(fr)
  }
  return { frames, users: U.slice(0, NH).map((u) => [u.home, u.pend, u.join]) }
}

module.exports = { runModel, CITIES }
