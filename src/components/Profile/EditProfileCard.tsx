/**
 * EditProfileCard — edição opt-in de kind 0 (NIP-01 profile metadata).
 *
 * **Manifesto §5.3 + §28 + §17 + §30**:
 * - Identificação é opt-in; default vazio = modo Anônimo
 * - "Não podemos impedir as pessoas se identificarem" (§4) — direito do user,
 *   mas cliente cria atrito intencional: banner antes do publish, cap em
 *   campos, sem auto-link, sem completeness score
 * - Whitelist NIP-01 puro (`name`, `display_name`, `about`, `picture`, `nip05`)
 * - Picture URL: requer https:// + warning de EXIF
 * - About: ≤140 chars plain text, sem markdown
 * - Reset = publicar kind 0 vazio (LWW sobrescreve)
 *
 * MVP fields:
 *   display_name (32 chars, com warning anti-formato-civil)
 *   about (140 chars, plain text)
 *   picture (URL https:// — warning EXIF)
 *   nip05 (display claim, sem verify externo)
 *
 * MVP+1 (não nesta versão):
 *   pronouns, website, banner, lud16, picture upload
 */

import { useState } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { DriftAlert } from '../UI/DriftAlert'
import { DriftButton } from '../UI/DriftButton'
import { dialog } from '../../lib/dialog'
import {
  publishUserMetadata,
  resetUserMetadata,
  validateProfilePayload,
  PROFILE_LIMITS,
} from '../../lib/profiles'
import type { UserMetadata, UserMetadataPayload } from '../../types/drift'

export interface EditProfileCardProps {
  npub: string
  currentMetadata: UserMetadata | null
  onClose: () => void
}

