/**
 * scheduler — primitivas de yield cooperativo pro main thread.
 *
 * Usado pra "espalhar no tempo" loops longos que processam muitos
 * eventos em rajada (verify-storm de boot: ~2000 eventos × verify+persist).
 * Sem yield, o loop monopoliza o main thread e CTAs/renders ficam
 * presos até a rajada drenar (bug #4, faceta INP).
 *
 * `scheduler.yield()` (Prioritized Task Scheduling API, Chrome 129+) é a
 * primitiva ideal: cede a vez ao browser pra pintar/responder input e
 * **re-agenda a continuação com prioridade alta** (não vai pro fim da
 * fila como `setTimeout(0)`, que adiciona ~4ms de clamp por tick). Quando
 * indisponível (Safari, Firefox até 2026), caímos em `setTimeout(0)` —
 * ainda cede o thread, só com latência de continuação um pouco maior.
 *
 * Sem dep externa, sem polyfill — só web platform API + fallback nativo.
 * Manifesto §29 (compatibilidade): só runtime browser, degrada limpo.
 *
 * Determinismo (manifesto §7) preservado: yield só altera QUANDO o
 * próximo evento é processado, nunca O QUE acontece com ele. A ordem de
 * processamento dentro de um batch é mantida; INSERT OR IGNORE +
 * scoring puro garantem score final idêntico independente do espaçamento
 * temporal entre processamentos.
 */

interface SchedulerWithYield {
  yield?: () => Promise<void>
}

/**
 * Cede a vez ao main thread, deixando o browser pintar e processar input
 * pendente antes de continuar. Resolve assim que o browser reagenda a
 * continuação.
 *
 * - `scheduler.yield()` quando disponível (continuação high-priority).
 * - `setTimeout(0)` como fallback universal.
 * - Em ambiente sem `window`/`setTimeout` (SSR/test edge), resolve já.
 */
export function yieldToMain(): Promise<void> {
  if (typeof globalThis !== 'undefined') {
    const sched = (globalThis as { scheduler?: SchedulerWithYield }).scheduler
    if (sched && typeof sched.yield === 'function') {
      return sched.yield()
    }
  }
  if (typeof setTimeout === 'function') {
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return Promise.resolve()
}

/**
 * Tamanho de batch padrão pra catch-up de eventos no boot. Processa N
 * eventos pelo pipeline e então cede o thread. 50 é o ponto de equilíbrio
 * medido: grande o suficiente pra amortizar o custo de re-agendamento,
 * pequeno o suficiente pra manter INP < ~50ms entre yields (cada evento
 * é ~0.1-0.3ms de trabalho no main thread; o verify Schnorr em si roda
 * no worker, fora do main).
 */
export const BOOT_BATCH_SIZE = 50

/**
 * Drena um array processando-o em batches de `batchSize`, cedendo o main
 * thread entre cada batch via `yieldToMain()`. Mantém a ordem do array
 * (crítico pra first-seen estável de `users.created_at`).
 *
 * O `process` de cada item roda sequencialmente dentro do batch — o
 * pipeline cheap→caro de `onNostrEvent` (invariante #5) fica intacto: o
 * yield acontece SÓ no boundary entre batches, nunca no meio do
 * processamento de um item.
 */
export async function drainInBatches<T>(
  items: readonly T[],
  process: (item: T) => Promise<void>,
  batchSize: number = BOOT_BATCH_SIZE,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    // i < items.length garante index válido (noUncheckedIndexedAccess)
    await process(items[i]!)
    // Boundary entre batches: cede o thread. `i + 1` pra não ceder logo
    // antes do primeiro item nem deixar um yield órfão após o último.
    if ((i + 1) % batchSize === 0 && i + 1 < items.length) {
      await yieldToMain()
    }
  }
}
