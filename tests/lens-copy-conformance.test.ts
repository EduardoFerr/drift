/**
 * Lens "identified-only" — vocabulário PROIBIDO em copy + comentários
 * próximos a callsites. LOCK_VIA_TEST estrutural (Sprint N+4, Marshall).
 *
 * Origem: peer-review Barney C2 "visual emphasis creep" + C6 "onboarding
 * push" (risco 20). Mitigation top-1 do threat model `barney-lens-
 * identified-threat-2026-05-23.md`: grep raio 200 chars de qualquer
 * referência a `identified-only` / `identifiedOnly` / `LensIdentified`
 * contra léxico de selo/verificação/legitimidade.
 *
 * Por que LOCK estrutural ANTES da feature existir?
 * - Test passa vacuously enquanto não houver callsite (zero matches → ok).
 * - No DIA em que alguém implementa a feature, qualquer copy "verified"/
 *   "trusted"/"selo"/"✓" perto do identifier QUEBRA o build. PR não
 *   merga sem rewrite explícito do vocabulário.
 * - Defense-in-depth contra cenário Barney: dev sob pressão de UX
 *   pede pra Claude "fazer parecer útil" → copy escorrega pra
 *   "Verified accounts only", "Trusted users", "✓ identificados".
 *   §22 (sem reputação) + §4 (anonimato preservado) seriam erodidos
 *   sem alarme — esse test soa o alarme.
 *
 * Léxico proibido (PT + EN):
 * - `verified`, `verificad*` (verificado/verificada) — sugere status oficial
 * - `trusted` — sugere autoridade central declarando quem confiar
 * - `official` — implica chancela do app (cliente é browser, §17)
 * - `genuine`, `real user` — implica que outros são "fake"
 * - `not a bot`, `non-bot`, `anti-bot` — Drift NÃO faz bot-detection
 * - `anti-spam`/`antispam` — confunde lente com filtro de spam
 * - `✓` (U+2713) — checkmark de "selo azul" (Twitter/Meta)
 * - `selo` (PT) — mesma conotação que "badge"/"verified mark"
 *
 * Raio 200 chars: balança entre pegar copy próxima (label JSX, toast,
 * tooltip) e ignorar JSDoc distante. Empiricamente: 1 linha de copy
 * JSX cabe em 80-120 chars; 200 cobre props multi-linha sem alcançar
 * blocos de comentário acima da função.
 *
 * Como rebatizar a lente sem perder a função:
 * - "Apenas perfis identificados" (descritivo, sem juízo de valor)
 * - "Filtrar por perfis com display_name" (concreto, sem hierarquia)
 * - "Esconder posts sem profile metadata" (técnico, neutro)
 *
 * Refs:
 *  - Docs/sessions/marshall-lens-identified-check-2026-05-23.md
 *  - Docs/sessions/barney-lens-identified-threat-2026-05-23.md (top-1 mitigation)
 *  - Manifesto §4 (anonimato preservado), §17 (sem chave mestra),
 *    §22 (sem reputação subjetiva)
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

// Helper de file walking. Comentários propositalmente NÃO são stripped
// no conteúdo lido — queremos pegar inclusive comentários próximos.
// Se dev escreveu `// verified-only users` ao lado do identifier, é
// vetor de escape. Idem pra JSX inline comment com checkmark literal.
function findSourceFiles(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        if (
          entry.name !== 'node_modules' &&
          entry.name !== 'dist' &&
          entry.name !== '.git'
        ) {
          walk(full)
        }
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      ) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

/**
 * Identifiers que apontam pra (futura) lens "identified-only". Lista
 * inclui kebab-case, camelCase e PascalCase pra cobrir: ID de strategy
 * no registry, callers React/util e classe/named export.
 */
const FEATURE_IDENTIFIERS = [
  'identified-only',
  'identifiedOnly',
  'IdentifiedOnly',
  'LensIdentified',
  'LensIdentifiedOnly',
  'identifiedOnlyLens',
]

/**
 * Palavras/símbolos proibidos no raio de 200 chars ao redor de qualquer
 * callsite de identified-only. Cada entry: regex case-insensitive
 * (exceto `✓` que é case-irrelevant) + razão pro erro.
 */
