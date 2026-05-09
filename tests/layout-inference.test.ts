/**
 * V9.1 — auto-inferência de layout (substitui seletor manual no ComposeOverlay).
 *
 * Função pura `inferLayout(text, imageUrl, imageMeta)`:
 *   - sem imagem → 'text'
 *   - imagem + dim válido → 'portrait' (ratio<1.2) ou 'landscape' (≥1.2)
 *   - imagem sem dim → fallback 'landscape'
 *
 * Manifesto §7 — determinismo. Mesma entrada → mesma saída sempre.
 */

import { describe, expect, it } from 'vitest'
import { inferLayout } from '../src/lib/layout-inference'
import type { BlobMeta } from '../src/lib/nip94'

describe('inferLayout — sem imagem', () => {
  it('texto preenchido sem imageUrl → text', () => {
    expect(inferLayout('hello world', null)).toBe('text')
  })

  it('texto vazio sem imageUrl → text (edge: validation upstream rejeita post inteiro)', () => {
    expect(inferLayout('', null)).toBe('text')
  })

  it('imageMeta presente mas imageUrl=null → text (sem imagem renderizável)', () => {
    expect(inferLayout('caption', null, { dim: '1920x1080' })).toBe('text')
  })
})

describe('inferLayout — com imagem + dim válido', () => {
  it('1080x1920 (vertical) → portrait', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1080x1920' })).toBe('portrait')
  })

  it('1920x1080 (horizontal) → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1920x1080' })).toBe('landscape')
  })

  it('800x800 (square, ratio=1.0) → portrait', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '800x800' })).toBe('portrait')
  })

  it('1200x1000 (ratio=1.2 boundary) → landscape (≥1.2 cai pro lado paisagem)', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1200x1000' })).toBe('landscape')
  })

  it('1199x1000 (ratio=1.199 abaixo do boundary) → portrait', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1199x1000' })).toBe('portrait')
  })

  it('caption preenchida não muda o layout (decisão depende só de imagem+ratio)', () => {
    const long = 'caption longa que poderia justificar text mas como tem imagem ganha'
    expect(inferLayout(long, 'https://x/y.jpg', { dim: '1920x1080' })).toBe('landscape')
  })
})

describe('inferLayout — fallbacks defensivos', () => {
  it('imagem sem meta → landscape (fallback)', () => {
    expect(inferLayout('', 'https://x/y.jpg')).toBe('landscape')
  })

  it('imagem com meta sem dim → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { mime: 'image/jpeg' })).toBe('landscape')
  })

  it('imagem com meta=null → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', null)).toBe('landscape')
  })

  it('dim malformado "abc" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: 'abc' })).toBe('landscape')
  })

  it('dim com 1 token "1920" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1920' })).toBe('landscape')
  })

  it('dim com 3 tokens "1x2x3" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '1x2x3' })).toBe('landscape')
  })

  it('dim com NaN "NaNxNaN" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: 'NaNxNaN' })).toBe('landscape')
  })

  it('dim com zero "0x100" → landscape (defensive: divisão por zero)', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '0x100' })).toBe('landscape')
  })

  it('dim com altura zero "100x0" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '100x0' })).toBe('landscape')
  })

  it('dim com negativos "-100x100" → landscape', () => {
    expect(inferLayout('', 'https://x/y.jpg', { dim: '-100x100' })).toBe('landscape')
  })
})

describe('inferLayout — determinismo (§7)', () => {
  it('mesma entrada → mesma saída em chamadas repetidas', () => {
    const inputs: Array<[string, string | null, BlobMeta | undefined]> = [
      ['', null, undefined],
      ['hello', null, undefined],
      ['', 'https://x/y.jpg', { dim: '1920x1080' }],
      ['', 'https://x/y.jpg', { dim: '1080x1920' }],
      ['', 'https://x/y.jpg', undefined],
    ]
    for (const [t, u, m] of inputs) {
      const r1 = inferLayout(t, u, m)
      const r2 = inferLayout(t, u, m)
      expect(r1).toBe(r2)
    }
  })
})
