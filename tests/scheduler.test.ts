/**
 * scheduler.test.ts — drainInBatches + yieldToMain (bug #4 throttle).
 *
 * Lock do contrato do throttle de verify-storm:
 *  - ORDEM preservada (first-seen estável de users.created_at depende disso)
 *  - TODOS os itens processados exatamente uma vez
 *  - yield acontece SÓ no boundary entre batches, nunca no meio de um item
 *    (invariante #5: pipeline cheap→caro de cada evento intacto)
 *  - número de yields = floor((n-1)/batchSize) — nunca yield após o último
 *
 * §7 (determinismo): drainInBatches só altera QUANDO cada item roda, não
 * O QUE acontece. Saída idêntica independente do espaçamento.
 */

import { describe, expect, it, vi } from 'vitest'
import { drainInBatches, yieldToMain } from '../src/lib/scheduler'

describe('drainInBatches', () => {
  it('processa todos os itens na ordem do array', async () => {
    const seen: number[] = []
    await drainInBatches([1, 2, 3, 4, 5], async (n) => {
      seen.push(n)
    }, 2)
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('processa cada item exatamente uma vez', async () => {
    const process = vi.fn(async () => {})
    const items = Array.from({ length: 137 }, (_, i) => i)
    await drainInBatches(items, process, 50)
    expect(process).toHaveBeenCalledTimes(137)
  })

  it('array vazio: noop, sem yield', async () => {
    const process = vi.fn(async () => {})
    await drainInBatches([], process, 50)
    expect(process).not.toHaveBeenCalled()
  })

  it('cede o thread SÓ no boundary entre batches (não após o último item)', async () => {
    // Sequência de eventos: cada processamento empurra 'P', cada yield
    // empurra 'Y'. Com 5 itens e batch 2 esperamos: P P Y P P Y P
    // (yields após item 2 e 4; nenhum após o item 5 final).
    const log: string[] = []
    // setTimeout(0) fallback é o caminho determinístico em Node (sem
    // scheduler.yield); spy nele pra contar yields sem depender de timing.
    const realSetTimeout = globalThis.setTimeout
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        log.push('Y')
        // resolve no próximo microtask pra manter a sequência determinística
        queueMicrotask(fn)
        return 0 as unknown as ReturnType<typeof realSetTimeout>
      }) as typeof setTimeout)

    try {
      await drainInBatches([1, 2, 3, 4, 5], async () => {
        log.push('P')
      }, 2)
    } finally {
      spy.mockRestore()
    }

    expect(log).toEqual(['P', 'P', 'Y', 'P', 'P', 'Y', 'P'])
    // 5 itens, batch 2 → yields nos boundaries após item 2 e 4 = 2 yields
    expect(log.filter((x) => x === 'Y')).toHaveLength(2)
  })

  it('batch >= n: nenhum yield (single batch)', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout')
    try {
      await drainInBatches([1, 2, 3], async () => {}, 50)
    } finally {
      spy.mockRestore()
    }
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('yieldToMain', () => {
  it('resolve (fallback setTimeout em ambiente sem scheduler.yield)', async () => {
    // Em Node/vitest não há scheduler.yield — cai no setTimeout(0).
    await expect(yieldToMain()).resolves.toBeUndefined()
  })

  it('usa scheduler.yield quando disponível', async () => {
    const yieldSpy = vi.fn(() => Promise.resolve())
    const g = globalThis as { scheduler?: { yield?: () => Promise<void> } }
    const prev = g.scheduler
    g.scheduler = { yield: yieldSpy }
    try {
      await yieldToMain()
      expect(yieldSpy).toHaveBeenCalledTimes(1)
    } finally {
      g.scheduler = prev
    }
  })
})