const FORBIDDEN_VOCAB: { pattern: RegExp; label: string; reason: string }[] = [
  {
    pattern: /\bverified\b/i,
    label: '"verified"',
    reason: 'sugere chancela oficial (selo azul). §22 sem reputação centralizada',
  },
  {
    pattern: /\bverificad[oa]s?\b/i,
    label: '"verificado/verificada"',
    reason: 'PT-BR de "verified" — mesma conotação',
  },
  {
    pattern: /\btrusted\b/i,
    label: '"trusted"',
    reason: 'implica autoridade central declarando quem confiar (§17 sem chave mestra)',
  },
  {
    pattern: /\bofficial\b/i,
    label: '"official"',
    reason: 'cliente Drift é browser determinístico, não chancela perfis',
  },
  {
    pattern: /\bgenuine\b/i,
    label: '"genuine"',
    reason: 'implica que outros perfis são "falsos"',
  },
  {
    pattern: /\breal\s+users?\b/i,
    label: '"real user/users"',
    reason: 'implica hierarquia ontológica entre perfis (§4 anonimato igual)',
  },
  {
    pattern: /\bnot\s+a\s+bot\b/i,
    label: '"not a bot"',
    reason: 'Drift NÃO faz bot-detection — claim falsa',
  },
  {
    pattern: /\bnon[-\s]?bot\b/i,
    label: '"non-bot"',
    reason: 'mesma falsa claim de bot-detection',
  },
  {
    pattern: /\banti[-\s]?bot\b/i,
    label: '"anti-bot"',
    reason: 'sugere mecanismo de bot-defense que não existe',
  },
  {
    pattern: /\banti[-\s]?spam\b/i,
    label: '"anti-spam"',
    reason: 'lente identified-only NÃO é filtro de spam — confunde semântica',
  },
  {
    pattern: /\bantispam\b/i,
    label: '"antispam"',
    reason: 'idem anti-spam (variação sem hífen)',
  },
  {
    // U+2713 CHECK MARK — selo azul style. Pega tanto literal quanto
    // em strings JSX. Sem flag /i pq não há diferença de case em símbolo.
    pattern: /✓/,
    label: '"✓" (U+2713 check mark)',
    reason: 'checkmark é símbolo universal de "selo verificado" (Twitter/Meta/etc)',
  },
  {
    pattern: /\bselos?\b/i,
    label: '"selo(s)"',
    reason: 'PT-BR de "badge"/"verified mark" — mesma conotação de chancela',
  },
]

/** Raio em chars antes/depois do match. Empírico: cobre props multi-linha
 * de copy JSX sem alcançar JSDoc/blocos de comentário acima da função. */
const RADIUS = 200

interface Offender {
  file: string
  line: number
  identifier: string
  forbidden: string
  reason: string
  snippet: string
}

describe('LOCK_VIA_TEST L-ID-1 — lens "identified-only" sem vocabulário de selo/reputação', () => {
  it('zero ocorrências de léxico proibido em raio de 200 chars ao redor de callsites', () => {
    const files = findSourceFiles(SRC)
    const offenders: Offender[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf8')

      // Pra cada identifier-alvo, scaneia o arquivo todo achando matches
      // e abrindo janela ±RADIUS chars.
      for (const ident of FEATURE_IDENTIFIERS) {
        // Escape regex pra identifier (kebab tem `-` que NÃO é metachar
        // de regex JS, mas IdentifiedOnly etc. são word-chars).
        const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const identRe = new RegExp(escaped, 'g')
        let m: RegExpExecArray | null
        while ((m = identRe.exec(content)) !== null) {
          const idx = m.index
          const start = Math.max(0, idx - RADIUS)
          const end = Math.min(content.length, idx + ident.length + RADIUS)
          const window = content.slice(start, end)
          for (const { pattern, label, reason } of FORBIDDEN_VOCAB) {
            if (pattern.test(window)) {
              // Calcula linha aproximada do identifier (1-based).
              const lineNum = content.slice(0, idx).split('\n').length
              offenders.push({
                file: file.replace(ROOT, '').replace(/\\/g, '/'),
                line: lineNum,
                identifier: ident,
                forbidden: label,
                reason,
                snippet: window.replace(/\s+/g, ' ').trim().slice(0, 240),
              })
            }
          }
        }
      }
    }

    expect(
      offenders,
      `Vocabulário proibido detectado próximo a callsite de "identified-only" lens. ` +
        `Manifesto §22 (sem reputação subjetiva) + §4 (anonimato preservado) ` +
        `+ §17 (sem chave mestra). LOCK_VIA_TEST L-ID-1.\n\n` +
        `Rebatize copy pra termo NEUTRO descritivo (ex.: "perfis com display_name", ` +
        `"perfis identificados"). NÃO use: verified/trusted/official/selo/✓/anti-bot.\n\n` +
        `Hits:\n` +
        offenders
          .map(
            (o) =>
              `  ${o.file}:${o.line} [${o.identifier}] → ${o.forbidden}\n` +
              `    motivo: ${o.reason}\n` +
              `    contexto: ${o.snippet}`,
          )
          .join('\n\n'),
    ).toEqual([])
  })

  // Sanity check: garantia que helper + FORBIDDEN_VOCAB de fato pegariam
  // um caso adversarial — caso contrário, o test passaria vacuously
  // mesmo se alguém implementasse a feature com vocab ruim. Aqui criamos
  // string in-memory contendo o pior caso e validamos que ≥ 1 pattern
  // dispararia.
  it('sanity — vocab pattern reconhece string adversarial sintética', () => {
    const adversarial =
      'const LENS_ID = "identified-only" /* Verified accounts only ✓ - trusted real users, anti-bot, selo azul */'
    const hits = FORBIDDEN_VOCAB.filter((v) => v.pattern.test(adversarial))
    expect(
      hits.length,
      'sanity: ao menos 4 patterns devem disparar contra string adversarial',
    ).toBeGreaterThanOrEqual(4)
  })

  // Sanity: helper de walking encontra arquivos.
  it('sanity — findSourceFiles(src/) retorna >= 50 arquivos', () => {
    const files = findSourceFiles(SRC)
    expect(files.length).toBeGreaterThan(50)
  })
})
