/**
 * P2P/WebRTC idle — LOCK_VIA_TEST consolidado (Lily/Marshall/Satoshi audit
 * convergente, 2026-05-23).
 *
 * Origem:
 * - `Docs/sessions/lily-p2p-idle-audit-2026-05-23.md` (Lily, runtime).
 * - Convergência tripla com Marshall (schema/conformance) e Satoshi
 *   (privacy/game-theory) sobre 3 quick wins implementadas + 1 lista
 *   de APIs proibidas (Satoshi NO-GO §17).
 *
 * O que este teste protege:
 *
 * (1) FORBIDDEN APIs em `src/lib/transport/webrtc/**` — Satoshi NO-GO §17:
 *     vendor decides "what's idle/active/charging" = chave-mestra
 *     disfarçada. NetworkInformation API (`navigator.connection`), Battery
 *     API (`navigator.getBattery`), Idle Detection API (`IdleDetector`,
 *     `permissions.query({name:'idle-detection'})`) são proibidos no
 *     cliente oficial Drift. Idle policy precisa ser puramente local,
 *     baseada em fatos observáveis sem cooperação de plataforma.
 *
 * (2) OK APIs explicitamente whitelisted — `document.hidden` e
 *     `visibilitychange` são DOM core sem permission e observáveis
 *     localmente; podem ser usadas. Este sub-teste apenas DOCUMENTA o
 *     contrato (não falha se ausentes — só falha se forbidden estiverem).
 *
 * (3) QW1 — `healthTimer` early-return quando `peerCount() === 0`.
 *     Audit Lily §5.QW1: timer rodava 4×/min queimando ~240 ticks
 *     vazios/h em uso solo. O guard preserva o setInterval (reativação
 *     imediata quando peer aparece) mas faz no-op zero-cost.
 *
 * (4) QW3 — `lastRateWarnAt` cleanup em paths não-tripped.
 *     Audit Lily §5.QW3: Map module-scoped só era limpo no caso
 *     `tripped`. Cleanup paths adicionais (ICE timeout, cross-proto kill,
 *     pagehide → closeAll → cleanupPeer, bye signaling) compartilham o
 *     mesmo helper `_cleanupRateState` chamado em `cleanupPeer`.
 *
 * (5) QW2 — `subscribe()` NÃO boota signaling em modo mock.
 *     Audit Lily §5.QW2 / L2: orchestrator chamava `subscribe()` no
 *     `startSync`, bootando BroadcastChannel + healthTimer +
 *     randomWalkTimer + pagehide listener mesmo sem peer jamais conectar.
 *     Gate `useNostrSignaling()` em `subscribe` mantém boot eager só pro
 *     modo Nostr (uso real). Reativação reativa via publish/connectTo.
 *
 * Manifesto: §15 (anti-censura preserved — capacidade técnica intacta),
 * §16 (disponibilidade preserved — seeding só vale com peer conectado),
 * §17 (sem chave-mestra disfarçada — sem vendor APIs).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const WEBRTC_DIR = join(ROOT, 'src', 'lib', 'transport', 'webrtc')

/** Strip JS/TS comments (line + block) — best-effort. Necessário porque
 *  comments têm dezenas de menções a "navigator", "battery", etc.,
 *  como referência textual ao manifesto/audits. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, (_m, prefix) => prefix)
}

function findTsFiles(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

// ─── (1) Forbidden APIs — Satoshi NO-GO §17 ──────────────────────────

/** APIs cuja semântica delega a "user is active/idle/connected/charging"
 *  para o vendor (browser/OS). Cada uma é vetor de chave-mestra
 *  disfarçada: o operador da API decide o estado, não o user.
 *
 *  - NetworkInformation (`navigator.connection`): browser reporta
 *    "effective network type". Em uma região onde a operadora marca
 *    todo Drift como "slow-2g", browser entrega esse sinal e cliente
 *    pode silenciosamente degradar features P2P.
 *  - Battery API (`navigator.getBattery`): vendor decide "low battery"
 *    threshold. Pior: API removida por privacy (fingerprinting); usar
 *    seria regressão.
 *  - IdleDetector (`IdleDetector` constructor / `permissions.query({
 *    name:'idle-detection' })`): requer permission do user E vendor
 *    define "idle" (sem mouse/keyboard por N min — pode ser disabled
 *    por OS configuration). */
