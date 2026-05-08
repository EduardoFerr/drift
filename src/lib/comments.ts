/**
 * Track C.3 + C.4.1 — store reativa de comments + tree assembly +
 * lazy subscribe controller (per postId).
 *
 * Camadas:
 *   - `buildThread(rows)` — função PURA: rows ordenados → forest top-level
 *     com replies aninhadas. Determinístico (manifesto §7).
 *   - `loadThread(postId)` — carrega rows do SQLite, popula store.
 *     Idempotente (re-chamar atualiza com novos rows).
 *   - `addCommentToStore(postId, row)` — gancho pra `events.ts:onNostrEvent`
 *     enfiar um comment recém-chegado sem re-ler do banco. Marshall liga
 *     em C.5; aqui só expomos a função.
 *   - `subscribeComments(postId)` — orchestrator subscribe lazy filtrando
 *     `kind 1111 #E [postId]`. Retorna `Unsubscribe`. Refcount per
 *     postId (Ted Issue #4 design-comments §15) — N consumers compartilham
 *     uma única REQ; cleanup decrementa, último zera dispara unsubscribe.
 *
 * Invariante #1 (CLAUDE.md): comments só entram no SQLite via
 * `events.ts:onNostrEvent` → `persistCommentRow`. Este módulo NÃO
 * insere — só lê do banco e expõe API pra UI consumir reativo.
 */

import { create } from 'zustand'
import { db } from './db'
import { onNostrEvent } from './events'
import { orchestrator } from './transport/orchestrator'
import type { Unsubscribe } from './transport'
import type { CommentRecord } from '../types/drift'
import type { SignedEvent } from '../types/nostr'
import {
  compareComments,
  type CommentNode,
  type ThreadIndex,
} from './thread-cursor'
import { parseImetaTags } from './nip94'

// ─── Constantes ──────────────────────────────────────────────────────

/**
 * Kind NIP-22 — duplicado aqui pra evitar import circular com events.ts.
 * Single source of truth segue em events.ts:NIP22_COMMENT_KIND.
 */
const NIP22_COMMENT_KIND = 1111

/**
 * Hard cap no SELECT inicial — Barney HIGH #2 (design-comments §5.2).
 * Evita despejar threads gigantes (post viral com 10k comments) em
 * memória de uma vez. Pagination/lazy load de mais é trabalho futuro.
 *
 * Trade-off: posts MUITO ativos perdem cauda no carregamento inicial.
 * Live subscribe (orchestrator) continua trazendo novos sem cap até
 * que algum mecanismo de unload entre em jogo.
 */
export const COMMENTS_LOAD_CAP = 200

// ─── Tipos da row ────────────────────────────────────────────────────

interface CommentRow {
  id: string
  post_id: string
  reply_to: string
  author_pub: string
  content: string
  created_at: number
  score: number
  /** C.6.2 — content_warning. NULL em rows v8 pré-migração. */
  content_warning: string | null
  /**
   * C.6.3 — JSON do evento original (sempre presente em v8+). Usado pra
   * extrair imeta tags no read path. Coluna existe desde Track C.1; se
   * por qualquer motivo vier null/inválido, comment continua só-texto.
   */
  raw_event: string | null
}

function rowToRecord(r: CommentRow): CommentRecord {
  // C.6.3 — parsing imeta best-effort. Cap convencional: 1 imagem por
  // comment (vs N em Post). Se autor publicou múltiplas imetas (cliente
  // alternativo ou bug), pega só a primeira.
  let meta: import('./nip94').BlobMeta | undefined
  if (r.raw_event) {
    try {
      const ev = JSON.parse(r.raw_event) as SignedEvent
      const metas = parseImetaTags(ev)
      if (metas.length > 0) meta = metas[0]
    } catch {
      // raw_event corrompido — ignora, comment renderiza só-texto.
    }
  }
  return {
    id: r.id,
    postId: r.post_id,
    replyTo: r.reply_to,
    authorPub: r.author_pub,
    content: r.content,
    createdAt: r.created_at,
    score: r.score,
    contentWarning: r.content_warning,
    meta,
  }
}

// ─── buildThread (puro) ──────────────────────────────────────────────

