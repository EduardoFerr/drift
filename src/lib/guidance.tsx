/**
 * Guidance — regras declarativas pra onboarding + hints contextuais.
 *
 * Source: RFC DAOP-001 Phase 1 PR1+PR2 (Ted HIMYM analysis 2026-05-17).
 *
 * Filosofia: onboarding NÃO é tutorial linear hardcoded em JSX. É uma
 * coleção de regras declarativas em dados — cada regra descreve uma
 * unidade pedagógica (título + body + capability triggers).
 *
 * **PR1 [c823e8f]** — refactor puro, paridade visual: extraídas 5 telas
 * de `OnboardingOverlay.tsx` pra `ONBOARDING_RULES`. Componente virou
 * consumer puro.
 *
 * **PR2 (este)** — capability detection (`lib/capabilities.ts`). Regras
 * ganham `appliesIf?: (caps) => boolean`. Hints contextuais surgem do
 * mesmo schema — uma regra pode ser onboarding step OU hint reativo
 * dependendo do trigger.
 *
 * **PR3** — HintChip primitive consome regras + capabilities pra mostrar
 * hints ambient (não interrompendo flow). HintToast/HintModal irmãos
 * foram removidos em 2026-05-23 (shelf-ware, 0 callers).
 *
 * Manifesto §17 (sem chave mestra): regras vivem NO REPO, versionadas
 * em código. Não há "engine remoto" servindo guidance — auditável,
 * imutável post-deploy.
 *
 * Manifesto §28 (privacy mínima): zero behavioral signal exportado.
 * Capability state é 100% local (SQLite + Zustand).
 */

import type { ReactNode } from 'react'
import { DriftButton } from '../components/UI/DriftButton'
import type { Capabilities } from './capabilities'

/**
 * Context injetado pelo caller (OnboardingOverlay, futuros consumers
 * de hints). Adicionar callbacks aqui conforme novas regras precisarem.
 *
 * Mantida MINIMAL — cada callback que entra aqui acopla regra ao
 * componente. Preferir capability checks (read-only) quando possível.
 */
export interface GuidanceRuleContext {
  /** Abre IdentityPanel (Backup tab). Usado por rule 'identity'. */
  onOpenIdentity: () => void
}

/**
 * Uma regra de guidance. PR1: usado pra steps de onboarding. PR2+:
 * usado também pra hints contextuais (passa por capability gates).
 */
export interface GuidanceRule {
  /** ID estável — referenciado em tests, capability checks, analytics
   * locais. NÃO mudar IDs após shipped (quebra continuity). */
  id: string
  /** Título uppercase exibido em destaque. */
  title: string
  /**
   * Body factory — recebe context com callbacks/state e retorna JSX.
   * Function (não JSX direto) permite injeção uniforme de handlers.
   * Casos sem context usam `() => <>...</>`.
   */
  body: (ctx: GuidanceRuleContext) => ReactNode
  /**
   * Capability trigger (PR2). Quando definido, regra só "aplica" se
   * retornar true pra capabilities atuais. Default (undefined) = sempre
   * aplica.
   *
   * Exemplos:
   *  - `(caps) => !caps.hasFirstPost` — hint só pra quem não postou
   *  - `(caps) => caps.hasFollow && !caps.hasFirstSpread` — hint pra
   *    quem segue alguém mas nunca drift-ou
   *
   * Para regras de onboarding (PR1), `appliesIf` é tipicamente
   * `(caps) => !caps.dismissedRuleIds.has(this.id)` — só mostra se
   * user não dispensou. Caller pode adicionar lógica mais sofisticada.
   *
   * Função pura (sem side effects) — testável + safe pra chamar várias
   * vezes em render.
   */
  appliesIf?: (caps: Capabilities) => boolean
}

