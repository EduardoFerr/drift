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
import { PlusIcon, CopyIcon, DownloadIcon } from '../UI/Icons'
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
      <div className="space-y-3 px-4 py-5">
        <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
          Manifesto §4 — anonimato por design. Múltiplas identidades
          ajudam a compartimentalizar contextos: uma pública, outra pra
          tópicos sensíveis. Cada uma é um nsec independente.
        </p>

        {error && (
          <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
            {error}
          </div>
        )}

        {mode === 'list' && (
          <>
            <section className="max-h-72 space-y-2 overflow-y-auto pl-3">
              {list.length === 0 && (
                <div className="font-mono text-[11px] text-drift-muted/40">
                  nenhuma identidade ainda — crie uma abaixo
                </div>
              )}
              {list.map((id) => {
                const isActive = id.npub === activeNpub
                return (
                  <div
                    key={id.npub}
                    className={`rounded-xl border bg-drift-surface/30 px-4 py-3 ${
                      isActive ? 'border-drift-accent2/40' : 'border-drift-border/30'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono text-[12px]">
                        <span className={isActive ? 'text-drift-accent2' : 'text-drift-muted/50'}>
                          {isActive ? '● ativa' : '○'}
                        </span>
                        <span className="text-drift-text">
                          {id.label || <em className="text-drift-muted/50">sem label</em>}
                        </span>
                        {id.imported && (
                          <span
                            className="rounded-lg bg-drift-border/20 px-1.5 py-0.5 font-mono text-[10px] text-drift-muted/60"
                            title="importada via nsec1"
                          >
                            importada
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mb-2 break-all font-mono text-[11px] text-drift-muted/50">
                      {id.npubBech32}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!isActive && (
                        <button
                          onClick={() => void handleSwitch(id)}
                          disabled={working}
                          className="rounded-lg border border-drift-accent2/25 bg-drift-surface/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                        >
                          ativar
                        </button>
                      )}
                      <button
                        onClick={() => void handleRename(id)}
                        disabled={working}
                        className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                      >
                        renomear
                      </button>
                      {isActive && (
                        <button
                          onClick={onRequestExport}
                          className="rounded-lg border border-drift-warning/20 bg-drift-warning/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/30"
                        >
                          backup nsec
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => void handleRemove(id)}
                          disabled={working}
                          className="rounded-lg border border-drift-danger/20 bg-drift-danger/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-danger/30"
                        >
                          remover
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>

            <div className="grid grid-cols-2 gap-2 pl-3">
              <button
                onClick={() => setMode('create')}
                className="rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                + nsec local
              </button>
              <button
                onClick={() => setMode('bip39-create')}
                className="rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                title="NIP-06 — gera 12 palavras BIP39 derivadas em nsec"
              >
                + 12 palavras
              </button>
              <button
                onClick={() => setMode('import')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                <DownloadIcon size={14} />
                importar nsec1
              </button>
              <button
                onClick={() => setMode('bip39-import')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                title="recupera identidade a partir de 12-24 palavras BIP39"
              >
                <DownloadIcon size={14} />
                importar palavras
              </button>
            </div>
          </>
        )}

        {mode === 'create' && (
          <div className="space-y-3 pl-3">
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
              Vai gerar uma nova chave criptográfica local. Não substitui a
              ativa atual — só adiciona à lista.
            </p>
            {/* Item #7 fricção UX iniciante 2026-05-23: antes de criar
                nova identidade, mostrar preview do que vai acontecer.
                User iniciante não sabia o que esperar — clicava sem
                modelo mental de "criação local" vs "trocar ativa" vs
                "backup obrigatório depois". Card preview reduz fricção
                e reforça manifesto §3 (dispositivo descartável,
                identidade não — backup ANTES de qualquer ação destrutiva). */}
            <div
              className="rounded-xl border border-drift-accent2/20 bg-drift-accent2/5 px-4 py-3 space-y-2 font-mono text-[11px] leading-relaxed text-drift-body/85"
              role="note"
              aria-label="passos da criação"
            >
              <p className="font-display text-[11px] uppercase tracking-tag text-drift-accent2">
                o que vai acontecer
              </p>
              <ol className="space-y-1.5 list-none">
                <li>
                  <span className="text-drift-accent2 font-medium">1.</span>{' '}
                  Gera uma nova chave secp256k1 local, criptografada com a
                  master key do seu dispositivo (AES-GCM 256).
                </li>
                <li>
                  <span className="text-drift-accent2 font-medium">2.</span>{' '}
                  A identidade entra na sua lista — não troca a ativa. Você
                  pode trocar depois explicitamente.
                </li>
                <li>
                  <span className="text-drift-accent2 font-medium">3.</span>{' '}
                  Trocar a identidade ativa exige reload do app (sync e feed
                  resetam). Por isso, faça <strong>backup do nsec antes</strong>
                  {' '}de trocar — sem o nsec exportado e este dispositivo
                  perdido, a identidade some pra sempre (manifesto §3).
                </li>
              </ol>
            </div>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional, ex: ativismo)"
              className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={working}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {working ? (
                  'criando…'
                ) : (
                  <>
                    <PlusIcon size={14} />
                    criar
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-3 pl-3">
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
              Cole um nsec1... existente. Adiciona à lista mas não troca
              a identidade ativa — você ativa explicitamente depois.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <textarea
              value={importNsec}
              onChange={(e) => setImportNsec(e.target.value)}
              placeholder="nsec1..."
              rows={2}
              className="w-full resize-none break-all rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={working || !importNsec.trim()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {working ? (
                  'importando…'
                ) : (
                  <>
                    <PlusIcon size={14} />
                    importar
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {mode === 'bip39-create' && !bip39ShowResult && (
          <div className="space-y-3 pl-3">
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
              Vai gerar uma nova identidade a partir de 12 palavras BIP39
              (NIP-06). Mais fácil de anotar que <code>nsec1</code>;
              compatível com Damus/Snort/Coracle/Iris/Amethyst.
            </p>
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-warning">
              ⚠ Anote ou guarde as palavras em local seguro. Quem tem as
              12 palavras tem a identidade.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                cancelar
              </button>
              <button
                onClick={handleBip39Create}
                disabled={working}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {working ? (
                  'gerando…'
                ) : (
                  <>
                    <PlusIcon size={14} />
                    gerar 12 palavras
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {bip39ShowResult && (
          <div className="space-y-3 pl-3">
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-warning">
              ⚠ Anote estas 12 palavras AGORA. Não terão como serem
              recuperadas depois. Quem tem as palavras tem a identidade.
            </p>
            <div className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 p-4">
              <div className="grid grid-cols-3 gap-2 font-mono text-[12px] text-drift-warning">
                {bip39ShowResult.mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="flex gap-1.5">
                    <span className="w-4 text-right text-drift-warning/60">{i + 1}.</span>
                    <span>{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="break-all px-1 font-mono text-[11px] text-drift-muted/50">
              npub: <span className="text-drift-text">{bip39ShowResult.npub}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(bip39ShowResult.mnemonic)
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                <CopyIcon size={14} />
                copiar
              </button>
              <button
                onClick={() => {
                  setBip39ShowResult(null)
                  setNewLabel('')
                  setMode('list')
                }}
                className="flex-1 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                ✓ anotei, fechar
              </button>
            </div>
          </div>
        )}

        {mode === 'bip39-import' && (
          <div className="space-y-3 pl-3">
            <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
              Cole 12 a 24 palavras BIP39. NIP-06 path padrão. Compatível
              com identidades criadas em outros clientes Nostr (Damus,
              Snort, Iris, Amethyst, etc.).
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="label (opcional)"
              className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <textarea
              value={bip39Phrase}
              onChange={(e) => setBip39Phrase(e.target.value)}
              placeholder="palavra1 palavra2 ... palavra12"
              rows={3}
              className="w-full resize-none rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <input
              type="password"
              value={bip39Passphrase}
              onChange={(e) => setBip39Passphrase(e.target.value)}
              placeholder="passphrase (opcional, padrão vazio)"
              className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('list')}
                className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                cancelar
              </button>
              <button
                onClick={handleBip39Import}
                disabled={working || !bip39Phrase.trim()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {working ? (
                  'derivando…'
                ) : (
                  <>
                    <PlusIcon size={14} />
                    importar
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </FullPageCard>
  )
}