const FORBIDDEN_PATTERNS: { name: string; re: RegExp; reason: string }[] = [
  {
    name: 'NetworkInformation API',
    re: /\bnavigator\s*\.\s*connection\b/,
    reason:
      'NetworkInformation API delega decisão de "qualidade de rede" ao vendor — chave-mestra disfarçada §17. Use métricas locais (relay health, peer RTT) que NÓS observamos.',
  },
  {
    name: 'Battery API (getBattery)',
    re: /\bnavigator\s*\.\s*getBattery\s*\(/,
    reason:
      'Battery API foi removida por privacy (fingerprinting). Vendor decide "low battery" threshold — §17. Idle policy P2P não pode depender disso.',
  },
  {
    name: 'IdleDetector constructor',
    re: /\bnew\s+IdleDetector\s*\(/,
    reason:
      'IdleDetector requer permission + vendor define "idle". Substituível por estado local (peerCount, lastActivityAt) que controlamos — §17.',
  },
  {
    name: 'IdleDetector reference',
    re: /\bIdleDetector\s*\./,
    reason:
      'Referência estática ao IdleDetector (e.g. `IdleDetector.requestPermission`) — proibido §17.',
  },
  {
    name: 'permissions.query idle-detection',
    re: /['"`]idle-detection['"`]/,
    reason:
      'Query a permission idle-detection indica intent de usar IdleDetector — proibido §17.',
  },
]

// ─── (2) OK APIs whitelisted (documentação contratual, não falha) ────

/** APIs DOM core SEM permission e observáveis localmente. Documentadas
 *  pra clareza: podem ser usadas se idle/visibility policy P2P precisar.
 *  Não falhamos se ausentes (decisão de design pode preferir não usar). */
const OK_APIS = ['document.hidden', 'visibilitychange'] as const

// ─── (3-5) Quick wins guards ─────────────────────────────────────────

const HEALTH_FILE = join(WEBRTC_DIR, 'health.ts')
const RATELIMIT_FILE = join(WEBRTC_DIR, 'rateLimit.ts')
const PEER_FILE = join(WEBRTC_DIR, 'peer.ts')
const INDEX_FILE = join(WEBRTC_DIR, 'index.ts')

describe('P2P idle conformance — (1) Forbidden vendor-idle APIs (Satoshi NO-GO §17)', () => {
  it('nenhum arquivo em src/lib/transport/webrtc/** usa NetworkInformation/Battery/IdleDetector', () => {
    const files = findTsFiles(WEBRTC_DIR)
    const offenders: { file: string; line: number; text: string; pattern: string; reason: string }[] = []
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const { name, re, reason } of FORBIDDEN_PATTERNS) {
          if (re.test(line)) {
            offenders.push({
              file: file.replace(ROOT, '').replace(/\\/g, '/'),
              line: i + 1,
              text: line.trim().slice(0, 140),
              pattern: name,
              reason,
            })
          }
        }
      }
    }
    expect(
      offenders,
      `Vendor-idle API detectada em src/lib/transport/webrtc/**. ` +
        `Satoshi NO-GO §17 (chave-mestra disfarçada): idle policy P2P precisa ` +
        `ser puramente local. Hits:\n` +
        offenders
          .map((o) => `  ${o.file}:${o.line} [${o.pattern}]: ${o.text}\n    → ${o.reason}`)
          .join('\n'),
    ).toEqual([])
  })
})

describe('P2P idle conformance — (2) OK APIs whitelisted (contrato documental)', () => {
  // Este teste NÃO falha se as APIs estiverem ausentes. Apenas serve
  // como prova de existência caso alguém adicione no futuro — mantém
  // contrato visível de "estas APIs SÃO ok, navigator.connection NÃO é".
  it('lista canonical das APIs DOM permitidas pra idle/visibility policy P2P', () => {
    expect(OK_APIS).toContain('document.hidden')
    expect(OK_APIS).toContain('visibilitychange')
    // Se alguma vier a ser usada no webrtc/**, este test pode ser
    // estendido pra checar presença. Por ora, apenas documenta.
  })
})

describe('P2P idle conformance — (3) QW1: healthTimer guard peerCount===0', () => {
  it('health.ts importa `peerCount` de ./state', () => {
    const src = readFileSync(HEALTH_FILE, 'utf8')
    // Deve ter import de peerCount (junto com iterPeers)
    const importMatch = src.match(/import\s*\{[^}]*peerCount[^}]*\}\s*from\s*['"]\.\/state['"]/)
    expect(
      importMatch,
      `health.ts deve importar peerCount de ./state pro guard QW1. ` +
        `Audit Lily §5.QW1 (2026-05-23).`,
    ).not.toBeNull()
  })

  it('startHealthCheckTimer tem early-return quando peerCount() === 0', () => {
    const src = stripComments(readFileSync(HEALTH_FILE, 'utf8'))
    // Extrai corpo de startHealthCheckTimer
    const fnMatch = src.match(/export\s+function\s+startHealthCheckTimer\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)
    expect(fnMatch, 'startHealthCheckTimer não encontrado em health.ts').not.toBeNull()
    if (!fnMatch) return
    const body = fnMatch[1]
    // Deve ter `if (peerCount() === 0) return` (ou equivalente sintático)
    const hasGuard = /if\s*\(\s*peerCount\s*\(\s*\)\s*===\s*0\s*\)\s*return/.test(body)
    expect(
      hasGuard,
      `startHealthCheckTimer deve ter early-return \`if (peerCount() === 0) return\` ` +
        `dentro do callback do setInterval. Sem o guard, timer queima ~240 ticks/h ` +
        `vazios em uso solo (mock signaling sem peer same-origin). ` +
        `Audit Lily §5.QW1.`,
    ).toBe(true)
  })
})

