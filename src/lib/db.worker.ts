/**
 * Web Worker do SQLite WASM.
 *
 * OPFS sync access só funciona dentro de um Worker — daí a separação.
 * Main thread fala com este worker via postMessage; ver db.ts para a
 * API ergonômica.
 *
 * Detecta OPFS na inicialização e cai para fallback IndexedDB-VFS
 * (Safari < 17). Em ambos os casos, a API SQL exposta é idêntica.
 *
 * IMPORTANTE: log() envia mensagens ao main thread (sem `id`) que são
 * tratadas como entradas de console. Útil para diagnosticar travamentos
 * — sem isso, console.log dentro do worker some no DevTools.
 */

import sqlite3InitModule, {
  type BindingSpec,
  type Database,
  type JsStorageDb,
  type OpfsDatabase,
} from '@sqlite.org/sqlite-wasm'

type Sqlite3Static = Awaited<ReturnType<typeof sqlite3InitModule>>

/**
 * Tipo unificado dos modos de DB que abrimos. Em ordem de preferência:
 *
 *   1. OpfsDatabase     — persistente, melhor performance, requer OPFS
 *                        (Chromium + Safari 17+).
 *   2. JsStorageDb (kvvfs) — persistente via localStorage. ~5MB hard
 *                        cap (mas chega + serve pra MVP). Safari antigo,
 *                        Firefox sem OPFS habilitado, contextos não-COI.
 *   3. Database (memória) — não-persistente. Último recurso. Banco some
 *                        ao recarregar a página. Avisa via log.
 *
 * `exec` está em todos os 3.
 */
type SqliteDb = Database | OpfsDatabase | JsStorageDb

/** Modo de storage atualmente em uso — relatado ao main thread no boot. */
type StorageMode = 'opfs' | 'kvvfs' | 'memory'

let db: SqliteDb | null = null
let storageMode: StorageMode = 'memory'

interface InMessage {
  id: number
  type: 'init' | 'exec' | 'run' | 'get' | 'rebuild'
  sql?: string
  params?: unknown[]
  schema?: string
}

interface OutMessage {
  id?: number
  ok?: boolean
  result?: unknown
  error?: string
  log?: string
}

function reply(msg: OutMessage) {
  ;(self as unknown as Worker).postMessage(msg)
}

function log(message: string) {
  reply({ log: message })
}

async function init(schema: string): Promise<{ hasOpfs: boolean; storage: StorageMode }> {
  log('chamando sqlite3InitModule…')
  // O .d.ts em @sqlite.org/sqlite-wasm 3.51.x declara init() sem args,
  // mas o runtime aceita { print, printErr } pra interceptar logs do
  // emscripten. Como queremos os logs aparecendo no console do main
  // thread (debug de inicialização), passamos via cast.
  const sqlite3: Sqlite3Static = await (
    sqlite3InitModule as unknown as (
      opts?: { print?: (...args: unknown[]) => void; printErr?: (...args: unknown[]) => void },
    ) => Promise<Sqlite3Static>
  )({
    print: (...args: unknown[]) => log(`stdout: ${args.join(' ')}`),
    printErr: (...args: unknown[]) => log(`stderr: ${args.join(' ')}`),
  })
  log(`módulo carregado · versão ${(sqlite3 as unknown as { version?: { libVersion?: string } }).version?.libVersion ?? '?'}`)

  // OPFS: persistente, melhor performance.
  // Detecta como em init prévia — namespace `opfs` só presente em
  // ambientes que suportam (Chromium, Safari 17+, contexto crossOriginIsolated).
  const hasOpfs =
    'opfs' in sqlite3 && (sqlite3 as { opfs?: unknown }).opfs !== undefined
  log(`OPFS disponível: ${hasOpfs}`)

  if (hasOpfs) {
    log('abrindo /drift.db via OpfsDb (persistente)…')
    db = new sqlite3.oo1.OpfsDb('/drift.db')
    storageMode = 'opfs'
  } else if (typeof localStorage !== 'undefined' && sqlite3.oo1.JsStorageDb) {
    // Fallback persistente: kvvfs em localStorage. ~5MB hard cap.
    // Adequado pra Safari < 17 e contextos sem OPFS.
    log('OPFS indisponível — abrindo /drift.db via JsStorageDb (localStorage, persistente, ~5MB)…')
    try {
      db = new sqlite3.oo1.JsStorageDb('local')
      storageMode = 'kvvfs'
    } catch (err) {
      log(`JsStorageDb falhou (${err instanceof Error ? err.message : err}); caindo pra memória`)
      db = new sqlite3.oo1.DB('/drift.db', 'ct')
      storageMode = 'memory'
    }
  } else {
    log('OPFS e localStorage indisponíveis — /drift.db em memória (NÃO persiste após reload)')
    db = new sqlite3.oo1.DB('/drift.db', 'ct')
    storageMode = 'memory'
  }
  log(`banco aberto (modo: ${storageMode}) · executando schema…`)

  db.exec(schema)
  log('schema aplicado com sucesso')

  // Migrações idempotentes — pra usuários com banco de fases anteriores.
  // CREATE TABLE IF NOT EXISTS preserva a estrutura antiga; ALTER TABLE
  // adiciona colunas novas. Se ALGUMA migração falha (sqlite-wasm em
  // algum device tem quirks com ALTER TABLE), faz auto-rebuild do schema
  // de domínio — descarta dados de posts/spreads/etc (que re-sincronizam
  // dos relays) preservando identity + user_prefs (que NÃO sincronizam
  // pela rede).
  //
  // Trade-off do auto-rebuild: usuário perde o cache local de posts.
  // Eles voltam pelo subscribe via sync.ts. nsec preservado — identidade
  // continua a mesma. Manifesto §3 (identidade portável, dispositivo
  // descartável) faz isso ser aceitável.
  applyMigrations(schema)

  return { hasOpfs: storageMode === 'opfs', storage: storageMode }
}

