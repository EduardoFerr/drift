/**
 * LensInspector — chip discreto + sheet de explicação no PostViewer.
 *
 * Chip aparece no canto inferior-direito do card APENAS quando a Trust
 * Lens está ativa (strength > 0) E o post foi efetivamente reordenado
 * (autor tem PPR > 0 OU houve drift mútuo no entorno). Tap → sheet com
 * 1-2 frases explicando por que.
 *
 * Conteúdo da sheet:
 *   - "@<short> (que você acompanha) deu drift neste post."
 *   - "@<short> (autor) é seguido por N pessoas que você acompanha."
 *
 * SEM score numérico. SEM grafo desenhado. SEM npub completo (apenas
 * short alias). Barney P0.5 — path leak guard: npubs NUNCA são logged,
 * sheet content NUNCA persisted. Manifesto §28.
 *
 * Acessibilidade:
 *   - Chip ≥44px hit area (h-11 min-w-[44px])
 *   - aria-label descritivo
 *   - SlideUpOverlay já implementa focus trap + ESC
 *
 * Plano: `Docs/plans/trust-lens-phase1-plan.md` §1.5 (Lily decisions).
 */

import { useEffect, useState } from 'react'
import { db } from '../../lib/db'
import { useFollowsStore } from '../../lib/follows'
import { useLensStore, getPprForAuthor } from '../../lib/trust-lens'
import { usePrefsStore } from '../../lib/prefs'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { EyeIcon } from '../UI/Icons'

interface InspectorProps {
  postId: string
  authorPub: string
}

interface InspectorData {
  /** Quantas pessoas que eu sigo deram drift neste post. */
  followsDrifted: number
  /** Quantas pessoas que eu sigo também seguem o autor (FoF count). */
  authorFofCount: number
  /** Short alias de um drifter conhecido (primeiro encontrado). */
  driftedExample: string | null
}

function shortAlias(npub: string): string {
  return `anon…${npub.slice(-6)}`
}

export function LensInspector({ postId, authorPub }: InspectorProps) {
  const strength = useLensStore((s) => s.strength)
  const following = useFollowsStore((s) => s.following)
  // PR-5 (2026-05-20): opt-in indicator visual. Default OFF — chip
  // existente já comunica "lente atuou aqui" para quem investiga.
  // Quando ON, adiciona glyph ↕ + estilo filled (mais visível). User
  // power que quer ver explicitamente cada reorder ativa.
  const showReorderIndicator = usePrefsStore(
    (s) => s.lens_show_reorder_indicator,
  )
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<InspectorData | null>(null)

  // Compute "should chip show" — strength > 0 E lens tocou no post.
  const pprAuthor = getPprForAuthor(authorPub)
  const shouldShow = strength > 0 && (pprAuthor > 0 || following.has(authorPub))

  useEffect(() => {
    if (!open || data) return
    let cancelled = false
    void (async () => {
      // Drifters que eu sigo (intersection no SQL pra evitar full scan).
      const rows = await db.exec<{ spreader_pub: string }>(
        `SELECT spreader_pub FROM spreads WHERE post_id = ? LIMIT 200`,
        [postId],
      )
      const drifted = rows
        .map((r) => r.spreader_pub)
        .filter((pub) => following.has(pub))
      const fofRows = await db.exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM follows
         WHERE following_pub = ?
           AND follower_pub IN (
             SELECT following_pub FROM follows WHERE follower_pub = (
               SELECT value FROM user_prefs WHERE key = 'active_identity'
             )
           )`,
        [authorPub],
      )
      const fof = fofRows[0]?.n ?? 0
      if (cancelled) return
      setData({
        followsDrifted: drifted.length,
        authorFofCount: fof,
        driftedExample: drifted[0] ?? null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [open, postId, authorPub, following, data])

  if (!shouldShow) return null

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={`absolute bottom-4 right-4 z-30 inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full px-3 backdrop-blur-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/50 ${
          showReorderIndicator
            ? 'border border-drift-accent2 bg-drift-accent2/15 text-drift-accent2 hover:bg-drift-accent2/25'
            : 'border border-drift-accent2/40 bg-drift-surface/85 text-drift-accent2 hover:border-drift-accent2 hover:bg-drift-surface/95'
        }`}
        aria-label={
          showReorderIndicator
            ? 'este post foi reordenado pela lente — toque pra entender'
            : 'por que este post está aqui'
        }
        title={
          showReorderIndicator
            ? 'reordenado pela lente'
            : 'por que este post está aqui'
        }
        data-no-longpress="true"
      >
        <EyeIcon size={14} />
        <span className="font-mono text-[10px] uppercase tracking-meta">
          {showReorderIndicator ? 'lente ↕' : 'lente'}
        </span>
      </button>

      {open && (
        <SlideUpOverlay onClose={() => setOpen(false)} ariaLabel="por que este post está aqui">
          <ModalHeader title="sua lente" onClose={() => setOpen(false)} />
          <div className="space-y-3 px-1 pt-1 font-mono text-[12px] leading-relaxed text-drift-text">
            {data === null ? (
              <p className="text-drift-muted/60">analisando…</p>
            ) : (
              <>
                {data.followsDrifted > 0 && (
                  <p>
                    <span className="text-drift-accent2">
                      {data.driftedExample
                        ? shortAlias(data.driftedExample)
                        : `${data.followsDrifted} pessoa(s) que você acompanha`}
                    </span>{' '}
                    {data.followsDrifted > 1 && data.driftedExample
                      ? `e mais ${data.followsDrifted - 1}`
                      : ''}{' '}
                    deu drift neste post.
                  </p>
                )}
                {data.authorFofCount > 0 && (
                  <p>
                    <span className="text-drift-accent2">{shortAlias(authorPub)}</span>{' '}
                    (autor) é seguido por {data.authorFofCount} pessoa(s) que
                    você acompanha.
                  </p>
                )}
                {data.followsDrifted === 0 && data.authorFofCount === 0 && (
                  <p className="text-drift-muted/70">
                    A Lente está ativa, mas não encontrou sinais diretos da
                    sua rede neste post. O reordenamento veio do entorno
                    indireto.
                  </p>
                )}
                <p className="pt-2 text-[10px] uppercase tracking-meta text-drift-muted/40">
                  análise local — manifesto §24
                </p>
              </>
            )}
          </div>
        </SlideUpOverlay>
      )}
    </>
  )
}