/**
 * 5 regras canônicas do onboarding (ordem é a sequência de steps).
 *
 * IDs estáveis (conformance trava): 'welcome' → 'swipes' → 'identity'
 * → 'location' → 'manifest-rules'.
 *
 * Tom: sóbrio, informativo, fácil de pular. Manifesto §27 (autor
 * declara) + §28 (privacy default) + §17 (sem chave mestra) refletidos
 * no copy.
 */
export const ONBOARDING_RULES: readonly GuidanceRule[] = [
  {
    id: 'welcome',
    title: 'bem-vindo ao drift',
    body: () => (
      <>
        <p>
          Drift é uma rede social descentralizada onde o conteúdo deriva pelo{' '}
          <span className="text-drift-accent">comportamento humano</span> — não por algoritmo.
        </p>
        <p>
          Sem servidor central, sem feed personalizado, sem bolha. Posts imutáveis, identidade portável.
        </p>
        <p className="text-drift-muted">
          Sem censura — nem pelo fundador.
        </p>
      </>
    ),
  },
  {
    id: 'swipes',
    title: 'os 3 swipes',
    body: () => (
      <>
        <ul className="space-y-2">
          <li>
            <span className="text-drift-spread">↑</span> swipe pra cima ·{' '}
            <span className="text-drift-text">DRIFT (drifta o post)</span>
            <span className="ml-1 text-drift-muted">(empurra a deriva)</span>
          </li>
          <li>
            <span className="text-drift-bury">↓</span> swipe pra baixo ·{' '}
            <span className="text-drift-text">SINK (afunda o post)</span>
            <span className="ml-1 text-drift-muted">(reduz, não pune o autor)</span>
          </li>
          <li>
            <span className="text-drift-accent">← →</span> swipe horizontal ·{' '}
            <span className="text-drift-text">navega subposts</span>
          </li>
        </ul>
        <p className="text-drift-muted">
          Sem like, sem follow obrigatório. O score é determinístico — todos veem a mesma ordem.
        </p>
      </>
    ),
  },
  {
    id: 'identity',
    title: 'sua identidade é uma chave',
    body: ({ onOpenIdentity }) => (
      <>
        <p>
          Nada de email ou telefone. Sua identidade é uma chave criptográfica (
          <code className="text-drift-accent">nsec1…</code>) gerada localmente.
        </p>
        <p>
          <span className="text-drift-warning">⚠</span> Faz backup. Se perder o nsec, perdeu a identidade. Se trocar de
          celular, é só importar o nsec — todo o histórico volta dos relays.
        </p>
        <DriftButton
          variant="ghost"
          size="md"
          onClick={onOpenIdentity}
          className="mt-1"
        >
          abrir backup agora →
        </DriftButton>
      </>
    ),
    // PR2: regra só aplica se user AINDA não fez backup do nsec.
    // hasBackup é derivado de `last_nsec_export_at` (Satoshi guard
    // [b76245b]). User que já clicou reveal/copy/download pula essa
    // tela — onboarding adapta ao estado real, não roteiro fixo.
    appliesIf: (caps) => !caps.hasBackup,
  },
  {
    id: 'location',
    title: '📍 location é opcional',
    body: () => (
      <>
        <p>
          Se ativar em <code>Configurações → localização</code>, seus drifts aparecem no
          mapa de outros posts. Padrão é <span className="text-drift-text">desligado</span>{' '}
          por privacidade (manifesto §28).
        </p>
        <p className="text-drift-muted">
          Pode ativar depois — granularidade é sua (país, cidade ou GPS).
        </p>
      </>
    ),
  },
  {
    id: 'manifest-rules',
    title: 'algumas regras duras',
    body: () => (
      <>
        <ul className="space-y-2">
          <li>
            <span className="text-drift-spread">✓</span> Posts são <span className="text-drift-text">imutáveis</span>.
            Nem o fundador apaga.
          </li>
          <li>
            <span className="text-drift-spread">✓</span> Cliente oficial NÃO escaneia conteúdo automaticamente.
          </li>
          <li>
            <span className="text-drift-spread">✓</span> Auto-classificação (NSFW, spoiler) é{' '}
            <span className="text-drift-text">do autor</span>; filtros são{' '}
            <span className="text-drift-text">do leitor</span>.
          </li>
          <li>
            <span className="text-drift-spread">✓</span> Conteúdo problemático é moderado pela comunidade via reports
            + threshold dinâmico.
          </li>
        </ul>
        <p className="text-drift-muted">
          Detalhes completos em <code>Docs/manifesto.md</code>.
        </p>
      </>
    ),
  },
] as const

