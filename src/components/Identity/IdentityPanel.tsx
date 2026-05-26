import { useEffect, useRef, useState } from 'react'
// Ted bundle audit 2026-05-15 §1.4 — entrypoint canvas-only (sem PNG Node,
// sem terminal). Corta peso do vendor-identity chunk.
import QRCode from 'qrcode/lib/browser'
import { FullPageCard } from '../UI/FullPageCard'
import { dialog } from '../../lib/dialog'
import { setIdentityFromNsec } from '../../lib/identity'
import {
  buildBackup,
  parseBackup,
  serializeBackup,
  suggestBackupFilename,
  BackupParseError,
} from '../../lib/identity-backup'
import { CLIENT_VERSION } from '../../config/constants'
import { rebuildIdentityHistory } from '../../lib/sync'
import {
  disablePasskey,
  enablePasskey,
  isPasskeyEnabled,
  isPasskeySupported,
} from '../../lib/passkey'
import type { DriftIdentity } from '../../types/drift'
import { CopyIcon, CheckIcon, DownloadIcon, WarningIcon, PlusIcon, XIcon } from '../UI/Icons'
import {
  formatLastExposed,
  isOverRateLimit,
  recordExposure,
  requirePasskeyForExport,
  useExposureStore,
} from '../../lib/identity-exposure'

// ─── Barney security guards — manifesto §8 (nsec NUNCA persiste em claro) ──
//
// Threats: Win+V clipboard history (default ON desde Windows 10 1809),
// iCloud Universal Clipboard (sincroniza pra outros devices Apple),
// 3rd-party clipboard managers (Gboard/SwiftKey/Samsung), extensões
// Chrome com `clipboardRead`. Sem guards, copy = persistência em claro
// fora do controle do app → viola §8 literalmente.
//
// Mitigações shipped 2026-05-17 (HIMYM Barney audit):
//   - Auto-clear clipboard após NSEC_CLIPBOARD_TTL_MS (30s)
//   - Auto-hide reveal após NSEC_REVEAL_TTL_MS (60s) sem interação
//   - Warning explícito acima do bloco copy/download
//   - QR + download visualmente promovidos (primary > copy)
const NSEC_CLIPBOARD_TTL_MS = 30_000
const NSEC_REVEAL_TTL_MS = 60_000

/**
 * Modal de identidade.
 *
 * Duas operações:
 *  - Backup: mostrar nsec1 + QR code para o usuário copiar/escanear.
 *  - Importar: aceitar nsec1 colado/escaneado e substituir identidade.
 *
 * Importar é destrutivo — apaga identidade local. Pede confirmação
 * dupla (textarea + alert) antes de executar.
 */

interface Props {
  identity: DriftIdentity
  onClose: () => void
}

export function IdentityPanel({ identity, onClose }: Props) {
  const [tab, setTab] = useState<'backup' | 'import' | 'passkey'>('backup')

  return (
    <FullPageCard onClose={onClose} title="sua identidade" ariaLabel="sua identidade">
      <div className="space-y-3 px-4 py-5">
        <div className="flex gap-1.5 rounded-2xl border border-drift-border/40 bg-drift-surface/50 p-1.5">
          <IdTabBtn active={tab === 'backup'} onClick={() => setTab('backup')}>
            backup
          </IdTabBtn>
          <IdTabBtn active={tab === 'import'} onClick={() => setTab('import')}>
            importar
          </IdTabBtn>
          <IdTabBtn active={tab === 'passkey'} onClick={() => setTab('passkey')}>
            passkey
          </IdTabBtn>
        </div>

        <div className="min-w-0">
          {tab === 'backup' && <BackupTab identity={identity} />}
          {tab === 'import' && <ImportTab onClose={onClose} />}
          {tab === 'passkey' && <PasskeyTab npub={identity.npub} />}
        </div>
      </div>
    </FullPageCard>
  )
}

