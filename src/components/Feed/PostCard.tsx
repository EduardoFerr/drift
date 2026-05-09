/**
 * PostCard — render compacto de um post no feed list.
 *
 * Extraído de App.tsx em V_pre0 do redesign visual v0.7 (sessão
 * 2026-05-04, HIMYM Round 1 recomendou). Reduz cognitive load do
 * App.tsx e prepara terreno pra V3.1 reskin (card stack shadow layers,
 * Syne typography, paleta v0.7).
 *
 * Comportamento idêntico ao inline anterior — só re-localizado.
 *
 * V3.1 (futuro) vai aplicar:
 * - Title em font-display Syne 700
 * - Stat "DERIVA" em DM Mono
 * - Card stack 2 shadow cards atrás (Tinder-style)
 * - Tokens drift-text/drift-muted no lugar de slate-*
 */

import type { Post } from '../../types/drift'
import { timeAgo } from '../../lib/format'

export function PostCard({
  post,
  isMine,
  pending,
  myAction,
  capturingLocation,
  blurred,
  onOpen,
  onSpread,
  onBury,
}: {
  post: Post
  isMine: boolean
  pending: 'spread' | 'bury' | null
  /**
   * Última ação do user neste post (lida do SQLite). Usado pra destacar
   * o botão correspondente — semântica "última ação vale". `null` quando
   * o user ainda não interagiu.
   */
  myAction: 'spread' | 'bury' | null
  /** GPS capture em curso pra spread/bury deste post (até 8s). */
  capturingLocation: boolean
  blurred: boolean
  onOpen: () => void
  onSpread: () => void
  onBury: () => void
}) {
  const text = post.subposts[0]?.text ?? '(sem conteúdo de texto)'
  const hasImage = post.subposts.some((s) => s.imageUrl)
  // Optimistic UI (manifesto §10 + arquitetura §2.4): mostra +1 imediato
  // quando o user acaba de driftar/sinkar. Quando o evento real chega
  // via subscribe, persistSpread/Bury → recalculateScore atualiza
  // post.spreads/buries no banco e `pending` é limpo pelo useEffect que
  // observa getMyAction. Daí o "+1 optimistic" some sem flicker porque
  // post.spreads do banco já incluiu o evento.
  const displaySpreads = post.spreads + (pending === 'spread' ? 1 : 0)
  const displayBuries = post.buries + (pending === 'bury' ? 1 : 0)

  // Estado visual efetivo dos botões: pending (em vôo) toma precedência,
  // depois myAction (confirmada). Botão destacado = última ação do user.
  const effectiveAction: 'spread' | 'bury' | null = pending ?? myAction
  const spreadActive = effectiveAction === 'spread'
  const buryActive = effectiveAction === 'bury'

  return (
    <article className="rounded border border-drift-border bg-drift-surface p-4">
      <div className="mb-2 flex items-center justify-between text-fluid-xs text-drift-muted">
        <span>
          {isMine ? 'você' : 'anon'}…{post.authorPub.slice(-8)} · {timeAgo(post.createdAt)}
          {post.contentWarning && (
            <span
              className="ml-2 rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-300"
              title="aviso declarado pelo autor (manifesto §27)"
            >
              ⚠ {post.contentWarning}
            </span>
          )}
        </span>
        <span title={`drifts ${displaySpreads} · sinks ${displayBuries}`}>
          DERIVA <span className="text-drift-accent2">{post.score.toFixed(3)}</span>
        </span>
      </div>

      <button
        onClick={onOpen}
        className="block w-full text-left"
        aria-label="abrir post em tela cheia"
      >
        <div
          className={`transition-[filter] duration-200 ${
            blurred ? 'select-none blur-md' : ''
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-fluid-lg text-drift-text">
            {text}
          </p>
          {hasImage && (
            <div className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
              [imagem · toque pra abrir]
            </div>
          )}
        </div>
      </button>

      <div className="mt-3 flex items-center justify-between text-[10px]">
        <div className="flex gap-3 text-slate-500">
          <span className="text-drift-spread">↑ {displaySpreads}</span>
          <span className="text-drift-bury">↓ {displayBuries}</span>
          <button
            onClick={onOpen}
            className="text-slate-500 hover:text-drift-accent"
          >
            abrir →
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSpread}
            disabled={pending !== null}
            className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
              spreadActive
                ? 'border-drift-spread bg-drift-spread/15 text-drift-spread'
                : 'border-drift-spread/40 text-drift-spread hover:bg-drift-spread/10'
            }`}
            title={
              capturingLocation && pending === 'spread'
                ? 'capturando localização (até 8s)'
                : myAction === 'spread'
                ? 'você driftou — clique ↓ pra mudar de opinião'
                : undefined
            }
            aria-pressed={spreadActive}
          >
            {pending === 'spread'
              ? capturingLocation
                ? '📍 location…'
                : 'enviando…'
              : '↑ DRIFT'}
          </button>
          <button
            onClick={onBury}
            disabled={pending !== null}
            className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
              buryActive
                ? 'border-drift-bury bg-drift-bury/15 text-drift-bury'
                : 'border-drift-bury/40 text-drift-bury hover:bg-drift-bury/10'
            }`}
            title={
              myAction === 'bury'
                ? 'você sinkou — clique ↑ pra mudar de opinião'
                : undefined
            }
            aria-pressed={buryActive}
          >
            {pending === 'bury' ? 'enviando…' : '↓ SINK'}
          </button>
        </div>
      </div>
    </article>
  )
}
