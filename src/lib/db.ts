/**
 * API do banco — wrapper main-thread para o Web Worker do SQLite.
 *
 * Toda chamada vira uma mensagem, espera resposta, resolve com o
 * resultado. Mensagens são correlacionadas por id incremental.
 *
 * Esta é a única superfície que o resto do app usa para falar com o
 * SQLite. db.worker.ts não é importado em nenhum outro lugar.
 *
 * Robustez:
 *  - Prazo do init: até o banco abrir, 30 s sem sinal de vida do worker
 *    (cada log renova); depois, só o teto total de 10 min; no estouro o
 *    worker é encerrado
 *  - worker.onerror / onmessageerror rejeitam promises pendentes
 *    (caso contrário um worker que falha silenciosamente trava o boot)
 */

// V10.11 — schema importado AGORA dentro do worker (db.worker.ts).
// Antes ficava aqui no main thread só pra ser enviado via postMessage,
// inchando o entry chunk em ~13 KB raw / ~4 KB gz sem benefício
// (schema é usado uma única vez no init e nunca mais — desperdício de
// parse + heap). Lighthouse `unused-javascript` audit identificou.
//
// Prazo do init (2026-11-05): no OPFS em disco o primeiro boot leva vários
// segundos fazendo progresso. Um prazo fixo de 15 s matava o boot no meio,
// o próximo refazia tudo e estourava de novo (laço), e o worker antigo
// seguia escrevendo no OPFS — dois workers no mesmo banco disputam o
// journal (SQLITE_IOERR). Agora:
//  - até o banco abrir (WASM + OPFS), 30 s sem sinal de vida = travado;
//  - depois de aberto, o trabalho é SQL (ex.: índice novo num banco grande,
//    num celular lento): matar por silêncio só faria o próximo boot refazer
//    tudo, então vale só o teto total — e cada índice fica salvo ao ficar
//    pronto, então nem o teto volta à estaca zero;
//  - no estouro, o worker é encerrado.
const INIT_IDLE_TIMEOUT_MS = 30_000
const INIT_MAX_MS = 600_000

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** Modos de storage que `db.worker` pode escolher pra persistência. */
export type StorageMode = 'opfs' | 'kvvfs' | 'memory'

export interface InitResult {
  /** True se OPFS foi escolhido (mais performance + persistência sólida). */
  hasOpfs: boolean
  /**
   * Modo concreto: 'opfs' = melhor caso. 'kvvfs' = localStorage (Safari
   * < 17, ~5MB cap). 'memory' = não persiste após reload (último recurso).
   */
  storage: StorageMode
}

let worker: Worker | null = null
let nextId = 0
let initPromise: Promise<InitResult> | null = null
/** Renova o prazo do init a cada log do worker (só enquanto o init corre). */
let onInitProgress: (() => void) | null = null
/** O worker abriu o banco: desliga o prazo de silêncio (fica o teto total). */
let onInitOpened: (() => void) | null = null
const pending = new Map<number, Pending>()

function rejectAllPending(reason: Error): void {
  for (const [, p] of pending) p.reject(reason)
  pending.clear()
}

function call<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!worker) throw new Error('DB not initialized — call initDb() first')
  const id = ++nextId
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, type, ...payload })
  })
}

