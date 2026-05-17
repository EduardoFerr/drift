/**
 * ProfileModal — perfil expandido (MVP pós-deliberação HIMYM 2026-05-17).
 *
 * Hero sempre visível (avatar + display_name + npub + tier + idade)
 * seguido de 4 seções accordion: identidade / atividade / peso & alcance /
 * minhas listas.
 *
 * **Manifesto §5.3**: 3 modos canônicos
 *   - Anônimo (default): display_name vazio → "anônimo" italic
 *   - Semi-anônimo: kind 0 com `name`/`display_name`
 *   - Identificado: kind 0 com nome + avatar (`picture`)
 *
 * **§28 / §17**: nenhum campo de kind 0 participa de score/weight/feed
 * ranking (LOCK_VIA_TEST). Identificação é opt-in, default vazio.
 *
 * Edit/reset de kind 0 ficam num sub-card separado (EditProfileCard)
 * com banner inline citando §28 + §5.3 antes do publish.
 */

import { useEffect, useState } from 'react'
import { db } from '../../lib/db'
import { FullPageCard } from '../UI/FullPageCard'
import { Collapse } from '../UI/Collapse'
import { SectionHeader } from '../UI/SectionHeader'
import { DriftButton } from '../UI/DriftButton'
import { useUserWeight } from '../../hooks/useUserWeight'
import { getWeightTier, type WeightTier } from '../../lib/weight'
import { useFollowsStore } from '../../lib/follows'
import { useIdentitiesStore, setActiveIdentity } from '../../lib/identities'
import { useModLocalStore } from '../../lib/moderation-local'
import { useUserMetadata } from '../../lib/profiles'
import { dialog } from '../../lib/dialog'
import { pushLayer } from '../../lib/layer-stack'
import { EditProfileCard } from './EditProfileCard'
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
  comments_authored: number
  spreads_received: number
  reports_received: number
}

