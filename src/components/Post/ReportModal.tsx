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
import { FullPageCard } from '../UI/FullPageCard'
import { DriftButton } from '../UI/DriftButton'
import { SectionHeader } from '../UI/SectionHeader'

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
  tone: 'danger' | 'warning' | 'muted'
}

const REASONS: ReasonOption[] = [
  {
    value: 'illegal',
    label: 'ilegal',
    description: 'CSAM, violência real, ameaça concreta',
    tone: 'danger',
  },
  {
    value: 'harassment',
    label: 'assédio',
    description: 'bullying direcionado, doxxing, perseguição',
    tone: 'warning',
  },
  {
    value: 'spam',
    label: 'spam',
    description: 'propaganda repetitiva, scams, links maliciosos',
    tone: 'muted',
  },
]

function toneClasses(tone: ReasonOption['tone'], active: boolean) {
  const base = active
    ? {
        danger: 'border-drift-danger/50 bg-drift-danger/10 text-drift-danger',
        warning: 'border-drift-warning/50 bg-drift-warning/10 text-drift-warning',
        muted: 'border-drift-accent2/40 bg-drift-accent2/10 text-drift-accent2',
      }
    : {
        danger:
          'border-drift-border/30 bg-drift-surface/30 text-drift-text hover:border-drift-danger/30',
        warning:
          'border-drift-border/30 bg-drift-surface/30 text-drift-text hover:border-drift-warning/30',
        muted:
          'border-drift-border/30 bg-drift-surface/30 text-drift-text hover:border-drift-accent2/30',
      }
  return base[tone]
}

export function ReportModal({ post, pending, onSubmit, onClose }: ReportModalProps) {
  const [selected, setSelected] = useState<ReportReason | null>(null)
  const [confirmStep, setConfirmStep] = useState(false)

  async function handleSubmit() {
    if (!selected || pending) return
    await onSubmit(selected)
  }

  return (
    <FullPageCard onClose={onClose} title="denunciar" ariaLabel="denunciar post">
      <div className="space-y-3 px-4 py-5">
        {!confirmStep && (
          <>
            <SectionHeader title="motivo" />
            <p className="px-1 font-mono text-[10px] text-drift-muted/60">
              reports são públicos e assinados. ao atingir threshold, post some do feed default.
            </p>

            <div className="space-y-2 pl-3">
              <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[11px]">
                <div className="mb-1 text-[10px] uppercase tracking-meta text-drift-muted/40">
                  post denunciado
                </div>
                <div className="line-clamp-3 text-drift-text/80">
                  {post.subposts[0]?.text ?? '(imagem)'}
                </div>
              </div>

              {REASONS.map((opt) => {
                const active = selected === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSelected(opt.value)}
                    className={`w-full rounded-xl border px-4 py-3.5 text-left transition-colors ${toneClasses(opt.tone, active)}`}
                  >
                    <div className="font-mono text-[13px]">
                      {active ? '✓ ' : ''}
                      {opt.label}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] opacity-60">
                      {opt.description}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex justify-end gap-2 pl-3">
              <DriftButton variant="ghost" size="md" onClick={onClose}>
                cancelar
              </DriftButton>
              <DriftButton
                variant="primary"
                size="md"
                onClick={() => selected && setConfirmStep(true)}
                disabled={!selected}
              >
                continuar →
              </DriftButton>
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
      </div>
    </FullPageCard>
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
    <>
      <SectionHeader title="confirmar" />
      <div className="space-y-2 pl-3">
        <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px]">
          <span className="text-drift-muted/50">motivo: </span>
          <span className="text-drift-accent">{reason}</span>
        </div>

        {/* D4 — warning pré-submit. Reporter pubkey vai PÚBLICO em
            ambos kind 9081 (Drift) + kind 1984 (NIP-56) com assinatura
            Schnorr. Target sabe quem reportou; stalker pode mapear
            padrões (Barney threat 2026-05-17 Tier 1 risk).
            Mitigation: multi-id (§15) permite descartável. */}
        <div
          role="note"
          aria-label="aviso de privacidade do reporter"
          className="rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[10px] leading-relaxed text-drift-warning"
        >
          <div className="mb-1 font-bold uppercase tracking-meta text-drift-warning">
            ⚠ privacy
          </div>
          <p>
            seu npub vai PÚBLICO em ambos os reports (kind 9081 + kind 1984
            NIP-56 pra interop). o autor reportado verá quem o reportou.
            stalker pode mapear padrões.
          </p>
          <p className="mt-1.5">
            considere trocar pra uma identidade descartável (§15 multi-id)
            antes de denunciar conteúdo sensível.
          </p>
        </div>
        <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/40">
          report é evento nostr imutável. não pode ser desfeito (§6).
        </p>

        {reason === 'illegal' && <AuthoritiesBlock />}

        <div className="mt-4 flex justify-end gap-2">
          <DriftButton variant="ghost" size="md" onClick={onBack} disabled={pending}>
            ← voltar
          </DriftButton>
          <button
            onClick={onSubmit}
            disabled={pending}
            className="rounded-xl border border-drift-danger/30 bg-drift-danger/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/15 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-danger/40"
          >
            {pending ? 'enviando…' : 'denunciar'}
          </button>
        </div>
      </div>
    </>
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
    <div className="mt-3 rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3">
      <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-meta text-drift-warning">
        denuncie também a autoridades
      </div>
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-drift-warning/50">
        drift não substitui denúncia formal. canais oficiais têm capacidade de investigação que nenhuma rede descentralizada tem.
      </p>
      <div className="space-y-1.5">
        {AUTHORITIES.map((a) => (
          <a
            key={a.url}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-drift-warning/20 bg-drift-warning/5 px-3 py-2 font-mono text-[11px] text-drift-warning transition-colors hover:bg-drift-warning/10"
          >
            <span className="truncate">{a.name}</span>
            <span className="ml-2 shrink-0 text-drift-warning/50">{a.region} ↗</span>
          </a>
        ))}
      </div>
    </div>
  )
}
