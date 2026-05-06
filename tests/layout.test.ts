/**
 * V4 — three-layout system LOCK_VIA_TEST.
 *
 * 6 tests blindam o invariante "layout deterministico + single source of
 * truth de LAYOUT_VALUES":
 *
 *   1. fixture-legacy        — post antigo sem campo `layout` no content JSON
 *                              normaliza pra DEFAULT_LAYOUT='portrait'
 *   2. enum-exhaustive        — SubpostLayout.tsx tem case pra cada
 *                              valor de LAYOUT_VALUES (grep estático,
 *                              quebra se alguém adicionar a const sem case)
 *   3. unknown-value-fallback — valores desconhecidos ('cubist', null,
 *                              123) caem pra DEFAULT_LAYOUT
 *   4. spec-code-sync         — Docs/protocol-spec.md §3.5.1 lista
 *                              exatamente os mesmos valores que
 *                              LAYOUT_VALUES (drift entre spec e código)
 *   5. decorative-letter-safety — getDecorativeLetters strippa Unicode
 *                              perigoso (RLO/ZW/control), trata title
 *                              vazio/curto, é determinístico
 *   6. roundtrip              — content JSON com layout='landscape' faz
 *                              roundtrip parseSubposts → mantém o valor
 *
 * Marshall (HIMYM Round 2) flagged 7 camadas que precisam estar em sync;
 * estes 6 tests blindam as 5 críticas.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  LAYOUT_VALUES,
  DEFAULT_LAYOUT,
  isLayoutKind,
  normalizeLayout,
  type LayoutKind,
} from '../src/types/drift'
import { parseSubposts } from '../src/lib/feed'
import { getDecorativeLetters } from '../src/lib/decorativeLetters'

const ROOT = join(__dirname, '..')

// ─── Test 1 — fixture-legacy ─────────────────────────────────────────

describe('V4 layout — fixture-legacy', () => {
  // Synthetic legacy fixture: content JSON no formato pré-V4 (sem campo
  // `layout`). Frozen bytes, NÃO mainnet fetch (Marshall: §7 determinismo
  // exige fixture local). Reproduz o shape de um post antigo real.
  const LEGACY_CONTENT_JSON = JSON.stringify({
    subposts: [
      { id: 'sp-1', type: 'text', text: 'pré-V4', imageUrl: null, order: 0 },
      { id: 'sp-2', type: 'image', text: null, imageUrl: 'https://x/y.jpg', order: 1 },
    ],
  })

  it('parseSubposts em content sem layout → todos default DEFAULT_LAYOUT', () => {
    const result = parseSubposts(LEGACY_CONTENT_JSON)
    expect(result).toHaveLength(2)
    for (const sp of result) {
      expect(sp.layout).toBe(DEFAULT_LAYOUT)
    }
  })

  it('DEFAULT_LAYOUT é "portrait" (manifesto §7 — valor canônico)', () => {
    expect(DEFAULT_LAYOUT).toBe('portrait')
  })
})

// ─── Test 2 — enum-exhaustive ────────────────────────────────────────

describe('V4 layout — enum-exhaustive', () => {
  it('SubpostLayout.tsx tem case pra cada LAYOUT_VALUES', () => {
    const source = readFileSync(
      join(ROOT, 'src', 'components', 'Post', 'SubpostLayout.tsx'),
      'utf-8',
    )
    for (const value of LAYOUT_VALUES) {
      // Procura `case 'value':` no switch — quebra se alguém adicionar
      // a LAYOUT_VALUES sem case correspondente. assertNever no default
      // branch também já quebra TS, mas teste runtime é explícito.
      const re = new RegExp(`case\\s+'${value}'\\s*:`)
      expect(source, `SubpostLayout.tsx falta case '${value}'`).toMatch(re)
    }
  })

  it('SubpostLayout.tsx usa assertNever no default (exhaustiveness)', () => {
    const source = readFileSync(
      join(ROOT, 'src', 'components', 'Post', 'SubpostLayout.tsx'),
      'utf-8',
    )
    expect(source).toMatch(/assertNever/)
    expect(source).toMatch(/function\s+assertNever\s*\(\s*x:\s*never\s*\)/)
  })

  it('LAYOUT_VALUES tem 3 itens (V4 spec)', () => {
    expect(LAYOUT_VALUES).toHaveLength(3)
    expect(new Set(LAYOUT_VALUES)).toEqual(new Set(['portrait', 'landscape', 'text']))
  })
})

// ─── Test 3 — unknown-value-fallback ─────────────────────────────────

describe('V4 layout — unknown-value-fallback', () => {
  it('isLayoutKind aceita só os 3 canônicos', () => {
    for (const v of LAYOUT_VALUES) {
      expect(isLayoutKind(v)).toBe(true)
    }
    for (const bad of ['cubist', 'square', '', 'PORTRAIT', null, undefined, 0, {}]) {
      expect(isLayoutKind(bad)).toBe(false)
    }
  })

  it('normalizeLayout valor inválido → DEFAULT_LAYOUT', () => {
    expect(normalizeLayout('cubist')).toBe(DEFAULT_LAYOUT)
    expect(normalizeLayout(undefined)).toBe(DEFAULT_LAYOUT)
    expect(normalizeLayout(null)).toBe(DEFAULT_LAYOUT)
    expect(normalizeLayout(123)).toBe(DEFAULT_LAYOUT)
    expect(normalizeLayout({})).toBe(DEFAULT_LAYOUT)
    expect(normalizeLayout('PORTRAIT')).toBe(DEFAULT_LAYOUT) // case-sensitive
  })

  it('normalizeLayout valor válido → ele mesmo (idempotente)', () => {
    for (const v of LAYOUT_VALUES) {
      expect(normalizeLayout(v)).toBe(v)
    }
  })

  it('parseSubposts em content com layout inválido → fallback', () => {
    const content = JSON.stringify({
      subposts: [
        { id: 'sp-1', type: 'text', text: 'x', imageUrl: null, order: 0, layout: 'cubist' },
      ],
    })
    const result = parseSubposts(content)
    expect(result).toHaveLength(1)
    expect(result[0]!.layout).toBe(DEFAULT_LAYOUT)
  })
})

// ─── Test 4 — spec-code-sync ─────────────────────────────────────────

describe('V4 layout — spec-code-sync', () => {
  it('protocol-spec.md §3.5.1 menciona exatamente LAYOUT_VALUES', () => {
    const spec = readFileSync(join(ROOT, 'Docs', 'protocol-spec.md'), 'utf-8')
    // Localiza a seção §3.5.1 (até próxima ###).
    const sectionMatch = spec.match(
      /### 3\.5\.1[\s\S]*?(?=\n###|\n##\s|$)/,
    )
    expect(sectionMatch, 'spec não tem §3.5.1 layout section').not.toBeNull()
    const section = sectionMatch![0]

    // Cada LAYOUT_VALUES deve aparecer literal na seção (em backticks ou
    // quoted). Drift entre spec e código quebra este teste.
    for (const value of LAYOUT_VALUES) {
      const re = new RegExp(`\\b${value}\\b`)
      expect(section, `spec §3.5.1 não menciona '${value}'`).toMatch(re)
    }

    // E o caminho contrário — spec não deve mencionar um valor que
    // não está em LAYOUT_VALUES (ex.: someone added 'square' to spec
    // mas esqueceu o código). Lista whitelist; outros tokens são prosa.
    const enumPattern = /`([a-z]+)`/g
    const valid = new Set<string>(LAYOUT_VALUES)
    let m: RegExpExecArray | null
    const sawValues = new Set<string>()
    while ((m = enumPattern.exec(section)) !== null) {
      const t = m[1]!
      // Só consideramos tokens que parecem ser valores de enum (lowercase
      // sem números, ≥4 chars). Filtra prose como 'opt-in', 'V4', etc.
      if (/^[a-z]{4,}$/.test(t) && (t === 'portrait' || t === 'landscape' || t === 'text' || t === 'square' || t === 'cubist')) {
        sawValues.add(t)
      }
    }
    for (const v of sawValues) {
      expect(valid.has(v), `spec §3.5.1 menciona '${v}' que NÃO está em LAYOUT_VALUES`).toBe(true)
    }
  })

  it('LAYOUT_VALUES referenciado em types/drift.ts (single source)', () => {
    const types = readFileSync(join(ROOT, 'src', 'types', 'drift.ts'), 'utf-8')
    expect(types).toMatch(/export const LAYOUT_VALUES = \[/)
    expect(types).toMatch(/'portrait'/)
    expect(types).toMatch(/'landscape'/)
    expect(types).toMatch(/'text'/)
    expect(types).toMatch(/as const/)
  })
})

// ─── Test 5 — decorative-letter-safety ───────────────────────────────

describe('V4 layout — decorative-letter-safety (getDecorativeLetters)', () => {
  it('título vazio/null/undefined → "•••"', () => {
    expect(getDecorativeLetters('')).toBe('•••')
    expect(getDecorativeLetters(null)).toBe('•••')
    expect(getDecorativeLetters(undefined)).toBe('•••')
    expect(getDecorativeLetters('   ')).toBe('•••') // só whitespace
  })

  it('título 1-2 chars → padding com "•" à direita', () => {
    expect(getDecorativeLetters('A')).toBe('A••')
    expect(getDecorativeLetters('Hi')).toBe('HI•')
  })

  it('título ≥3 chars → primeiros 3 UPPERCASE', () => {
    expect(getDecorativeLetters('Hello')).toBe('HEL')
    expect(getDecorativeLetters('drift')).toBe('DRI')
    expect(getDecorativeLetters('abc-xyz')).toBe('ABC')
  })

  it('strippa Unicode bidi controls (RLO ataque #2 Round 1)', () => {
    // U+202E = RLO (Right-to-Left Override) — usado pra inverter
    // visualmente texto e spoofing.
    const malicious = '‮evil'
    const result = getDecorativeLetters(malicious)
    // Sem strip: 'evil' invertido ou inclui RLO
    // Com strip: 'evil' → 'EVI'
    expect(result).toBe('EVI')
    expect(result).not.toContain('‮')
  })

  it('strippa zero-width chars (ZWJ/ZWNJ/BOM)', () => {
    // U+200B = ZWSP, U+FEFF = BOM, U+200D = ZWJ
    expect(getDecorativeLetters('​AB‍C')).toBe('ABC')
    expect(getDecorativeLetters('﻿hello')).toBe('HEL')
  })

  it('strippa control chars (U+0000-U+001F)', () => {
    expect(getDecorativeLetters(' Abc')).toBe('ABC')
    expect(getDecorativeLetters('ABC')).toBe('ABC')
  })

  it('NFKC normaliza ligaduras (ex.: ﬁ → fi)', () => {
    // U+FB01 = LATIN SMALL LIGATURE FI → 'fi' após NFKC
    expect(getDecorativeLetters('ﬁx')).toBe('FIX')
  })

  it('determinístico — mesma entrada sempre mesma saída (§7)', () => {
    const inputs = ['hello', 'A', '', null, '‮test', undefined, 'çãõ']
    for (const input of inputs) {
      const r1 = getDecorativeLetters(input)
      const r2 = getDecorativeLetters(input)
      expect(r1).toBe(r2)
    }
  })

  it('output sempre tem exatamente 3 caracteres', () => {
    const inputs: (string | null | undefined)[] = [
      '',
      'A',
      'AB',
      'ABC',
      'ABCDEFG',
      null,
      undefined,
      '​',
      '‮‮‮',
    ]
    for (const input of inputs) {
      const r = getDecorativeLetters(input)
      // [...string].length conta graphemes aproximados (pra igualar
      // a saída visual esperada do template).
      expect([...r]).toHaveLength(3)
    }
  })
})

// ─── Test 6 — roundtrip ──────────────────────────────────────────────

describe('V4 layout — roundtrip', () => {
  it('content JSON com layout=landscape preserva ao parse', () => {
    const content = JSON.stringify({
      subposts: [
        { id: 'sp-1', type: 'text', text: 'a', imageUrl: null, order: 0, layout: 'landscape' },
        { id: 'sp-2', type: 'image', text: null, imageUrl: 'x', order: 1, layout: 'text' },
        { id: 'sp-3', type: 'text+image', text: 'c', imageUrl: 'y', order: 2, layout: 'portrait' },
      ],
    })
    const result = parseSubposts(content)
    expect(result).toHaveLength(3)
    expect(result[0]!.layout).toBe('landscape')
    expect(result[1]!.layout).toBe('text')
    expect(result[2]!.layout).toBe('portrait')
  })

  it('todos os LAYOUT_VALUES roundtrip preservam', () => {
    for (const v of LAYOUT_VALUES) {
      const content = JSON.stringify({
        subposts: [
          { id: 'sp-1', type: 'text', text: 'x', imageUrl: null, order: 0, layout: v },
        ],
      })
      const result = parseSubposts(content)
      expect(result[0]!.layout).toBe(v)
    }
  })

  it('idempotência: parseSubposts(serialize(parsed)) === parsed', () => {
    const content = JSON.stringify({
      subposts: [
        { id: 'sp-1', type: 'text', text: 'a', imageUrl: null, order: 0, layout: 'landscape' as LayoutKind },
      ],
    })
    const first = parseSubposts(content)
    const reserialized = JSON.stringify({ subposts: first })
    const second = parseSubposts(reserialized)
    expect(second).toEqual(first)
  })
})
