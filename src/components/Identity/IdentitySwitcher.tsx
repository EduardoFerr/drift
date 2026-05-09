/**
 * IdentitySwitcher — UI de gerenciamento de múltiplas identidades.
 *
 * Manifesto §4 (Anonimato por Design): suporte a multi-identidade pra
 * anti-perseguição (uma pública, outra para tópicos sensíveis).
 *
 * Fluxos:
 *   - Listar todas as identidades + marcar a ativa
 *   - Criar nova identidade (gera nsec local)
 *   - Importar nsec1 existente
 *   - Renomear (label livre)
 *   - Trocar ativa — destrutivo pro estado local em RAM, exige confirm
 *     + oferece export antes (regra dura, manifesto §3)
 *   - Remover — destrutivo pro nsec no device, exige confirm + export
 *
 * **Não inclui ainda:** BIP39 opt-in (NIP-06) e Passkey opt-in. Esses
 * são features de polimento — adicionados depois sem mudar essa UI.
 */

import { useState } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { dialog } from '../../lib/dialog'
import {
  createNewIdentity,
  importIdentityNsec,
  removeIdentity,
  renameIdentity,
  setActiveIdentity,
  useIdentitiesStore,
  type IdentityRecord,
} from '../../lib/identities'
import { deriveNostrKeyFromMnemonic, generateBip39Mnemonic } from '../../lib/bip39'

export interface IdentitySwitcherProps {
  /** Chamado quando user pede pra ver backup do nsec (delega pro IdentityPanel principal). */
  onRequestExport: () => void
  onClose: () => void
}

