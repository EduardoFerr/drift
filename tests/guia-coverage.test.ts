/**
 * guia-coverage.test.ts — LOCK_VIA_TEST de cobertura mínima do GuideCard.
 *
 * Origem: user feedback 2026-05-22 — "explicar cada algoritmo e funções
 * de forma que o usuário entenda bem o que ele pode fazer e o que isso
 * traz de responsabilidade para ele e a rede que ele está cultivando".
 *
 * O GuideCard é o hub exploratório em Settings → "guia do drift". Esse
 * teste garante que TODOS os tópicos prometidos pro user existem como
 * `accordionId` no JSX. Qualquer remoção acidental quebra o teste e
 * sinaliza regressão na cobertura educativa.
 *
 * Cobertura validada:
 *   - 4 contextos de mapa (post/global/network/embedded)
 *   - 6 ações sociais (DRIFT/SINK/REPORT/BLOCK/MUTE/PIN)
 *   - 6 algoritmos (score/weight/threshold/PPR/decay/lentes pluggable)
 *   - 4 tópicos de privacidade (nsec/GPS/reports públicos/sem scan)
 *   - 3 itens de responsabilidade ("cultivar a rede")
 *
 * Manifesto §28: teste lê código-fonte (offline, sem runtime), não
 * exporta nada.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GUIDE_PATH = resolve(__dirname, '../src/components/Settings/GuideCard.tsx')
const GUIDE_SRC = readFileSync(GUIDE_PATH, 'utf-8')

describe('GuideCard — cobertura de tópicos', () => {
  describe('maps (4 contextos)', () => {
    const MAPS = ['post', 'global', 'network', 'embedded'] as const
    it.each(MAPS)('tem accordionId guia-map-%s', (m) => {
      expect(GUIDE_SRC).toMatch(new RegExp(`accordionId=["']guia-map-${m}["']`))
    })
  })

  describe('ações sociais (6 ações)', () => {
    const ACTIONS = ['drift', 'sink', 'report', 'block', 'mute', 'pin'] as const
    it.each(ACTIONS)('tem accordionId guia-acao-%s', (a) => {
      expect(GUIDE_SRC).toMatch(new RegExp(`accordionId=["']guia-acao-${a}["']`))
    })
  })

  describe('algoritmos (6 algoritmos)', () => {
    const ALGOS = ['score', 'weight', 'threshold', 'ppr', 'decay', 'lentes'] as const
    it.each(ALGOS)('tem accordionId guia-algo-%s', (a) => {
      expect(GUIDE_SRC).toMatch(new RegExp(`accordionId=["']guia-algo-${a}["']`))
    })
  })

  describe('privacidade (4 tópicos)', () => {
    const PRIVACY = ['nsec', 'gps', 'reports', 'no-scan'] as const
    it.each(PRIVACY)('tem accordionId guia-privacy-%s', (p) => {
      expect(GUIDE_SRC).toMatch(new RegExp(`accordionId=["']guia-privacy-${p}["']`))
    })
  })

  describe('responsabilidade — "cultivar a rede"', () => {
    it('seção de responsabilidade existe', () => {
      expect(GUIDE_SRC).toMatch(/aria-labelledby=["']guia-responsabilidade["']/)
    })

    it('tem 3 verdades (3 <article> dentro da seção)', () => {
      // Conta ocorrências de <article ...> dentro do arquivo. Em PR
      // futura, se outras seções usarem <article>, ajustar regex.
      const articleMatches = GUIDE_SRC.match(/<article\b/g) ?? []
      expect(articleMatches.length).toBeGreaterThanOrEqual(3)
    })

    it('cita manifesto §17 (sem chave mestra) — fundamento da verdade 2', () => {
      expect(GUIDE_SRC).toMatch(/§17/)
    })

    it('caixa "sua responsabilidade" aparece pelo menos 1x', () => {
      expect(GUIDE_SRC).toMatch(/sua responsabilidade/i)
    })
  })

  describe('referências aos docs canônicos', () => {
    it('linka Docs/algoritmos.md (fonte da matemática)', () => {
      expect(GUIDE_SRC).toMatch(/Docs\/algoritmos\.md/)
    })

    it('linka Docs/manifesto.md (fonte dos princípios)', () => {
      expect(GUIDE_SRC).toMatch(/Docs\/manifesto\.md/)
    })

    it('linka Docs/guia-do-usuario.md (versão markdown)', () => {
      expect(GUIDE_SRC).toMatch(/Docs\/guia-do-usuario\.md/)
    })
  })

  describe('vocabulário UI (DRIFT/SINK, não SPREAD/BURY)', () => {
    // Manifesto-conformance LOCK exige separação léxica em strings JSX:
    // UI usa DRIFT/SINK/DERIVA; spec/código usa SPREAD/BURY.
    it('usa "DRIFT" como verbo da ação ↑ (≥3 ocorrências)', () => {
      const matches = GUIDE_SRC.match(/\bDRIFT\b/g) ?? []
      expect(matches.length).toBeGreaterThanOrEqual(3)
    })

    it('usa "SINK" como verbo da ação ↓ (≥2 ocorrências)', () => {
      const matches = GUIDE_SRC.match(/\bSINK\b/g) ?? []
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })

    it('NÃO usa "espalhar"/"enterrar" em copy JSX (vocabulário PT antigo)', () => {
      // Procura em strings JSX (entre > e < ou entre aspas que viram
      // children/description). Conservador: qualquer ocorrência fora
      // de comentário levanta suspeita.
      const lines = GUIDE_SRC.split('\n')
      const offenders = lines
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => {
          // ignora linhas de comentário
          const trimmed = l.trim()
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false
          return /\b(espalha|enterra)\b/.test(l)
        })
      // Aceita ocorrências dentro de parênteses explicativos do tipo
      // "DRIFT (espalhar ↑)" — esse é o ÚNICO ponto onde mencionamos
      // o vocabulário PT antigo intencionalmente, como bridge léxico.
      // Filtramos esses casos.
      const realOffenders = offenders.filter(
        ({ l }) => !/\([^)]*(espalhar|enterrar)[^)]*\)/.test(l),
      )
      expect(realOffenders).toEqual([])
    })
  })
})

describe('GuideCard — wiring em App.tsx', () => {
  const APP_PATH = resolve(__dirname, '../src/App.tsx')
  const APP_SRC = readFileSync(APP_PATH, 'utf-8')

  it('lazy import existe', () => {
    expect(APP_SRC).toMatch(/const GuideCard = lazy/)
  })

  it("SettingsTarget inclui 'guia'", () => {
    expect(APP_SRC).toMatch(/\|\s*'guia'/)
  })

  it("case 'guia' roteia pra GuideCard", () => {
    expect(APP_SRC).toMatch(/case 'guia':[\s\S]{0,200}GuideCard/)
  })

  it("entry de menu 'guia do drift' existe", () => {
    expect(APP_SRC).toMatch(/label: 'guia do drift'/)
  })
})