/**
 * Assembly de rows → forest. Determinístico:
 *   1. sort por (created_at ASC, id ASC)
 *   2. node por id, replies append-order = sort-order
 *   3. roots = nodes com `reply_to === post_id`
 *   4. órfãos (parent ainda não chegou) ⇒ exibidos como top-level
 *      temporário até o parent aparecer (§16 disponibilidade).
 *
 * Score = -999 esconde do thread (manifesto §17). Filtra aqui.
 */
export function buildThread(rows: CommentRecord[]): CommentNode[] {
  const visible = rows.filter((r) => r.score > -999)
  const sorted = [...visible].sort(compareComments)

  const byId = new Map<string, CommentNode>()
  for (const r of sorted) {
    byId.set(r.id, {
      id: r.id,
      post_id: r.postId,
      reply_to: r.replyTo,
      author_pub: r.authorPub,
      content: r.content,
      created_at: r.createdAt,
      score: r.score,
      replies: [],
      content_warning: r.contentWarning ?? null,
      meta: r.meta,
    })
  }

  const roots: CommentNode[] = []
  for (const r of sorted) {
    const node = byId.get(r.id)!
    const isTopLevel = r.replyTo === r.postId
    if (isTopLevel) {
      roots.push(node)
      continue
    }
    const parent = byId.get(r.replyTo)
    if (parent) {
      parent.replies.push(node)
    } else {
      // Órfão: parent ainda não chegou. Exibe como top-level temporário.
      roots.push(node)
    }
  }
  return roots
}

/**
 * Constrói `ThreadIndex` a partir do forest — usado pelas cursor ops
 * (`thread-cursor.ts`) pra navegação O(1).
 */
export function buildThreadIndex(forest: CommentNode[]): ThreadIndex {
  const byId = new Map<string, CommentNode>()
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []

  function visit(node: CommentNode, parentId: string | null): void {
    byId.set(node.id, node)
    if (parentId === null) {
      roots.push(node.id)
    } else {
      const arr = childrenOf.get(parentId) ?? []
      arr.push(node.id)
      childrenOf.set(parentId, arr)
    }
    for (const child of node.replies) visit(child, node.id)
  }

  for (const root of forest) visit(root, null)
  return { byId, childrenOf, roots }
}

// ─── Store ───────────────────────────────────────────────────────────

interface ThreadEntry {
  rows: CommentRecord[]
  forest: CommentNode[]
  index: ThreadIndex
  loading: boolean
}

interface ThreadState {
  threads: Map<string, ThreadEntry>
  /** Bumps a cada mutação — selectors usam pra invalidate. */
  generation: number
}

const INITIAL: ThreadState = {
  threads: new Map(),
  generation: 0,
}

export const useThreadStore = create<ThreadState>(() => INITIAL)

function bumpGeneration(): void {
  useThreadStore.setState((s) => ({ generation: s.generation + 1 }))
}

function setThread(postId: string, entry: ThreadEntry): void {
  useThreadStore.setState((s) => {
    const next = new Map(s.threads)
    next.set(postId, entry)
    return { threads: next, generation: s.generation + 1 }
  })
}

function getThread(postId: string): ThreadEntry | undefined {
  return useThreadStore.getState().threads.get(postId)
}

// ─── loadThread ──────────────────────────────────────────────────────

/**
 * Carrega comments do post no SQLite e popula o store. Idempotente —
 * pode ser chamado várias vezes; cada chamada faz re-query e regenera
 * forest/index. Hard cap em `COMMENTS_LOAD_CAP` (Barney HIGH #2).
 */
