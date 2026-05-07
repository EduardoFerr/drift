import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { FullPageOverlay } from '../UI/FullPageOverlay'
import { dialog } from '../../lib/dialog'
import { setIdentityFromNsec } from '../../lib/identity'
import { rebuildIdentityHistory } from '../../lib/sync'
import {
  disablePasskey,
  enablePasskey,
  isPasskeyEnabled,
  isPasskeySupported,
} from '../../lib/passkey'
import type { DriftIdentity } from '../../types/drift'

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
    <FullPageOverlay onClose={onClose} title="sua identidade" ariaLabel="sua identidade">
      <div className="p-5">
      <div className="mb-5 flex gap-1 text-[10px] uppercase tracking-widest">
          <button
            onClick={() => setTab('backup')}
            className={`flex-1 rounded border px-3 py-1.5 ${
              tab === 'backup'
                ? 'border-drift-accent text-drift-accent'
                : 'border-drift-border text-slate-500 hover:text-slate-300'
            }`}
          >
            backup
          </button>
          <button
            onClick={() => setTab('import')}
            className={`flex-1 rounded border px-3 py-1.5 ${
              tab === 'import'
                ? 'border-drift-accent text-drift-accent'
                : 'border-drift-border text-slate-500 hover:text-slate-300'
            }`}
          >
            importar
          </button>
          <button
            onClick={() => setTab('passkey')}
            className={`flex-1 rounded border px-3 py-1.5 ${
              tab === 'passkey'
                ? 'border-drift-accent text-drift-accent'
                : 'border-drift-border text-slate-500 hover:text-slate-300'
            }`}
            title="WebAuthn opt-in"
          >
            passkey
          </button>
        </div>

      {tab === 'backup' && <BackupTab identity={identity} />}
      {tab === 'import' && <ImportTab onClose={onClose} />}
      {tab === 'passkey' && <PasskeyTab npub={identity.npub} />}
      </div>
    </FullPageOverlay>
  )
}

// ─── Backup ──────────────────────────────────────────────────────────

function BackupTab({ identity }: { identity: DriftIdentity }) {
  const [reveal, setReveal] = useState(false)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<string | null>(null)

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(identity.nsecBech32)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[copy]', err)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
          npub público
        </div>
        <div className="break-all rounded border border-drift-border bg-black/30 p-2 text-[11px] text-slate-300">
          {identity.npubBech32}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-red-400/80">
            nsec privado
          </span>
          <button
            onClick={() => setReveal((r) => !r)}
            className="text-[10px] uppercase tracking-widest text-slate-500 hover:text-slate-300"
          >
            {reveal ? 'ocultar' : 'revelar'}
          </button>
        </div>

        {reveal ? (
          <div className="space-y-3">
            <div className="break-all rounded border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-red-300">
              {identity.nsecBech32}
            </div>

            <div className="flex justify-center">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR code do nsec"
                  className="rounded"
                  width={240}
                  height={240}
                />
              ) : (
                <div className="grid h-[240px] w-[240px] place-items-center rounded border border-drift-border text-[10px] text-slate-600">
                  gerando QR…
                </div>
              )}
            </div>

            <button
              onClick={handleCopy}
              className="w-full rounded border border-drift-border px-3 py-2 text-[11px] uppercase tracking-widest text-slate-400 transition-colors hover:border-drift-accent hover:text-drift-accent"
            >
              {copied ? 'copiado ✓' : 'copiar nsec'}
            </button>
          </div>
        ) : (
          <div className="rounded border border-drift-border bg-black/30 p-2 text-[11px] text-slate-700">
            ••••••••••••••••••••••••••••••••••••••••••••••••••••••••
          </div>
        )}
      </div>

      <div className="rounded border border-yellow-900/60 bg-yellow-950/10 p-3 text-[10px] leading-relaxed text-yellow-300/70">
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

  async function handleImport() {
    setError(null)
    const trimmed = nsec.trim()
    if (!trimmed) {
      setError('Cole uma chave nsec1...')
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
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
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
          className="w-full break-all rounded border border-drift-border bg-black/30 p-2 font-mono text-[11px] text-slate-300 placeholder:text-slate-700 focus:border-drift-accent focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="rounded border border-yellow-900/60 bg-yellow-950/10 p-3 text-[10px] leading-relaxed text-yellow-300/70">
        Importar substitui a identidade atual. Posts publicados com a
        chave atual deixam de ser exibidos como "seus". Se você ainda
        não fez backup, volta na aba "backup" antes.
      </div>

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 rounded border border-drift-border px-3 py-2 text-[11px] uppercase tracking-widest text-slate-500 hover:text-slate-300 disabled:opacity-40"
        >
          cancelar
        </button>
        <button
          onClick={handleImport}
          disabled={busy || !nsec.trim()}
          className="flex-1 rounded border border-drift-accent px-3 py-2 text-[11px] uppercase tracking-widest text-drift-accent transition-colors hover:bg-drift-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy ? 'importando…' : 'importar'}
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
      'O cliente vai parar de pedir autenticação no boot. A identidade em si NÃO é afetada — só o gate local.',
      {
        title: 'desabilitar passkey',
        okLabel: 'desabilitar',
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
      <div className="rounded border border-yellow-700/60 bg-yellow-950/20 p-3 text-[11px] text-yellow-300">
        ⚠ WebAuthn não suportado neste browser. Passkey requer browser
        moderno (Chrome 67+, Safari 14+, Firefox 60+) em contexto seguro
        (HTTPS ou localhost).
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        Passkey opt-in (WebAuthn) — adiciona um gate de autenticação local
        ao boot do app. Usa biometria (Touch ID, Face ID, Windows Hello)
        ou security key (YubiKey, etc.).
      </p>
      <p className="mb-3 text-[10px] leading-relaxed text-slate-500">
        ⚠ Passkey NÃO é a sua identidade — sua identidade é o nsec. Passkey
        só é gate local pra abrir o app aqui. Se você perder o device + nunca
        fez backup do nsec1, identidade some. Manifesto §3.
      </p>

      {error && (
        <div className="mb-3 rounded border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {enabled === null ? (
        <div className="text-[11px] text-slate-600">verificando…</div>
      ) : enabled ? (
        <div>
          <div className="mb-3 rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-[11px] text-emerald-300">
            ✓ Passkey ativo. Boot do app pede autenticação.
          </div>
          <button
            onClick={handleDisable}
            disabled={working}
            className="w-full rounded border border-red-900/60 px-3 py-2 text-[11px] uppercase tracking-widest text-red-400 hover:bg-red-950/30 disabled:opacity-50"
          >
            {working ? 'desabilitando…' : 'desabilitar passkey'}
          </button>
        </div>
      ) : (
        <button
          onClick={handleEnable}
          disabled={working}
          className="w-full rounded border border-drift-accent px-3 py-2 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:opacity-50"
        >
          {working ? 'registrando…' : '+ habilitar passkey'}
        </button>
      )}
    </div>
  )
}
