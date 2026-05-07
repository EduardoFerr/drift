/**
 * ComposeOverlay — V9 full-page editor de post (mockup v0.7).
 *
 * Substitui o SubpostEditor modal (V7) pelo padrão do mockup: página
 * fullscreen com csub dots numerados (1, 2, 3, +) no topo, layout
 * chips horizontal, drop area condicional (visível só em RETRATO/
 * PAISAGEM), textarea flex-1, footer com botões `-SUB` (delete current)
 * e `DRIFT ↑` full-width.
 *
 * Interação:
 * - Apenas 1 subpost visível por vez (currentIdx)
 * - Click no csub circle = troca pra esse subpost
 * - Click no `+` = adiciona novo subpost (até maxSubposts)
 * - Click `-SUB` = remove subpost atual (só visível se >1 subpost)
 * - Click `DRIFT ↑` = publica todos os subposts não-vazios
 *
 * Estado interno (drafts/CW/idx) — não compartilhado com SubpostEditor
 * legado. Quando publish completa, App.tsx fecha o overlay e o
 * componente desmonta — drafts vão pro garbage collector.
 *
 * Anti-CLS: textarea flex-1 com min-height fixo evita layout shift
 * quando user troca entre subposts. Drop area altura fixa 125px.
 *
 * Anti-overflow: body com overflow-y-auto via FullPageOverlay; textarea
 * com sua própria scrollbar quando text excede min-height.
 */

import { useState } from 'react'
import {
  CONTENT_WARNING_VALUES,
  LAYOUT_VALUES,
  DEFAULT_LAYOUT,
  type Subpost,
  type ContentWarning,
  type LayoutKind,
} from '../../types/drift'
import { uploadBlob, BlobError } from '../../lib/blobs'
import { UploadError } from '../../lib/upload'
import type { BlobMeta } from '../../lib/nip94'
import { DRIFT_LIMITS } from '../../config/constants'
import { Image } from '../UI/Image'
import { FullPageOverlay } from '../UI/FullPageOverlay'

export interface ComposeOverlayProps {
  publishing: boolean
  capturingLocation?: boolean
  maxSubposts: number
  onClose: () => void
  onPublish: (input: {
    subposts: Subpost[]
    contentWarning: ContentWarning | null
    /** Metadados NIP-94 dos blobs uploaded (Track B.2). Ordem casa com
     *  a ordem dos subposts que têm imageUrl. Subposts sem imagem não
     *  contribuem entrada aqui. */
    imetas: BlobMeta[]
  }) => Promise<void> | void
}

interface DraftSubpost {
  id: string
  text: string
  imageUrl: string | null
  imageFile: File | null
  /**
   * Metadado NIP-94 do blob uploaded (Track B.2). Populado por handleFile
   * após uploadBlob retornar com hash + cid + size + mime. Vira tag
   * `imeta` no kind 9078.
   */
  blobMeta: BlobMeta | null
  uploading: boolean
  uploadError: string | null
  layout: LayoutKind
}

function newDraft(): DraftSubpost {
  return {
    id: crypto.randomUUID(),
    text: '',
    imageUrl: null,
    imageFile: null,
    blobMeta: null,
    uploading: false,
    uploadError: null,
    layout: DEFAULT_LAYOUT,
  }
}

function isDraftEmpty(d: DraftSubpost): boolean {
  return !d.text.trim() && !d.imageUrl
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
    layout: d.layout,
  }
}

