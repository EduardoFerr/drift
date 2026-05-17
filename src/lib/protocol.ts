/**
 * Protocolo Drift — operações públicas que clientes alternativos
 * também implementariam.
 *
 * Cada função aqui:
 *   1. Recebe parâmetros do domínio
 *   2. Monta evento no schema Drift (kinds 9078..9081, regular events)
 *   3. Assina com o nsec local
 *   4. Publica em todos os relays
 *   5. Retorna o evento publicado
 *
 * IMPORTANTE: NÃO escreve no SQLite. Materialização é trabalho
 * exclusivo de onNostrEvent() (events.ts). Quando o relay confirma,
 * o evento volta pelo subscribe ativo e é persistido lá.
 *
 * ─── Sobre tags `e` e `p` (NIP-01) ─────────────────────────────────
 *
 * NIP-01 define `e` como **event id em hex 64-char** (SHA256 do evento)
 * e `p` como **pubkey em hex 64-char**. nostr-tools VALIDA esses
 * tamanhos no `_onmessage` do relay e descarta eventos malformados.
 *
 * Por isso:
 *  - `createPost` retorna o evento assinado; o caller (App.tsx) usa
 *    `event.id` (hex 64) como identificador local do post (vai pra
 *    `posts.id` no SQLite).
 *  - `spreadPost`/`buryPost`/`reportPost` recebem `postId` que DEVE
 *    ser o `event.id` hex do post (não UUID, não d-tag).
 *  - `authorPub` em todas as variações é hex 64 (o `pubkey` do post,
 *    direto de `event.pubkey`).
 */

import { signDriftEvent, publishToRelays } from './nostr'
import { DRIFT_KIND, CLIENT_ID, DRIFT_VERSION } from '../config/constants'
import { normalizeLayout } from '../types/drift'
import { buildImetaTag } from './nip94'
import type { BlobMeta } from './nip94'
import type {
  Subpost,
  GeoPoint,
  ReportReason,
  ContentWarning,
} from '../types/drift'
import type { SignedEvent } from '../types/nostr'

function locationTag(loc: GeoPoint | null | undefined): string[] | null {
  if (!loc) return null
  return ['location', String(loc.lat), String(loc.lng), loc.city, loc.country]
}

// ─── Post (kind 9078) ────────────────────────────────────────────────

export interface CreatePostInput {
  subposts: Subpost[]
  category?: string
  location?: GeoPoint
  /**
   * Auto-classificação voluntária pelo autor (manifesto §27).
   * Aceita os 4 valores conhecidos ou string livre. Cliente oficial
   * só renderiza tratamento específico pros 4 conhecidos; livre fica
   * só como "marcado".
   */
  contentWarning?: ContentWarning | string
  /**
   * Metadados NIP-94 dos blobs anexados (Track B.2). Cada `BlobMeta`
   * vira uma tag `imeta` no evento, na ordem em que aparece no array.
   * Convenção Drift (RFC §3.5.3): a ordem das imetas tags casa com a
   * ordem dos `subposts[i].imageUrl` no JSON. Reader Drift usa isso
   * pra resolver `cid`/`hash` do subpost correspondente.
   *
   * Posts sem imeta (legacy ou só-texto) continuam válidos — readers
   * caem pro `imageUrl` do subpost diretamente, sem hash verify.
   */
  imetas?: BlobMeta[]
}

/**
 * Publica um post Drift. O identificador local do post pós-publicação
 * é `event.id` (hex 64) — caller usa isso pra spread/bury/report.
 *
 * Não usamos `d` tag pra identificar o post: kind 9078 é regular event
 * (faixa 1..9999), `d` tag não tem semântica protocolar aqui (NIP-01
 * só usa `d` em parameterized replaceable, faixa 30000..39999). Drift
 * usa `event.id` como identificador, igual qualquer evento Nostr.
 */