export async function loadThread(postId: string): Promise<void> {
  // Marca loading pra UI poder mostrar spinner
  const existing = getThread(postId)
  setThread(postId, {
    rows: existing?.rows ?? [],
    forest: existing?.forest ?? [],
    index: existing?.index ?? buildThreadIndex([]),
    loading: true,
  })

  const rows = await db.exec<CommentRow>(
    `SELECT id, post_id, reply_to, author_pub, content, created_at, score, content_warning, raw_event
       FROM comments
      WHERE post_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [postId, COMMENTS_LOAD_CAP],
  )
  const records = (rows ?? []).map(rowToRecord)
  const forest = buildThread(records)
  const index = buildThreadIndex(forest)
  setThread(postId, { rows: records, forest, index, loading: false })
}

/**
 * Adiciona um comment recém-chegado ao store sem re-ler o banco.
 * Trabalho do gancho em `events.ts:onNostrEvent` (Marshall em C.5)
 * chamar após o INSERT. Idempotente: row com mesmo id sobrescreve.
 *
 * Defesa: ignora silenciosamente se row.postId não bate com o postId
 * passado (defesa em camada — onNostrEvent já valida).
 */
export function addCommentToStore(
  postId: string,
  row: CommentRecord,
): void {
  if (row.postId !== postId) return
  const entry = getThread(postId)
  // Sem entry: store ainda não conhece este postId. Ignora — quando
  // alguém chamar loadThread, vai pegar do banco já com este row.
  if (!entry) return

  // dedup por id
  const filtered = entry.rows.filter((r) => r.id !== row.id)
  filtered.push(row)
  filtered.sort(compareComments)
  // Aplica cap (mantém os mais antigos pra preservar ordering estável,
  // descarta cauda — sync continua entregando, só não infla memória).
  const capped =
    filtered.length > COMMENTS_LOAD_CAP
      ? filtered.slice(0, COMMENTS_LOAD_CAP)
      : filtered
  const forest = buildThread(capped)
  const index = buildThreadIndex(forest)
  setThread(postId, { rows: capped, forest, index, loading: false })
  bumpGeneration()
}

// ─── Subscribe lazy + refcount ───────────────────────────────────────

interface SubRef {
  unsubscribe: Unsubscribe
  refcount: number
}

const activeSubs = new Map<string, SubRef>()

/**
 * Subscribe orchestrator pra kind 1111 com filter `#E: [postId]`.
 * Refcount per postId — N consumers (PostViewer + ThreadView abertos)
 * compartilham UMA REQ. Cleanup decrementa; ao zerar, dispara
 * unsubscribe real (Ted Issue #4 design-comments §15).
 *
 * Entrega eventos pro pipeline canônico via `onNostrEvent` — invariante
 * #1 (única porta INSERT). Não toca SQLite direto.
 */
export function subscribeComments(postId: string): Unsubscribe {
  const existing = activeSubs.get(postId)
  if (existing) {
    existing.refcount += 1
    return makeReleaseFn(postId)
  }

  // Filter NIP-22: #E aponta o root event id (kind 9078 do post).
  // Usamos o uppercase tag pra capturar TOP-LEVEL e nested replies do
  // mesmo post numa só REQ.
  const filter = {
    kinds: [NIP22_COMMENT_KIND],
    '#E': [postId],
  }

  const unsubscribe = orchestrator.subscribe(filter, {
    onevent: async (event: SignedEvent) => {
      try {
        await onNostrEvent(event)
      } catch (err) {
        console.error('[comments] onNostrEvent failed:', err)
      }
    },
    oneose: () => {
      // EOSE — sinaliza fim do histórico. Não precisamos fazer nada
      // especial; loadThread separadamente já cobre rows persistidos.
    },
  })

  activeSubs.set(postId, { unsubscribe, refcount: 1 })
  return makeReleaseFn(postId)
}

function makeReleaseFn(postId: string): Unsubscribe {
  let released = false
  return () => {
    if (released) return
    released = true
    const ref = activeSubs.get(postId)
    if (!ref) return
    ref.refcount -= 1
    if (ref.refcount <= 0) {
      try {
        ref.unsubscribe()
      } catch (err) {
        console.error('[comments] unsubscribe failed:', err)
      }
      activeSubs.delete(postId)
    }
  }
}

/**
 * Test helper — número de REQs ativas. Não usar em produção.
 * Exposto pra `tests/comments-store.test.ts` validar refcount.
 */
export function _activeSubCount(): number {
  return activeSubs.size
}

/**
 * Test helper — refcount de um postId específico. `undefined` se não
 * tem REQ ativa.
 */
export function _refcountOf(postId: string): number | undefined {
  return activeSubs.get(postId)?.refcount
}

/**
 * Test helper — limpa todas as REQs ativas. Usado em `beforeEach` dos
 * tests pra isolamento. Chama unsubscribe de cada uma.
 */
export function _resetSubsForTest(): void {
  for (const ref of activeSubs.values()) {
    try {
      ref.unsubscribe()
    } catch {
      // ignore
    }
  }
  activeSubs.clear()
}