export function ComposeOverlay({
  publishing,
  capturingLocation = false,
  maxSubposts,
  onClose,
  onPublish,
}: ComposeOverlayProps) {
  const [drafts, setDrafts] = useState<DraftSubpost[]>(() => [newDraft()])
  const [contentWarning, setContentWarning] = useState<ContentWarning | null>(
    null,
  )
  const [currentIdx, setCurrentIdx] = useState(0)

  // Clamp idx — pode acontecer ao remover subpost.
  const safeIdx = Math.max(0, Math.min(currentIdx, drafts.length - 1))
  const draft = drafts[safeIdx]!

  function updateCurrent(patch: Partial<DraftSubpost>) {
    setDrafts((arr) => arr.map((d, i) => (i === safeIdx ? { ...d, ...patch } : d)))
  }

  function addSubpost() {
    if (drafts.length >= maxSubposts) return
    setDrafts((arr) => [...arr, newDraft()])
    setCurrentIdx(drafts.length) // pula pro novo
  }

  function removeCurrent() {
    if (drafts.length === 1) return
    setDrafts((arr) => arr.filter((_, i) => i !== safeIdx))
    setCurrentIdx((i) => Math.max(0, i - 1))
  }

  async function handleFile(file: File) {
    updateCurrent({ imageFile: file, uploading: true, uploadError: null })
    try {
      // Track B.2: uploadBlob retorna BlobMeta completo (url + hash +
      // size + mime + opcional cid). Helia é best-effort — se falhar,
      // cid fica undefined mas post ainda publica via HTTP url.
      const meta = await uploadBlob(file)
      updateCurrent({
        imageUrl: meta.url,
        blobMeta: meta,
        uploading: false,
      })
    } catch (err) {
      const msg =
        err instanceof UploadError
          ? `upload falhou: ${err.message}`
          : err instanceof BlobError
          ? `upload falhou: ${err.message}`
          : err instanceof Error
          ? err.message
          : String(err)
      updateCurrent({ uploading: false, uploadError: msg, imageFile: null })
    }
  }

  function clearImage() {
    updateCurrent({
      imageUrl: null,
      imageFile: null,
      blobMeta: null,
      uploadError: null,
    })
  }

  // Validação agregada (todos os drafts).
  const anyUploading = drafts.some((d) => d.uploading)
  const anyOverLimit = drafts.some(
    (d) => d.text.length > DRIFT_LIMITS.TEXT_MAX_CHARS,
  )
  const allEmpty = drafts.every(isDraftEmpty)
  const blocked = publishing || anyUploading || allEmpty || anyOverLimit

  async function handlePublish() {
    if (blocked) return
    const nonEmpty = drafts.filter((d) => !isDraftEmpty(d))
    const subposts: Subpost[] = nonEmpty.map((d, i) => draftToSubpost(d, i))
    if (subposts.length === 0) return

    // imetas na ordem dos subposts com imagem (RFC §3.5.3 — convenção
    // ordem = ordem). Subposts só-texto não contribuem entrada.
    const imetas: BlobMeta[] = nonEmpty
      .map((d) => d.blobMeta)
      .filter((m): m is BlobMeta => m !== null)

    await onPublish({ subposts, contentWarning, imetas })
    // Reset interno (caller fecha o overlay).
    setDrafts([newDraft()])
    setCurrentIdx(0)
    setContentWarning(null)
  }

  // Layout = label tradução pra UI (mockup: TEXTO/RETRATO/PAISAGEM).
  const LAYOUT_LABELS: Record<LayoutKind, { label: string; icon: string }> = {
    text: { label: 'texto', icon: '≡' },
    portrait: { label: 'retrato', icon: '▯' },
    landscape: { label: 'paisagem', icon: '▭' },
  }

  const showImagePicker = draft.layout !== 'text'
  const remaining = DRIFT_LIMITS.TEXT_MAX_CHARS - draft.text.length
  const overLimit = remaining < 0

  // Botão CANCELAR no header right (mockup pattern). Em vez do default
  // FECHAR; UX semântico — "cancela a composição" é mais claro que "fecha".
  const headerRight = (
    <button
      onClick={onClose}
      disabled={publishing}
      className="rounded border border-drift-border px-3 py-[5px] font-mono text-[10px] uppercase tracking-[2px] text-drift-muted transition-colors hover:text-drift-text disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-drift-accent2"
      aria-label="cancelar"
    >
      cancelar
    </button>
  )

  // Footer com -SUB + DRIFT ↑. -SUB só aparece se >1 subpost.
  const footer = (
    <div className="flex shrink-0 items-stretch gap-[9px] px-[18px] py-[11px]">
      {drafts.length > 1 && (
        <button
          onClick={removeCurrent}
          disabled={publishing}
          className="rounded border border-drift-border px-[14px] font-mono text-[10px] uppercase tracking-[1px] text-drift-bury transition-colors hover:border-drift-bury disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-drift-accent2"
          aria-label="remover subpost atual"
        >
          - SUB
        </button>
      )}
      <button
        onClick={handlePublish}
        disabled={blocked}
        className="flex-1 rounded bg-drift-accent px-3 py-[13px] font-display text-[14px] font-extrabold uppercase tracking-[2px] text-drift-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
      >
        {publishing
          ? capturingLocation
            ? '📍 capturando location…'
            : 'publicando…'
          : anyUploading
          ? 'aguardando upload…'
          : 'drift ↑'}
      </button>
    </div>
  )

  return (
    <FullPageOverlay
      onClose={onClose}
      title="novo drift"
      headerRight={headerRight}
      ariaLabel="criar novo post"
      footer={footer}
      escDismissible={!publishing}
    >
      <div className="flex h-full flex-col">
        {/* csub dots row (mockup .cr-tabs) — numbered circles per subpost
            + dashed add button. Scroll-x se muitos subposts (defensive
            anti-overflow em mobile). */}
        <div className="flex shrink-0 items-center gap-[7px] overflow-x-auto border-b border-drift-border px-[18px] py-[10px]">
          {drafts.map((d, i) => {
            const isActive = i === safeIdx
            const isFilled = !isDraftEmpty(d)
            return (
              <button
                key={d.id}
                onClick={() => setCurrentIdx(i)}
                className={`relative flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[10px] transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-1 focus:ring-offset-drift-bg ${
                  isActive
                    ? 'border-drift-accent bg-drift-accent font-bold text-drift-bg'
                    : isFilled
                    ? 'border-drift-border bg-[#1e1e1c] text-drift-text'
                    : 'border-drift-border bg-[#1e1e1c] text-drift-muted'
                }`}
                aria-label={`ir pro subpost ${i + 1}`}
                aria-current={isActive ? 'true' : undefined}
              >
                {i + 1}
                {/* dot indicador "tem imagem" — accent2 mint. */}
                {d.imageUrl && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-[2px] -top-[2px] h-[5px] w-[5px] rounded-full border border-drift-bg bg-drift-accent2"
                  />
                )}
              </button>
            )
          })}
          {drafts.length < maxSubposts && (
            <button
              onClick={addSubpost}
              className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-drift-border text-[15px] text-drift-muted transition-colors hover:border-drift-accent hover:text-drift-accent focus:outline-none focus:ring-1 focus:ring-drift-accent2"
              aria-label="adicionar subpost"
            >
              +
            </button>
          )}
          <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-meta text-drift-muted">
            {drafts.length}/{maxSubposts}
          </span>
        </div>

        {/* Editor body — scrollable se viewport curto. */}
        <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
          {/* Layout picker (mockup .lp). */}
          <div
            className="flex shrink-0 gap-[7px]"
            role="radiogroup"
            aria-label="layout do subpost"
          >
            {LAYOUT_VALUES.map((kind) => {
              const isActive = draft.layout === kind
              const meta = LAYOUT_LABELS[kind]
              return (
                <button
                  key={kind}
                  onClick={() => updateCurrent({ layout: kind })}
                  role="radio"
                  aria-checked={isActive}
                  className={`flex flex-1 items-center justify-center gap-[5px] rounded-sm border-[1.5px] py-[8px] font-mono text-[9px] uppercase tracking-meta transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg ${
                    isActive
                      ? 'border-drift-accent text-drift-accent'
                      : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
                  }`}
                >
                  <span aria-hidden="true">{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              )
            })}
          </div>

          {/* Drop area (.img-drop) — visível só em retrato/paisagem. */}
          {showImagePicker && (
            <ImageDrop
              draft={draft}
              onFile={handleFile}
              onClear={clearImage}
            />
          )}

          {/* Textarea (.post-ta) flex:1. Min-height pra evitar CLS quando
              imagem é adicionada/removida (drop area aparece/some). */}
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              value={draft.text}
              onChange={(e) => updateCurrent({ text: e.target.value })}
              placeholder={
                draft.layout === 'text'
                  ? 'escreva o que vai derivar…'
                  : 'legenda (opcional)…'
              }
              rows={5}
              data-subpost-input={safeIdx === 0 ? '' : undefined}
              className="min-h-[85px] flex-1 resize-none rounded-sm border-[1.5px] border-drift-border bg-[#1e1e1c] p-3 font-mono text-[13px] leading-[1.6] text-drift-text placeholder:text-drift-muted focus:border-drift-accent focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-[10px]">
              <span
                className={
                  overLimit ? 'text-drift-bury' : 'text-drift-muted'
                }
              >
                {remaining} chars
              </span>
              {draft.uploadError && (
                <span className="ml-3 truncate font-mono text-drift-bury" title={draft.uploadError}>
                  {draft.uploadError}
                </span>
              )}
            </div>
          </div>

          {/* Content warning picker (compartilhado entre todos os subposts). */}
          <ContentWarningRow
            value={contentWarning}
            onChange={setContentWarning}
          />
        </div>
      </div>
    </FullPageOverlay>
  )
}

