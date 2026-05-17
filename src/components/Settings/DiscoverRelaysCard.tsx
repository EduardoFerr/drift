/**
 * DiscoverRelaysCard — sub-card lançado de RelaySettings pra descobrir
 * relays curados por política de moderação.
 *
 * Fase A relay moderation (Etapa 3 da deliberação HIMYM 2026-05-17).
 *
 * Manifesto §17 adendo + CLAUDE invariante #18: relays moderados são
 * OPT-IN no Discovery, NUNCA pré-populados no SEED. Sub-card complementa
 * a UI "adicionar manualmente" existente em RelaySettings.
 *
 * Estrutura:
 *  - 5 tabs (curated / moderated / livre / community / onion)
 *  - Cada card de relay: badge tier (D3) + custo + latência (NIP-11
 *    fetch lazy quando tab abre) + ações 'adicionar' / 'detalhes'
 *  - Modal NIP-11 dump on tap (E4)
 *
 * Filosofia (Barney + Robin):
 *  - Sem ratings/reviews de peers (manifesto §22 sem reputação subjetiva)
 *  - Mostrar política CLARAMENTE — transparência > marketing
 *  - Aviso silent-drop herdado de RelaySettings parent
 */

import { useEffect, useState } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { RelayTierBadge, type RelayTier } from '../UI/RelayTierBadge'
import {
  getRelaysByTab,
  DIRECTORY_TAB_LABELS,
  type RelayDirectoryTab,
  type RelayDirectoryEntry,
} from '../../config/relays-directory'
import { fetchNip11, type Nip11Info } from '../../lib/relay-directory'
import { addRelay, useRelaysStore } from '../../lib/relays'

interface CardProps {
  onClose: () => void
}

const TAB_ORDER: RelayDirectoryTab[] = [
  'curated',
  'moderated',
  'free',
  'community',
  'onion',
]

const TAB_SHORT_LABELS: Record<RelayDirectoryTab, string> = {
  curated: 'curados',
  moderated: 'moderados',
  free: 'livres',
  community: 'comunidade',
  onion: 'onion',
}

