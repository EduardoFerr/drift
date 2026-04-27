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
import { motion } from 'framer-motion'
import type { ReportReason, Post } from '../../types/drift'

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-drift-bg/95 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        className="w-full max-w-md rounded border border-drift-border bg-drift-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.2em] text-drift-accent">
            denunciar post
          </h2>
          <button
            onClick={onClose}
            className="rounded border border-drift-border px-2 py-1 text-[10px] hover:border-drift-accent hover:text-drift-accent"
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
          Reports são eventos públicos assinados (manifesto §26).
          Quando o threshold dinâmico é atingido, o post some do feed
          default — mas continua na rede. Cliente alternativo pode
          exibir mesmo assim.
        </p>

        {!confirmStep && (
          <>
            <div className="mb-4 rounded border border-drift-border bg-drift-bg/50 p-3 text-[10px] text-slate-400">
              <div className="mb-1 text-slate-600">post sendo denunciado:</div>
              <div className="line-clamp-3 text-slate-300">
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
                  <div className="mt-0.5 text-[10px] leading-relaxed opacity-80">
                    {opt.description}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-drift-border px-3 py-1 text-[11px] text-slate-500 hover:border-slate-500"
              >
                cancelar
              </button>
              <button
                onClick={() => selected && setConfirmStep(true)}
                disabled={!selected}
                className="rounded border border-drift-accent px-3 py-1 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
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
      </motion.div>
    </motion.div>
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
      <div className="mb-3 text-[11px] text-slate-300">
        confirmar denúncia: <span className="text-drift-accent">{reason}</span>
      </div>

      <p className="mb-4 text-[10px] leading-relaxed text-slate-500">
        O report vai ser publicado como evento Nostr assinado pela sua
        identidade. Não pode ser desfeito — eventos Drift são imutáveis
        (manifesto §6).
      </p>

      {reason === 'illegal' && <AuthoritiesBlock />}

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onBack}
          disabled={pending}
          className="rounded border border-drift-border px-3 py-1 text-[11px] text-slate-500 hover:border-slate-500 disabled:opacity-50"
        >
          ← voltar
        </button>
        <button
          onClick={onSubmit}
          disabled={pending}
          className="rounded border border-red-700 bg-red-950/30 px-3 py-1 text-[11px] uppercase tracking-widest text-red-300 hover:bg-red-950/50 disabled:opacity-50"
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
    <div className="mb-2 rounded border border-yellow-700/60 bg-yellow-950/20 p-3">
      <div className="mb-2 text-[11px] font-semibold text-yellow-300">
        ⚠ conteúdo ilegal — denuncie também a autoridades
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-yellow-200/80">
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
            className="flex items-center justify-between rounded border border-yellow-700/40 bg-yellow-950/10 px-2 py-1 text-[10px] text-yellow-200 hover:border-yellow-700 hover:bg-yellow-950/30"
          >
            <span className="truncate">{a.name}</span>
            <span className="ml-2 shrink-0 text-yellow-500/70">{a.region} ↗</span>
          </a>
        ))}
      </div>
    </div>
  )
}
