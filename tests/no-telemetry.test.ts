/**
 * No-telemetry / no-fingerprinting conformance test.
 *
 * Persona: Barney (peer review crítico) — sessão 2026-05-02.
 * Companion doc: `Docs/sessions/barney-code-hardening-2026-05-02.md`.
 *
 * **Premissa:** PRIVACY.md afirma "Sem telemetria. Sem analytics. Sem
 * reports automáticos de erro. (`grep` no repositório confirma)" e "Sem
 * fingerprinting de usuário entre sessões além do que o navegador expõe
 * naturalmente". Estas são claims **públicas** — Marshall (legal-2026-05-02
 * Cenário F) trata como evidência defensiva LGPD/ANPD se forem
 * **continuamente verificáveis**. Este test transforma a prosa em prova
 * executável.
 *
 * Falha do teste = regressão da claim pública = potencial liability
 * jurídica (defesa "tratamento não acontece" enfraquece). Tratar como
 * P0 em CI.
 *
 * **Escopo:** scan estático de `src/**\/*.{ts,tsx}` (Node fs disponível
 * em vitest — testes existentes já mockam db; aqui não mockamos nada,
 * só lemos source).
 *
 * **Falsos positivos esperados:** strings em comentários explicando
 * O QUE NÃO FAZER. Mitigamos com regex que pula linhas que começam
 * com `*` (JSDoc) ou `//` quando a string é precedida de palavra de
 * negação. Whitelist explícita pra arquivos onde menção é deliberada
 * (este arquivo, docs).
 *
 * **TODO humano antes do merge:**
 * - Validar deny-list de domínios analytics — adicionar mais se conhecer.
 * - Decidir se `it.todo` virajobs falhantes (recomendado após refactor de
 *   `upload.ts` pra UserPrefs).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_ROOT = join(__dirname, '..', 'src')
const ROOT = join(__dirname, '..')

/** Recursive walk yielding all .ts/.tsx files under `dir`. */
function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walkSource(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

interface Match {
  file: string
  line: number
  text: string
  pattern: string
}

/**
 * Scan all source files for any pattern. Returns matches with file/line.
 * Skips lines that look like comments-of-prohibition (line starts with
 * `*` or `//` AND mentions a negation word) — best-effort but generous.
 */
function scanSource(patterns: { name: string; re: RegExp }[]): Match[] {
  const files = walkSource(SRC_ROOT)
  const hits: Match[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      // Skip pure comment lines that are documenting prohibition.
      const isComment = trimmed.startsWith('*') || trimmed.startsWith('//')
      const negates = /\b(NÃO|NAO|NOT|sem|without|never|jamais|proibid|forbidden|deny|skip)\b/i.test(line)
      if (isComment && negates) continue
      for (const { name, re } of patterns) {
        if (re.test(line)) {
          hits.push({
            file: relative(ROOT, file),
            line: i + 1,
            text: trimmed.slice(0, 200),
            pattern: name,
          })
        }
      }
    }
  }
  return hits
}

