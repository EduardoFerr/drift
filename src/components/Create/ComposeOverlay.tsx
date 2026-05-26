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
  type LocationGranularity,
} from '../../types/drift'
import { inferLayout } from '../../lib/layout-inference'
import { uploadBlob, BlobError } from '../../lib/blobs'
import { UploadError } from '../../lib/upload'
import type { BlobMeta } from '../../lib/nip94'
import { DRIFT_LIMITS } from '../../config/constants'
import { Image } from '../UI/Image'
import { FullPageCard } from '../UI/FullPageCard'
import { DriftButton } from '../UI/DriftButton'
import { SubpostLayout } from '../Post/SubpostLayout'
import { usePrefsStore } from '../../lib/prefs'
import { WarningIcon } from '../UI/Icons'
import { GpsScopeButton } from './GpsScopeButton'

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
    /**
     * Escopo GPS escolhido per-post (manifesto §28 — privacy mínima por
     * inércia eliminada). Pre-selecionado a partir de
     * `user_prefs.location_granularity` (que vira "padrão pra novos
     * posts"); user pode override per-post via GpsScopeButton no header.
     * Caller (App.tsx) usa esse valor em `getCurrentLocation(scope)`
     * — NÃO mais lê `prefs.location_granularity` direto no publish flow.
     */
    gpsScope: LocationGranularity
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

/**
 * Extrai host de URL com fallback seguro. Satoshi audit 2026-05-19:
 * usado pra exibir badge 'upload via X' quando upload_endpoint
 * customizado — torna tampering DETECTÁVEL antes do user publicar
 * foto sensível pra servidor adversário.
 */
function safeHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
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
  const [showPreview, setShowPreview] = useState(false)
  // Manifesto §28 (privacy mínima por inércia eliminada): GPS é decisão
  // per-post, não setting persistente. Pre-selecionamos com o valor de
  // `user_prefs.location_granularity` (que agora é "padrão pra novos
  // posts" — não mais "sempre vaza"). User pode override per-post via
  // GpsScopeButton no header sem mexer no setting persistente.
  const defaultScope = usePrefsStore((s) => s.location_granularity)
  const [gpsScope, setGpsScope] = useState<LocationGranularity>(defaultScope)
  // Toast inline quando permission GPS é negada após user selecionar
  // country/city/precise. Visível 4s; dismiss manual via tap.
  const [gpsDeniedToast, setGpsDeniedToast] = useState(false)
  // Satoshi audit 2026-05-19: upload_endpoint customizado é invisível
  // no compose flow. Adversário com 5min de acesso ao device pode setar
  // endpoint malicioso em Settings > Soberania; user manda foto pro
  // servidor adversário sem perceber. Badge visible-when-custom torna
  // tampering DETECTÁVEL (defesa via visibilidade, manifesto §28).
  const customUploadEndpoint = usePrefsStore((s) => s.upload_endpoint)
  const hasCustomUpload = !!customUploadEndpoint
  const customUploadHost = hasCustomUpload
    ? safeHost(customUploadEndpoint)
    : null
  const hasAnyImage = drafts.some((d) => d.imageUrl !== null)

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

    await onPublish({ subposts, contentWarning, imetas, gpsScope })
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

  // Header right: GpsScopeButton (decisão per-post de localização —
  // manifesto §28) + CANCELAR. Ordem: GPS antes de CANCELAR, alinhados
  // à direita. GpsScopeButton tem popover próprio (z-50) que escapa
  // do header.
  const headerRight = (
    <div className="flex items-center gap-2">
      <GpsScopeButton
        value={gpsScope}
        onChange={setGpsScope}
        disabled={publishing}
        onPermissionDenied={() => {
          setGpsDeniedToast(true)
          // Auto-dismiss em 4s.
          setTimeout(() => setGpsDeniedToast(false), 4000)
        }}
      />
      <DriftButton
        variant="ghost"
        size="md"
        onClick={onClose}
        disabled={publishing}
        aria-label="cancelar"
      >
        cancelar
      </DriftButton>
    </div>
  )

  // Footer com -SUB + DRIFT ↑. -SUB só aparece se >1 subpost.
  const footer = (
    <div className="flex shrink-0 items-stretch gap-[9px] px-[18px] py-[11px]">
      {drafts.length > 1 && (
        <button
          onClick={removeCurrent}
          disabled={publishing}
          className="rounded-xl border border-drift-danger/30 bg-drift-danger/5 px-4 font-mono text-[12px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-danger/30"
          aria-label="remover subpost atual"
        >
          − sub
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
        {/* Satoshi audit 2026-05-19: badge warning quando upload_endpoint
            customizado E user tem foto pra publicar. Defesa via
            visibilidade — adversário não consegue mais setar endpoint
            malicioso silenciosamente. Não bloqueia publicação (user
            consciente que setou pode prosseguir); só TORNA EVIDENTE. */}
        {gpsDeniedToast && (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-b border-drift-warning/40 bg-drift-warning/10 px-4 py-2.5 text-drift-warning"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              <WarningIcon size={14} strokeWidth={2} />
            </span>
            <p className="font-mono text-[11px] leading-relaxed">
              permissão de localização negada — post vai sem GPS. ajuste no
              ícone de cadeado da URL pra liberar.
            </p>
          </div>
        )}
        {hasCustomUpload && hasAnyImage && customUploadHost && (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-b border-drift-warning/50 bg-drift-warning/15 px-4 py-3 text-drift-warning"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              <WarningIcon size={14} strokeWidth={2} />
            </span>
            <p className="font-mono text-[11px] leading-relaxed">
              <span className="font-bold uppercase tracking-meta">
                upload customizado:{' '}
              </span>
              imagens vão pra{' '}
              <code className="font-mono text-drift-text">
                {customUploadHost}
              </code>
              {' '}(setado em Soberania). Se você não configurou isso, alguém
              alterou — desative em Soberania &gt; endpoint de upload &gt; limpar.
            </p>
          </div>
        )}
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
                // Chips de subpost usam drift-bg pra inset visual contra drift-surface
                // do painel parent (#15151a vs #0c0c0b). Diff sutil mas suficiente
                // pra delimitar; antes era #1e1e1c custom — consolidado em token.
                className={`relative flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[12px] transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-1 focus:ring-offset-drift-bg ${
                  isActive
                    ? 'border-drift-accent2 bg-drift-accent2 font-bold text-drift-bg'
                    : isFilled
                    ? 'border-drift-border/40 bg-drift-bg text-drift-text'
                    : 'border-drift-border/40 bg-drift-bg text-drift-muted'
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
          <span className="ml-auto shrink-0 font-mono text-[12px] uppercase tracking-meta text-drift-muted">
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

          {/* Textarea. Tamanho cap (max-h-44 = ~176px) — 250 chars cabe em
              ~6 linhas; mais que isso vira scroll interno. Sem flex-1
              pra não ocupar toda viewport. */}
          <div className="flex min-h-0 flex-col">
            <textarea
              value={draft.text}
              onChange={(e) => updateCurrent({ text: e.target.value })}
              maxLength={DRIFT_LIMITS.TEXT_MAX_CHARS}
              placeholder={
                draft.imageUrl
                  ? 'legenda (opcional)…'
                  : 'escreva o que vai derivar… (ou anexe uma imagem)'
              }
              rows={4}
              data-subpost-input={safeIdx === 0 ? '' : undefined}
              // wcag-audit: ok reason=doc-comment-describes-historical-fix
              // WCAG audit 2026-05-17 (Marshall regra de 2 camadas):
              // bg-drift-bg/60 + placeholder:text-drift-muted/40 = double-alpha
              // que falha AA em velatura (light theme, ratio 1.68:1). Fix:
              // bg-drift-bg opaco + placeholder sem alpha (drift-muted/70 mínimo
              // pra contrast AA em todos os 3 temas).
              className="min-h-[100px] max-h-44 resize-none rounded-xl border border-drift-border/40 bg-drift-bg p-4 font-mono text-fluid-lg leading-[1.6] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/50 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
            />
            <div className="mt-1.5 flex items-center justify-between font-mono text-[11px]">
              <span
                className={
                  overLimit
                    ? 'text-drift-danger'
                    : nearLimit
                    ? 'text-drift-warning'
                    : 'text-drift-muted/50'
                }
                title={`${used} de ${DRIFT_LIMITS.TEXT_MAX_CHARS} caracteres usados`}
                aria-label={`${used} de ${DRIFT_LIMITS.TEXT_MAX_CHARS} caracteres usados`}
              >
                {used} / {DRIFT_LIMITS.TEXT_MAX_CHARS}
              </span>
              {/* Item #4 fricção iniciante 2026-05-23: disabled state
                  era sutil (opacity-30 não comunicava 'inativo' bem ao
                  user iniciante). Agora:
                  - opacity-40 + border-dashed quando vazio (visual mais
                    forte de 'campo aguardando ação')
                  - copy muda pra '✕ escreva algo' (explica POR QUÊ
                    está inativo)
                  - title tooltip cobre hover desktop
                  Mantém pointer-events: none implícito de `disabled` no
                  HTML — sem precisar de classe extra. */}
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                disabled={allEmpty}
                title={allEmpty ? 'escreva algo antes de pré-visualizar' : 'pré-visualizar o post'}
                className={`rounded-lg border px-3 py-1 font-mono text-[10px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                  allEmpty
                    ? 'cursor-not-allowed border-dashed border-drift-muted/30 bg-transparent text-drift-muted/50'
                    : 'border-drift-accent2/30 bg-drift-surface/30 text-drift-accent2 hover:bg-drift-accent2/10'
                }`}
              >
                {allEmpty ? '✕ escreva algo' : '◐ prévia'}
              </button>
              {draft.uploadError && (
                <span className="ml-3 truncate text-drift-danger" title={draft.uploadError}>
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
              className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[11px] leading-snug text-drift-warning"
            >
              post com imagem sem aviso. considere marcar acima (NSFW, violência, spoiler, ad) — ajuda quem filtra.
            </div>
          )}
        </div>
      </div>

      {showPreview && (
        <PreviewOverlay
          drafts={drafts}
          contentWarning={contentWarning}
          onClose={() => setShowPreview(false)}
        />
      )}
    </FullPageCard>
  )
}

// ─── Preview overlay ─────────────────────────────────────────────────

/**
 * PreviewOverlay — renderiza o draft como o card apareceria no feed.
 * Constrói um Post mock a partir dos drafts não-vazios; SubpostLayout
 * cuida do render (mesmo componente do feed, manifesto §7 determinismo).
 *
 * Carrossel simples (← →) entre subposts quando há mais de 1.
 */
function PreviewOverlay({
  drafts,
  contentWarning,
  onClose,
}: {
  drafts: DraftSubpost[]
  contentWarning: ContentWarning | null
  onClose: () => void
}) {
  const filled = drafts.filter((d) => !isDraftEmpty(d))
  const subposts: Subpost[] = filled.length === 0
    ? [{ id: 'preview-empty', type: 'text', text: '(vazio)', imageUrl: null, order: 0, layout: 'text' }]
    : filled.map((d, i) => draftToSubpost(d, i))
  const [idx, setIdx] = useState(0)
  const safeIdx = Math.max(0, Math.min(idx, subposts.length - 1))
  const total = subposts.length

  const mockPost: import('../../types/drift').Post = {
    id: 'preview-mock',
    // Fix 2026-05-21: 'preview' (não-hex) quebrava AuthorChip identicon
    // (parseInt('preview', 16) = NaN → hsl(NaN,...) CSS inválido).
    // Usa hex pattern reservado pra preview — determinístico + válido.
    // AuthorChip também ganhou guard defensivo (defesa em camada).
    authorPub: '0000000000000000000000000000000000000000000000000000000000000000',
    content: '',
    subposts,
    createdAt: Math.floor(Date.now() / 1000),
    category: null,
    location: null,
    client: 'drift-official',
    contentWarning,
    score: 0,
    spreads: 0,
    buries: 0,
    authorAlias: 'você',
  }

  return (
    <FullPageCard
      onClose={onClose}
      title="prévia"
      ariaLabel="prévia do post"
      headerRight={
        <DriftButton variant="ghost" size="md" onClick={onClose} aria-label="voltar à edição">
          voltar
        </DriftButton>
      }
    >
      {/* B8 fix 2026-05-22 (Robin): PreviewOverlay renderizava tela
          preta após fix 64e1d59 — culpa de height collapse. FullPageCard
          envolve children num `<div min-h-0 flex-1 overflow-y-auto>`
          (block, sem flex flex-col). Nossa wrapper interno usava
          `flex-1` que sem flex-parent vira altura 0; SubpostLayout's
          TextLayout depende de `h-full` herdada → renderiza 0px ⇒
          card preto. Trocar pra `h-full` resolve: usa 100% da altura
          do body (que tem altura concreta via flex-1 do FullPageCard
          flex-col root). Min-height fallback 320px protege contra
          edge-case onde body collapsa em viewports muito curtos. */}
      <div className="flex h-full min-h-[320px] flex-col px-4 py-4">
        <div className="relative flex-1 overflow-hidden rounded-2xl border border-drift-border/40 bg-drift-surface">
          <SubpostLayout subpost={subposts[safeIdx]!} post={mockPost} subpostIdx={safeIdx} subpostsTotal={total} />
        </div>

        {total > 1 && (
          <div className="mt-3 flex shrink-0 items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-3 py-1.5 font-mono text-[12px] text-drift-muted/70 transition-colors hover:text-drift-text disabled:opacity-25"
              aria-label="subpost anterior"
            >
              ←
            </button>
            <span className="font-mono text-[11px] uppercase tracking-meta text-drift-muted/50">
              {safeIdx + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              disabled={safeIdx === total - 1}
              className="rounded-lg border border-drift-border/30 bg-drift-surface/30 px-3 py-1.5 font-mono text-[12px] text-drift-muted/70 transition-colors hover:text-drift-text disabled:opacity-25"
              aria-label="próximo subpost"
            >
              →
            </button>
          </div>
        )}
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
      className={`relative flex h-[125px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed transition-colors ${
        draft.imageUrl
          ? 'border-drift-border/40'
          : 'border-drift-border/40 bg-drift-bg/30 hover:border-drift-accent2/40'
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
            className="absolute right-2 top-2 z-[2] rounded-lg border border-drift-danger/30 bg-drift-bg/75 px-2.5 py-1 font-mono text-[11px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/15"
          >
            remover
          </button>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="text-[20px] opacity-50">
            ◐
          </span>
          <span className="font-mono text-[11px] uppercase tracking-meta text-drift-muted/60">
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
    <div className="shrink-0 border-t border-drift-border/40 pt-3">
      <div
        className="mb-2 font-mono text-[11px] uppercase tracking-meta text-drift-muted/50"
        title="manifesto §27 — autor declara, leitor filtra"
      >
        marcar conteúdo (opcional)
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CONTENT_WARNING_VALUES.map((cw) => {
          const active = value === cw
          return (
            <button
              key={cw}
              type="button"
              onClick={() => onChange(active ? null : cw)}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                active
                  ? 'border-drift-warning/50 bg-drift-warning/10 text-drift-warning'
                  : 'border-drift-border/30 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/30 hover:text-drift-text'
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