export function EditProfileCard({ currentMetadata, onClose }: EditProfileCardProps) {
  const [displayName, setDisplayName] = useState(currentMetadata?.displayName ?? '')
  const [about, setAbout] = useState(currentMetadata?.about ?? '')
  const [picture, setPicture] = useState(currentMetadata?.picture ?? '')
  const [nip05, setNip05] = useState(currentMetadata?.nip05 ?? '')
  const [publishing, setPublishing] = useState(false)
  const [errors, setErrors] = useState<{ field: string; reason: string }[]>([])

  // Heurística leve anti-formato-civil — não bloqueia, só warning.
  const civilWarning =
    /\b(\d{6,}|\+?\d{2,3}\s?\d{4,})\b/.test(displayName) ||
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(displayName)

  async function handlePublish() {
    if (publishing) return

    const payload: UserMetadataPayload = {
      display_name: displayName.trim() || undefined,
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
      nip05: nip05.trim() || undefined,
    }

    const validationErrors = validateProfilePayload(payload)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    // Confirmação dupla com aviso explícito de imutabilidade
    const ok = await dialog.confirm(
      'Eventos Nostr são imutáveis. Esse perfil será visível em qualquer cliente Nostr (Damus, Snort, Iris, etc.) — não só Drift. Você pode atualizá-lo depois, mas a publicação original existe pra sempre. Continuar?',
      { title: 'publicar perfil público', okLabel: 'publicar' },
    )
    if (!ok) return

    setPublishing(true)
    setErrors([])
    try {
      await publishUserMetadata(payload)
      onClose()
    } catch (err) {
      setErrors([{ field: 'publish', reason: err instanceof Error ? err.message : String(err) }])
    } finally {
      setPublishing(false)
    }
  }

  async function handleReset() {
    if (publishing) return
    const ok = await dialog.confirm(
      'Publica um kind 0 vazio na sua identidade. Clientes Nostr que respeitam LWW (last-write-wins) vão considerar o último vazio como autoritativo — efetivamente "voltar ao anônimo". Os kind 0 anteriores continuam existindo na rede (eventos são imutáveis), mas não são mais o atual.',
      { title: 'resetar perfil', dangerous: true, okLabel: 'resetar' },
    )
    if (!ok) return
    setPublishing(true)
    try {
      await resetUserMetadata()
      onClose()
    } catch (err) {
      setErrors([{ field: 'reset', reason: err instanceof Error ? err.message : String(err) }])
    } finally {
      setPublishing(false)
    }
  }

  const hasAnyField = displayName.trim() || about.trim() || picture.trim() || nip05.trim()

  return (
    <FullPageCard
      onClose={onClose}
      title="editar perfil"
      ariaLabel="editar perfil público"
      escDismissible={!publishing}
    >
      <div className="space-y-3 px-4 py-5">
        {/* Banner inline §28 + §5.3 — mandatory antes de publicar */}
        <ManifestoNotice />

        {/* display_name */}
        <Field
          label="nome de exibição"
          hint={`máx ${PROFILE_LIMITS.display_name}. vazio = "anônimo"`}
          error={errors.find((e) => e.field === 'display_name')?.reason}
        >
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={PROFILE_LIMITS.display_name}
            placeholder="anônimo"
            className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[13px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
          {civilWarning && (
            <p className="mt-1.5 font-mono text-[10px] text-drift-warning/70">
              isso parece nome civil / dados pessoais — tem certeza? §28 sugere usar alias
            </p>
          )}
        </Field>

        {/* about */}
        <Field
          label="bio"
          hint={`máx ${PROFILE_LIMITS.about}. texto puro, sem links auto`}
          error={errors.find((e) => e.field === 'about')?.reason}
        >
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={PROFILE_LIMITS.about}
            rows={3}
            placeholder="conta um pouco… (opcional)"
            className="w-full resize-none rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] leading-relaxed text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
          <div className="mt-1 text-right font-mono text-[10px] text-drift-muted/40">
            {about.length} / {PROFILE_LIMITS.about}
          </div>
        </Field>

        {/* picture */}
        <Field
          label="avatar URL"
          hint="https:// — atenção a EXIF (rosto/local podem deanonimizar)"
          error={errors.find((e) => e.field === 'picture')?.reason}
        >
          <input
            type="url"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            maxLength={PROFILE_LIMITS.picture}
            placeholder="https://…"
            className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
        </Field>

        {/* nip05 */}
        <Field
          label="nip-05"
          hint="handle@domain.com — exibido como claim, sem verificação externa"
          error={errors.find((e) => e.field === 'nip05')?.reason}
        >
          <input
            type="text"
            value={nip05}
            onChange={(e) => setNip05(e.target.value)}
            maxLength={PROFILE_LIMITS.nip05}
            placeholder="seuapelido@example.com"
            className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
          />
        </Field>

        {errors.find((e) => e.field === 'publish' || e.field === 'reset') && (
          <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-3 font-mono text-[11px] text-drift-danger">
            {errors.find((e) => e.field === 'publish')?.reason ??
              errors.find((e) => e.field === 'reset')?.reason}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <DriftButton
            variant="primary"
            size="lg"
            onClick={() => void handlePublish()}
            disabled={publishing || !hasAnyField}
            className="flex-1"
          >
            {publishing ? 'publicando…' : '↗ publicar'}
          </DriftButton>
        </div>

        {/* Reset — botão destrutivo separado, só aparece se já tem kind 0 */}
        {currentMetadata && (
          <div className="mt-4 border-t border-drift-border/40 pt-4">
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={publishing}
              className="w-full rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/30"
            >
              ↻ resetar perfil (voltar ao anônimo)
            </button>
            <p className="mt-2 px-1 font-mono text-[10px] leading-relaxed text-drift-muted/60">
              publica kind 0 vazio. clientes que respeitam LWW consideram esse como autoritativo.
            </p>
          </div>
        )}
      </div>
    </FullPageCard>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
          {label}
        </span>
        <span className="font-mono text-[10px] text-drift-muted/60">{hint}</span>
      </div>
      {children}
      {error && (
        <p className="mt-1.5 font-mono text-[10px] text-drift-danger">{error}</p>
      )}
    </div>
  )
}

function ManifestoNotice() {
  return (
    <DriftAlert variant="warning" title="antes de publicar">
      <p>
        <strong className="text-drift-warning">§28 privacidade pelo mínimo:</strong>{' '}
        anonimato é o default. tudo que voce preencher aqui vira público em
        todos os relays e visível em qualquer cliente nostr (damus, snort, iris).
      </p>
      <p className="mt-2">
        <strong className="text-drift-warning">§5.3 modos de identidade:</strong>{' '}
        "o cliente nunca obriga o usuário a se identificar. se o usuário
        publica seu nome real voluntariamente, é decisão dele e direito dele."
      </p>
    </DriftAlert>
  )
}
