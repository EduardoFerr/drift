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
import { nip19 } from 'nostr-tools'

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
      <div className="p-5">
        <p className="mb-4 text-[11px] leading-relaxed text-drift-muted">
          Manifesto §14 — bootstrap distribuído. Relays são intercambiáveis;
          remover um não tira você da rede. Cliente sempre mantém ao
          menos um seed externo se sua lista ficar muito pequena (anti-eclipse §20).
        </p>

        {/* Lista atual */}
        <section className="mb-4 max-h-64 space-y-1 overflow-y-auto">
          {!loaded && <div className="text-[11px] text-drift-muted">carregando…</div>}
          {loaded && list.length === 0 && (
            <div className="text-[11px] text-drift-muted">nenhum relay configurado</div>
          )}
          {list.map((r) => {
            const status = r.lastErr
              ? '✗'
              : r.lastOkAt
              ? '✓'
              : '·'
            const tone = r.lastErr
              ? 'text-red-400'
              : r.lastOkAt
              ? 'text-drift-spread'
              : 'text-drift-muted'
            return (
              <div
                key={r.url}
                className={`flex items-center gap-2 rounded border border-drift-border/60 bg-drift-bg/30 px-2 py-1 text-[10px] ${
                  r.enabled ? '' : 'opacity-50'
                }`}
              >
                <span className={`${tone} text-base leading-none`}>{status}</span>
                <span className="flex-1 truncate text-drift-text" title={r.lastErr ?? ''}>
                  {r.url}
                </span>
                <span className="rounded bg-drift-border/40 px-1 text-[9px] text-drift-muted">
                  {r.source}
                </span>
                <button
                  onClick={() => void setRelayEnabled(r.url, !r.enabled)}
                  className="rounded border border-drift-border px-1 py-0.5 text-drift-muted hover:border-drift-accent hover:text-drift-accent"
                >
                  {r.enabled ? 'pausar' : 'ativar'}
                </button>
                <button
                  onClick={() => void removeRelay(r.url)}
                  className="rounded border border-red-900/60 px-1 py-0.5 text-red-400/80 hover:bg-red-950/30"
                >
                  remover
                </button>
              </div>
            )
          })}
        </section>

        {/* Adicionar */}
        <section className="mb-4 border-t border-drift-border pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-drift-muted">
            adicionar relay
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="wss://relay.exemplo.com"
              className="flex-1 rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newUrl.trim()}
              className="rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
            >
              {adding ? '…' : '+'}
            </button>
          </div>
          {error && (
            <div className="mt-2 text-[10px] text-red-400">{error}</div>
          )}
        </section>

        {/* NIP-65 */}
        <section className="mb-4 border-t border-drift-border pt-3">
          <div
            className="mb-2 text-[10px] uppercase tracking-widest text-drift-muted"
            title="NIP-65 — Relay List Metadata"
          >
            descobrir relays via NIP-65
          </div>
          <div className="mb-2 flex gap-2">
            <input
              type="text"
              value={importNpub}
              onChange={(e) => setImportNpub(e.target.value)}
              placeholder="npub1... — buscar lista de relays desse user"
              className="flex-1 rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <button
              onClick={handleImport}
              disabled={importing || !importNpub.trim()}
              className="rounded border border-drift-accent px-3 py-1 text-[11px] text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
            >
              {importing ? '…' : 'buscar'}
            </button>
          </div>
          {importMsg && (
            <div className="text-[10px] text-drift-muted">{importMsg}</div>
          )}

          <button
            onClick={handlePublish}
            disabled={publishing || list.filter((r) => r.enabled).length === 0}
            className="mt-2 w-full rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-accent hover:text-drift-accent disabled:opacity-30"
          >
            {publishing ? 'publicando…' : '↗ publicar minha lista (NIP-65)'}
          </button>
          {publishMsg && (
            <div className="mt-1 text-[10px] text-drift-muted">{publishMsg}</div>
          )}
        </section>
      </div>
    </FullPageCard>
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