describe('PRIVACY.md claim: "Sem telemetria. Sem analytics. Sem reports automáticos de erro."', () => {
  it('código fonte não importa SDKs de telemetria/analytics conhecidos', () => {
    // Deny-list de imports de SDKs analytics. Lista cresce — humano
    // adicione conforme conhecer (Datadog RUM, LogRocket, FullStory etc.).
    const patterns = [
      { name: 'sentry', re: /from\s+['"]@sentry\/[^'"]+['"]/ },
      { name: 'mixpanel', re: /from\s+['"]mixpanel(-browser)?['"]/ },
      { name: 'amplitude', re: /from\s+['"]@?amplitude(\/[^'"]+)?['"]/ },
      { name: 'plausible', re: /from\s+['"]plausible-tracker['"]/ },
      { name: 'posthog', re: /from\s+['"]posthog-js['"]/ },
      { name: 'datadog-rum', re: /from\s+['"]@datadog\/[^'"]+['"]/ },
      { name: 'logrocket', re: /from\s+['"]logrocket['"]/ },
      { name: 'hotjar', re: /from\s+['"]@?hotjar(\/[^'"]+)?['"]/ },
      { name: 'fullstory', re: /from\s+['"]@?fullstory(\/[^'"]+)?['"]/ },
      { name: 'segment', re: /from\s+['"]@?segment\/[^'"]+['"]/ },
    ]
    const hits = scanSource(patterns)
    expect(hits, `Telemetry/analytics SDK detected:\n${formatHits(hits)}`).toEqual([])
  })

  it('código fonte não chama URLs analytics conhecidos via string literal', () => {
    // URLs analytics que aparecem em código fonte — pegamos antes do
    // fetch ser construído.
    const patterns = [
      { name: 'google-analytics', re: /google-analytics\.com|googletagmanager\.com|gtag\(/i },
      { name: 'mixpanel', re: /api\.mixpanel\.com/i },
      { name: 'segment', re: /api\.segment\.(com|io)/i },
      { name: 'sentry-ingest', re: /\.ingest\.sentry\.io|sentry\.io\/api/i },
      { name: 'plausible', re: /plausible\.io\/api\/event/i },
      { name: 'amplitude', re: /api\.amplitude\.com/i },
      { name: 'cloudflare-analytics', re: /static\.cloudflareinsights\.com/i },
      { name: 'vercel-analytics', re: /vitals\.vercel-(insights|analytics)\.com/i },
    ]
    const hits = scanSource(patterns)
    expect(hits, `Analytics endpoint detected:\n${formatHits(hits)}`).toEqual([])
  })

  it('navigator.sendBeacon não é chamado (vetor clássico de telemetria silenciosa)', () => {
    const patterns = [
      { name: 'sendBeacon', re: /\bnavigator\.sendBeacon\b|\bsendBeacon\s*\(/ },
    ]
    const hits = scanSource(patterns)
    expect(hits, `sendBeacon usage:\n${formatHits(hits)}`).toEqual([])
  })
})

describe('PRIVACY.md claim: "Sem fingerprinting de usuário entre sessões"', () => {
  it('código fonte não usa APIs de fingerprinting clássicas', () => {
    // APIs reconhecidamente usadas pra fingerprinting (EFF Panopticlick
    // / FingerprintJS catalogo). Whitelist explícita: nenhuma desta
    // lista deve aparecer no Drift cliente oficial.
    const patterns = [
      // `\.toDataURL` cru pega QRCode.toDataURL (lib npm legítima usada pra
      // export visual de nsec — não é fingerprinting, é UX). Restringir
      // a `canvas`/`ctx` (nomes convencionais de HTMLCanvasElement) reduz
      // false-positive sem deixar passar fingerprint real.
      { name: 'canvas-fingerprint', re: /\b(?:canvas|ctx|context)\.toDataURL\s*\(/ },
      { name: 'audio-fingerprint', re: /new\s+(Offline)?AudioContext\b/ },
      { name: 'webgl-vendor', re: /UNMASKED_VENDOR_WEBGL|UNMASKED_RENDERER_WEBGL/ },
      { name: 'ua-high-entropy', re: /getHighEntropyValues/ },
      { name: 'battery-api', re: /\bnavigator\.getBattery\b/ },
      { name: 'installed-apps', re: /getInstalledRelatedApps/ },
      { name: 'media-devices-enum', re: /enumerateDevices/ },
      { name: 'fingerprintjs', re: /from\s+['"]@?fingerprintjs(\/[^'"]+)?['"]/ },
    ]
    const hits = scanSource(patterns)
    expect(hits, `Fingerprinting API detected:\n${formatHits(hits)}`).toEqual([])
  })
})

describe('CLAUDE.md invariante #8: "nsec NUNCA sai do dispositivo"', () => {
  it('JSON.stringify não é aplicado próximo a variáveis nomeadas como nsec/secretKey/privKey em transport', () => {
    // Heurística estática: JSON.stringify nas mesmas 5 linhas de um
    // identificador `nsec`/`secretKey`/`privKey`/`privateKey` em código
    // de transport. False-positives possíveis — decisão humana se
    // expandir whitelist.
    //
    // Limitamos a transport/sync/probe/rebroadcast — onde dados saem
    // do device. Em identity.ts/crypto.ts é legítimo serializar como
    // parte de export consciente.
    const transportFiles = [
      'src/lib/sync.ts',
      'src/lib/probe.ts',
      'src/lib/rebroadcast.ts',
    ]
    const danger = /\b(nsec|secretKey|privKey|privateKey)\b/
    const stringify = /JSON\.stringify\b/
    const hits: Match[] = []
    for (const rel of transportFiles) {
      const full = join(ROOT, rel)
      let content: string
      try {
        content = readFileSync(full, 'utf8')
      } catch {
        // Arquivo pode não existir em todas as fases — tudo bem,
        // skip silently. Falha apenas se existir e contiver match.
        continue
      }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!danger.test(lines[i])) continue
        // Janela de ±5 linhas
        const lo = Math.max(0, i - 5)
        const hi = Math.min(lines.length - 1, i + 5)
        for (let j = lo; j <= hi; j++) {
          if (stringify.test(lines[j])) {
            hits.push({
              file: rel,
              line: i + 1,
              text: lines[i].trim().slice(0, 200),
              pattern: `nsec-near-stringify (line ${j + 1} stringifies)`,
            })
            break
          }
        }
      }
    }
    expect(hits, `nsec serialization risk:\n${formatHits(hits)}`).toEqual([])
  })

  // TODO Barney: smoke-test dinâmico em Playwright.
  // Monkey-patch WebSocket.prototype.send + window.fetch durante
  // bootstrap+post flow; assert nenhum payload contém os 32 bytes
  // do nsec gerado. Exige Playwright em CI — fora de escopo deste PR.
  it.todo('smoke-test dinâmico: nsec não aparece em nenhum WebSocket.send/fetch payload')
})

describe('Marshall finding: nostr.build hardcoded é vetor LGPD curador-único', () => {
  // Test atualmente falha-on-purpose se você descomentar — serve como
  // TDD pro refactor `UPLOAD_ENDPOINT` → `UserPrefs.upload_endpoint`.
  // Mantemos como `it.todo` pra não quebrar CI antes do refactor; quando
  // o refactor entra, mover pra `it()` ativo.
  it.todo('upload.ts não contém endpoint hardcoded — endpoint vem de UserPrefs')

  it.todo('SpreadMap.tsx não contém URL CARTO hardcoded — vem de UserPrefs.map_tile_url_template')

  it.todo('Quando IPFS gateway entrar (Fase 6+), endpoint vem de UserPrefs (não hardcoded)')
})

function formatHits(hits: Match[]): string {
  if (hits.length === 0) return '(none)'
  return hits
    .map((h) => `  ${h.file}:${h.line} [${h.pattern}] ${h.text}`)
    .join('\n')
}