/**
 * Hints contextuais (Phase 2 PR3 — 2026-05-20).
 *
 * Diferença vs ONBOARDING_RULES: hints NÃO viram steps da overlay
 * inicial. Renderizam ambient via HintChip em pontos estratégicos da
 * UI onde a capability gap é relevante (post-action, not pre-action).
 *
 * Filosofia (Ted/Lily): nag <-> contextual. Onboarding cobre quem nunca
 * usou. Hints cobrem quem usou parcialmente — adquiriu uma capability
 * (ex.: primeiro post) sem adquirir a complementar (backup).
 *
 * Conservative roll-out: começa com 1 hint. Mais hints só após
 * telemetria local (capabilities_dismissed count) sugerir que user não
 * está achando-os intrusivos.
 *
 * Cada hint TEM dismiss explícito (HintChip × button) que persiste em
 * `capabilities_dismissed` bag — uma vez dispensado, nunca volta.
 */
export const HINT_RULES: readonly GuidanceRule[] = [
  {
    id: 'backup-after-post',
    title: 'faça backup do nsec',
    body: ({ onOpenIdentity }) => (
      <>
        <p>
          Você já publicou. Se perder este dispositivo sem backup do{' '}
          <code className="text-drift-accent">nsec1…</code>, perde a
          identidade — e ninguém (nem o fundador) consegue recuperar.
        </p>
        <p className="text-drift-muted">
          Backup leva ~30 segundos. Manifesto §3 (dispositivo é
          descartável; identidade não).
        </p>
        <DriftButton
          variant="ghost"
          size="md"
          onClick={onOpenIdentity}
          className="mt-1"
        >
          fazer backup agora →
        </DriftButton>
      </>
    ),
    // Trigger forte: user já tem skin in the game (1+ post) mas nenhum
    // export de nsec registrado. Antes do primeiro post, onboarding step
    // 'identity' já cobre — duplicar nag seria intrusivo. hasBackup é
    // proxy razoável (reveal/copy/download log; Satoshi guard [b76245b]).
    appliesIf: (caps) => caps.hasFirstPost && !caps.hasBackup,
  },
] as const

/**
 * Lookup helper — usado por tests + capability checks.
 * Returns rule por id ou undefined.
 */
export function getOnboardingRule(id: string): GuidanceRule | undefined {
  return ONBOARDING_RULES.find((r) => r.id === id)
}

/**
 * Lookup helper para hints contextuais (PR3). Returns rule ou undefined.
 */
export function getHintRule(id: string): GuidanceRule | undefined {
  return HINT_RULES.find((r) => r.id === id)
}

/**
 * Filtra regras aplicáveis dado snapshot de capabilities (PR2).
 *
 * Regras sem `appliesIf` SEMPRE aplicam (default seguro pra onboarding).
 * Regras com `appliesIf` aplicam se função retorna true.
 *
 * Pure — não muta input, não toca DOM. Caller usa em render path
 * (memoize se profile mostrar gargalo; hoje N=5 rules dispensa cache).
 *
 * @param rules Lista de regras (use ONBOARDING_RULES ou subset)
 * @param caps Snapshot atual (null = retorna lista inteira — defaults
 *   aplicam, preservando paridade com PR1 quando capabilities ainda
 *   loading)
 */
export function filterApplicableRules(
  rules: readonly GuidanceRule[],
  caps: Capabilities | null,
): readonly GuidanceRule[] {
  if (caps === null) return rules
  return rules.filter((r) => !r.appliesIf || r.appliesIf(caps))
}
