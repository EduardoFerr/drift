/**
 * SettingExplainer — primitive de "setting explicada".
 *
 * Source: audit `Docs/sessions/settings-friction-audit-2026-05-18.md`.
 * User feedback 2026-05-18: "usuário comum não sabe do que se trata,
 * do impacto que a configuração tem, ou outras mais avançadas não dá
 * para ele saber como configurar".
 *
 * Resolve os 6 padrões transversais detectados:
 * 1. Hint invisível (text-drift-muted/30) — usa text-drift-body com
 *    weight legível
 * 2. Jargão protocol-level — `description` é plain pt-BR; termos
 *    técnicos só em `reference` opcional
 * 3. Tooltips só desktop — hints SEMPRE visíveis (não em `title=`)
 * 4. Hints descrevem setting mas não impacto — campo `impact` obrigatório
 *    pra controles non-trivial
 * 5. Defaults sem justificativa — campo `defaultExplained` opcional
 * 6. Reversibilidade não comunicada — campo `reversible` controla badge
 *    visível (default true)
 *
 * Gold standard de referência: SuaLenteCard (Trust Lens). Esse primitive
 * generaliza o pattern dele pra qualquer setting.
 *
 * Uso típico:
 *
 *   <SettingExplainer
 *     label="modo de rede"
 *     description="Como o app se conecta aos servidores Nostr."
 *     impact="Tor contorna bloqueios regionais, mas exige o app desktop. No navegador, escolher Tor não muda nada — seu IP continua exposto."
 *     defaultExplained="Default clearnet — funciona em qualquer device."
 *     reversible
 *   >
 *     <SegmentedControl ... />
 *   </SettingExplainer>
 *
 * Hierarquia visual:
 *   ┌─ LABEL ────────────────────── [advanced?] ┐
 *   │ Description (plain language).             │
 *   │                                            │
 *   │ [Interactive control children]            │
 *   │                                            │
 *   │ • Impacto: ...                            │
 *   │ • Default: ...                            │
 *   │ ⚠ Aviso (warning, se destrutivo)          │
 *   │ ✓ Reversível (ou ✗ Irreversível)          │
 *   │ Referência: link opcional                 │
 *   └────────────────────────────────────────────┘
 *
 * Manifesto §28 (privacy mínima): primitive 100% local-only, zero
 * telemetry, zero export. Nada do conteúdo dos hints sai do device.
 */

import type { ReactNode } from 'react'
import { WarningIcon, CheckIcon, BanIcon, InfoIcon, ChevronDownIcon } from './Icons'
import { usePrefsStore } from '../../lib/prefs'
import { useAccordionMember } from './AccordionGroup'
import { Collapse } from './Collapse'

export type SettingLevel = 'basic' | 'advanced'

export interface SettingExplainerProps {
  /** Nome do setting em plain language (uppercase tag-style header). */
  label: string
  /**
   * O que esse setting controla — 1-2 frases plain pt-BR, sem jargão.
   * Obrigatório.
   */
  description: string
  /**
   * O que MUDA visivelmente no app quando o user altera esse setting.
   * Concreto, observável. Ex.: "Posts marcados como spoiler aparecem
   * borrados até você tocar pra revelar." Recomendado pra qualquer
   * controle non-trivial; opcional pra toggles auto-evidentes.
   */
  impact?: string
  /**
   * Por que o default é o que é. Ex.: "Default off — cidade pequena +
   * opinião política = identificável (manifesto §28)."
   */
  defaultExplained?: string
  /**
   * Pode ser desfeito? Default true. Quando false, render badge
   * "irreversível" em drift-bury.
   */
  reversible?: boolean
  /**
   * UI gate (Phase 2): 'basic' sempre visível; 'advanced' marca o
   * setting como power-user. Hoje só marker visual (chip top-right);
   * Phase 2 adiciona toggle de filtro em SettingsRoot.
   */
  level?: SettingLevel
  /**
   * Aviso destacado pra ações destrutivas (limpar local, mudar identidade
   * etc.). Renderiza em drift-bury com WarningIcon antes do controle.
   */
  warning?: string
  /**
   * Referência opcional pra docs/manifesto (power user wanting depth).
   * Renderizada como mini-link no rodapé. Ex.: "manifesto §17" ou
   * "Docs/architecture.md#relays".
   */
  reference?: string
  /** Controle interativo (toggle, segmented control, input, slider). */
  children: ReactNode
  /** className adicional pro wrapper externo. */
  className?: string
  /**
   * Quando dentro de `<AccordionGroup>`, ID único pra registro no
   * contexto. String slug semântico (não index). Stable across re-
   * renders, tolera reordenação e filhos `level='advanced'` que somem.
   * Quando ausente, fallback ao `slugify(label)`.
   *
   * Quando NÃO há AccordionGroup parent (standalone usage), prop
   * ignorada — render expanded sempre (back-compat).
   */
  accordionId?: string
}

