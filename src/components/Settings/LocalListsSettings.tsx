/**
 * LocalListsSettings — gerenciamento das listas locais do user:
 *
 *   - Pinned: posts que o user "fixou" (manifesto §16, "espalhar = seedear")
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
import { nip19 } from 'nostr-tools'

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
      <div className="p-5">

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-drift-border">
          <TabBtn active={tab === 'pinned'} onClick={() => setTab('pinned')}>
            📌 fixados ({pinned.length})
          </TabBtn>
          <TabBtn active={tab === 'blocked'} onClick={() => setTab('blocked')}>
            ⊘ bloqueados ({blocked.length})
          </TabBtn>
          <TabBtn active={tab === 'muted'} onClick={() => setTab('muted')}>
            🔇 silenciados ({muted.length})
          </TabBtn>
        </div>

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
    </FullPageCard>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1 text-[10px] uppercase tracking-widest transition-colors ${
        active
          ? 'border-b-2 border-drift-accent text-drift-accent'
          : 'border-b-2 border-transparent text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
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
      <p className="py-6 text-center text-[11px] text-slate-600">
        nenhum post fixado.
        <br />
        no PostViewer, clique em 📍 pra fixar — protege de eviction local
        e marca pra re-broadcast (manifesto §16).
      </p>
    )
  }
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
      {list.map((p) => (
        <div
          key={p.postId}
          className="flex items-center gap-2 rounded border border-drift-border/60 bg-drift-bg/30 px-2 py-1 text-[10px]"
        >
          <span className="text-yellow-300">📌</span>
          <span className="flex-1 truncate font-mono text-slate-400">
            {p.postId.slice(0, 16)}…
          </span>
          <span className="text-slate-600">{timeAgo(p.pinnedAt)}</span>
          {p.cid && (
            <span
              className="rounded bg-emerald-950/30 px-1 text-emerald-400"
              title={`IPFS CID: ${p.cid}`}
            >
              IPFS
            </span>
          )}
          <button
            onClick={() => void onUnpin(p.postId)}
            className="rounded border border-red-900/60 px-1 py-0.5 text-red-400/80 hover:bg-red-950/30"
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
      <p className="py-6 text-center text-[11px] text-slate-600">
        nenhum {kind === 'blocked' ? 'bloqueado' : 'silenciado'}. Filtros
        locais (manifesto §24) — não mudam o score, só sua visualização.
      </p>
    )
  }
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
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
            className="flex items-center gap-2 rounded border border-drift-border/60 bg-drift-bg/30 px-2 py-1 text-[10px]"
          >
            <span className="flex-1 truncate font-mono text-slate-400" title={e.reason ?? ''}>
              {bech32.slice(0, 18)}…
            </span>
            <span className="text-slate-600">{timeAgo(e.at)}</span>
            <button
              onClick={() => void onAction(e.npub)}
              className="rounded border border-drift-border px-1 py-0.5 text-slate-400 hover:border-drift-accent hover:text-drift-accent"
            >
              {kind === 'blocked' ? 'desbloquear' : 'dessilenciar'}
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
