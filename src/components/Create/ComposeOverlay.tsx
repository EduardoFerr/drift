/**
 * ComposeOverlay — V9.1 full-page editor de post (auto-layout).
 *
 * Substitui o SubpostEditor modal (V7) pelo padrão do mockup: página
 * fullscreen com csub dots numerados (1, 2, 3, +) no topo, drop area
 * sempre visível, textarea flex-1, footer com botões `-SUB` (delete
 * current) e `DRIFT ↑` full-width.
 *
 * **V9.1 — auto-inferência de layout (2026-05-09):** removidos os 3
 * botões RETRATO/PAISAGEM/TEXTO. Layout é inferido por
 * `lib/layout-inference.ts:inferLayout()` no momento do publish a
 * partir de (a) presença de imagem e (b) aspect ratio do `meta.dim`.
 * Mesmo input → mesmo layout (manifesto §7 determinismo). User pode
 * controlar layout indireto via aspect ratio da foto que escolhe; o
 * wire format (`Subpost.layout` no content JSON) permanece inalterado
 * pra compat com SubpostLayout.tsx exhaustive switch e posts antigos.
 *
 * Interação:
 * - Apenas 1 subpost visível por vez (currentIdx)
 * - Click no csub circle = troca pra esse subpost
 * - Click no `+` = adiciona novo subpost (até maxSubposts)
 * - Click `-SUB` = remove subpost atual (só visível se >1 subpost)
 * - Click `DRIFT ↑` = publica todos os subposts não-vazios
 *
 * Validação: cada subpost permitido com (texto OU imagem); não exige
 * ambos. Post inteiro requer ≥1 subpost não-vazio.
 *
 * Estado interno (drafts/CW/idx) — não compartilhado com SubpostEditor
 * legado. Quando publish completa, App.tsx fecha o overlay e o
 * componente desmonta — drafts vão pro garbage collector.
 *
 * Anti-CLS: textarea flex-1 com min-height fixo evita layout shift
 * quando user troca entre subposts. Drop area altura fixa 125px.
 *
 * Anti-overflow: body com overflow-y-auto via FullPageCard; textarea
 * com sua própria scrollbar quando text excede min-height.
 */

