// SpreadMap network mode — LOCK_VIA_TEST conformance.
//
// Source: Satoshi+Ted maps audit 2026-05-21. Modo `network` adicionado
// pra fechar gap semântico (user pensava que "global" era "minha rede"
// mas é agregação global). Network filtra spreads por follows do user.
//
// Cobre:
//   1. Type `SpreadMapMode` declarado e usado consistentemente
//   2. SQL `network` faz IN (SELECT following_pub FROM follows WHERE follower_pub = ?)
//   3. SQL `network` NÃO toca em lens_edges, posts.score, reports (scope-limited)
//   4. UI ModeToggle tem 3 botões (post + global + network)
//   5. ModeBtn `network` é disabled quando anônimo
//   6. Empty states distintos (anônimo / sem follows / sem GPS na rede)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HOOK = readFileSync('src/hooks/useSpreadMap.ts', 'utf8')
const MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

describe('SpreadMap — lente SÓ no network (§24, deliberação 2026-05-30)', () => {
  it('lensShowInMap é gateado por mode === network (não pinta global/post)', () => {
    // §24: a lente (PPR colors) só tinge a MINHA WoT (network). global/post
    // são canônicos/compartilhados → nunca personalizados pela lente. O gate
    // combina a pref com o modo.
    expect(MAP).toMatch(/lens_show_in_map/)
    expect(MAP).toMatch(/lensShowInMap\s*=\s*lensShowInMapPref\s*&&\s*mode === 'network'/)
  })

  it('getFillColor da lente usa o valor GATEADO (não a pref crua)', () => {
    // pinColor(ppr) só quando lensShowInMap (já = pref && network).
    expect(MAP).toMatch(/getFillColor:\s*lensShowInMap/)
    // a pref crua não pode ser usada direto no getFillColor (furaria §24).
    expect(MAP).not.toMatch(/getFillColor:\s*lensShowInMapPref/)
  })
})

describe('SpreadMap network mode — type system', () => {
  it('declares SpreadMapMode type with 3 values', () => {
    expect(HOOK).toMatch(
      /export type SpreadMapMode\s*=\s*'post'\s*\|\s*'global'\s*\|\s*'network'/,
    )
  })

  it('SpreadMap.tsx importa SpreadMapMode (não declara inline)', () => {
    expect(MAP).toMatch(
      /import\s*\{[^}]*SpreadMapMode[^}]*\}\s*from\s*['"][^'"]*useSpreadMap['"]/,
    )
    // Não deve ter type literal 'post' | 'global' inline (single SoT)
    expect(MAP).not.toMatch(/'post'\s*\|\s*'global'\s*\|\s*'network'/)
  })
})

describe('SpreadMap network mode — SQL scope (Satoshi)', () => {
  it('buildNetworkData query usa IN (SELECT following_pub FROM follows)', () => {
    expect(HOOK).toMatch(
      /spreader_pub\s+IN\s*\(\s*SELECT\s+following_pub\s+FROM\s+follows\s+WHERE\s+follower_pub\s*=\s*\?\s*\)/,
    )
  })

  it('buildNetworkData NÃO faz JOIN com lens_edges (scope-limited)', () => {
    const match = HOOK.match(
      /async function buildNetworkData[\s\S]*?^}/m,
    )
    expect(match, 'buildNetworkData function not found').not.toBeNull()
    const body = match![0]
    expect(body, 'NÃO pode tocar em lens_edges').not.toMatch(/lens_edges/)
    expect(body, 'NÃO pode tocar em posts.score').not.toMatch(/p\.score|posts\.score/)
    expect(body, 'NÃO pode tocar em reports').not.toMatch(/\bFROM\s+reports\b/)
  })

  it('buildNetworkData usa LIMIT 2000 (mesmo cap do global)', () => {
    const match = HOOK.match(
      /async function buildNetworkData[\s\S]*?^}/m,
    )
    expect(match![0]).toMatch(/LIMIT\s+2000/)
  })
})

describe('SpreadMap network mode — hook signature', () => {
  it('useSpreadMap aceita 3 modes', () => {
    expect(HOOK).toMatch(/mode:\s*SpreadMapMode\s*=\s*'post'/)
  })

  it('hook re-fetch on followsVersion change (network reflete state atual)', () => {
    expect(HOOK).toMatch(/followsVersion/)
    expect(HOOK).toMatch(/useFollowsStore.*following\.size/)
  })

  it('hook retorna empty pra mode network sem activeNpub (anônimo)', () => {
    expect(HOOK).toMatch(
      /mode\s*===\s*'network'\s*&&\s*!activeNpub/,
    )
  })
})