// ─── Drop area ───────────────────────────────────────────────────────

function ImageDrop({
  draft,
  onFile,
  onClear,
}: {
  draft: DraftSubpost
  onFile: (f: File) => void
  onClear: () => void
}) {
  // Altura fixa 125px = anti-CLS quando imagem carrega.
  return (
    <label
      className={`relative flex h-[125px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[7px] overflow-hidden rounded-sm border-[1.5px] border-dashed transition-colors ${
        draft.imageUrl
          ? 'border-drift-border'
          : 'border-drift-border hover:border-drift-accent'
      }`}
    >
      {draft.imageUrl ? (
        <>
          <Image
            src={draft.imageUrl}
            // Track B.2 — passa blobMeta pro preview também. Image
            // resolve via fetchBlobUrl (objeto blob: URL local), o que
            // bypassa COEP em browsers strict. Sem isso, o `<img>` puxa
            // direto do CDN do nostr.build e algumas configurações de
            // COEP bloqueiam (require-corp; image.nostr.build não
            // envia CORP header).
            meta={draft.blobMeta ?? undefined}
            className="absolute inset-0 h-full w-full object-cover"
            aspect="auto"
          />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              onClear()
            }}
            className="absolute right-[7px] top-[7px] z-[2] rounded border border-drift-border bg-[rgba(0,0,0,0.75)] px-2 py-[3px] font-mono text-[10px] text-drift-bury transition-colors hover:border-drift-bury"
          >
            REMOVER
          </button>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="text-[24px] opacity-35">
            🖼
          </span>
          <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            {draft.uploading ? 'fazendo upload…' : 'adicionar imagem'}
          </span>
        </>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={draft.uploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </label>
  )
}

// ─── Content warning ─────────────────────────────────────────────────

function ContentWarningRow({
  value,
  onChange,
}: {
  value: ContentWarning | null
  onChange: (v: ContentWarning | null) => void
}) {
  return (
    <div className="shrink-0 border-t border-drift-border pt-[10px]">
      <div
        className="mb-[7px] font-mono text-[9px] uppercase tracking-[2px] text-drift-muted"
        title="manifesto §27 — autor declara, leitor filtra"
      >
        marcar conteúdo (opcional)
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {CONTENT_WARNING_VALUES.map((cw) => {
          const active = value === cw
          return (
            <button
              key={cw}
              type="button"
              onClick={() => onChange(active ? null : cw)}
              className={`rounded-sm border-[1.5px] px-[10px] py-[5px] font-mono text-[9px] uppercase tracking-meta transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 ${
                active
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                  : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
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
