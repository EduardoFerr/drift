/**
 * ReportModal — modal de denúncia comunitária (manifesto §26).
 *
 * Cliente NÃO escaneia conteúdo automaticamente (manifesto §25). A
 * moderação é reativa: usuários reportam → threshold dinâmico decide
 * quando esconder do feed default. Três categorias:
 *
 *   illegal      — conteúdo crime (CSAM, violência real, ameaça)
 *                  threshold mais agressivo, comunidade defende
 *                  rapidamente
 *   spam         — conteúdo automatizado, propaganda repetitiva
 *   harassment   — assédio direcionado, doxxing, bullying
 *
 * Pra `illegal`, oferecemos botões pra denunciar a autoridades
 * competentes — manifesto Nota Legal: cliente oficial encoraja, não
 * substitui. NCMEC (EUA), SaferNet (Brasil), IWF (UK), e link
 * genérico INHOPE pros demais países.
 */

import { useState } from 'react'
import type { ReportReason, Post } from '../../types/drift'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'

export interface ReportModalProps {
  post: Post
  pending: boolean
  onSubmit: (reason: ReportReason) => Promise<void> | void
  onClose: () => void
}

interface ReasonOption {
  value: ReportReason
  label: string
  description: string
  color: string
}

const REASONS: ReasonOption[] = [
  {
    value: 'illegal',
    label: 'ilegal',
    description:
      'CSAM, violência real, ameaça concreta, ou outro conteúdo crime na sua jurisdição',
    color: 'border-red-700/60 hover:bg-red-950/30 text-red-300',
  },
  {
    value: 'harassment',
    label: 'assédio',
    description:
      'Bullying direcionado, doxxing, perseguição. Não é desacordo de opinião — é hostilidade pessoal sustentada.',
    color: 'border-orange-700/60 hover:bg-orange-950/30 text-orange-300',
  },
  {
    value: 'spam',
    label: 'spam',
    description:
      'Conteúdo automatizado, propaganda repetitiva, scams, links maliciosos.',
    color: 'border-yellow-700/60 hover:bg-yellow-950/30 text-yellow-300',
  },
]

export function ReportModal({ post, pending, onSubmit, onClose }: ReportModalProps) {
  const [selected, setSelected] = useState<ReportReason | null>(null)
  const [confirmStep, setConfirmStep] = useState(false)

  async function handleSubmit() {
    if (!selected || pending) return
    await onSubmit(selected)
  }

  return (
    <SlideUpOverlay onClose={onClose} ariaLabel="denunciar post">
      <ModalHeader title="denunciar post" onClose={onClose} tone="danger" />

      <p className="mb-4 text-[12px] leading-relaxed text-drift-muted">
        Reports são eventos públicos assinados (manifesto §26).
        Quando o threshold dinâmico é atingido, o post some do feed
        default — mas continua na rede. Cliente alternativo pode
        exibir mesmo assim.
      </p>

      {!confirmStep && (
        <>
          <div className="mb-4 rounded border border-drift-border bg-drift-bg/50 p-3 text-[12px] text-drift-muted">
            <div className="mb-1 text-drift-muted">post sendo denunciado:</div>
            <div className="line-clamp-3 text-drift-text">
              {post.subposts[0]?.text ?? '(imagem)'}
            </div>
          </div>

          <div className="space-y-2">
            {REASONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={`w-full rounded border px-3 py-2 text-left transition-colors ${opt.color} ${
                  selected === opt.value ? 'bg-opacity-50 ring-1 ring-current' : 'bg-transparent'
                }`}
              >
                <div className="text-[12px] font-semibold">
                  {selected === opt.value ? '✓ ' : ''}
                  {opt.label}
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed opacity-80">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded border border-drift-border px-3 py-1 text-[12px] text-drift-muted hover:border-drift-text hover:text-drift-text"
            >
              cancelar
            </button>
            <button
              onClick={() => selected && setConfirmStep(true)}
              disabled={!selected}
              className="rounded border border-drift-accent px-3 py-1 text-[12px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              continuar →
            </button>
          </div>
        </>
      )}

      {confirmStep && selected && (
        <ConfirmStep
          reason={selected}
          pending={pending}
          onBack={() => setConfirmStep(false)}
          onSubmit={handleSubmit}
        />
      )}
    </SlideUpOverlay>
  )
}

function ConfirmStep({
  reason,
  pending,
  onBack,
  onSubmit,
}: {
  reason: ReportReason
  pending: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <div>
      <div className="mb-3 text-[12px] text-drift-text">
        confirmar denúncia: <span className="text-drift-accent">{reason}</span>
      </div>

      <p className="mb-4 text-[12px] leading-relaxed text-drift-muted">
        O report vai ser publicado como evento Nostr assinado pela sua
        identidade. Não pode ser desfeito — eventos Drift são imutáveis
        (manifesto §6).
      </p>

      {reason === 'illegal' && <AuthoritiesBlock />}

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onBack}
          disabled={pending}
          className="rounded border border-drift-border px-3 py-1 text-[12px] text-drift-muted hover:border-drift-border disabled:opacity-50"
        >
          ← voltar
        </button>
        <button
          onClick={onSubmit}
          disabled={pending}
          className="rounded border border-drift-danger/60 bg-drift-danger/15 px-3 py-1 text-[12px] uppercase tracking-widest text-drift-danger hover:bg-drift-danger/25 disabled:opacity-50"
        >
          {pending ? 'enviando…' : 'denunciar'}
        </button>
      </div>
    </div>
  )
}

interface Authority {
  name: string
  region: string
  url: string
}

const AUTHORITIES: Authority[] = [
  { name: 'NCMEC CyberTipline', region: 'EUA / global', url: 'https://report.cybertip.org/' },
  { name: 'SaferNet', region: 'Brasil', url: 'https://new.safernet.org.br/denuncie' },
  { name: 'IWF', region: 'Reino Unido / global', url: 'https://www.iwf.org.uk/report/' },
  { name: 'INHOPE (busca por país)', region: 'Internacional', url: 'https://www.inhope.org/EN/articles/find-a-hotline' },
]

function AuthoritiesBlock() {
  return (
    <div className="mb-2 rounded border border-drift-warning/60 bg-drift-warning/10 p-3">
      <div className="mb-2 text-[12px] font-semibold text-drift-warning">
        ⚠ conteúdo ilegal — denuncie também a autoridades
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-drift-warning/80">
        O Drift não substitui denúncia formal. Se viu conteúdo crime
        (especialmente CSAM), denuncie ao canal oficial do seu país —
        eles têm capacidade de investigação e ação que nenhuma rede
        descentralizada tem (manifesto Nota Legal).
      </p>
      <div className="space-y-1">
        {AUTHORITIES.map((a) => (
          <a
            key={a.url}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded border border-drift-warning/40 bg-drift-warning/5 px-2 py-1 text-[12px] text-drift-warning hover:border-drift-warning/60 hover:bg-drift-warning/15"
          >
            <span className="truncate">{a.name}</span>
            <span className="ml-2 shrink-0 text-drift-warning/70">{a.region} ↗</span>
          </a>
        ))}
      </div>
    </div>
  )
}