export function initDb(opts: { onProgress?: (message: string) => void } = {}): Promise<InitResult> {
  if (initPromise) return initPromise

  console.log('[db] criando worker SQLite…')

  try {
    worker = new Worker(new URL('./db.worker.ts', import.meta.url), {
      type: 'module',
      name: 'drift-sqlite',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Promise.reject(new Error(`Falha ao criar Worker: ${message}`))
  }

  worker.onmessage = (e: MessageEvent) => {
    const data = e.data as {
      id?: number
      ok: boolean
      result?: unknown
      error?: string
      log?: string
      stage?: 'opened'
      progress?: string
    }

    // etapa/progresso do init (sem id): renovam o prazo e informam a tela
    if (data.stage === 'opened') {
      onInitOpened?.()
      return
    }
    // log do worker — útil pra debug
    if (data.log || data.progress) {
      if (data.log) console.log('[db.worker]', data.log)
      if (data.progress) opts.onProgress?.(data.progress)
      onInitProgress?.()
      return
    }

    if (typeof data.id !== 'number') return
    const handler = pending.get(data.id)
    if (!handler) return
    pending.delete(data.id)
    if (data.ok) {
      handler.resolve(data.result)
    } else {
      const err = new Error(data.error ?? 'unknown worker error')
      // Propaga sinal de conflito multi-aba via err.name pro bootstrap
      // detectar e renderizar modal específico. Sem isso, o erro vira
      // genérico no BootView "erro" e o user fica perdido.
      if (data.error?.includes('MULTI_TAB_CONFLICT')) {
        err.name = 'MULTI_TAB_CONFLICT'
      }
      handler.reject(err)
    }
  }

  worker.onerror = (e) => {
    // Em workers, ErrorEvent geralmente vem com message/filename/lineno
    const detail = `${e.message ?? 'erro desconhecido'}${
      e.filename ? ` em ${e.filename}:${e.lineno}` : ''
    }`
    console.error('[db.worker] onerror:', detail, e)
    rejectAllPending(new Error(`Worker error: ${detail}`))
  }

  worker.onmessageerror = (e) => {
    console.error('[db.worker] onmessageerror:', e)
    rejectAllPending(new Error('Worker message channel error'))
  }

  // Timeout no init evita travar pra sempre se o worker engasgar.
  // Operações subsequentes não usam timeout — assumem que o canal está saudável.
  // V10.11 — payload `schema` removido; worker importa direto.
  const initCall = call<InitResult>('init')
  let idle: ReturnType<typeof setTimeout> | undefined
  let cap: ReturnType<typeof setTimeout> | undefined
  const stopTimers = () => {
    onInitProgress = null
    onInitOpened = null
    clearTimeout(idle)
    clearTimeout(cap)
  }
  const timeout = new Promise<never>((_, reject) => {
    const fail = (message: string) => {
      stopTimers()
      // Encerra o worker: senão ele segue escrevendo no OPFS e a próxima
      // tentativa (ou a recarga) disputa o journal com ele.
      worker?.terminate()
      worker = null
      const err = new Error(message)
      rejectAllPending(err)
      reject(err)
    }
    // O texto aparece na tela de erro do boot: linguagem simples, e nunca
    // empurrar para "limpar local" (apaga a identidade se não foi exportada).
    // O detalhe técnico vai para o console.
    const KEEP =
      'Feche as outras abas do Drift e toque em “↻ forçar atualização”, abaixo. Seus dados continuam aqui. Só use “limpar local” se isso não resolver — ele apaga a sua identidade se você não a exportou.'
    let opened = false
    const arm = () => {
      clearTimeout(idle)
      if (opened) return // banco aberto: só o teto total
      idle = setTimeout(() => {
        console.error(`[db] init do worker SQLite sem sinal de vida por ${INIT_IDLE_TIMEOUT_MS} ms (WASM ou OPFS?)`)
        fail(
          `O Drift ficou ${INIT_IDLE_TIMEOUT_MS / 1000} segundos sem conseguir abrir os dados guardados neste aparelho. ${KEEP}`,
        )
      }, INIT_IDLE_TIMEOUT_MS)
    }
    onInitProgress = arm
    onInitOpened = () => {
      opened = true
      clearTimeout(idle)
    }
    arm()
    cap = setTimeout(() => {
      console.error(`[db] init do worker SQLite passou de ${INIT_MAX_MS} ms`)
      fail(`O Drift levou mais de ${INIT_MAX_MS / 60_000} minutos para abrir os dados deste aparelho. ${KEEP}`)
    }, INIT_MAX_MS)
  })

  initPromise = Promise.race([initCall, timeout]).then(
    (result) => {
      stopTimers()
      return result
    },
    (err) => {
      stopTimers()
      // libera initPromise para retentativa após erro
      initPromise = null
      throw err
    },
  )

  return initPromise
}

export const db = {
  /** SELECT que retorna múltiplas linhas, cada uma como objeto. */
  exec: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    call<T[]>('exec', { sql, params }),

  /** INSERT/UPDATE/DELETE. Não retorna linhas. */
  run: (sql: string, params?: unknown[]) => call<void>('run', { sql, params }),

  /**
   * Executa N writes numa ÚNICA transação + 1 roundtrip postMessage.
   * Colapsa o custo serializado de muitos `run()` (cada um = 1 roundtrip).
   * Usado pelo dev-seed drain. Atômico (BEGIN/COMMIT no worker).
   */
  batch: (ops: Array<{ sql: string; params?: unknown[] }>) =>
    call<void>('batch', { ops }),

  /** SELECT que retorna a primeira linha ou null. */
  get: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    call<T | null>('get', { sql, params }),

  /**
   * Reconstrói o schema de domínio. Drop + recreate de posts, spreads,
   * buries, reports, users, follows, sync_log, pinned. **Preserva
   * identity + user_prefs**.
   *
   * Usado pra recuperar de schema corrompido/desatualizado quando a
   * migração não pegou. Manifesto §3 (dispositivo descartável,
   * identidade não): user perde só o cache, identidade segue.
   *
   * Após chamar, é típico fazer `location.reload()` pro sync ressincar
   * dos relays a partir do zero.
   */
  rebuildDomainSchema: () => call<void>('rebuild'),
}
