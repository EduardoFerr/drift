/**
 * Trust Lens conformance tests — 9 LOCK_VIA_TEST invariantes.
 *
 * Source: deliberação HIMYM 5/5 consolidada em
 *   `Docs/plans/trust-lens-phase1-plan.md` §1.7
 *
 * Estes tests TRAVAM invariantes do manifesto (§17, §22, §24, §25, §27)
 * + decisões arquiteturais Ted/Marshall/Lily/Robin/Barney. Quebra de test
 * = quebra de contrato; fix the code, não the test.
 *
 * Scaffolding atual: 9 `it.todo()` placeholders. Bodies preenchidos
 * conforme implementação avança (edges.ts → ppr.ts → predicate.ts → UI).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

function readJsxStrings(): { file: string; content: string }[] {
  const root = 'src/components'
  return walk(root)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ file: f, content: readFileSync(f, 'utf8') }))
}

describe('Trust Lens — conformance (LOCK_VIA_TEST §17 §22 §24 §25 §27)', () => {
  // ─── #1 — posts.score write-side fechado (Marshall) ──────────────
  // `UPDATE posts SET score` só pode aparecer em scoring.ts:
  // scheduleScoreRecalc + moderation.ts:maybeModerate. Em qualquer
  // outro arquivo = violação §22 (canônico mutado fora do owner).
  it('1. UPDATE posts SET score restrito a scoring/moderation/events (recalc canônico)', () => {
    // events.ts:scheduleScoreRecalc + applyCommentsContribution são parte
    // do pipeline canônico (CLAUDE.md invariante #6 — debounced recalc).
    // scoring.ts é puro (calculateScore) e moderation.ts é §26 reports
    // threshold. Outros arquivos NÃO podem atualizar score.
    const allowed = new Set([
      'src/lib/scoring.ts',
      'src/lib/moderation.ts',
      'src/lib/events.ts',
    ])
    const violations: string[] = []
    // Walk src/ procurando `UPDATE posts SET score`
    function walk(dir: string): void {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const stat = statSync(full)
        if (stat.isDirectory()) walk(full)
        else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          const rel = full.replace(/\\/g, '/')
          const content = readFileSync(full, 'utf8')
          // Strip comments — pattern em docstring não conta
          const stripped = content
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          if (/UPDATE\s+posts\s+SET\s+score/i.test(stripped)) {
            if (!allowed.has(rel)) violations.push(rel)
          }
        }
      }
    }
    walk('src')
    expect(violations, `Violação §22: UPDATE posts SET score fora de ${[...allowed].join(', ')}`).toEqual([])
  })

  // ─── #2 — s_local nunca persisted (Marshall) ─────────────────────
  // s_local é cálculo view-boundary; aplica no render do feed e morre.
  // Persistir em posts.score quebra §22 (lens vira ranking canônico).
  // Grep `s_local` fora de trust-lens/* e feed.ts + render path.
  it('2. s_local nunca aparece em writes ao DB (apenas render path)', () => {
    // Allowlist: arquivos onde s_local pode aparecer (pure compute + render)
    const allowedPrefixes = [
      'src/lib/trust-lens.ts',
      'src/lib/trust/',
      'src/lib/feed.ts',
      'src/hooks/useFeed',
      'src/components/', // render path em qualquer componente
    ]
    const violations: string[] = []
    function walk(dir: string): void {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const stat = statSync(full)
        if (stat.isDirectory()) walk(full)
        else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          const rel = full.replace(/\\/g, '/')
          const content = readFileSync(full, 'utf8')
          const stripped = content
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          // Match `s_local` como identifier (não substring de outros)
          if (/\bs_local\b/.test(stripped)) {
            const allowed = allowedPrefixes.some((p) => rel.startsWith(p))
            // Adicionalmente: se está em allowed e ALSO menciona db.run com
            // s_local, é violação (persistir s_local em DB).
            const persistViolation =
              /db\.run[\s\S]{0,200}\bs_local\b|UPDATE[\s\S]{0,200}\bs_local\b/.test(stripped)
            if (!allowed || persistViolation) violations.push(rel)
          }
        }
      }
    }
    walk('src')
    expect(violations, `Violação §22: s_local fora de render path ou persisted ao DB`).toEqual([])
  })

  // ─── #3 — PPR Monte Carlo determinism (Marshall + Ted §7) ────────
  // Mesmo seed + mesma adjacency list → mesmo Map<target, score> bit-
  // exact. Cross-device convergence exige determinism. Quebra = §7
  // violado.
  // DEFER: coberto por tests/trust-lens-math.test.ts (PPR Monte Carlo
  // section); este conformance fica it.todo até refatorar suite.
  it.todo(
    '3. PPR Monte Carlo é determinístico dado mesma seed + adjacency',
  )

  // ─── #4 — Edge influence bounds (Marshall) ───────────────────────
  // Property test: 1000 inputs aleatórios em domínios válidos de
  // LensEdgeComponentsV1 → output ∈ [0, 1]. Defensável via sigmoid.
  // CHECK constraint em SQL já bound, mas pure function deve garantir
  // antes do write (defense em camada).
  it('4. edge influence ∈ [0, 1] pra todos inputs válidos', async () => {
    const { computeInfluence, sanitizeComponents } = await import('../src/lib/trust/edges')
    // Fuzz com 1000 inputs aleatórios em domínio válido
    function randInt(min: number, max: number): number {
      return Math.floor(Math.random() * (max - min + 1)) + min
    }
    for (let i = 0; i < 1000; i++) {
      const raw = {
        v: 1 as const,
        follow: (i % 2) as 0 | 1,
        mutual_spread: randInt(0, 100),
        my_spread: randInt(0, 100),
        my_bury: randInt(0, 100),
        fof_paths: randInt(0, 50),
      }
      const components = sanitizeComponents(raw)
      const inf = computeInfluence(components)
      expect(inf, `influence fora de [0,1] em iteration ${i}: ${inf} (raw=${JSON.stringify(raw)})`).toBeGreaterThanOrEqual(0)
      expect(inf).toBeLessThanOrEqual(1)
      expect(Number.isFinite(inf)).toBe(true)
    }
  })

  // ─── #5 — Filter predicate schema valid (Marshall) ───────────────
  // Reader DSL rejeita gracefully (return null) quando:
  //   - v !== 1
  //   - kind desconhecido
  //   - shape inválido (e.g. predicates: missing)
  // Sem throw. Forward-compat pra Phase 2/3 onde v=2 aparece.
  it('5. parseFilterPredicate rejeita v != 1 ou kind unknown sem throw', async () => {
    const { parsePredicate } = await import('../src/lib/trust/predicate')
    // Casos de input inválido — todos devem retornar null SEM throw
    const invalidInputs: unknown[] = [
      { v: 2, kind: 'all', action: 'hide' }, // v desconhecido
      { v: 1, kind: 'unknown_kind', action: 'hide' }, // kind desconhecido
      { v: 1, kind: 'all' }, // action missing
      { v: 1 }, // kind+action missing
      null,
      undefined,
      'string',
      42,
      [],
      {},
      { v: '1', kind: 'all', action: 'hide' }, // v como string
    ]
    for (const input of invalidInputs) {
      let result: unknown
      let threw = false
      try {
        result = parsePredicate(input)
      } catch {
        threw = true
      }
      expect(threw, `parsePredicate THROW pra input inválido: ${JSON.stringify(input)}`).toBe(false)
      expect(result, `parsePredicate aceitou input inválido: ${JSON.stringify(input)}`).toBeNull()
    }
  })

  // ─── #6 — lens_edges nunca em raw_event nem em kind published ────
  // Manifesto §22: trust scores não saem do device. Grep em
  // protocol.ts + nostr.ts proibindo refs a lens_edges/lens_walks_cache
  // em qualquer code path que emit kinds.
  it('6. lens_edges/lens_walks_cache nunca referenciados em protocol/nostr', () => {
    // Manifesto §22 + §17 — trust scores nunca saem do device. Code paths
    // que assinam ou publicam eventos NÃO podem referenciar lens state.
    const targets = ['src/lib/protocol.ts', 'src/lib/nostr.ts']
    const violations: string[] = []
    for (const file of targets) {
      const src = readFileSync(file, 'utf8')
      if (/\blens_edges\b|\blens_walks_cache\b|\bppr_score\b/.test(src)) {
        violations.push(file)
      }
    }
    expect(violations).toEqual([])
  })

  // ─── #7 — Vocabulary lock (Lily) ─────────────────────────────────
  // JSX strings NÃO usam "Trust" nem score numérico exposto. Só "Sua
  // Lente"/"influência" PT-BR. Evita colisão semântica com Peso de
  // Perfil (ProfileModal) + evita gaming (Stack Overflow karma).
  it('7. JSX strings não contêm "Trust"/"trust score" expostos', () => {
    // Vocabulary lock PT-BR (Lily): UI user-facing usa "Sua Lente" /
    // "influência" / "lente". Strings em inglês "Trust" ou "trust score"
    // ou expor o número PPR são proibidas em JSX.
    //
    // Source-of-truth: arquivos de comentário/doc (`Docs/`) podem
    // mencionar "Trust Lens" — protocol/spec lexicon. JSX user-facing
    // (.tsx em src/components) NÃO.
    //
    // Aceitável apenas:
    //   - comentários `//` ou `/* */` (não chegam ao DOM)
    //   - imports/identifiers (não viram texto user-facing)
    //
    // Bloqueado: texto entre `>...<` ou em prop string que aparente ser
    // user-facing copy ("Trust", "trust score", numérico de PPR exposto).
    const violations: string[] = []
    const userFacingForbidden = /(?:>|"|')(?:[^<>"']*?\b)(Trust\s+(?:Lens|score)|trust\s+score)\b/gi
    for (const { file, content } of readJsxStrings()) {
      // Remove block + line comments antes do match — sem dependência
      // de AST. Regex simples cobre os casos do repo.
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      let m: RegExpExecArray | null
      while ((m = userFacingForbidden.exec(stripped)) !== null) {
        violations.push(`${file}: "${m[0]}"`)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  // ─── #8 — Subscribe filter independence (Barney P0.2) ────────────
  // sync.ts subscribe filters NÃO dependem de PPR. Relay observer
  // não pode inferir trust graph parcial via timing de subscribe shape.
  // Grep sync.ts: sem import de lens_edges/lens_walks_cache/ppr_score.
  it('8. sync.ts não importa lens_edges nem lens_walks_cache (PPR post-fetch only)', () => {
    // Barney P0.2 (filter shape leak): subscribe filters NÃO podem
    // depender de PPR. Se o relay vê filtros enviesados pela rede social
    // do user, infere o grafo parcial via timing — vetor de eclipse.
    //
    // Lock: sync.ts não importa de lens-*; não lê lens_edges /
    // lens_walks_cache do SQL; não chama getPprForAuthor.
    const sync = readFileSync('src/lib/sync.ts', 'utf8')
    const forbidden = [
      /from\s+['"]\.\/trust-lens['"]/,
      /from\s+['"]\.\/trust\//,
      /\blens_edges\b/,
      /\blens_walks_cache\b/,
      /\bgetPprForAuthor\b/,
    ]
    const hits = forbidden.filter((re) => re.test(sync))
    expect(hits, `sync.ts viola P0.2: ${hits.map((r) => r.source).join(', ')}`).toEqual([])
  })

  // ─── #9 — PPR locality (Ted zero-trust survey) ───────────────────
  // PPR scores nunca escapam do client: import em sync.ts (#8 já cobre),
  // publish em event tag (kinds 9078/9079/9080/9081/1984 sem ref a
  // lens_*), export em bundle (transport/webrtc/* sem ref).
  // LOCK_VIA_TEST §17/§22/§25 — "no trust catedral compartilhada".
  it.todo(
    '9. PPR scores nunca aparecem em event tags published ou bundle exports',
  )
})