export function DiscoverRelaysCard({ onClose }: CardProps) {
  const [activeTab, setActiveTab] = useState<RelayDirectoryTab>('curated')
  const [detailRelay, setDetailRelay] = useState<RelayDirectoryEntry | null>(null)

  return (
    <FullPageCard onClose={onClose} title="descobrir relays" ariaLabel="descobrir relays">
      <div className="space-y-3 px-4 py-5">
        {/* Hero — 2 frases (Lily proposta) */}
        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-4">
          <p className="font-mono text-[11px] leading-relaxed text-drift-muted/70">
            drift conecta a múltiplos servidores (relays). cada relay decide
            o que aceita guardar. você escolhe quais usar.
          </p>
        </div>

        {/* Footer note global — §17 adendo + link manifesto */}
        <div className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[10px] leading-relaxed text-drift-warning">
          <strong className="font-bold uppercase tracking-meta">§17 adendo:</strong>{' '}
          drift não escaneia seu conteúdo. relay operator pode. veja política
          de cada relay no badge antes de adicionar.
        </div>

        {/* Tabs segmentadas */}
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-drift-border/40 bg-drift-surface/50 p-1.5">
          {TAB_ORDER.map((tab) => {
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 rounded-xl px-3 py-2 font-mono text-[11px] uppercase tracking-meta transition-colors ${
                  isActive
                    ? 'bg-drift-accent2 text-drift-bg'
                    : 'text-drift-muted/70 hover:text-drift-text'
                }`}
                aria-pressed={isActive}
              >
                {TAB_SHORT_LABELS[tab]}
              </button>
            )
          })}
        </div>

        {/* Descrição da tab atual */}
        <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/40">
          {DIRECTORY_TAB_LABELS[activeTab]}
        </p>

        {/* Lista de relays da tab */}
        <RelayList
          tab={activeTab}
          onTapDetail={(r) => setDetailRelay(r)}
        />
      </div>

      {detailRelay && (
        <RelayDetailModal
          entry={detailRelay}
          onClose={() => setDetailRelay(null)}
        />
      )}
    </FullPageCard>
  )
}

function RelayList({
  tab,
  onTapDetail,
}: {
  tab: RelayDirectoryTab
  onTapDetail: (r: RelayDirectoryEntry) => void
}) {
  const entries = getRelaysByTab(tab)
  const currentRelays = useRelaysStore((s) => s.list)
  const currentUrls = new Set(currentRelays.map((r) => r.url))

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-6 text-center font-mono text-[11px] text-drift-muted/40">
        nenhum relay nessa categoria ainda.
      </div>
    )
  }

  return (
    <div className="space-y-2 pl-3">
      {entries.map((entry) => (
        <RelayCard
          key={entry.url + (entry.onion ?? '')}
          entry={entry}
          alreadyAdded={currentUrls.has(entry.url)}
          onTapDetail={() => onTapDetail(entry)}
        />
      ))}
    </div>
  )
}

function RelayCard({
  entry,
  alreadyAdded,
  onTapDetail,
}: {
  entry: RelayDirectoryEntry
  alreadyAdded: boolean
  onTapDetail: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (adding || alreadyAdded) return
    setAdding(true)
    setError(null)
    try {
      await addRelay({ url: entry.url, source: 'user' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const tier: RelayTier = entry.policy

  return (
    <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
      <button
        type="button"
        onClick={onTapDetail}
        className="block w-full text-left transition-colors hover:text-drift-text"
        aria-label={`detalhes de ${entry.url}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex-1 truncate font-mono text-[12px] text-drift-text">
            {entry.url}
          </span>
          <RelayTierBadge tier={tier} size="xs" />
          <span className="rounded-md bg-drift-border/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/60">
            {entry.cost === 'free' ? 'grátis' : 'pago'}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-drift-muted/50">
          {entry.policyDetail}
        </p>
        {entry.trustNote && (
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-drift-muted/40">
            {entry.trustNote}
          </p>
        )}
      </button>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void handleAdd()}
          disabled={adding || alreadyAdded}
          className={`flex-1 rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-meta transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            alreadyAdded
              ? 'border border-drift-spread/30 bg-drift-spread/10 text-drift-spread'
              : 'bg-drift-accent2 text-drift-bg hover:bg-drift-accent2/85'
          }`}
        >
          {alreadyAdded ? '✓ já adicionado' : adding ? 'adicionando…' : '+ adicionar'}
        </button>
        <button
          onClick={onTapDetail}
          className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:text-drift-text"
        >
          detalhes
        </button>
      </div>

      {error && (
        <p className="mt-2 font-mono text-[10px] text-drift-danger">{error}</p>
      )}
    </div>
  )
}

/**
 * Modal NIP-11 dump on tap (E4 do plano).
 *
 * Lazy: NIP-11 fetch só dispara aqui. Cache 24h em SQLite via
 * relay-directory.ts. Sem reviews de peers (manifesto §22).
 */
function RelayDetailModal({
  entry,
  onClose,
}: {
  entry: RelayDirectoryEntry
  onClose: () => void
}) {
  const [nip11, setNip11] = useState<Nip11Info | null>(null)
  const [loading, setLoading] = useState(true)
  const [latency, setLatency] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchNip11(entry.url).then((result) => {
      if (cancelled) return
      setNip11(result.nip11)
      setLatency(result.latencyMs)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [entry.url])

  return (
    <FullPageCard onClose={onClose} title="detalhes do relay" ariaLabel={`detalhes ${entry.url}`}>
      <div className="space-y-3 px-4 py-5">
        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-4">
          <div className="break-all font-mono text-[12px] text-drift-text">
            {entry.url}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <RelayTierBadge tier={entry.policy} size="sm" />
            <span className="rounded-md bg-drift-border/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/60">
              {entry.cost === 'free' ? 'grátis' : 'pago'}
            </span>
            {latency !== null && (
              <span className="rounded-md bg-drift-border/20 px-2 py-0.5 font-mono text-[10px] text-drift-muted/60">
                ~{latency}ms
              </span>
            )}
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-drift-muted/70">
            {entry.policyDetail}
          </p>
          {entry.trustNote && (
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-drift-muted/40">
              {entry.trustNote}
            </p>
          )}
          {entry.source && (
            <a
              href={entry.source}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-meta text-drift-accent2 hover:underline"
            >
              ↗ fonte / política
            </a>
          )}
        </div>

        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5">
          <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
            NIP-11
          </span>
        </div>
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          metadata declarada pelo relay (atualizada a cada 24h).
        </p>

        <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
          {loading ? (
            <p className="font-mono text-[11px] text-drift-muted/40">carregando…</p>
          ) : nip11 ? (
            <Nip11Display info={nip11} />
          ) : (
            <p className="font-mono text-[11px] text-drift-warning">
              relay não respondeu ao fetch NIP-11. pode estar offline ou não
              suporta o endpoint padrão.
            </p>
          )}
        </div>

        {entry.onion && (
          <>
            <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5">
              <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
                onion mirror
              </span>
            </div>
            <p className="px-1 font-mono text-[10px] text-drift-muted/30">
              acessível via Tor (precisa `network_mode=tor` no Drift).
            </p>
            <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[10px] text-drift-muted/60 break-all">
              {entry.onion}
            </div>
          </>
        )}
      </div>
    </FullPageCard>
  )
}

function Nip11Display({ info }: { info: Nip11Info }) {
  return (
    <div className="space-y-2 font-mono text-[11px]">
      {info.name && (
        <KV label="name" value={info.name} />
      )}
      {info.description && (
        <KV label="description" value={info.description} />
      )}
      {info.contact && (
        <KV label="contact" value={info.contact} />
      )}
      {info.software && (
        <KV label="software" value={`${info.software}${info.version ? ' / ' + info.version : ''}`} />
      )}
      {info.supported_nips && info.supported_nips.length > 0 && (
        <KV
          label="NIPs"
          value={info.supported_nips.slice(0, 16).join(', ') + (info.supported_nips.length > 16 ? '…' : '')}
        />
      )}
      {info.drift_policy && (
        <div className="mt-2 rounded-lg border border-drift-accent2/30 bg-drift-accent2/5 px-3 py-2">
          <div className="mb-1 font-bold uppercase tracking-meta text-drift-accent2">
            drift_policy declarada
          </div>
          {info.drift_policy.classifiers && info.drift_policy.classifiers.length > 0 && (
            <p className="text-drift-muted/70">
              classifiers: {info.drift_policy.classifiers.join(', ')}
            </p>
          )}
          {info.drift_policy.rejects && info.drift_policy.rejects.length > 0 && (
            <p className="text-drift-muted/70">
              rejeita: {info.drift_policy.rejects.join(', ')}
            </p>
          )}
          {info.drift_policy.appeal_contact && (
            <p className="text-drift-muted/70">
              appeal: {info.drift_policy.appeal_contact}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-meta text-drift-muted/50">
        {label}
      </span>
      <span className="break-all text-drift-text/80">{value}</span>
    </div>
  )
}
