/**
 * SubpostEditor — composição de um post com 1..N subposts.
 *
 * Quantos subposts são permitidos? Função do peso da identidade
 * (`getMaxSubposts(weight)` em `lib/weight.ts`) — manifesto §22, §33
 * (anti-spam pela mecânica social, não PoW). Identidade nova começa
 * em 1; cresce conforme acumula peso.
 *
 * Auto-classificação voluntária (manifesto §27): autor escolhe se
 * marca o post inteiro como `nsfw` / `violence` / `spoiler` / `ad`.
 * Cliente oficial NÃO classifica automaticamente — sem nsfwjs, sem
 * PhotoDNA, sem ML embutido (manifesto §25).
 *
 * Cada subpost pode ser `text`, `image`, ou `text+image`. Upload via
 * `lib/upload.ts` (nostr.build, retry+jitter, sem scan, compressão
 * local + EXIF strip).
 */

import { useState } from 'react'
import { CONTENT_WARNING_VALUES, type Subpost, type ContentWarning } from '../../types/drift'
import { uploadImage, UploadError } from '../../lib/upload'
import { DRIFT_LIMITS } from '../../config/constants'
import { Image } from '../UI/Image'

export interface SubpostEditorProps {
  publishing: boolean
  /**
   * Captura GPS em curso antes do publish. UX: getCurrentLocation pode
   * demorar até 8s (timeout do navigator.geolocation). Sem feedback,
   * o user acha que travou. Quando true, botão mostra "📍 capturando…".
   */
  capturingLocation?: boolean
  /** Limite de subposts pra esta identidade. Vem de `getMaxSubposts(weight)`. */
  maxSubposts: number
  onPublish: (input: {
    subposts: Subpost[]
    contentWarning: ContentWarning | null
  }) => Promise<void> | void
}

interface DraftSubpost {
  id: string
  text: string
  imageUrl: string | null
  imageFile: File | null
  uploading: boolean
  uploadError: string | null
}

function newDraft(): DraftSubpost {
  return {
    id: crypto.randomUUID(),
    text: '',
    imageUrl: null,
    imageFile: null,
    uploading: false,
    uploadError: null,
  }
}

function draftToSubpost(d: DraftSubpost, order: number): Subpost {
  const text = d.text.trim() || null
  const type: Subpost['type'] = d.imageUrl
    ? text
      ? 'text+image'
      : 'image'
    : 'text'
  return {
    id: d.id,
    type,
    text,
    imageUrl: d.imageUrl,
    order,
  }
}

function isDraftEmpty(d: DraftSubpost): boolean {
  return !d.text.trim() && !d.imageUrl
}