function IdTabBtn({
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
      className={`flex-1 rounded-xl px-3 py-2 font-mono text-[11px] uppercase tracking-meta transition-colors ${
        active
          ? 'bg-drift-accent2 text-drift-bg'
          : 'text-drift-muted/70 hover:text-drift-text'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Backup ──────────────────────────────────────────────────────────

function BackupTab({ identity }: { identity: DriftIdentity }) {
  const [reveal, setReveal] = useState(false)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Countdown ms restante até clipboard ser limpo (Barney §8 guard).
  // null = sem copy ativo ou já limpo.
  const [clipboardTtlMs, setClipboardTtlMs] = useState<number | null>(null)
  const [npubCopied, setNpubCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  // Satoshi guard 2026-05-17: rate-limit warning quando user faz > 3
  // exposições em 10 min. Reativo via store.
  const exposureCount = useExposureStore((s) => s.recentExposures.length)
  const lastExposedAt = useExposureStore((s) => s.lastExposedAt)
  // Subscribe ao store pra UI atualizar quando store muda (não usado
  // diretamente — usExposureStore selecionado acima já reativa).
  void exposureCount
  void lastExposedAt
  // Track C.3 — checkbox de confirmação. UX guia: user precisa
  // explicitamente declarar que guardou. Não bloqueia (não é gate),
  // só sinaliza visualmente. Manifesto §3 — usuário detém a chave.
  const [confirmed, setConfirmed] = useState(false)
  const qrRef = useRef<string | null>(null)
  const clipboardClearAtRef = useRef<number | null>(null)
  const revealStartedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!reveal) return
    if (qrRef.current === identity.nsecBech32) return
    qrRef.current = identity.nsecBech32
    QRCode.toDataURL(identity.nsecBech32, {
      width: 240,
      margin: 1,
      color: { dark: '#e2e8f0', light: '#0d0d16' },
      errorCorrectionLevel: 'M',
    })
      .then(setQrUrl)
      .catch((err) => console.error('[qr]', err))
  }, [reveal, identity.nsecBech32])

  // Auto-hide reveal após NSEC_REVEAL_TTL_MS sem interação — reduz
  // screenshot/screen-share leak window (Barney §8 guard).
  useEffect(() => {
    if (!reveal) {
      revealStartedAtRef.current = null
      return
    }
    revealStartedAtRef.current = Date.now()
    const timer = window.setTimeout(() => {
      setReveal(false)
      setQrUrl(null)
      qrRef.current = null
    }, NSEC_REVEAL_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [reveal])

  // Tick clipboard countdown a cada 1s + clear quando TTL expira.
  useEffect(() => {
    if (clipboardTtlMs === null) return
    if (clipboardTtlMs <= 0) {
      // Limpa clipboard se ainda contém nosso nsec (best-effort —
      // outras escritas podem ter sobrescrito; safe overwrite).
      void navigator.clipboard.writeText('').catch(() => {
        // Permissão clipboard negada após copy? Silencioso —
        // user já foi alertado pelo warning banner.
      })
      clipboardClearAtRef.current = null
      setClipboardTtlMs(null)
      setCopied(false)
      return
    }
    const tick = window.setTimeout(() => {
      const deadline = clipboardClearAtRef.current
      if (deadline === null) return
      const remaining = deadline - Date.now()
      setClipboardTtlMs(Math.max(0, remaining))
    }, 1000)
    return () => window.clearTimeout(tick)
  }, [clipboardTtlMs])

  /**
   * Toggle reveal — quando ON, exige passkey verify primeiro (se passkey
   * opt-in habilitado). Satoshi guard 2026-05-17.
   */
  async function handleToggleReveal() {
    if (reveal) {
      // Ocultar não exige gate.
      setReveal(false)
      setQrUrl(null)
      qrRef.current = null
      return
    }
    // Going from hidden → reveal: passkey gate + record.
    const ok = await requirePasskeyForExport()
    if (!ok) return // user cancelou ou falhou — abort silencioso
    recordExposure('reveal')
    setReveal(true)
  }

  async function handleCopy() {
    // Satoshi guard: passkey gate antes de copy (mesmo se já está reveal —
    // copy é nova superfície de exposure: clipboard system).
    const ok = await requirePasskeyForExport()
    if (!ok) return
    try {
      await navigator.clipboard.writeText(identity.nsecBech32)
      recordExposure('copy')
      setCopied(true)
      clipboardClearAtRef.current = Date.now() + NSEC_CLIPBOARD_TTL_MS
      setClipboardTtlMs(NSEC_CLIPBOARD_TTL_MS)
    } catch (err) {
      console.error('[copy]', err)
    }
  }

  async function handleCopyNpub() {
    try {
      await navigator.clipboard.writeText(identity.npubBech32)
      setNpubCopied(true)
      setTimeout(() => setNpubCopied(false), 2000)
    } catch (err) {
      console.error('[copy npub]', err)
    }
  }

  // Track C.3 — download backup como JSON file. Browser file picker
  // via blob URL + a.download. Sem upload remoto, sem servidor —
  // arquivo gerado e salvo 100% client-side (manifesto §28).
  // Satoshi guard 2026-05-17: passkey gate + record exposure.
  async function handleDownload() {
    const ok = await requirePasskeyForExport()
    if (!ok) return
    const backup = buildBackup({
      npub: identity.npubBech32,
      nsec: identity.nsecBech32,
      appVersion: CLIENT_VERSION,
    })
    const text = serializeBackup(backup)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestBackupFilename(identity.npubBech32)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    recordExposure('download')
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 2000)
  }

  // Satoshi audit chip: mostra "última exposição: X tempo atrás" pra
  // user notar comportamento anômalo seu mesmo. Manifesto §28 — info
  // local, nunca enviada. Null = nunca exposto = não mostrar chip.
  const lastExposedLabel = formatLastExposed()
  const overLimit = isOverRateLimit()

  return (
    <div className="space-y-3">
      {/* Audit chip de exposição — auditoria de comportamento próprio
          (Satoshi guard 2026-05-17). Aparece só se já houve ≥1 exposição.
          Color escala: muted (>1h atrás) → warning (rate limit hit). */}
      {lastExposedLabel && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[10px] uppercase tracking-meta ${
            overLimit
              ? 'border-drift-warning/40 bg-drift-warning/5 text-drift-warning'
              : 'border-drift-border/30 bg-drift-surface/30 text-drift-muted/70'
          }`}
        >
          <span className="shrink-0" aria-hidden="true">
            {overLimit ? <WarningIcon size={12} /> : <CheckIcon size={12} />}
          </span>
          <span>
            última exposição: {lastExposedLabel}
            {overLimit && (
              <>
                {' · '}
                <strong className="text-drift-warning">
                  3+ nos últimos 10 min
                </strong>
              </>
            )}
          </span>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
            npub público
          </span>
          <button
            onClick={() => void handleCopyNpub()}
            aria-label="copiar npub"
            title={npubCopied ? 'copiado' : 'copiar npub'}
            className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded font-mono text-[10px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {npubCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span aria-live="polite">{npubCopied ? 'copiado' : 'copiar'}</span>
          </button>
        </div>
        <div className="min-w-0 break-all rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text">
          {identity.npubBech32}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="font-mono text-[10px] uppercase tracking-meta text-drift-danger/80">
            nsec privado
          </span>
          <button
            onClick={() => void handleToggleReveal()}
            title={
              reveal
                ? 'ocultar automaticamente em 60s'
                : 'revelar — auto-oculta em 60s · pode pedir passkey'
            }
            className="font-mono text-[10px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {reveal ? 'ocultar' : 'revelar'}
          </button>
        </div>

        {reveal ? (
          <div className="space-y-3">
            <div className="min-w-0 break-all rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-3 font-mono text-[12px] text-drift-danger">
              {identity.nsecBech32}
            </div>

            {/* QR code — caminho primário (sem clipboard exposure).
                Manifesto §8 — preferir QR/download a copy. */}
            <div className="rounded-xl border border-drift-accent2/25 bg-drift-surface/30 p-5">
              {qrUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <img
                    src={qrUrl}
                    alt="QR code do nsec"
                    className="rounded-lg"
                    width={240}
                    height={240}
                  />
                  <p className="text-center font-mono text-[10px] uppercase tracking-meta text-drift-accent2/70">
                    escaneie pra importar em outro device
                  </p>
                </div>
              ) : (
                <div className="grid h-[240px] place-items-center font-mono text-[11px] text-drift-muted/40">
                  gerando QR…
                </div>
              )}
            </div>

            {/* Download primary CTA — arquivo local, sem clipboard. */}
            <button
              onClick={handleDownload}
              aria-label="baixar arquivo de backup"
              title="Baixa um arquivo .json com nsec + npub + metadados. Guarde em local seguro."
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-drift-accent2/40 bg-drift-accent2/10 px-3 py-3.5 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              {downloaded ? <CheckIcon size={14} /> : <DownloadIcon size={14} />}
              <span aria-live="polite">
                {downloaded ? 'baixado' : 'baixar arquivo (recomendado)'}
              </span>
            </button>

            {/* Warning Barney §8: clipboard pode vazar via Win+V/iCloud.
                Visível ANTES do botão copy. */}
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-drift-warning/30 bg-drift-warning/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-drift-warning"
            >
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                <WarningIcon size={14} />
              </span>
              <span>
                Copy expõe o nsec ao clipboard do sistema (histórico do
                Windows com Win+V, área de transferência universal do iCloud,
                gerenciadores de senhas e extensões do navegador podem ler).
                <strong className="text-drift-warning"> Prefira QR ou arquivo</strong>.
              </span>
            </div>

            {/* Copy secondary — só pra quem entende o tradeoff. Com
                countdown visível e auto-clear em 30s. */}
            <button
              onClick={handleCopy}
              aria-label="copiar nsec apesar do risco"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/20 px-3 py-3 font-mono text-[11px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:border-drift-warning/30 hover:text-drift-warning focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span aria-live="polite">
                {copied && clipboardTtlMs !== null
                  ? `copiado · limpa em ${Math.ceil(clipboardTtlMs / 1000)}s`
                  : copied
                  ? 'limpo do clipboard'
                  : 'copiar mesmo assim'}
              </span>
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-muted/40">
            ••••••••••••••••••••••••••••••••••••••••••••••••••••••••
          </div>
        )}
      </div>

      {reveal && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5 font-mono text-[12px] leading-relaxed text-drift-text transition-colors hover:border-drift-accent2/25 focus-within:ring-2 focus-within:ring-drift-accent2/40">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-drift-accent2"
          />
          <span>
            Confirmo que <strong className="text-drift-text">guardei o nsec
            em local seguro</strong> (papel, gerenciador de senhas, arquivo
            offline). Entendo que perder isso = perder a identidade
            permanentemente.
          </span>
        </label>
      )}

      <div className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[11px] leading-relaxed text-drift-warning">
        Esta é a sua identidade na rede Drift. Quem tiver acesso a ela
        controla a sua conta — pode publicar como você, drift e
        sink como você. Guarde offline (papel, gerenciador de
        senhas, fotografia em local seguro). Anthropic, Drift e Nostr
        não conseguem recuperá-la se você perder.
      </div>
    </div>
  )
}

// ─── Importar ────────────────────────────────────────────────────────

function ImportTab({ onClose }: { onClose: () => void }) {
  const [nsec, setNsec] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Track C.3 — carrega backup .json. Lê localmente (FileReader),
  // valida shape via parseBackup, e popula textarea com nsec1.
  // User ainda precisa confirmar no botão "importar" — file load
  // não é destrutivo.
  async function handleFileLoad(file: File) {
    setError(null)
    setLoadedFrom(null)
    try {
      const text = await file.text()
      const backup = parseBackup(text)
      setNsec(backup.nsec)
      setLoadedFrom(`${file.name} · npub ${backup.npub.slice(0, 14)}…`)
    } catch (err) {
      const msg =
        err instanceof BackupParseError
          ? `arquivo inválido (${err.cause}): ${err.message}`
          : err instanceof Error
          ? err.message
          : String(err)
      setError(msg)
    }
  }

  async function handleImport() {
    setError(null)
    const trimmed = nsec.trim()
    if (!trimmed) {
      setError('Cole uma chave nsec1 ou carregue um arquivo de backup.')
      return
    }
    const ok = await dialog.confirm(
      'Importar uma nova identidade APAGA a identidade atual deste dispositivo. Você fez backup da chave atual?',
      {
        title: 'importar nsec',
        dangerous: true,
        okLabel: 'continuar',
      },
    )
    if (!ok) return

    setBusy(true)
    try {
      const newIdentity = await setIdentityFromNsec(trimmed)
      // Dispara rebuild em background — vai puxar o histórico do
      // novo author dos relays e materializar no SQLite.
      void rebuildIdentityHistory(newIdentity.npub)
      // Pequeno delay pro rebuild começar antes do reload.
      // Os eventos continuam chegando após reload via startSync também.
      await new Promise((r) => setTimeout(r, 500))
      location.reload()
    } catch (err) {
      setBusy(false)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }
  }

  return (
    <div className="space-y-3">
      {/* Track C.3 — file picker pra carregar backup .json. */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFileLoad(file)
            // Reset value pra permitir reload do mesmo arquivo
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        >
          <DownloadIcon size={14} />
          carregar arquivo de backup (.json)
        </button>
        {loadedFrom && (
          <div className="mt-2 truncate px-1 font-mono text-[11px] text-drift-accent2/80" title={loadedFrom}>
            ✓ carregado: {loadedFrom}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-drift-border/40" />
        <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
          ou cole manual
        </span>
        <div className="h-px flex-1 bg-drift-border/40" />
      </div>

      <div>
        <div className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
          chave nsec
        </div>
        <textarea
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          placeholder="nsec1..."
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full break-all rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[11px] leading-relaxed text-drift-warning">
        Importar substitui a identidade atual. Posts publicados com a
        chave atual deixam de ser exibidos como "seus". Se você ainda
        não fez backup, volta na aba "backup" antes.
      </div>

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        >
          cancelar
        </button>
        <button
          onClick={handleImport}
          disabled={busy || !nsec.trim()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-3 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        >
          {busy ? (
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
  )
}

// ─── PasskeyTab ─────────────────────────────────────────────────────

function PasskeyTab({ npub }: { npub: string }) {
  const supported = isPasskeySupported()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void isPasskeyEnabled().then((v) => {
      if (!cancelled) setEnabled(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleEnable() {
    if (working) return
    setWorking(true)
    setError(null)
    try {
      await enablePasskey(npub)
      setEnabled(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  async function handleDisable() {
    if (working) return
    const ok = await dialog.confirm(
      'O cliente vai parar de pedir autenticação no boot. A identidade em si NÃO é afetada — só o gate local. ⚠ Se você não tem backup do nsec, perder este device = perder a conta (B-UX-6 / manifesto §3).',
      {
        title: 'desabilitar passkey',
        okLabel: 'desabilitar',
        dangerous: true,
      },
    )
    if (!ok) return
    setWorking(true)
    setError(null)
    try {
      await disablePasskey()
      setEnabled(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[11px] leading-relaxed text-drift-warning">
        ⚠ WebAuthn não suportado neste browser. Passkey requer browser
        moderno (Chrome 67+, Safari 14+, Firefox 60+) em contexto seguro
        (HTTPS ou localhost).
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
        Passkey opt-in (WebAuthn) — adiciona um gate de autenticação local
        ao boot do app. Usa biometria (Touch ID, Face ID, Windows Hello)
        ou security key (YubiKey, etc.).
      </p>
      <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
        ⚠ Passkey NÃO é a sua identidade — sua identidade é o nsec. Passkey
        só é gate local pra abrir o app aqui. Se você perder o device + nunca
        fez backup do nsec1, identidade some. Manifesto §3.
      </p>

      {error && (
        <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
          {error}
        </div>
      )}

      {enabled === null ? (
        <div className="px-1 font-mono text-[11px] text-drift-muted/50">verificando…</div>
      ) : enabled ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-drift-spread/20 bg-drift-spread/5 px-4 py-3 font-mono text-[11px] text-drift-spread">
            ✓ Passkey ativo. Boot do app pede autenticação.
          </div>
          <button
            onClick={handleDisable}
            disabled={working}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/30"
          >
            {working ? (
              'desabilitando…'
            ) : (
              <>
                <XIcon size={14} />
                desabilitar passkey
              </>
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={handleEnable}
          disabled={working}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        >
          {working ? (
            'registrando…'
          ) : (
            <>
              <PlusIcon size={14} />
              habilitar passkey
            </>
          )}
        </button>
      )}
    </div>
  )
}