describe('P2P idle conformance — (4) QW3: lastRateWarnAt cleanup paths', () => {
  it('rateLimit.ts expõe `_cleanupRateState` (helper público pro lifecycle peer.ts)', () => {
    const src = readFileSync(RATELIMIT_FILE, 'utf8')
    const hasHelper = /export\s+function\s+_cleanupRateState\s*\(/.test(src)
    expect(
      hasHelper,
      `rateLimit.ts deve exportar \`_cleanupRateState(peerId)\` pra cleanup ` +
        `cross-arquivo do Map module-scoped lastRateWarnAt. Audit Lily §5.QW3.`,
    ).toBe(true)
  })

  it('rateLimit.ts contém pelo menos 2 paths que chamam lastRateWarnAt.delete', () => {
    // Paths esperados:
    //   (a) caso `tripped` dentro de consumeRateBudget (já existia)
    //   (b) helper `_cleanupRateState` (QW3 novo)
    const src = stripComments(readFileSync(RATELIMIT_FILE, 'utf8'))
    const matches = src.match(/lastRateWarnAt\.delete\s*\(/g) ?? []
    expect(
      matches.length,
      `rateLimit.ts deve ter ≥2 call sites de lastRateWarnAt.delete: ` +
        `(a) caso tripped em consumeRateBudget, (b) _cleanupRateState. ` +
        `Atual: ${matches.length}. Audit Lily §5.QW3.`,
    ).toBeGreaterThanOrEqual(2)
  })

  it('peer.ts:cleanupPeer chama _cleanupRateState (cobre ICE timeout, cross-proto, pagehide, bye)', () => {
    const src = stripComments(readFileSync(PEER_FILE, 'utf8'))
    // Extrai corpo de cleanupPeer com matcher balanceado simples — a função
    // termina antes da próxima `export function` ou `// ─── separator.
    const fnStartIdx = src.search(/export\s+function\s+cleanupPeer\s*\(/)
    expect(fnStartIdx, 'cleanupPeer não encontrado em peer.ts').toBeGreaterThanOrEqual(0)
    if (fnStartIdx < 0) return
    // Pega ~80 linhas após o início; cleanupPeer tem ~30 linhas no source atual.
    const slice = src.slice(fnStartIdx, fnStartIdx + 3000)
    const fnMatch = slice.match(/^export\s+function\s+cleanupPeer\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/m)
    expect(fnMatch, 'corpo de cleanupPeer não pôde ser extraído').not.toBeNull()
    if (!fnMatch) return
    const body = fnMatch[1]
    // Padrão atual: lazy import pra evitar circular peer ↔ rateLimit.
    // Aceita tanto eager (`_cleanupRateState(remoteId)`) quanto lazy
    // (`import('./rateLimit').then(({ _cleanupRateState })`).
    const hasCleanupCall =
      /_cleanupRateState\s*\(/.test(body) || /import\s*\(\s*['"]\.\/rateLimit['"]\s*\)/.test(body)
    expect(
      hasCleanupCall,
      `cleanupPeer em peer.ts deve invocar _cleanupRateState (direto ou via ` +
        `lazy import de ./rateLimit). Sem isso, peers limpos via ICE timeout / ` +
        `cross-proto kill / pagehide / bye deixam entry pendurada no Map ` +
        `module-scoped lastRateWarnAt (leak monotônico em sessão longa). ` +
        `Audit Lily §5.QW3.`,
    ).toBe(true)
  })
})

describe('P2P idle conformance — (5) QW2: subscribe não boota signaling em modo mock', () => {
  it('index.ts:subscribe gate `useNostrSignaling()` antes de ensureSignalingAsync', () => {
    const src = stripComments(readFileSync(INDEX_FILE, 'utf8'))
    // Extrai corpo de subscribe
    const fnMatch = src.match(/function\s+subscribe\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)
    expect(fnMatch, 'subscribe não encontrado em index.ts').not.toBeNull()
    if (!fnMatch) return
    const body = fnMatch[1]
    // Deve haver gate `if (useNostrSignaling())` ou equivalente envolvendo
    // ensureSignalingAsync. Aceita variantes de espaços/parens.
    const hasGate = /if\s*\(\s*useNostrSignaling\s*\(\s*\)\s*\)/.test(body) &&
      /ensureSignalingAsync\s*\(/.test(body)
    expect(
      hasGate,
      `subscribe() em index.ts deve gatear ensureSignalingAsync() atrás de ` +
        `useNostrSignaling(). Sem gate, orchestrator chamando subscribe em ` +
        `startSync boota BroadcastChannel + healthTimer + randomWalkTimer + ` +
        `pagehide listener em modo mock mesmo sem peer jamais conectar. ` +
        `Audit Lily §5.QW2 / L2.`,
    ).toBe(true)
  })
})
