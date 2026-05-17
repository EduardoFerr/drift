/**
 * RelaySettings — UI de gerenciamento de relays (manifesto §14).
 *
 * Mostra a lista atual com status (last_ok_at vs last_err), permite
 * adicionar/remover, pausar (enabled toggle), e publicar a lista
 * própria via NIP-65 pra outros clientes Nostr descobrirem.
 *
 * Também permite importar lista de outro npub (NIP-65 fetch) — útil
 * pra "seguir alguém estruturalmente": adoto os relays dele como dica.
 */

import { useState } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { addRelay, removeRelay, setRelayEnabled, useRelaysStore } from '../../lib/relays'
import { entriesFromRecords, fetchRelayList, publishRelayList } from '../../lib/nip65'
import * as nip19 from 'nostr-tools/nip19'

export interface RelaySettingsProps {
  onClose: () => void
}

export function RelaySettings({ onClose }: RelaySettingsProps) {
  const list = useRelaysStore((s) => s.list)
  const loaded = useRelaysStore((s) => s.loaded)

  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importNpub, setImportNpub] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)

  async function handleAdd() {
    if (!newUrl.trim() || adding) return
    setAdding(true)
    setError(null)
    try {
      await addRelay({ url: newUrl.trim() })
      setNewUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  async function handleImport() {
    if (!importNpub.trim() || importing) return
    setImporting(true)
    setImportMsg(null)
    try {
      const hex = parseNpubInput(importNpub.trim())
      if (!hex) {
        setImportMsg('formato inválido — espera npub1... ou hex')
        return
      }
      const entries = await fetchRelayList(hex)
      if (!entries || entries.length === 0) {
        setImportMsg('nenhum kind 10002 encontrado pra esse npub')
        return
      }
      let added = 0
      for (const e of entries) {
        try {
          await addRelay({ url: e.url, read: e.read, write: e.write, source: 'nip65' })
          added++
        } catch {
          /* relay inválido, pula */
        }
      }
      setImportMsg(`importados ${added} relay(s) do NIP-65`)
      setImportNpub('')
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function handlePublish() {
    if (publishing) return
    setPublishing(true)
    setPublishMsg(null)
    try {
      const entries = entriesFromRecords(list)
      if (entries.length === 0) {
        setPublishMsg('sem relays habilitados pra publicar')
        return
      }
      await publishRelayList(entries)
      setPublishMsg(`lista publicada (${entries.length} relays) — outros clientes Nostr podem descobrir`)
    } catch (err) {
      setPublishMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <FullPageCard onClose={onClose} title="relays" ariaLabel="settings · relays">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="conectados" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          relays intercambiáveis. remover um não tira você da rede.
        </p>
        <div className="max-h-72 space-y-2 overflow-y-auto pl-3">
          {!loaded && (
            <div className="font-mono text-[11px] text-drift-muted/40">carregando…</div>
          )}
          {loaded && list.length === 0 && (
            <div className="font-mono text-[11px] text-drift-muted/40">nenhum relay configurado</div>
          )}
          {list.map((r) => {
            const now = Date.now()
            const isDemoted = r.demotedUntil > now
            const status = isDemoted ? '⏸' : r.lastErr ? '✗' : r.lastOkAt ? '✓' : '·'
            const tone = isDemoted
              ? 'text-drift-warning'
              : r.lastErr
              ? 'text-drift-danger'
              : r.lastOkAt
              ? 'text-drift-spread'
              : 'text-drift-muted'
            const demotedMin = isDemoted
              ? Math.max(1, Math.round((r.demotedUntil - now) / 60000))
              : 0
            const titleAttr = isDemoted
              ? `demoted ${demotedMin}min · fails ${r.consecutiveFails} · ${r.lastErr ?? '—'}`
              : r.lastErr ?? ''
            return (
              <div
                key={r.url}
                className={`flex items-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 font-mono text-[11px] ${
                  r.enabled ? '' : 'opacity-50'
                }`}
              >
                <span className={`${tone} text-base leading-none`}>{status}</span>
                <span className="flex-1 truncate text-drift-text/80" title={titleAttr}>
                  {r.url}
                </span>
                {isDemoted && (
                  <span className="rounded-md bg-drift-warning/10 px-1.5 py-0.5 text-[10px] text-drift-warning">
                    {demotedMin}m
                  </span>
                )}
                <span className="rounded-md bg-drift-border/20 px-1.5 py-0.5 text-[10px] text-drift-muted/60">
                  {r.source}
                </span>
                <button
                  onClick={() => void setRelayEnabled(r.url, !r.enabled)}
                  className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-2 py-0.5 text-[10px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2"
                >
                  {r.enabled ? 'pausar' : 'ativar'}
                </button>
                <button
                  onClick={() => void removeRelay(r.url)}
                  className="rounded-lg border border-drift-danger/20 bg-drift-danger/5 px-2 py-0.5 text-[10px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/10"
                >
                  remover
                </button>
              </div>
            )
          })}
        </div>

        <SectionHeader title="adicionar" />
        <div className="space-y-2 pl-3">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="wss://relay.exemplo.com"
            className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/25 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newUrl.trim()}
            className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {adding ? 'adicionando…' : '⊕ adicionar relay'}
          </button>
          {error && (
            <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
              {error}
            </div>
          )}
        </div>

        <SectionHeader title="NIP-65" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          descobrir relays de outro user ou publicar a sua lista.
        </p>
        <div className="space-y-2 pl-3">
          <input
            type="text"
            value={importNpub}
            onChange={(e) => setImportNpub(e.target.value)}
            placeholder="npub1… — buscar lista desse user"
            className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/25 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || !importNpub.trim()}
              className="flex-1 rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              {importing ? 'buscando…' : '↓ buscar lista'}
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing || list.filter((r) => r.enabled).length === 0}
              className="flex-1 rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              {publishing ? 'publicando…' : '↗ publicar'}
            </button>
          </div>
          {importMsg && (
            <div className="rounded-xl border border-drift-border/20 bg-drift-surface/20 px-4 py-2.5 font-mono text-[11px] text-drift-muted/60">
              {importMsg}
            </div>
          )}
          {publishMsg && (
            <div className="rounded-xl border border-drift-border/20 bg-drift-surface/20 px-4 py-2.5 font-mono text-[11px] text-drift-muted/60">
              {publishMsg}
            </div>
          )}
        </div>
      </div>
    </FullPageCard>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5">
      <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
        {title}
      </span>
    </div>
  )
}

function parseNpubInput(input: string): string | null {
  // Hex direto (64 caracteres)
  if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase()
  // Bech32 npub1...
  try {
    const decoded = nip19.decode(input)
    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      return decoded.data
    }
  } catch {
    /* malformado */
  }
  return null
}