const DOMAIN_TABLES = [
  'posts',
  'spreads',
  'buries',
  'reports',
  'users',
  'follows',
  'sync_log',
  'pinned',
  // Fase 5: relays_user também é cache reconstruível (re-discovery via
  // NIP-65 dos contacts repõe). identities/blocked/muted NÃO entram
  // aqui — são estado local do user (identidade não é descartável).
  'relays_user',
] as const

function rebuildDomainSchema(schema: string) {
  if (!db) throw new Error('DB not initialized — rebuildDomainSchema')
  log('reconstruindo schema de domínio (preserva identity + user_prefs)…')
  for (const t of DOMAIN_TABLES) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${t}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`drop ${t} falhou (continuando): ${msg}`)
    }
  }
  // schema.sql usa CREATE TABLE IF NOT EXISTS — recria os DOMAIN_TABLES
  // dropados, mantém identity + user_prefs intactos (não foram dropados).
  db.exec(schema)
  log('schema de domínio reconstruído com sucesso')
}

function tableHasColumn(table: string, column: string): boolean {
  if (!db) return false
  // PRAGMA table_info('posts') retorna [{cid,name,type,notnull,dflt_value,pk}, ...]
  const rows = db.exec({
    sql: `PRAGMA table_info(${table})`,
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

interface ColumnMigration {
  name: string
  table: string
  column: string
  sql: string
}

function applyMigrations(schema: string) {
  if (!db) throw new Error('DB not initialized — applyMigrations')

  const migrations: ColumnMigration[] = [
    {
      // Fase 3 — auto-classificação voluntária (manifesto §27).
      // Posts criados na Fase 2 não têm essa coluna; null é OK.
      name: 'add_content_warning_to_posts',
      table: 'posts',
      column: 'content_warning',
      sql: `ALTER TABLE posts ADD COLUMN content_warning TEXT`,
    },
    {
      // Fase 4 — moderação reativa (manifesto §26). Reports criados
      // antes desta migração não tinham reason. Coluna é nullable na
      // migração (sqlite-wasm em alguns devices/versões falha em
      // ADD COLUMN com NOT NULL DEFAULT). NULL é tratado como 'spam'
      // pela leitura — manifesto §26 trata report sem reason como
      // genérico spam.
      name: 'add_reason_to_reports',
      table: 'reports',
      column: 'reason',
      sql: `ALTER TABLE reports ADD COLUMN reason TEXT`,
    },
    {
      // Fase 5 — multi-identidade (manifesto §4). Coluna `imported`
      // marca identidades trazidas via nsec1 (vs geradas localmente).
      name: 'add_imported_to_identities',
      table: 'identities',
      column: 'imported',
      sql: `ALTER TABLE identities ADD COLUMN imported INTEGER DEFAULT 0`,
    },
    {
      // Fase 5 — relays dinâmicos (manifesto §14). Coluna `last_err`
      // pra rastrear quando o relay deu erro de conexão.
      name: 'add_last_err_to_relays_user',
      table: 'relays_user',
      column: 'last_err',
      sql: `ALTER TABLE relays_user ADD COLUMN last_err TEXT`,
    },
    {
      // Fase 5 — re-broadcast oportunista (manifesto §16). Armazena o
      // evento bruto pra poder republicar quando conecta a relay novo.
      name: 'add_raw_event_to_posts',
      table: 'posts',
      column: 'raw_event',
      sql: `ALTER TABLE posts ADD COLUMN raw_event TEXT`,
    },
    {
      name: 'add_raw_event_to_spreads',
      table: 'spreads',
      column: 'raw_event',
      sql: `ALTER TABLE spreads ADD COLUMN raw_event TEXT`,
    },
    {
      name: 'add_raw_event_to_buries',
      table: 'buries',
      column: 'raw_event',
      sql: `ALTER TABLE buries ADD COLUMN raw_event TEXT`,
    },
  ]

  let anyFailed = false

  for (const m of migrations) {
    // Check via PRAGMA — mais confiável que try/catch sobre mensagem
    // de erro (que varia entre versões do sqlite-wasm).
    let exists = false
    try {
      exists = tableHasColumn(m.table, m.column)
    } catch (err) {
      // Tabela não existe → schema base não foi aplicado; pula a
      // migração (será irrelevante, schema cuida).
      log(`migração ${m.name}: tabela ${m.table} ainda não existe (skip)`)
      continue
    }

    if (exists) {
      log(`migração ${m.name} já estava aplicada (skip)`)
      continue
    }

    try {
      db.exec(m.sql)
      log(`migração aplicada: ${m.name}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`migração ${m.name} FALHOU: ${msg}`)
      anyFailed = true
    }
  }

  // Migração de dados: copia identity (singular, Fase 1-4) pra
  // identities (plural, Fase 5+) se a nova tabela está vazia. NÃO
  // remove identity — fica como single-source pra `identity.ts` legado
  // até multi-identity completo. Idempotente: roda só quando identities
  // está vazio.
  try {
    db.exec(`
      INSERT OR IGNORE INTO identities (npub, label, nsec_encrypted, created_at, imported)
      SELECT npub, NULL, nsec_encrypted, created_at, 0 FROM identity
      WHERE NOT EXISTS (SELECT 1 FROM identities LIMIT 1)
    `)
    log('migração identity → identities concluída (ou já feita)')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`migração identity→identities FALHOU (continuando): ${msg}`)
  }

  // schema_v: marker semântico (não estrutural).
  //
  //   v6 (Abril 2026): posts.id deixou de ser UUID local e passou a
  //   ser `event.id` hex 64 (NIP-01). Bancos pré-v6 têm posts com id
  //   em formato UUID que SPREAD/BURY/REPORT não conseguem referenciar
  //   por `e` tag (rejeitado por nostr-tools). Solução: rebuild do
  //   domínio uma vez. Identidades, prefs e relays preservados;
  //   posts/spreads/etc voltam pelo subscribe.
  //
  // Idempotente via marker em user_prefs. A migração de coluna acima
  // já roda; esta cuida da semântica do conteúdo das colunas.
  try {
    const rows = db.exec({
      sql: `SELECT value FROM user_prefs WHERE key = 'schema_v'`,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as Array<{ value: string }>
    const current = rows.length > 0 ? parseInt(rows[0]!.value, 10) || 0 : 0

    if (current < 6) {
      log(`schema_v=${current} < 6 — rebuild de domínio (posts.id UUID → event.id hex)`)
      rebuildDomainSchema(schema)
    }

    db.exec({
      sql: `INSERT INTO user_prefs (key, value) VALUES ('schema_v', '6')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`migração schema_v=6 FALHOU (continuando): ${msg}`)
  }

  // Auto-recuperação: se alguma migração falhou, rebuild do schema de
  // domínio. Boot continua, app funciona; user perde só o cache local
  // (re-sincroniza dos relays). NÃO aborta boot — manifesto §3
  // (dispositivo descartável, identidade não).
  if (anyFailed) {
    log('migração falhou — auto-rebuild do schema de domínio')
    try {
      rebuildDomainSchema(schema)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`auto-rebuild FALHOU: ${msg}`)
      // Mesmo aqui não aborta — código defensivo nos persists pode dar
      // alguma fluência. Boot terminado, banner de recuperação manual
      // aparece na UI via verifySchema (próximo).
    }
  }
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const { id, type } = e.data
  try {
    if (type === 'init') {
      if (!e.data.schema) throw new Error('init: missing schema')
      const result = await init(e.data.schema)
      reply({ id, ok: true, result })
      return
    }

    if (!db) throw new Error('DB not initialized')

    if (type === 'rebuild') {
      // Recuperação manual disparada pela UI (Settings →
      // "redefinir cache local"). Drop + recreate dos domain tables;
      // identity + user_prefs intactos.
      if (!e.data.schema) throw new Error('rebuild: missing schema')
      rebuildDomainSchema(e.data.schema)
      reply({ id, ok: true })
      return
    }

    // exec/run/get exigem sql; valida cedo pra dar erro claro e
    // permitir TS narrowing.
    const sql = e.data.sql
    if (!sql) throw new Error(`${type}: missing sql`)
    const bind = (e.data.params ?? []) as BindingSpec

    if (type === 'exec') {
      const result = db.exec({
        sql,
        bind,
        returnValue: 'resultRows',
        rowMode: 'object',
      })
      reply({ id, ok: true, result })
      return
    }

    if (type === 'run') {
      db.exec({ sql, bind })
      reply({ id, ok: true })
      return
    }

    if (type === 'get') {
      const rows = db.exec({
        sql,
        bind,
        returnValue: 'resultRows',
        rowMode: 'object',
      })
      reply({ id, ok: true, result: rows[0] ?? null })
      return
    }

    throw new Error(`unknown message type: ${type}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`ERRO em ${type}: ${message}`)
    reply({ id, ok: false, error: message })
  }
}

// Erros não capturados (ex: import do WASM falha) também ficam visíveis
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  log(`unhandledrejection: ${String(e.reason)}`)
})