export function ProfileModal({ identity, onClose }: ProfileModalProps) {
  const userWeight = useUserWeight(identity.npub)
  const followingCount = useFollowsStore((s) => s.following.size)
  const blockedCount = useModLocalStore((s) => s.blocked.size)
  const mutedCount = useModLocalStore((s) => s.muted.size)
  const activeNpub = useIdentitiesStore((s) => s.activeNpub)
  const identitiesList = useIdentitiesStore((s) => s.list)
  const metadata = useUserMetadata(identity.npub)

  const [aggregate, setAggregate] = useState<AggregateRow | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const toggle = (i: number) => setOpen((prev) => (prev === i ? null : i))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const npub = identity.npub
      const row = await db.get<AggregateRow>(
        `SELECT
           (SELECT COUNT(*) FROM posts    WHERE author_pub = ?) AS posts_count,
           (SELECT COUNT(*) FROM spreads  WHERE spreader_pub = ?) AS spreads_given,
           (SELECT COUNT(*) FROM buries   WHERE burier_pub = ?) AS buries_given,
           (SELECT COUNT(*) FROM pinned)  AS pinned_count,
           (SELECT COUNT(*) FROM comments WHERE author_pub = ?) AS comments_authored,
           (SELECT COUNT(*) FROM spreads s JOIN posts p ON p.id = s.post_id WHERE p.author_pub = ?) AS spreads_received,
           (SELECT COUNT(*) FROM reports  WHERE post_id IN (SELECT id FROM posts WHERE author_pub = ?)) AS reports_received`,
        [npub, npub, npub, npub, npub, npub],
      )
      if (!cancelled && row) setAggregate(row)
    })()
    return () => {
      cancelled = true
    }
  }, [identity.npub])

  const activeRecord = identitiesList.find((id) => id.npub === activeNpub)
  const label = activeRecord?.label ?? null
  const tier = getWeightTier(userWeight.weight)
  const ageWeeks = Math.max(1, Math.floor((Date.now() - identity.createdAt) / (1000 * 60 * 60 * 24 * 7)))

  function openEdit() {
    pushLayer({
      id: 'profile-edit',
      component: EditProfileCard,
      parent: 'profile',
      props: { npub: identity.npub, currentMetadata: metadata },
    })
  }

  async function handleSwitchIdentity(npub: string) {
    if (npub === activeNpub) return
    const target = identitiesList.find((id) => id.npub === npub)
    const targetLabel = target?.label ?? `${npub.slice(0, 8)}…`
    const ok = await dialog.confirm(
      `Trocar para ${targetLabel}? É preciso recarregar pra resetar sync e feed.`,
      { title: 'trocar identidade', okLabel: 'trocar' },
    )
    if (!ok) return
    await setActiveIdentity(npub)
    window.location.reload()
  }

  return (
    <FullPageCard onClose={onClose} title="perfil" ariaLabel="perfil">
      <div className="space-y-3 px-4 py-5">
        {/* Hero — sempre visível */}
        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-5">
          <div className="flex items-start gap-4">
            <Avatar metadata={metadata} npub={identity.npub} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[18px] font-bold text-drift-text">
                {metadata?.displayName || metadata?.name || (
                  <span className="italic text-drift-muted/50">anônimo</span>
                )}
              </div>
              {label && (
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/40">
                  {label}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TierBadge tier={tier} />
                <span className="font-mono text-[10px] text-drift-muted/50">
                  há {ageWeeks} {ageWeeks === 1 ? 'semana' : 'semanas'}
                </span>
              </div>
            </div>
          </div>
          {metadata?.about && (
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-drift-text/70">
              {metadata.about}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <DriftButton variant="primary" size="md" onClick={openEdit} className="flex-1">
              ✎ editar
            </DriftButton>
          </div>
        </div>

        {/* Section: Identidade */}
        <SectionHeader title="identidade" expanded={open === 0} onToggle={() => toggle(0)} />
        <Collapse open={open === 0}>
          <div className="space-y-2 pl-3">
            <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
                npub
              </div>
              <div className="break-all font-mono text-[11px] text-drift-text/80">
                {identity.npubBech32}
              </div>
              {metadata?.nip05 && (
                <div className="mt-2">
                  <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
                    nip-05
                  </span>
                  <div className="font-mono text-[12px] text-drift-accent2">
                    {metadata.nip05}
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-drift-muted/30">
                    claim não verificado pelo Drift — outros clientes podem checar
                  </p>
                </div>
              )}
            </div>
            {identitiesList.length > 1 && (
              <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
                  trocar identidade ativa
                </div>
                <div className="space-y-1.5">
                  {identitiesList.map((id) => {
                    const isActive = id.npub === activeNpub
                    return (
                      <button
                        key={id.npub}
                        onClick={() => void handleSwitchIdentity(id.npub)}
                        disabled={isActive}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                          isActive
                            ? 'border-drift-accent2/40 bg-drift-accent2/10 text-drift-accent2'
                            : 'border-drift-border/30 bg-drift-surface/20 text-drift-muted/70 hover:text-drift-text'
                        }`}
                      >
                        <span className="truncate">
                          {id.label || `${id.npub.slice(0, 8)}…`}
                        </span>
                        {isActive && <span className="text-[10px] uppercase tracking-meta">ativa</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Collapse>

        {/* Section: Atividade */}
        <SectionHeader title="atividade" expanded={open === 1} onToggle={() => toggle(1)} />
        <Collapse open={open === 1}>
          <div className="grid grid-cols-2 gap-2 pl-3">
            <Stat label="posts" value={aggregate?.posts_count ?? 0} />
            <Stat label="comments" value={aggregate?.comments_authored ?? 0} />
            <Stat label="↑ dados" value={aggregate?.spreads_given ?? 0} tone="spread" />
            <Stat label="↓ dados" value={aggregate?.buries_given ?? 0} tone="bury" />
            <Stat label="↑ recebidos" value={aggregate?.spreads_received ?? 0} tone="spread" />
            {(aggregate?.reports_received ?? 0) > 0 && (
              <Stat
                label="reports recebidos"
                value={aggregate!.reports_received}
                tone="warning"
                tooltip="reports não excluem — score só baixa após threshold dinâmico (§26)"
              />
            )}
          </div>
        </Collapse>

        {/* Section: Peso & alcance */}
        <SectionHeader title="peso & alcance" expanded={open === 2} onToggle={() => toggle(2)} />
        <Collapse open={open === 2}>
          <div className="space-y-2 pl-3">
            <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
                  peso composto
                </span>
                <span className="font-display text-[20px] font-bold text-drift-text tabular-nums">
                  {userWeight.weight.toFixed(1)}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 font-mono text-[11px]">
                <Row label="antiquidade" value={userWeight.antiquity.toFixed(1)} />
                <Row label="engajamento" value={userWeight.engagement.toFixed(1)} />
                <Row label="max subposts" value={String(userWeight.maxSubposts)} />
              </div>
            </div>
            <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/30">
              peso é função pura de antiquidade + spreads recebidos (§22).
              qualquer cliente drift calcula o mesmo.
            </p>
          </div>
        </Collapse>

        {/* Section: Minhas listas */}
        <SectionHeader title="minhas listas" expanded={open === 3} onToggle={() => toggle(3)} />
        <Collapse open={open === 3}>
          <div className="grid grid-cols-2 gap-2 pl-3">
            <Stat label="seguindo" value={followingCount} />
            <Stat label="fixados" value={aggregate?.pinned_count ?? 0} />
            <Stat label="bloqueados" value={blockedCount} />
            <Stat label="silenciados" value={mutedCount} />
          </div>
        </Collapse>

        <p className="px-2 pt-2 font-mono text-[10px] leading-relaxed text-drift-muted/30">
          §22 — score determinístico. esses números vêm de eventos públicos;
          qualquer cliente drift calcula os mesmos.
        </p>
      </div>
    </FullPageCard>
  )
}


/**
 * Whitelist de schemes seguros pra avatar URL.
 *
 * Barney HIMYM audit 2026-05-17 (HIGH severity):
 * Autor malicioso pode setar `metadata.picture` pra rastrear viewer:
 *   - Tracker pixel: `https://attacker.com/pixel?npub=…` colhe IP+Referer
 *   - `javascript:` URL: React 18 sanitiza, mas defensa em profundidade
 *   - `data:image/...` gigante: DoS render
 *   - schemes desconhecidos (file://, vbscript:, etc.): bloquear
 *
 * Decisão: aceitar `https://` (90% dos casos) + `data:image/` (avatar
 * pequeno embedded). Recusar todo o resto silenciosamente (fallback
 * pro identicon).
 */
function isSafeAvatarUrl(url: string): boolean {
  if (!url) return false
  // wcag-audit: ok reason=length-cap-prevents-DoS-from-massive-data-urls
  if (url.length > 4096) return false
  const lower = url.trim().toLowerCase()
  return lower.startsWith('https://') || lower.startsWith('data:image/')
}

function Avatar({
  metadata,
  npub,
}: {
  metadata: ReturnType<typeof useUserMetadata>
  npub: string
}) {
  if (metadata?.picture && isSafeAvatarUrl(metadata.picture)) {
    return (
      <img
        src={metadata.picture}
        alt="avatar"
        // Barney §28 — `referrerPolicy="no-referrer"` evita que origem
        // do avatar (potencialmente hostil) colha viewer's Referer + IP.
        // `loading="lazy"` reduz DoS de avatares enormes em listas.
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-14 w-14 shrink-0 rounded-full border border-drift-border/40 object-cover"
        onError={(e) => {
          // Fallback se URL quebrar: esconde img, identicon assume.
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }
  // Identicon simples — derivado do npub.
  const hue = parseInt(npub.slice(0, 8), 16) % 360
  return (
    <div
      className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-drift-border/40 font-display text-[18px] font-bold text-drift-bg"
      style={{ background: `hsl(${hue}, 50%, 60%)` }}
      aria-hidden="true"
    >
      {npub.slice(0, 2).toUpperCase()}
    </div>
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
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-[11px] ${config.color}`}
      title="weight é determinístico — função pura de antiquity (semanas) + spreads recebidos. §22."
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
  value: number
  tone?: 'spread' | 'bury' | 'warning'
  tooltip?: string
}) {
  const color =
    tone === 'spread'
      ? 'text-drift-spread'
      : tone === 'bury'
      ? 'text-drift-bury'
      : tone === 'warning'
      ? 'text-drift-warning'
      : 'text-drift-text'
  return (
    <div
      className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5 text-center"
      title={tooltip}
    >
      <div className={`font-display text-[18px] font-bold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
        {label}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-meta text-drift-muted/50">
        {label}
      </span>
      <span className="text-[12px] text-drift-text tabular-nums">{value}</span>
    </div>
  )
}