export function SettingExplainer({
  label,
  description,
  impact,
  defaultExplained,
  reversible = true,
  level = 'basic',
  warning,
  reference,
  children,
  className = '',
  accordionId,
}: SettingExplainerProps) {
  // Phase 3 (2026-05-18): level='advanced' gate. Novice user (default
  // show_advanced_settings=false) só vê basic settings. Power user
  // liga toggle no topo de SettingsRoot pra revelar tudo.
  const showAdvanced = usePrefsStore((s) => s.show_advanced_settings)
  // Phase 4 (Ted 2026-05-18): AccordionGroup integration. ID = explícito
  // accordionId ou fallback slugify(label). Auto-registra no contexto;
  // se NÃO há AccordionGroup parent (ctx null), render standalone
  // sempre-expanded (back-compat com 30+ usos atuais).
  const id = accordionId ?? slugify(label)
  const member = useAccordionMember(id)
  if (level === 'advanced' && !showAdvanced) return null

  const headerId = `setting-${id}-header`
  const panelId = `setting-${id}-panel`
  const bodyContent = (
    <ExplainerBody
      description={description}
      impact={impact}
      defaultExplained={defaultExplained}
      reversible={reversible}
      warning={warning}
      reference={reference}
    >
      {children}
    </ExplainerBody>
  )

  // Standalone: card simples sempre-expanded (back-compat).
  if (!member.inGroup) {
    return (
      <section
        className={`rounded-2xl border border-drift-border bg-drift-surface/40 px-4 py-4 ${className}`}
        aria-labelledby={headerId}
      >
        <header className="mb-2 flex items-center justify-between gap-2">
          <h3
            id={headerId}
            className="font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent"
          >
            {label}
          </h3>
          {level === 'advanced' && <AdvancedBadge />}
        </header>
        {bodyContent}
      </section>
    )
  }

  // Accordion mode: header clickável, body em Collapse.
  // WAI-ARIA Accordion pattern: <h3><button aria-expanded aria-controls>
  const { isOpen, toggle } = member
  return (
    <section
      className={`rounded-2xl border border-drift-border bg-drift-surface/40 ${className}`}
      aria-labelledby={headerId}
    >
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-drift-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        >
          <span className="flex-1 font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent">
            {label}
          </span>
          {level === 'advanced' && <AdvancedBadge />}
          <span
            aria-hidden="true"
            className={`shrink-0 text-drift-muted/60 transition-transform duration-motion-emphasis ease-drift-inout ${
              isOpen ? 'rotate-180' : ''
            }`}
          >
            <ChevronDownIcon size={14} strokeWidth={2} />
          </span>
        </button>
      </h3>
      <Collapse open={isOpen}>
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-4 pb-4"
        >
          {bodyContent}
        </div>
      </Collapse>
    </section>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────

function AdvancedBadge() {
  return (
    <span
      className="shrink-0 rounded border border-drift-accent2/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-accent2"
      aria-label="setting avançada"
    >
      avançado
    </span>
  )
}

interface ExplainerBodyProps {
  description: string
  impact?: string
  defaultExplained?: string
  reversible: boolean
  warning?: string
  reference?: string
  children: ReactNode
}

function ExplainerBody({
  description,
  impact,
  defaultExplained,
  reversible,
  warning,
  reference,
  children,
}: ExplainerBodyProps) {
  return (
    <>
      {/* Description — plain language, always visible */}
      <p className="mb-3 font-mono text-[12px] leading-relaxed text-drift-body">
        {description}
      </p>

      {/* Warning destrutivo — antes do controle pra user ver ANTES de agir */}
      {warning && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-drift-bury/40 bg-drift-bury/8 px-3 py-2 text-drift-bury"
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            <WarningIcon size={14} strokeWidth={2} />
          </span>
          <p className="font-mono text-[11px] leading-relaxed">{warning}</p>
        </div>
      )}

      {/* Controle interativo */}
      <div className="mb-3">{children}</div>

      {/* Meta info — impact + default + reversibility */}
      <dl className="space-y-1.5 font-mono text-[11px] leading-relaxed text-drift-body/85">
        {impact && (
          <MetaRow icon={<InfoIcon size={12} strokeWidth={2} />} label="Impacto">
            {impact}
          </MetaRow>
        )}
        {defaultExplained && (
          <MetaRow icon={<InfoIcon size={12} strokeWidth={2} />} label="Default">
            {defaultExplained}
          </MetaRow>
        )}
        <MetaRow
          icon={
            reversible ? (
              <CheckIcon size={12} strokeWidth={2} />
            ) : (
              <BanIcon size={12} strokeWidth={2} />
            )
          }
          label={reversible ? 'Reversível' : 'Irreversível'}
        >
          {reversible
            ? 'Pode desfazer mudando de volta a qualquer momento.'
            : 'Esta ação NÃO pode ser desfeita.'}
        </MetaRow>
      </dl>

      {/* Reference link opcional */}
      {reference && (
        <p className="mt-3 border-t border-drift-border/40 pt-2 font-mono text-[10px] text-drift-muted">
          Referência: <span className="text-drift-accent2">{reference}</span>
        </p>
      )}
    </>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-drift-muted"
      >
        {icon}
      </span>
      <div className="flex-1">
        <dt className="inline font-medium text-drift-text">{label}: </dt>
        <dd className="inline text-drift-body/85">{children}</dd>
      </div>
    </div>
  )
}
