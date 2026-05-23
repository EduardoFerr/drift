/**
 * LocalListsSettings — gerenciamento das listas locais do user:
 *
 *   - Pinned: posts que o user "fixou" (manifesto §16, "DRIFT = seedear":
 *     vocab UI = DRIFT, vocab protocolo/manifesto histórico = espalhar)
 *   - Blocked: npubs cujo conteúdo NÃO aparece no feed
 *   - Muted: npubs cujos POSTS estão silenciados (mas spreads/buries
 *     deles ainda contam pro score visualizado)
 *
 * Manifesto §24: filtro local, não muda ranking. §10: cliente NÃO
 * deleta dados moderados — só esconde. Pinned é diferente: protege
 * de eviction E marca pra re-broadcast.
 */

import { useEffect, useState } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { listPinned, unpinPost } from '../../lib/cache'
import {
  listBlocked,
  listMuted,
  unblock,
  unmute,
  type ModLocalEntry,
} from '../../lib/moderation-local'
import * as nip19 from 'nostr-tools/nip19'

export interface LocalListsSettingsProps {
  onClose: () => void
}

interface PinnedEntry {
  postId: string
  pinnedAt: number
  cid: string | null
}

export function LocalListsSettings({ onClose }: LocalListsSettingsProps) {
  const [tab, setTab] = useState<'pinned' | 'blocked' | 'muted'>('pinned')
  const [pinned, setPinned] = useState<PinnedEntry[]>([])
  const [blocked, setBlocked] = useState<ModLocalEntry[]>([])
  const [muted, setMuted] = useState<ModLocalEntry[]>([])

  useEffect(() => {
    void reload()
  }, [])

  async function reload() {
    const [p, b, m] = await Promise.all([listPinned(), listBlocked(), listMuted()])
    setPinned(p)
    setBlocked(b)
    setMuted(m)
  }

  return (
    <FullPageCard onClose={onClose} title="listas locais" ariaLabel="settings · listas locais">
      <div className="space-y-3 px-4 py-5">

        <div className="flex gap-2 rounded-2xl border border-drift-border/40 bg-drift-surface/50 p-1.5">
          <TabBtn active={tab === 'pinned'} onClick={() => setTab('pinned')} count={pinned.length}>
            fixados
          </TabBtn>
          <TabBtn active={tab === 'blocked'} onClick={() => setTab('blocked')} count={blocked.length}>
            bloqueados
          </TabBtn>
          <TabBtn active={tab === 'muted'} onClick={() => setTab('muted')} count={muted.length}>
            silenciados
          </TabBtn>
        </div>

        <div className="pl-3">
          {tab === 'pinned' && (
            <PinnedList
              list={pinned}
              onUnpin={async (postId) => {
                await unpinPost(postId)
                await reload()
              }}
            />
          )}
          {tab === 'blocked' && (
            <ModList
              list={blocked}
              kind="blocked"
              onAction={async (npub) => {
                await unblock(npub)
                await reload()
              }}
            />
          )}
          {tab === 'muted' && (
            <ModList
              list={muted}
              kind="muted"
              onAction={async (npub) => {
                await unmute(npub)
                await reload()
              }}
            />
          )}
        </div>
      </div>
    </FullPageCard>
  )
}

function TabBtn({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 font-mono text-[11px] uppercase tracking-meta transition-colors ${
        active
          ? 'bg-drift-accent2 text-drift-bg'
          : 'text-drift-muted/70 hover:text-drift-text'
      }`}
    >
      {children}
      <span className={`ml-1.5 ${active ? 'opacity-60' : 'opacity-40'}`}>
        {count}
      </span>
    </button>
  )
}

function PinnedList({
  list,
  onUnpin,
}: {
  list: PinnedEntry[]
  onUnpin: (postId: string) => Promise<void>
}) {
  if (list.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-[11px] leading-relaxed text-drift-muted/40">
        nenhum post fixado.
        <br />
        no post, toque em ◈ pra fixar — protege de eviction e re-broadcast.
      </p>
    )
  }
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto">
      {list.map((p) => (
        <div
          key={p.postId}
          className="flex items-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 font-mono text-[11px]"
        >
          <span className="text-drift-accent">◈</span>
          <span className="flex-1 truncate text-drift-text/80">
            {p.postId.slice(0, 16)}…
          </span>
          <span className="text-drift-muted/40">{timeAgo(p.pinnedAt)}</span>
          {p.cid && (
            <span
              className="rounded-md bg-drift-spread/10 px-1.5 py-0.5 text-[10px] text-drift-spread"
              title={`IPFS CID: ${p.cid}`}
            >
              ipfs
            </span>
          )}
          <button
            onClick={() => void onUnpin(p.postId)}
            className="rounded-lg border border-drift-danger/20 bg-drift-danger/5 px-2 py-0.5 text-[10px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/10"
          >
            unpin
          </button>
        </div>
      ))}
    </div>
  )
}

function ModList({
  list,
  kind,
  onAction,
}: {
  list: ModLocalEntry[]
  kind: 'blocked' | 'muted'
  onAction: (npub: string) => Promise<void>
}) {
  if (list.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-[11px] leading-relaxed text-drift-muted/40">
        nenhum {kind === 'blocked' ? 'bloqueado' : 'silenciado'}.
        <br />
        filtros locais não mudam o score, só sua visualização.
      </p>
    )
  }
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto">
      {list.map((e) => {
        let bech32 = ''
        try {
          bech32 = nip19.npubEncode(e.npub)
        } catch {
          bech32 = e.npub
        }
        return (
          <div
            key={e.npub}
            className="flex items-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 font-mono text-[11px]"
          >
            <span className="flex-1 truncate text-drift-text/80" title={e.reason ?? ''}>
              {bech32.slice(0, 18)}…
            </span>
            <span className="text-drift-muted/40">{timeAgo(e.at)}</span>
            <button
              onClick={() => void onAction(e.npub)}
              className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-2 py-0.5 text-[10px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2"
            >
              {kind === 'blocked' ? 'desbloq' : 'dessil'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
