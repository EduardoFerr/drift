/**
 * ProfileModal — perfil do user atual.
 *
 * Mostra:
 *   - npub (identidade ativa, formato bech32)
 *   - Label (se multi-identidade tem nome)
 *   - Peso composto + breakdown (antiguidade + engajamento + max subposts)
 *   - Contadores: posts publicados, spreads dados, buries dados,
 *     reports recebidos
 *   - Listas: quantos seguindo, quantos pinned, blocked, muted
 *   - Identidade criada em
 *
 * Manifesto §22: tudo aqui vem de eventos públicos verificáveis.
 * Outros clientes Drift, dados o mesmo conjunto de eventos, calculam
 * os mesmos números. Sem reputação subjetiva.
 */

import { useEffect, useState } from 'react'
import { db } from '../../lib/db'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { useUserWeight } from '../../hooks/useUserWeight'
import { getWeightTier, type WeightTier } from '../../lib/weight'
import { useFollowsStore } from '../../lib/follows'
import { useIdentitiesStore } from '../../lib/identities'
import { useModLocalStore } from '../../lib/moderation-local'
import type { DriftIdentity } from '../../types/drift'

export interface ProfileModalProps {
  identity: DriftIdentity
  onClose: () => void
}

interface AggregateRow {
  posts_count: number
  spreads_given: number
  buries_given: number
  pinned_count: number
}

export function ProfileModal({ identity, onClose }: ProfileModalProps) {
  const userWeight = useUserWeight(identity.npub)
  const followingCount = useFollowsStore((s) => s.following.size)
  const blockedCount = useModLocalStore((s) => s.blocked.size)
  const mutedCount = useModLocalStore((s) => s.muted.size)
  const activeNpub = useIdentitiesStore((s) => s.activeNpub)
  const identitiesList = useIdentitiesStore((s) => s.list)

  const [aggregate, setAggregate] = useState<AggregateRow | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Query consolidada — 1 round-trip pegando todos os contadores.
      const row = await db.get<AggregateRow>(
        `SELECT
           (SELECT COUNT(*) FROM posts WHERE author_pub = ?) AS posts_count,
           (SELECT COUNT(*) FROM spreads WHERE spreader_pub = ?) AS spreads_given,
           (SELECT COUNT(*) FROM buries WHERE burier_pub = ?) AS buries_given,
           (SELECT COUNT(*) FROM pinned) AS pinned_count`,
        [identity.npub, identity.npub, identity.npub],
      )
      if (!cancelled && row) setAggregate(row)
    })()
    return () => {
      cancelled = true
    }
  }, [identity.npub])

  const activeRecord = identitiesList.find((id) => id.npub === activeNpub)
  const label = activeRecord?.label ?? null

  return (
    <SlideUpOverlay onClose={onClose} ariaLabel="perfil">
      <ModalHeader title="perfil" onClose={onClose} />

      <section className="mb-4 rounded border border-drift-border bg-drift-bg/30 p-3">
          {label && (
            <div className="mb-1 text-[12px] text-drift-text">{label}</div>
          )}
          <div className="break-all font-mono text-[10px] text-drift-muted">
            {identity.npubBech32}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-drift-muted">
              criada: {new Date(identity.createdAt).toLocaleString()}
            </span>
            <TierBadge tier={getWeightTier(userWeight.weight)} />
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2 text-center">
          <Stat
            label="max subposts"
            value={String(userWeight.maxSubposts)}
            tooltip="máximo permitido por post; cresce com peso (manifesto §33)"
          />
          <Stat
            label="seguindo"
            value={String(followingCount)}
            tooltip="manifesto §24 — filtragem local, não muda ranking"
          />
        </section>

        {aggregate && (
          <section className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="posts" value={String(aggregate.posts_count)} tooltip="que você publicou" />
            <Stat label="↑ dados" value={String(aggregate.spreads_given)} tone="spread" />
            <Stat label="↓ dados" value={String(aggregate.buries_given)} tone="bury" />
          </section>
        )}

        {(aggregate?.pinned_count || blockedCount || mutedCount) ? (
          <section className="mb-2 flex flex-wrap gap-2 border-t border-drift-border pt-3 text-[10px] text-drift-muted">
            {aggregate && aggregate.pinned_count > 0 && (
              <span>📌 {aggregate.pinned_count} fixados</span>
            )}
            {blockedCount > 0 && <span>⊘ {blockedCount} bloqueados</span>}
            {mutedCount > 0 && <span>🔇 {mutedCount} silenciados</span>}
          </section>
        ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-drift-muted">
        Manifesto §22 — score determinístico. Esses números vêm de eventos
        Nostr públicos; qualquer cliente Drift calcula os mesmos a partir
        do mesmo conjunto.
      </p>
    </SlideUpOverlay>
  )
}

function TierBadge({ tier }: { tier: WeightTier | null }) {
  if (tier === null) return null
  const config =
    tier === 'established'
      ? { emoji: '🏆', label: 'estabelecido', color: 'text-drift-warning border-drift-warning/40' }
      : tier === 'active'
      ? { emoji: '⭐', label: 'ativo', color: 'text-drift-text border-drift-text/40' }
      : { emoji: '🌱', label: 'novo', color: 'text-drift-spread border-drift-spread/40' }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${config.color}`}
      title="weight é determinístico — função pura de antiquity (semanas) + spreads recebidos. Manifesto §22."
    >
      <span aria-hidden>{config.emoji}</span>
      <span>{config.label}</span>
    </span>
  )
}

function Stat({
  label,
  value,
  tone,
  tooltip,
}: {
  label: string
  value: string
  tone?: 'accent' | 'spread' | 'bury'
  tooltip?: string
}) {
  const color =
    tone === 'accent'
      ? 'text-drift-accent'
      : tone === 'spread'
      ? 'text-drift-spread'
      : tone === 'bury'
      ? 'text-drift-bury'
      : 'text-drift-text'
  return (
    <div className="rounded border border-drift-border/60 bg-drift-bg/30 p-2" title={tooltip}>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-drift-muted">{label}</div>
    </div>
  )
}