export async function createPost(input: CreatePostInput): Promise<SignedEvent> {
  const tags: string[][] = [
    ['drift-version', DRIFT_VERSION],
    ['client', CLIENT_ID],
  ]
  if (input.category) tags.push(['category', input.category])
  if (input.contentWarning) tags.push(['content-warning', input.contentWarning])
  const loc = locationTag(input.location)
  if (loc) tags.push(loc)

  // NIP-94 imeta tags — Track B.2. Cada blob anexado vira uma tag.
  // Compat: clientes não-Drift com NIP-94 renderizam via `url`.
  // Cliente Drift com Helia prefere `cid`. RFC §6.
  if (input.imetas) {
    for (const meta of input.imetas) {
      try {
        tags.push(buildImetaTag(meta))
      } catch (err) {
        // Meta mal-formada (sem url/cid ou valor com espaço) — log e
        // pula; outros subposts continuam válidos.
        console.warn('[protocol] imeta inválida pulada:', err)
      }
    }
  }

  // V4: normaliza layout no write path. Drafts vêm do SubpostEditor com
  // layout = LayoutKind explícito (3 chips no footer); se vier undefined
  // por qualquer motivo (caller programático), normalizeLayout aplica
  // DEFAULT_LAYOUT. Garante que content JSON na rede tem sempre valor
  // canônico — outros clientes Drift que NÃO chamem parseSubposts
  // (parsing direto do raw_event) ainda veem o enum válido.
  const subposts = input.subposts.map((s) => ({
    ...s,
    layout: normalizeLayout(s.layout),
  }))

  const event = await signDriftEvent({
    kind: DRIFT_KIND.POST,
    tags,
    content: JSON.stringify({ subposts }),
  })
  await publishToRelays(event)
  return event
}

// ─── Spread (kind 9079) ──────────────────────────────────────────────

export interface SpreadPostInput {
  /** event.id hex 64 do post sendo espalhado. NIP-01 exige hex 64 em `e`. */
  postId: string
  /** pubkey hex 64 do autor do post. NIP-01 exige hex 64 em `p`. */
  authorPub: string
  location?: GeoPoint
}

export async function spreadPost(input: SpreadPostInput): Promise<SignedEvent> {
  const tags: string[][] = [
    ['e', input.postId],
    ['p', input.authorPub],
  ]
  const loc = locationTag(input.location)
  if (loc) tags.push(loc)

  const event = await signDriftEvent({
    kind: DRIFT_KIND.SPREAD,
    tags,
    content: '',
  })
  await publishToRelays(event)
  return event
}

// ─── Bury (kind 9080) ────────────────────────────────────────────────

export interface BuryPostInput {
  /** event.id hex 64 do post sendo enterrado. */
  postId: string
}

export async function buryPost(input: BuryPostInput): Promise<SignedEvent> {
  // Sem 'p' tag — enterro é silencioso, não notifica autor
  // Sem 'reason' — não precisa justificar (já que não é punição)
  const event = await signDriftEvent({
    kind: DRIFT_KIND.BURY,
    tags: [['e', input.postId]],
    content: '',
  })
  await publishToRelays(event)
  return event
}

// ─── Report (kind 9081) ──────────────────────────────────────────────

export interface ReportPostInput {
  /** event.id hex 64 do post sendo reportado. */
  postId: string
  /** pubkey hex 64 do autor do post reportado. */
  authorPub: string
  reason: ReportReason
}

// ─── Comment (kind 1111 NIP-22) — Track C ────────────────────────────

/**
 * Kind NIP-22 — não vive em DRIFT_KIND porque é padrão Nostr reusado
 * (manifesto §29). Drift adiciona tags `drift-version` + `client` sem
 * quebrar compat com clientes NIP-22-aware (habla.news, Highlighter).
 */
const NIP22_COMMENT_KIND = 1111

/** Cap em chars de content de comment (Drift convention).
 *  Uniformizado com DRIFT_LIMITS.TEXT_MAX_CHARS (post text limit) em
 *  2026-05-08 (user feedback): mesma constante pra ambos previne
 *  divergência visual + força brevidade. 256 = power-of-2 byte-economy. */
export const COMMENT_MAX_CHARS = 256

/**
 * Placeholder mínimo usado quando reply é só-imagem (texto vazio + blob).
 * NIP-22 não exige content específico, mas o Drift schema check exige
 * content non-empty. Este símbolo passa o check e é convencionalmente
 * exibido pra leitores como "anexo" — comportamento idiomático.
 */
export const COMMENT_IMAGE_ONLY_PLACEHOLDER = '📎'

export interface CommentOnPostInput {
  /** event.id hex 64 do post raiz (kind 9078 Drift). */
  postId: string
  /** pubkey hex 64 do autor do post raiz. */
  postAuthorPub: string
  /**
   * Parent direto da resposta. Se top-level reply ao post: igual a
   * `postId` + `replyToKind: '9078'` + `replyToAuthorPub: postAuthorPub`.
   * Se reply a outro comment: id desse comment + kind '1111' + pubkey
   * do autor desse comment.
   */
  replyTo: string
  replyToKind: string
  replyToAuthorPub: string
  /** Texto do comentário (≤ 1000 chars). */
  text: string
  /** Auto-classificação opcional (manifesto §27). C.6.2. */
  contentWarning?: ContentWarning | string
  /**
   * C.6.3 — Metadados NIP-94 dos blobs anexados (Track B integration).
   * Cap convencional Drift: 1 imagem por comment (vs N em POST). Caller
   * já passa o array com cap aplicado; `commentOnPost` não força — só
   * emite as tags `imeta` na ordem recebida.
   */
  imetas?: BlobMeta[]
}