describe('SpreadMap network mode — UI ModeToggle', () => {
  it('ModeToggle renderiza 3 ModeBtn', () => {
    // Captura ModeToggle até começar próxima `function ` declaration
    const toggleMatch = MAP.match(/function ModeToggle[\s\S]*?(?=\nfunction )/m)
    expect(toggleMatch).not.toBeNull()
    const body = toggleMatch![0]
    expect(body).toMatch(/onModeChange\('post'\)/)
    expect(body).toMatch(/onModeChange\('global'\)/)
    expect(body).toMatch(/onModeChange\('network'\)/)
  })

  it('ModeBtn network é disabled quando !activeNpub', () => {
    const toggleMatch = MAP.match(/function ModeToggle[\s\S]*?(?=\nfunction )/m)
    expect(toggleMatch![0]).toMatch(/networkDisabled\s*=\s*!activeNpub/)
    expect(toggleMatch![0]).toMatch(/disabled=\{networkDisabled\}/)
  })

  it('ModeBtn suporta prop disabled + title (a11y)', () => {
    expect(MAP).toMatch(/disabled\?:\s*boolean/)
    expect(MAP).toMatch(/title\?:\s*string/)
    expect(MAP).toMatch(/aria-pressed=\{active\}/)
  })
})

describe('SpreadMap WoT colors opt-in (Satoshi+Ted plan D)', () => {
  it('pinColor é função pura — 4-tier discreto', async () => {
    const { pinColor, PIN_COLOR_DEFAULT } = await import('../src/lib/trust/map-color')
    // undefined → default (sem edge)
    expect(pinColor(undefined)).toEqual(PIN_COLOR_DEFAULT)
    // 0/negativo → default (proteção)
    expect(pinColor(0)).toEqual(PIN_COLOR_DEFAULT)
    expect(pinColor(-0.5)).toEqual(PIN_COLOR_DEFAULT)
    expect(pinColor(NaN)).toEqual(PIN_COLOR_DEFAULT)
    // < 0.3 → low blue
    expect(pinColor(0.1)).toEqual([100, 150, 180, 180])
    expect(pinColor(0.29)).toEqual([100, 150, 180, 180])
    // 0.3-0.7 → mid yellow
    expect(pinColor(0.3)).toEqual([200, 180, 80, 200])
    expect(pinColor(0.5)).toEqual([200, 180, 80, 200])
    expect(pinColor(0.69)).toEqual([200, 180, 80, 200])
    // ≥ 0.7 → high orange
    expect(pinColor(0.7)).toEqual([244, 130, 14, 220])
    expect(pinColor(1.0)).toEqual([244, 130, 14, 220])
  })

  it('pinColor determinístico — mesmo input → mesmo output', async () => {
    const { pinColor } = await import('../src/lib/trust/map-color')
    const out1 = pinColor(0.45)
    const out2 = pinColor(0.45)
    expect(out1).toEqual(out2)
  })

  it('UserPrefs declara lens_show_in_map default false', () => {
    const types = readFileSync('src/types/drift.ts', 'utf8')
    expect(types).toMatch(/lens_show_in_map:\s*boolean/)
    expect(types).toMatch(/lens_show_in_map:\s*false/)
  })

  it('prefs.ts deserialize case lens_show_in_map', () => {
    const prefs = readFileSync('src/lib/prefs.ts', 'utf8')
    expect(prefs).toMatch(/case 'lens_show_in_map'/)
    expect(prefs).toMatch(/target\.lens_show_in_map\s*=\s*value === '1'/)
  })

  it('SpreadMap importa pinColor + usa em getFillColor condicional', () => {
    expect(MAP).toMatch(/import\s*\{[^}]*pinColor[^}]*\}/)
    expect(MAP).toMatch(/lensShowInMap\s*\?\s*\(d:.*\)\s*=>\s*pinColor/)
  })

  it('SuaLenteCard tem MapColorsToggle (3º toggle isActive)', () => {
    const card = readFileSync('src/components/Settings/SuaLenteCard.tsx', 'utf8')
    expect(card).toMatch(/MapColorsToggle/)
    expect(card).toMatch(/setPref\('lens_show_in_map'/)
  })

  it('social-nodes layer passa npub no data (pra pinColor lookup)', () => {
    expect(MAP).toMatch(/npub:\s*n\.npub/)
  })
})