export function IdentitySwitcher({ onRequestExport, onClose }: IdentitySwitcherProps) {
  const list = useIdentitiesStore((s) => s.list)
  const activeNpub = useIdentitiesStore((s) => s.activeNpub)

  const [mode, setMode] = useState<'list' | 'create' | 'import' | 'bip39-create' | 'bip39-import'>(
    'list',
  )
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [importNsec, setImportNsec] = useState('')
  const [bip39Phrase, setBip39Phrase] = useState('')
  const [bip39Passphrase, setBip39Passphrase] = useState('')
  const [bip39ShowResult, setBip39ShowResult] = useState<{ mnemonic: string; npub: string } | null>(
    null,
  )

  async function handleCreate() {
    if (working) return
    setWorking(true)
    setError(null)
    try {
      await createNewIdentity(newLabel.trim() || undefined)
      setNewLabel('')
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  async function handleImport() {
    if (working || !importNsec.trim()) return
    setWorking(true)
    setError(null)
    try {
      await importIdentityNsec(importNsec.trim(), newLabel.trim() || undefined)
      setImportNsec('')
      setNewLabel('')
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  async function handleBip39Create() {
    if (working) return
    setWorking(true)
    setError(null)
    try {
      const mnemonic = generateBip39Mnemonic()
      const derived = await deriveNostrKeyFromMnemonic(mnemonic)
      await importIdentityNsec(derived.nsecBech32, newLabel.trim() || undefined)
      // Mostra a frase pro user copiar/anotar ANTES de fechar.
      setBip39ShowResult({ mnemonic, npub: derived.npubBech32 })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  async function handleBip39Import() {
    if (working || !bip39Phrase.trim()) return
    setWorking(true)
    setError(null)
    try {
      const derived = await deriveNostrKeyFromMnemonic(bip39Phrase, bip39Passphrase)
      await importIdentityNsec(derived.nsecBech32, newLabel.trim() || undefined)
      setBip39Phrase('')
      setBip39Passphrase('')
      setNewLabel('')
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }


  async function handleSwitch(target: IdentityRecord) {
    if (target.npub === activeNpub) return

    const proceed = await dialog.confirm(
      `Trocar pra "${target.label || target.npubBech32.slice(0, 12) + '…'}"?\n\nA identidade ATUAL fica salva. Mas o estado local em memória vai resetar e a app recarrega. Recomendado fazer backup do nsec da identidade atual antes.`,
      {
        title: 'trocar identidade',
        okLabel: 'continuar',
        cancelLabel: 'fazer backup',
      },
    )
    if (!proceed) {
      onRequestExport()
      return
    }

    setWorking(true)
    setError(null)
    try {
      await setActiveIdentity(target.npub)
      // Reload pra sync e feed reconstruírem com a identidade nova.
      // Manifesto §3: dispositivo descartável; reset clean é aceitável.
      location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setWorking(false)
    }
  }

  async function handleRemove(target: IdentityRecord) {
    if (target.npub === activeNpub) {
      await dialog.alert(
        'Não pode remover a identidade ativa. Troque pra outra primeiro.',
        { title: 'remover identidade' },
      )
      return
    }
    const confirmed = await dialog.confirm(
      `Remover "${target.label || target.npubBech32.slice(0, 12) + '…'}"?\n\nDESTRUTIVO: o nsec encriptado será apagado deste dispositivo. Sem backup do nsec1, recuperá-la é IMPOSSÍVEL (manifesto §3). Recomendado exportar antes.`,
      {
        title: 'remover identidade',
        dangerous: true,
        okLabel: 'remover',
      },
    )
    if (!confirmed) return

    setWorking(true)
    try {
      await removeIdentity(target.npub)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  async function handleRename(target: IdentityRecord) {
    const next = await dialog.prompt('Novo label:', {
      title: 'renomear identidade',
      defaultValue: target.label ?? '',
      placeholder: 'ex: público, anônimo, work',
      maxLength: 32,
    })
    if (next === null) return
    try {
      await renameIdentity(target.npub, next.trim() || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <FullPageCard onClose={onClose} title="identidades" ariaLabel="identidades">
      <div className="p-5">
        <p className="mb-4 text-[11px] leading-relaxed text-drift-muted">
          Manifesto §4 — anonimato por design. Múltiplas identidades
          ajudam a compartimentalizar contextos: uma pública, outra pra
          tópicos sensíveis. Cada uma é um nsec independente.
        </p>

        {error && (
          <div className="mb-3 rounded border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {mode === 'list' && (
          <>
            <section className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {list.length === 0 && (
                <div className="text-[11px] text-drift-muted">
                  nenhuma identidade ainda — crie uma abaixo
                </div>
              )}
              {list.map((id) => {
                const isActive = id.npub === activeNpub
                return (
                  <div
                    key={id.npub}
                    className={`rounded border bg-drift-bg/30 p-2 ${
                      isActive ? 'border-drift-accent' : 'border-drift-border/60'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className={isActive ? 'text-drift-accent' : 'text-drift-muted'}>
                          {isActive ? '● ativa' : '○'}
                        </span>
                        <span className="text-drift-text">
                          {id.label || <em className="text-drift-muted">sem label</em>}
                        </span>
                        {id.imported && (
                          <span
                            className="rounded bg-slate-800/50 px-1 text-[9px] text-drift-muted"
                            title="importada via nsec1"
                          >
                            importada
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mb-1 break-all text-[9px] text-drift-muted">
                      {id.npubBech32}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {!isActive && (
                        <button
                          onClick={() => void handleSwitch(id)}
                          disabled={working}
                          className="rounded border border-drift-accent px-2 py-0.5 text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
                        >
                          ativar
                        </button>
                      )}
                      <button
                        onClick={() => void handleRename(id)}
                        disabled={working}
                        className="rounded border border-drift-border px-2 py-0.5 text-drift-muted hover:border-drift-accent hover:text-drift-accent disabled:opacity-30"
                      >
                        renomear
                      </button>
                      {isActive && (
                        <button
                          onClick={onRequestExport}
                          className="rounded border border-yellow-700/60 px-2 py-0.5 text-yellow-300 hover:bg-yellow-950/30"
                        >
                          backup nsec
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => void handleRemove(id)}
                          disabled={working}
                          className="rounded border border-red-900/60 px-2 py-0.5 text-red-400/80 hover:bg-red-950/30 disabled:opacity-30"
                        >
                          remover
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('create')}
                className="rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
              >
                + nsec local
              </button>
              <button
                onClick={() => setMode('bip39-create')}
                className="rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
                title="NIP-06 — gera 12 palavras BIP39 derivadas em nsec"
              >
                + 12 palavras
              </button>
              <button
                onClick={() => setMode('import')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] uppercase tracking-widest text-drift-muted hover:border-drift-accent hover:text-drift-accent"
              >
                ↓ importar nsec1
              </button>
              <button
                onClick={() => setMode('bip39-import')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] uppercase tracking-widest text-drift-muted hover:border-drift-accent hover:text-drift-accent"
                title="recupera identidade a partir de 12-24 palavras BIP39"
              >
                ↓ importar palavras
              </button>
            </div>
          </>
        )}

        {mode === 'create' && (
          <>
            <p className="mb-2 text-[11px] text-drift-muted">
              Vai gerar uma nova chave criptográfica local. Não substitui a
              ativa atual — só adiciona à lista.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional, ex: ativismo)"
              className="mb-3 w-full rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-border"
              >
                cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={working}
                className="flex-1 rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
              >
                {working ? 'criando…' : 'criar'}
              </button>
            </div>
          </>
        )}

        {mode === 'import' && (
          <>
            <p className="mb-2 text-[11px] text-drift-muted">
              Cole um nsec1... existente. Adiciona à lista mas não troca
              a identidade ativa — você ativa explicitamente depois.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="mb-2 w-full rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <textarea
              value={importNsec}
              onChange={(e) => setImportNsec(e.target.value)}
              placeholder="nsec1..."
              rows={2}
              className="mb-3 w-full resize-none rounded border border-drift-border bg-drift-bg px-2 py-1 font-mono text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-border"
              >
                cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={working || !importNsec.trim()}
                className="flex-1 rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
              >
                {working ? 'importando…' : 'importar'}
              </button>
            </div>
          </>
        )}

        {mode === 'bip39-create' && !bip39ShowResult && (
          <>
            <p className="mb-2 text-[11px] text-drift-muted">
              Vai gerar uma nova identidade a partir de 12 palavras BIP39
              (NIP-06). Mais fácil de anotar que <code>nsec1</code>;
              compatível com Damus/Snort/Coracle/Iris/Amethyst.
            </p>
            <p className="mb-3 text-[10px] text-yellow-400">
              ⚠ Anote ou guarde as palavras em local seguro. Quem tem as
              12 palavras tem a identidade.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="mb-3 w-full rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-border"
              >
                cancelar
              </button>
              <button
                onClick={handleBip39Create}
                disabled={working}
                className="flex-1 rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
              >
                {working ? 'gerando…' : 'gerar 12 palavras'}
              </button>
            </div>
          </>
        )}

        {bip39ShowResult && (
          <>
            <p className="mb-2 text-[11px] text-yellow-300">
              ⚠ Anote estas 12 palavras AGORA. Não terão como serem
              recuperadas depois. Quem tem as palavras tem a identidade.
            </p>
            <div className="mb-3 rounded border border-yellow-700/60 bg-yellow-950/20 p-3">
              <div className="grid grid-cols-3 gap-1 font-mono text-[12px] text-yellow-200">
                {bip39ShowResult.mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="flex gap-1">
                    <span className="w-4 text-right text-yellow-600">{i + 1}.</span>
                    <span>{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-2 break-all text-[10px] text-drift-muted">
              npub: <span className="text-drift-text">{bip39ShowResult.npub}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(bip39ShowResult.mnemonic)
                }}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-accent hover:text-drift-accent"
              >
                copiar
              </button>
              <button
                onClick={() => {
                  setBip39ShowResult(null)
                  setNewLabel('')
                  setMode('list')
                }}
                className="flex-1 rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
              >
                anotei, fechar
              </button>
            </div>
          </>
        )}

        {mode === 'bip39-import' && (
          <>
            <p className="mb-2 text-[11px] text-drift-muted">
              Cole 12 a 24 palavras BIP39. NIP-06 path padrão. Compatível
              com identidades criadas em outros clientes Nostr (Damus,
              Snort, Iris, Amethyst, etc.).
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="mb-2 w-full rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <textarea
              value={bip39Phrase}
              onChange={(e) => setBip39Phrase(e.target.value)}
              placeholder="palavra1 palavra2 ... palavra12"
              rows={3}
              className="mb-2 w-full resize-none rounded border border-drift-border bg-drift-bg px-2 py-1 font-mono text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <input
              type="password"
              value={bip39Passphrase}
              onChange={(e) => setBip39Passphrase(e.target.value)}
              placeholder="passphrase (opcional, padrão vazio)"
              className="mb-3 w-full rounded border border-drift-border bg-drift-bg px-2 py-1 text-[11px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-drift-muted hover:border-drift-border"
              >
                cancelar
              </button>
              <button
                onClick={handleBip39Import}
                disabled={working || !bip39Phrase.trim()}
                className="flex-1 rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-30"
              >
                {working ? 'derivando…' : 'importar'}
              </button>
            </div>
          </>
        )}
      </div>
    </FullPageCard>
  )
}