/**
 * Publica um comentário NIP-22. Cliente NÃO escreve em SQLite — evento
 * volta pelo subscribe ativo e onNostrEvent persiste (invariante #1).
 *
 * Wire format NIP-22:
 *   E/K/P (maiúsculas) = root marker
 *   e/k/p (minúsculas) = direct parent
 *
 * Drift extensions (`drift-version`, `client`) são metadata adicional —
 * clientes NIP-22 não-Drift ignoram silenciosamente.
 */
export async function commentOnPost(input: CommentOnPostInput): Promise<SignedEvent> {
  const text = input.text
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('commentOnPost: text vazio')
  }
  if (text.length > COMMENT_MAX_CHARS) {
    throw new Error(`commentOnPost: text excede ${COMMENT_MAX_CHARS} chars`)
  }

  const tags: string[][] = [
    // root marker (NIP-22 padrão)
    ['E', input.postId, '', input.postAuthorPub],
    ['K', String(9078)],
    ['P', input.postAuthorPub],
    // direct parent (NIP-22 padrão; em top-level reply, mesmo do root)
    ['e', input.replyTo, '', input.replyToAuthorPub],
    ['k', input.replyToKind],
    ['p', input.replyToAuthorPub],
    // Drift extensions
    ['drift-version', DRIFT_VERSION],
    ['client', CLIENT_ID],
  ]
  if (input.contentWarning) tags.push(['content-warning', input.contentWarning])

  // C.6.3 — imeta tags pra blobs anexados (mesmo pattern de createPost).
  // Tags imeta mal-formadas (sem url/cid ou valor com espaço) são puladas
  // com warning; comment continua publicável só com texto.
  if (input.imetas) {
    for (const meta of input.imetas) {
      try {
        tags.push(buildImetaTag(meta))
      } catch (err) {
        console.warn('[protocol] imeta inválida pulada (comment):', err)
      }
    }
  }

  const event = await signDriftEvent({
    kind: NIP22_COMMENT_KIND,
    tags,
    content: text,
  })
  await publishToRelays(event)
  return event
}

/**
 * Publica DUAL report (kind 9081 Drift native + kind 1984 NIP-56).
 *
 * Manifesto §29 (compat Nostr) — Drift agora interopera com Damus,
 * Snort, Iris via NIP-56 sem perder pipeline interno (weight,
 * threshold dinâmico §26). Ingestão local via `onNostrEvent` dedupliza
 * via UNIQUE (post_id, reporter_pub).
 *
 * Retorna o evento PRIMÁRIO (9081) pra compat com callers existentes
 * que esperam SignedEvent único. O evento 1984 vai pros mesmos relays
 * lado-a-lado, fire-and-forget.
 *
 * Privacy WARNING — D4 do plano relay moderation: reporter pubkey é
 * PÚBLICO em AMBOS os eventos (assinatura Schnorr). UI deve avisar
 * antes de chamar isso. Multi-identidade (§15) permite usar nsec
 * descartável pra reports sensíveis.
 */
export async function reportPost(input: ReportPostInput): Promise<SignedEvent> {
  const { mapDriftToNip56 } = await import('./nip56-mapping')
  const nip56Type = mapDriftToNip56(input.reason)

  // Kind 9081 Drift native — pipeline interno (weight + threshold §26).
  const event9081 = await signDriftEvent({
    kind: DRIFT_KIND.REPORT,
    tags: [
      ['e', input.postId],
      ['p', input.authorPub],
      ['reason', input.reason],
    ],
    content: '',
  })

  // Kind 1984 NIP-56 — compat ecossistema Nostr. report_type vai
  // como [3] de `e`/`p` (spec literal). Drift-version tag distingue
  // emit Drift do externo (anti-weaponization cross-client).
  const event1984 = await signDriftEvent({
    kind: 1984,
    tags: [
      ['e', input.postId, '', nip56Type],
      ['p', input.authorPub, '', nip56Type],
      ['drift-version', '1'],
    ],
    content: '',
  })

  // Broadcast paralelo — ambos os events vão pros mesmos relays.
  // 9081 retornado primeiro pra preservar API callers; 1984 não-aguardado
  // já é publicado em paralelo. Eventual failure de 1984 não bloqueia.
  const publish9081 = publishToRelays(event9081)
  const publish1984 = publishToRelays(event1984).catch((err) => {
    // Log mas não throw — 9081 é o caminho crítico pro pipeline interno.
    console.warn('[protocol] NIP-56 (kind 1984) publish falhou:', err)
  })
  await Promise.all([publish9081, publish1984])

  return event9081
}
