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

  const event = await signDriftEvent({
    kind: DRIFT_KIND.POST,
    tags,
    content: JSON.stringify({ subposts: input.subposts }),
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

export async function reportPost(input: ReportPostInput): Promise<SignedEvent> {
  const event = await signDriftEvent({
    kind: DRIFT_KIND.REPORT,
    tags: [
      ['e', input.postId],
      ['p', input.authorPub],
      ['reason', input.reason],
    ],
    content: '',
  })
  await publishToRelays(event)
  return event
}