import { useState } from 'react'
import {
  CONTENT_WARNING_VALUES,
  type Subpost,
  type ContentWarning,
} from '../../types/drift'
import { inferLayout } from '../../lib/layout-inference'
import { uploadBlob, BlobError } from '../../lib/blobs'
import { UploadError } from '../../lib/upload'
import type { BlobMeta } from '../../lib/nip94'
import { DRIFT_LIMITS } from '../../config/constants'
import { Image } from '../UI/Image'
import { FullPageCard } from '../UI/FullPageCard'
import { DriftButton } from '../UI/DriftButton'

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
  // V9.1: layout inferido automaticamente. Determinístico (§7) — depende
  // só do que o user efetivamente colocou no subpost (texto + imagem +
  // dim do blob). Wire format Subpost.layout permanece populated.
  const layout = inferLayout(d.text, d.imageUrl, d.blobMeta)
  return {
    id: d.id,
    type,
    text,
    imageUrl: d.imageUrl,
    order,
    layout,
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

  const remaining = DRIFT_LIMITS.TEXT_MAX_CHARS - draft.text.length
  const overLimit = remaining < 0
  // Round 4 Fase B (F-27 friction fix): counter "62 chars" → "X / Y"
  // (used / max), convenção universal Twitter/Mastodon. Cor warning
  // quando remaining < 20 (já existia overLimit; complementa).
  const used = draft.text.length
  const nearLimit = remaining < 20 && !overLimit

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
      {/* DRIFT ↑ via DriftButton primitive (variant primary, size lg).
          Mantém visual idêntico ao botão inline anterior; padding py-[13px]
          + font-display extrabold é override via className extra (variant
          primary cobre bg/text/hover, size lg cobre tracking; py específico
          do mockup .post-go fica como extra). */}
      <DriftButton
        variant="primary"
        size="lg"
        onClick={handlePublish}
        disabled={blocked}
        className="flex-1 py-[13px] font-display text-fluid-display font-extrabold"
      >
        {/* Round 4 Fase B (F-30 friction fix): CTA "drift ↑" → "publicar ↑".
            DRIFT já é nome do app + ação no feed (↑ swipe). Usar "drift"
            também no compose CTA criava o terceiro significado ("publicar"),
            quebrando mental model do user. "publicar" + ↑ preserva
            consistência visual com swipe direction sem overload do verbo. */}
        {publishing
          ? capturingLocation
            ? '📍 capturando location…'
            : 'publicando…'
          : anyUploading
          ? 'aguardando upload…'
          : 'publicar ↑'}
      </DriftButton>
    </div>
  )

  return (
    <FullPageCard
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

        {/* Editor body — scrollable se viewport curto.
            V9.1 (2026-05-09): removido layout picker (RETRATO/PAISAGEM/
            TEXTO). Drop area sempre visível (opcional); textarea sempre
            visível (opcional). Layout inferido automaticamente no publish
            via lib/layout-inference.ts (manifesto §7 determinismo). */}
        <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
          {/* Drop area (.img-drop) — sempre visível. User pode pular
              (post só-texto) ou anexar (auto-infere portrait/landscape
              por aspect ratio). */}
          <ImageDrop
            draft={draft}
            onFile={handleFile}
            onClear={clearImage}
          />

          {/* Textarea (.post-ta) flex:1. Min-height pra evitar CLS quando
              imagem é adicionada/removida. Placeholder genérico —
              caption opcional, post de texto puro também aceito. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              value={draft.text}
              onChange={(e) => updateCurrent({ text: e.target.value })}
              placeholder={
                draft.imageUrl
                  ? 'legenda (opcional)…'
                  : 'escreva o que vai derivar… (ou anexe uma imagem)'
              }
              rows={5}
              data-subpost-input={safeIdx === 0 ? '' : undefined}
              className="min-h-[85px] flex-1 resize-none rounded-sm border-[1.5px] border-drift-border bg-[#1e1e1c] p-3 font-mono text-fluid-lg leading-[1.6] text-drift-text placeholder:text-drift-muted focus:border-drift-accent focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-[10px]">
              <span
                className={
                  overLimit
                    ? 'text-drift-bury'
                    : nearLimit
                    ? 'text-drift-warning'
                    : 'text-drift-muted'
                }
                title={`${used} de ${DRIFT_LIMITS.TEXT_MAX_CHARS} caracteres usados`}
                aria-label={`${used} de ${DRIFT_LIMITS.TEXT_MAX_CHARS} caracteres usados`}
              >
                {used} / {DRIFT_LIMITS.TEXT_MAX_CHARS}
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

          {/* TM-3 (Marshall Opção A) — warning informativo quando o post
              contém imagens e nenhum content-warning foi declarado.
              Manifesto §27 auto-classificação voluntária: cliente sugere,
              não bloqueia. Não persiste, não telemetra, não hash imagem
              (§17/§28). Aparece só durante compose. */}
          {!contentWarning && drafts.some((d) => !!d.imageUrl) && (
            <div
              role="note"
              aria-label="sugestão de aviso de conteúdo"
              className="rounded border border-drift-warning/40 bg-drift-warning/5 px-3 py-2 font-mono text-[10px] leading-snug text-drift-warning"
            >
              <span className="mr-1" aria-hidden="true">⚠</span>
              Seu post tem imagem mas nenhum aviso de conteúdo. Considere
              adicionar (NSFW, violência, spoiler, ad) acima — ajuda quem
              filtra. Manifesto §27 — auto-classificação voluntária.
            </div>
          )}
        </div>
      </div>
    </FullPageCard>
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
                  ? 'border-drift-warning bg-drift-warning/15 text-drift-warning'
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