describe('SpreadMap global como rede social geográfica (Satoshi+Ted plan E)', () => {
  it('SpreadMapData declara field `nodes: GlobalNode[]`', () => {
    const types = readFileSync('src/types/drift.ts', 'utf8')
    expect(types).toMatch(/export interface GlobalNode/)
    expect(types).toMatch(/npub:\s*string/)
    expect(types).toMatch(/spreadCount:\s*number/)
    expect(types).toMatch(/nodes:\s*GlobalNode\[\]/)
  })

  it('buildGlobalNodes dedupa por spreader_pub + sort desc por count', () => {
    expect(HOOK).toMatch(/function buildGlobalNodes/)
    expect(HOOK).toMatch(/seen\.set\(npub/)
    expect(HOOK).toMatch(/existing\.spreadCount\s*\+=\s*1/)
    expect(HOOK).toMatch(/sort\(\(a,\s*b\)\s*=>\s*b\.spreadCount\s*-\s*a\.spreadCount\)/)
  })

  it('SELECT global/network inclui spreader_pub na query', () => {
    // VirtualArcRow precisa expor spreader_pub
    expect(HOOK).toMatch(/spreader_pub:\s*string/)
    expect(HOOK).toMatch(/s\.spreader_pub\s+AS\s+spreader_pub/)
  })

  it('buildPostData retorna nodes: [] (dedup não faz sentido em post único)', () => {
    const postMatch = HOOK.match(/async function buildPostData[\s\S]*?(?=\n\/\/)/m)
    expect(postMatch).not.toBeNull()
    expect(postMatch![0]).toMatch(/nodes:\s*\[\]/)
  })

  it('GlobalModeMap renderiza ScatterplotLayer social-nodes', () => {
    expect(MAP).toMatch(/id:\s*['"]social-nodes['"]/)
    expect(MAP).toMatch(/Math\.sqrt\(d\.count\)/)
    expect(MAP).toMatch(/socialNodes\.length\s*>\s*0/)
  })

  it('stats label mostra "N pessoas" quando há nodes dedupados', () => {
    expect(MAP).toMatch(/data\.nodes\.length === 1 \? 'pessoa' : 'pessoas'/)
  })
})

describe('SpreadMap K=1 doxx defense (Satoshi devsec C 2026-05-21)', () => {
  it('hook exporta isUserSoloSpreader pure helper', () => {
    expect(HOOK).toMatch(/export function isUserSoloSpreader\b/)
  })

  it('helper retorna false quando activeNpub null (anônimo)', () => {
    // Pattern check: precisa de early return pra !activeNpub
    expect(HOOK).toMatch(/if\s*\(\s*!activeNpub\s*\|\|\s*!data\s*\)\s*return false/)
  })

  it('helper checa totalSpreads === 1 + firstSpread.spreaderPub', () => {
    expect(HOOK).toMatch(/data\.totalSpreads\s*!==\s*1/)
    expect(HOOK).toMatch(/data\.firstSpread\?\.spreaderPub\s*===\s*activeNpub/)
  })

  it('SpreadMap renderiza SoloSpreaderWarning quando trigger ativo', () => {
    expect(MAP).toMatch(/import\s*\{[^}]*isUserSoloSpreader[^}]*\}/)
    expect(MAP).toMatch(/function SoloSpreaderWarning/)
    expect(MAP).toMatch(/showK1Warning\s*=\s*isUserSoloSpreader/)
  })

  it('Warning é dismissable via session state (useState, não persisted)', () => {
    expect(MAP).toMatch(/k1WarningDismissed.*useState\(false\)|useState<.*>\(false\)/)
    expect(MAP).toMatch(/setK1WarningDismissed\(true\)/)
  })

  it('Warning aparece APENAS em PostModeMap (não global/network)', () => {
    // GlobalModeMap não chama SoloSpreaderWarning nem usa
    // isUserSoloSpreader — só PostModeMap (modo onde K=1 faz sentido)
    const globalMatch = MAP.match(/function GlobalModeMap[\s\S]*?(?=\nfunction )/m)
    expect(globalMatch).not.toBeNull()
    expect(globalMatch![0]).not.toMatch(/SoloSpreaderWarning|isUserSoloSpreader/)
  })

  it('threat-model-maps.md existe + cobre 5 vetores', () => {
    const doc = readFileSync('Docs/threat-model-maps.md', 'utf8')
    expect(doc).toMatch(/K=1.*doxx|K=1-DOXX/i)
    expect(doc).toMatch(/Location disclosure|LD/i)
    expect(doc).toMatch(/Relay correlation|RC/i)
    expect(doc).toMatch(/Follow-graph leak/i)
    expect(doc).toMatch(/Trust coloration/i)
  })
})

describe('SpreadMap DRY — loadMapDeps shared (B refactor 2026-05-21)', () => {
  const DEPS = readFileSync('src/components/Feed/useMapDeps.ts', 'utf8')

  it('useMapDeps.ts exporta loadMapDeps async', () => {
    expect(DEPS).toMatch(/export async function loadMapDeps\(\)/)
  })

  it('loadMapDeps faz Promise.all dos 3 imports (maplibre + deck + layers)', () => {
    expect(DEPS).toMatch(/import\(['"]maplibre-gl['"]\)/)
    expect(DEPS).toMatch(/import\(['"]@deck\.gl\/mapbox['"]\)/)
    expect(DEPS).toMatch(/import\(['"]\.\/spreadMapLayers['"]\)/)
  })

  it('SpreadMap consome loadMapDeps via useMapInstance OU await direto (sem duplicar imports)', () => {
    // Ted refactor B 2026-05-22: PostModeMap migrou pra useMapInstance
    // (que internamente chama loadMapDeps). GlobalModeMap mantém await
    // direto (animation loop tem ciclo próprio). Total = 1 direct + 1
    // via hook.
    const HOOK = readFileSync('src/components/Feed/useMapInstance.ts', 'utf8')
    const directCalls = MAP.match(/await loadMapDeps\(\)/g) ?? []
    const hookCalls = HOOK.match(/await loadMapDeps\(\)/g) ?? []
    expect(directCalls.length + hookCalls.length).toBeGreaterThanOrEqual(2)
    // SpreadMap importa useMapInstance (refactor #1 Ted)
    expect(MAP).toMatch(/from\s+'\.\/useMapInstance'/)
    // SpreadMap NÃO pode importar maplibre-gl direto (ficou em useMapDeps)
    expect(MAP).not.toMatch(/import\(['"]maplibre-gl['"]\)/)
  })
})

describe('Stats deemphasis (Satoshi A3 2026-05-22)', () => {
  it('stats badge usa text-[10px] + text-drift-muted/60 (deemphasis)', () => {
    // LOCK_VIA_TEST Gap #1 audit: número agregado perde primacy visual.
    expect(MAP).toMatch(/text-\[10px\][^"]*text-drift-muted\/60/)
  })
})

describe('Mode badge REMOVIDO (user 2026-05-29: toast ruído)', () => {
  // Histórico: o badge "modo: este post/sua rede/rede inteira" foi um toast
  // transiente (2s) que aparecia ao trocar de modo no mapa. Passou por várias
  // iterações de posicionamento (V-4/V-5/V-6, centro do mapa) pra não colidir
  // com controles. User decidiu removê-lo de vez: o ModeToggle (POST/GLOBAL/
  // NETWORK) já mostra o modo ativo via estado visual selecionado — o toast
  // era redundante. Estes testes garantem que ele não volte a existir.

  it('SpreadMap não declara badgeMode/setBadgeMode (estado morto removido)', () => {
    expect(MAP).not.toMatch(/badgeMode/)
    expect(MAP).not.toMatch(/setBadgeMode/)
  })

  it('SpreadMap não tem prevModeRef nem SAFE TOAST ZONE (badge effect removido)', () => {
    expect(MAP).not.toMatch(/prevModeRef/)
    expect(MAP).not.toMatch(/SAFE TOAST ZONE/)
    expect(MAP).not.toMatch(/initialModeRef/)
  })

  it('topo limpo: ModeToggle é o único controle top-left (badge não compete)', () => {
    // ModeToggle ancora em top-3 left-3 (controle permanente). Garante que
    // nenhum toast transiente reintroduz top-3 left-1/2 (centro do topo).
    expect(MAP).not.toMatch(/left-1\/2 top-3/)
    expect(MAP).not.toMatch(/top-3 left-1\/2/)
  })
})

describe('MapOverlay default mode (Satoshi A1 2026-05-22)', () => {
  it('App.tsx MapOverlay default mapMode = "global" (não "post")', () => {
    const APP = readFileSync('src/App.tsx', 'utf8')
    // LOCK_VIA_TEST: NavBar entry-point sempre abre em modo agregado.
    // Mini-map embedded no PostViewer continua `post` (não passa mode prop).
    expect(APP).toMatch(/useState<SpreadMapMode>\(['"]global['"]\)/)
  })
})

describe('SpreadMap network mode — empty states', () => {
  it('network + anônimo: placeholder "modo rede desativado"', () => {
    expect(MAP).toMatch(/modo rede desativado/)
  })

  it('network + sem follows: placeholder "sua rede está vazia"', () => {
    expect(MAP).toMatch(/sua rede está vazia/)
  })

  it('network + follows mas sem GPS: placeholder específico', () => {
    expect(MAP).toMatch(/sua rede sem GPS por enquanto/)
  })

  it('PostMode + global mode: copy original preservada (zero regression)', () => {
    // Backward compat — defesa contra regressão em modos existentes
    expect(MAP).toMatch(/sem dados de localização globais/)
    expect(MAP).toMatch(/GPS desativado nas suas configurações/)
  })
})

describe('MapOverlay — título dinâmico (item #6 fricção iniciante)', () => {
  // LOCK_VIA_TEST 2026-05-25 — header do MapOverlay deve refletir aba
  // ativa em vocabulário user-facing 'mapa · <contexto>'. Antes: header
  // estático 'propagação' enquanto nav dizia 'MAPA' e abas internas
  // POST/GLOBAL/NETWORK — 3 nomenclaturas pra mesma feature, user
  // iniciante perdia o mental model.
  const APP = readFileSync('src/App.tsx', 'utf8')

  it('MapOverlay computa title dinâmico baseado em mapMode', () => {
    // Pattern: const mapTitle = mapMode === 'post' ? 'mapa · este post' : …
    expect(APP).toMatch(/mapa\s*·\s*este post/)
    expect(APP).toMatch(/mapa\s*·\s*sua rede/)
    expect(APP).toMatch(/mapa\s*·\s*global/)
  })

  it('MapOverlay NÃO usa mais título estático "propagação" como header', () => {
    // Allowlist: aria-label e comments podem mencionar propagação;
    // mas title prop do FullPageCard deve ser dinâmico.
    expect(APP).not.toMatch(/title="propagação"/)
  })

  it('FullPageCard recebe title={mapTitle} no MapOverlay', () => {
    expect(APP).toMatch(/title=\{mapTitle\}/)
  })
})

describe('MapOverlay — headerRight sem counter EV (user feedback 2026-05-26)', () => {
  // LOCK_VIA_TEST 2026-05-26 — counter 'ev' no headerRight era ruído
  // no contexto do mapa (header global do app já exibe). Diluía FECHAR
  // como ação primária. headerRight agora é só o botão fechar.
  const APP = readFileSync('src/App.tsx', 'utf8')

  it('MapOverlay headerRight NÃO contém o counter eventsReceived', () => {
    const overlayMatch = APP.match(/function MapOverlay\([\s\S]*?(?=\n\/\/\s*─)/m)
    expect(overlayMatch, 'MapOverlay function not found').not.toBeNull()
    const body = overlayMatch![0]
    // Defesa contra regressão: events.toLocaleString não pode reaparecer
    // dentro do MapOverlay (era o pattern do counter removido).
    expect(body).not.toMatch(/events\.toLocaleString/)
    // Defesa léxica: sufixo ' ev' no headerRight literal era a string
    // user-facing — não pode voltar dentro de MapOverlay.
    expect(body).not.toMatch(/\}\s*ev\s*</)
  })

  it('MapOverlay headerRight = botão "?" (legenda) + FECHAR (user 2026-05-29)', () => {
    // O counter 'ev' continua removido (test acima). headerRight agora tem
    // 2 ações: "?" abre o MapExplainerCard (legenda visível, antes só via
    // long-press 3s) + FECHAR. NÃO pode reintroduzir o counter de eventos.
    const overlayMatch = APP.match(/function MapOverlay\([\s\S]*?(?=\n\/\/\s*─)/m)
    const body = overlayMatch![0]
    // botão de legenda: abre o explainer.
    expect(body).toMatch(/setShowExplainer\(true\)/)
    expect(body).toMatch(/aria-label="legenda do mapa/)
    // explainer renderizado no contexto do modo ativo.
    expect(body).toMatch(/<MapExplainerCard context=\{mapMode\}/)
    // FECHAR continua presente como ação primária.
    expect(body).toMatch(/aria-label="fechar mapa"/)
  })
})
