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
 *  - Timeout de 15s no init (caso WASM demore demais ou trave)
 *  - worker.onerror / onmessageerror rejeitam promises pendentes
 *    (caso contrário um worker que falha silenciosamente trava o boot)
 */

// V10.11 — schema importado AGORA dentro do worker (db.worker.ts).
// Antes ficava aqui no main thread só pra ser enviado via postMessage,
// inchando o entry chunk em ~13 KB raw / ~4 KB gz sem benefício
// (schema é usado uma única vez no init e nunca mais — desperdício de
// parse + heap). Lighthouse `unused-javascript` audit identificou.
const INIT_TIMEOUT_MS = 15_000

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

export function initDb(): Promise<InitResult> {
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
    }

    // log do worker — útil pra debug
    if (data.log) {
      console.log('[db.worker]', data.log)
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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `Init do SQLite worker excedeu ${INIT_TIMEOUT_MS}ms. Verifique o console — provável erro carregando o WASM ou abrindo OPFS.`,
        ),
      )
    }, INIT_TIMEOUT_MS)
  })

  initPromise = Promise.race([initCall, timeout]).catch((err) => {
    // libera initPromise para retentativa após erro
    initPromise = null
    throw err
  })

  return initPromise
}

export const db = {
  /** SELECT que retorna múltiplas linhas, cada uma como objeto. */
  exec: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    call<T[]>('exec', { sql, params }),

  /** INSERT/UPDATE/DELETE. Não retorna linhas. */
  run: (sql: string, params?: unknown[]) => call<void>('run', { sql, params }),

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
