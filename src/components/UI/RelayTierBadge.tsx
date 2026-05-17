/**
 * RelayTierBadge — chip semântico mostrando o TIER de moderação de um
 * relay (D3 do plano relay moderation, deliberação HIMYM 2026-05-17).
 *
 * Manifesto §17 adendo: operador de relay é autoridade independente.
 * Cliente Drift deve expor o tier visualmente pra user escolher
 * conscientemente — transparência > opacidade (Barney threat model).
 *
 * 6 tiers (espelha `RelayPolicy` em `config/relays-directory.ts`):
 *   - `manual-spam-only`   ⚪ neutro     — rate-limit técnico, sem AI
 *   - `unmoderated`        🟢 spread     — sem rejeição de conteúdo
 *   - `ai-assisted-opt-in` 🔵 accent2    — labels NIP-56 via bot opt-in
 *   - `ai-automated`       🟡 warning    — reject server-side por classifier (RED FLAG → audit obrigatório)
 *   - `manual-human`       🔵 accent     — mod humano (raro, geralmente community)
 *   - `private`            ⚫ neutro     — membership/whitelist
 *   - `unknown`            ⚫ neutro     — NIP-11 sem `drift_policy`, política não declarada
 *
 * Visual: rounded-lg, font-mono uppercase tracking-meta, ~24px tall.
 * Sempre com aria-label expandido pra screen reader entender contexto.
 */

import type { RelayPolicy } from '../../config/relays-directory'

export type RelayTier = RelayPolicy | 'unknown'

interface RelayTierBadgeProps {
  tier: RelayTier
  /** Tamanho compacto pra listas densas; default = sm. */
  size?: 'xs' | 'sm'
}

interface TierConfig {
  label: string
  tone: 'neutral' | 'spread' | 'accent2' | 'warning' | 'accent' | 'dim'
  ariaSuffix: string
}

const TIER_CONFIG: Record<RelayTier, TierConfig> = {
  'manual-spam-only': {
    label: 'sem AI',
    tone: 'neutral',
    ariaSuffix: 'rate-limit técnico, sem AI scan',
  },
  unmoderated: {
    label: 'livre',
    tone: 'spread',
    ariaSuffix: 'sem moderação de conteúdo declarada',
  },
  'ai-assisted-opt-in': {
    label: 'AI opt-in',
    tone: 'accent2',
    ariaSuffix: 'labels NIP-56 via bot opt-in — você escolhe seguir',
  },
  'ai-automated': {
    label: 'AI auto',
    tone: 'warning',
    ariaSuffix: 'reject server-side por classifier — exige audit público do modelo',
  },
  'manual-human': {
    label: 'mod humano',
    tone: 'accent',
    ariaSuffix: 'moderador humano revisa eventos',
  },
  private: {
    label: 'privado',
    tone: 'dim',
    ariaSuffix: 'membership ou whitelist obrigatório',
  },
  unknown: {
    label: 'política?',
    tone: 'dim',
    ariaSuffix: 'política não declarada via NIP-11; user assume risco',
  },
}

const TONE_CLASSES: Record<TierConfig['tone'], string> = {
  neutral: 'border-drift-border/40 bg-drift-surface/30 text-drift-muted/80',
  spread: 'border-drift-spread/30 bg-drift-spread/10 text-drift-spread',
  accent2: 'border-drift-accent2/40 bg-drift-accent2/10 text-drift-accent2',
  warning: 'border-drift-warning/40 bg-drift-warning/10 text-drift-warning',
  accent: 'border-drift-accent/40 bg-drift-accent/10 text-drift-accent',
  dim: 'border-drift-border/30 bg-drift-surface/20 text-drift-muted/50',
}

export function RelayTierBadge({ tier, size = 'sm' }: RelayTierBadgeProps) {
  const cfg = TIER_CONFIG[tier]
  const sizeCls =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[9px]'
      : 'px-2 py-0.5 text-[10px]'
  return (
    <span
      className={`inline-flex items-center rounded-md border font-mono uppercase tracking-meta ${TONE_CLASSES[cfg.tone]} ${sizeCls}`}
      aria-label={`política do relay: ${cfg.label} — ${cfg.ariaSuffix}`}
      title={cfg.ariaSuffix}
    >
      {cfg.label}
    </span>
  )
}

/**
 * Helper: deriva `RelayTier` a partir de uma combinação opcional de:
 *  - `policy` declarada no curated directory (autoritativo se vier de
 *    `RELAY_DIRECTORY` em `config/relays-directory.ts`)
 *  - `drift_policy` em NIP-11 (operator self-declared)
 *
 * Quando NENHUM dos dois está presente, retorna `'unknown'` — Barney
 * red flag (Settings UI deve dar aviso adicional).
 */
export function deriveRelayTier(input: {
  curatedPolicy?: RelayPolicy
  driftPolicy?: { classifiers?: string[]; rejects?: string[] }
}): RelayTier {
  if (input.curatedPolicy) return input.curatedPolicy
  if (input.driftPolicy?.classifiers?.length) {
    return input.driftPolicy.rejects?.length ? 'ai-automated' : 'ai-assisted-opt-in'
  }
  return 'unknown'
}