export function SubpostEditor({ publishing, capturingLocation = false, maxSubposts, onPublish }: SubpostEditorProps) {
  const [drafts, setDrafts] = useState<DraftSubpost[]>(() => [newDraft()])
  const [contentWarning, setContentWarning] = useState<ContentWarning | null>(null)

  function updateDraft(id: string, patch: Partial<DraftSubpost>) {
    setDrafts((arr) => arr.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function addSubpost() {
    if (drafts.length >= maxSubposts) return
    setDrafts((arr) => [...arr, newDraft()])
  }

  function removeSubpost(id: string) {
    setDrafts((arr) => (arr.length === 1 ? arr : arr.filter((d) => d.id !== id)))
  }

  async function handleFile(id: string, file: File) {
    updateDraft(id, { imageFile: file, uploading: true, uploadError: null })
    try {
      const url = await uploadImage(file)
      updateDraft(id, { imageUrl: url, uploading: false })
    } catch (err) {
      const msg =
        err instanceof UploadError
          ? `upload falhou: ${err.message}`
          : err instanceof Error
          ? err.message
          : String(err)
      updateDraft(id, { uploading: false, uploadError: msg, imageFile: null })
    }
  }

  function clearImage(id: string) {
    updateDraft(id, { imageUrl: null, imageFile: null, uploadError: null })
  }

  // Validação agregada
  const anyUploading = drafts.some((d) => d.uploading)
  const anyOverLimit = drafts.some((d) => d.text.length > DRIFT_LIMITS.TEXT_MAX_CHARS)
  const allEmpty = drafts.every(isDraftEmpty)
  const blocked = publishing || anyUploading || allEmpty || anyOverLimit

  async function handleSubmit() {
    if (blocked) return
    const subposts: Subpost[] = drafts
      .filter((d) => !isDraftEmpty(d))
      .map((d, i) => draftToSubpost(d, i))
    if (subposts.length === 0) return
    await onPublish({ subposts, contentWarning })
    // Reset
    setDrafts([newDraft()])
    setContentWarning(null)
  }

  return (
    <div className="mb-6 rounded border border-drift-border bg-drift-surface p-3">
      <div className="space-y-3">
        {drafts.map((draft, idx) => (
          <SubpostBlock
            key={draft.id}
            index={idx}
            total={drafts.length}
            draft={draft}
            onChange={(patch) => updateDraft(draft.id, patch)}
            onFile={(f) => handleFile(draft.id, f)}
            onClearImage={() => clearImage(draft.id)}
            onRemove={drafts.length > 1 ? () => removeSubpost(draft.id) : null}
          />
        ))}
      </div>

      {drafts.length < maxSubposts && (
        <button
          onClick={addSubpost}
          className="mt-3 w-full rounded border border-dashed border-drift-border px-3 py-2 text-[11px] text-slate-500 hover:border-drift-accent hover:text-drift-accent"
        >
          + adicionar subpost ({drafts.length}/{maxSubposts})
        </button>
      )}
      {drafts.length >= maxSubposts && drafts.length > 1 && (
        <div className="mt-3 text-[10px] text-slate-600">
          limite atingido ({drafts.length}/{maxSubposts}) — peso da identidade
          define o máximo (manifesto §22)
        </div>
      )}

      <ContentWarningPicker value={contentWarning} onChange={setContentWarning} />

      <div className="mt-3 flex items-center justify-between text-[10px]">
        <div className="text-slate-600">
          {drafts.length} subpost{drafts.length === 1 ? '' : 's'} · max {maxSubposts}
        </div>
        <button
          onClick={handleSubmit}
          disabled={blocked}
          className="rounded border border-drift-accent px-3 py-1 text-xs uppercase tracking-widest text-drift-accent transition-colors hover:bg-drift-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {publishing
            ? capturingLocation
              ? '📍 capturando location…'
              : 'publicando…'
            : anyUploading
            ? 'aguardando upload…'
            : 'publicar'}
        </button>
      </div>
    </div>
  )
}

// ─── Subpost Block ──────────────────────────────────────────────────

function SubpostBlock({
  index,
  total,
  draft,
  onChange,
  onFile,
  onClearImage,
  onRemove,
}: {
  index: number
  total: number
  draft: DraftSubpost
  onChange: (patch: Partial<DraftSubpost>) => void
  onFile: (file: File) => void
  onClearImage: () => void
  onRemove: (() => void) | null
}) {
  const remaining = DRIFT_LIMITS.TEXT_MAX_CHARS - draft.text.length
  const overLimit = remaining < 0

  return (
    <div className="rounded border border-drift-border/60 bg-drift-bg/30 p-2">
      {total > 1 && (
        <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-slate-600">
          <span>subpost {index + 1}/{total}</span>
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-red-400/70 hover:text-red-300"
              title="remover este subpost"
            >
              remover
            </button>
          )}
        </div>
      )}

      <textarea
        value={draft.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={index === 0 ? 'o que está acontecendo?' : 'continua…'}
        rows={2}
        data-subpost-input={index === 0 ? '' : undefined}
        className="w-full resize-none bg-transparent text-sm text-slate-200 placeholder:text-slate-700 focus:outline-none"
      />

      {draft.imageUrl && (
        <div className="mt-2 rounded border border-drift-border bg-drift-bg p-2">
          <Image src={draft.imageUrl} className="max-h-64 w-full rounded" aspect="auto" />
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
            <span className="truncate">{draft.imageFile?.name ?? 'imagem'}</span>
            <button onClick={onClearImage} className="text-red-400 hover:text-red-300">
              remover
            </button>
          </div>
        </div>
      )}

      {draft.uploadError && (
        <div className="mt-2 rounded border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-red-300">
          {draft.uploadError}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <ImagePicker
          disabled={draft.uploading || !!draft.imageUrl}
          uploading={draft.uploading}
          onFile={onFile}
        />
        <span className={overLimit ? 'text-red-400' : 'text-slate-600'}>{remaining}</span>
      </div>
    </div>
  )
}

function ImagePicker({
  disabled,
  uploading,
  onFile,
}: {
  disabled: boolean
  uploading: boolean
  onFile: (f: File) => void
}) {
  return (
    <label
      className={`cursor-pointer rounded border border-drift-border px-2 py-1 text-slate-500 hover:border-drift-accent hover:text-drift-accent ${
        disabled ? 'pointer-events-none opacity-40' : ''
      }`}
    >
      {uploading ? '↑ …' : '+ imagem'}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </label>
  )
}

function ContentWarningPicker({
  value,
  onChange,
}: {
  value: ContentWarning | null
  onChange: (v: ContentWarning | null) => void
}) {
  return (
    <div className="mt-3 border-t border-drift-border pt-2">
      <div
        className="mb-2 text-[10px] uppercase tracking-widest text-slate-600"
        title="manifesto §27 — autor declara, leitor filtra"
      >
        marcar conteúdo (opcional)
      </div>
      <div className="flex flex-wrap gap-2">
        {CONTENT_WARNING_VALUES.map((cw) => {
          const active = value === cw
          return (
            <button
              key={cw}
              type="button"
              onClick={() => onChange(active ? null : cw)}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                active
                  ? 'border-yellow-400 bg-yellow-900/20 text-yellow-300'
                  : 'border-drift-border text-slate-500 hover:border-yellow-700 hover:text-yellow-500'
              }`}
            >
              {active ? '✓ ' : ''}
              {cw}
            </button>
          )
        })}
      </div>
    </div>
  )
}
