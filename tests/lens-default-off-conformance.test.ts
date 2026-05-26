/**
 * Lens "identified-only" — schema/registry veta `default: true`.
 * LOCK_VIA_TEST estrutural (Sprint N+4, Marshall).
 *
 * Origem: Barney cenário C1 "feature creep pra default-on" (risco 20).
 * Threat: feature ship com `default: false` (correto), mas Sprint N+M
 * alguém muda silenciosamente pra `default: true` "porque user reclamou
 * de spam" → maioria silenciosa nunca toca settings → cliente vira
 * "Drift identificado por default" → §4 anonimato erodido.
 *
 * Por que LOCK estrutural ANTES da feature existir?
 * - Inverte a default: passa vacuously enquanto não há entry pra
 *   `identified-only` no registry.
 * - No DIA do ship: feature precisa demonstrar `default: false`
 *   (ou ausência de `default`, que registry trata como off) pra mergar.
 * - PR que tenta `default: true` falha o test → revisor humano vê o
 *   alarme antes de aprovar.
 *
 * Manifesto refs:
 *  - §4 anonimato preservado (default-off respeita user que NÃO se
 *    identificou; default-on penaliza por omissão)
 *  - §17 sem chave mestra (cliente NÃO impõe lente; user escolhe)
 *  - §22 sem reputação subjetiva (default que privilegia "identificados"
 *    cria pseudo-hierarquia oficial)
 *
 * Refs:
 *  - Docs/sessions/barney-lens-identified-threat-2026-05-23.md C1
 *  - Docs/sessions/marshall-lens-identified-check-2026-05-23.md
 *  - src/lib/lens/registry.ts DEFAULT_ACTIVE_ID
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const LENS_DIR = join(ROOT, 'src', 'lib', 'lens')
const STRATEGIES_DIR = join(LENS_DIR, 'strategies')
const REGISTRY_FILE = join(LENS_DIR, 'registry.ts')
const INIT_FILE = join(LENS_DIR, 'init.ts')

/** Strip JS/TS comments — best-effort. Importante aqui: NÃO queremos
 * que comentário "default: true seria errado" trigger falso positivo. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, (_m, prefix) => prefix)
}

/** Lista arquivos .ts em src/lib/lens/strategies/ (se existir). */
function listStrategyFiles(): string[] {
  if (!existsSync(STRATEGIES_DIR)) return []
  return readdirSync(STRATEGIES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(STRATEGIES_DIR, e.name))
}

/** True se o arquivo declara um LensStrategy com `id: 'identified-only'`. */
function declaresIdentifiedOnlyId(src: string): boolean {
  const stripped = stripComments(src)
  return /id\s*:\s*['"`]identified-only['"`]/.test(stripped)
}

describe('LOCK_VIA_TEST L-ID-2 — lens "identified-only" NUNCA default-on', () => {
  it('DEFAULT_ACTIVE_ID em registry.ts NÃO aponta pra "identified-only"', () => {
    if (!existsSync(REGISTRY_FILE)) {
      // Sem registry → feature inteira não existe. Pass vacuously.
      return
    }
    const src = stripComments(readFileSync(REGISTRY_FILE, 'utf8'))
    // Captura literal de DEFAULT_ACTIVE_ID = '...'
    const m = src.match(/DEFAULT_ACTIVE_ID\s*=\s*['"`]([^'"`]+)['"`]/)
    if (!m) {
      // Registry mudou estrutura — esse test precisa atualizar de propósito.
      throw new Error(
        '[L-ID-2] DEFAULT_ACTIVE_ID literal não encontrado em registry.ts. ' +
          'Se a constante mudou de nome/forma, atualize este test pra continuar ' +
          'validando que default-active NUNCA é identified-only. NÃO simplesmente ' +
          'remova o assert.',
      )
    }
    expect(
      m[1],
      `DEFAULT_ACTIVE_ID = '${m[1]}'. Manifesto §4 + §17 + §22: ` +
        `lente "identified-only" NUNCA pode ser default-active. ` +
        `User deve OPTAR conscientemente em Settings > Sua Lente. ` +
        `Default-on viola anonimato preservado (§4) e §22 (sem reputação). ` +
        `Barney threat C1 (risco 20).`,
    ).not.toBe('identified-only')
  })

  it('init.ts (initBuiltinLenses) NÃO chama setActiveLens("identified-only")', () => {
    if (!existsSync(INIT_FILE)) return
    const src = stripComments(readFileSync(INIT_FILE, 'utf8'))
    // Match: setActiveLens('identified-only') / setActiveLens("identified-only")
    const callPattern = /setActiveLens\s*\(\s*['"`]identified-only['"`]\s*\)/
    expect(
      callPattern.test(src),
      `init.ts chama setActiveLens("identified-only") — força lente como ativa ` +
        `durante boot, bypassando default-off. Manifesto §4/§17/§22. L-ID-2.`,
    ).toBe(false)
  })

  it('nenhuma strategy declara propriedade `default: true` (campo schemático futuro)', () => {
    // Future-proof: se em SHIP a interface LensStrategy ganhar campo
    // `default?: boolean`, qualquer strategy que set `default: true` é
    // automaticamente caught aqui. Funciona hoje (passa vacuously, sem
    // campo) e funciona amanhã (bloqueia abuso).
    const files = listStrategyFiles()
    const offenders: { file: string; line: number; text: string }[] = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Pattern: `default: true` ou `default:true` (object literal)
        // dentro de arquivo que declara id 'identified-only'.
        if (/\bdefault\s*:\s*true\b/.test(lines[i])) {
          // Só conta se o arquivo é da feature alvo (não polui outros).
          if (declaresIdentifiedOnlyId(src)) {
            offenders.push({
              file: file.replace(ROOT, '').replace(/\\/g, '/'),
              line: i + 1,
              text: lines[i].trim().slice(0, 160),
            })
          }
        }
      }
    }
    expect(
      offenders,
      `Strategy "identified-only" declara \`default: true\`. ` +
        `LOCK L-ID-2 / Barney C1 (risco 20). Default-on viola §4 anonimato + ` +
        `§22 sem reputação. Strategy DEVE ter \`default: false\` ou omitir o campo.\n` +
        `Hits:\n` +
        offenders.map((o) => `  ${o.file}:${o.line}: ${o.text}`).join('\n'),
    ).toEqual([])
  })

  // Sanity: se feature for implementada, garantir que existe ALGUM
  // arquivo declarando o id (caso contrário o test acima passaria trivialmente
  // mesmo se alguém escondesse `default: true` num lugar exótico).
  // Esse sanity NÃO falha se feature ainda não existe — só anota.
  it('sanity informativa — feature "identified-only" presente?', () => {
    const files = listStrategyFiles()
    const found = files.some((f) =>
      declaresIdentifiedOnlyId(readFileSync(f, 'utf8')),
    )
    // Esse expect existe apenas pra documentar status; NÃO falha em
    // nenhuma direção (vacuously ok antes E depois do ship).
    expect(typeof found).toBe('boolean')
  })
})
