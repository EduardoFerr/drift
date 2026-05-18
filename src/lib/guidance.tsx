/**
 * Guidance — regras declarativas pra onboarding + hints contextuais.
 *
 * Source: RFC DAOP-001 Phase 1 PR1 (Ted HIMYM analysis 2026-05-17).
 *
 * Filosofia: onboarding NÃO é tutorial linear hardcoded em JSX. É uma
 * coleção de regras declarativas em dados — cada regra descreve uma
 * unidade pedagógica (título + body + futuros triggers/capabilities).
 *
 * **PR1 (este)** — refactor puro, paridade visual: extrai as 5 telas
 * de `OnboardingOverlay.tsx` pra `ONBOARDING_RULES` aqui. Componente
 * vira consumer puro.
 *
 * **PR2 (futuro)** — capability detection (`hasFirstPost`, `hasBackup`,
 * etc.) em `lib/capabilities.ts`. Regras ganham triggers `appliesIf:
 * (caps) => boolean`. Hints contextuais surgem do mesmo schema.
 *
 * **PR3 (futuro)** — HintChip / HintToast / HintModal primitives que
 * consomem regras + capabilities pra mostrar hints ambient (não
 * interrompendo flow).
 *
 * Manifesto §17 (sem chave mestra): regras vivem NO REPO, versionadas
 * em código. Não há "engine remoto" servindo guidance — auditável,
 * imutável post-deploy (até próximo PR).
 *
 * Manifesto §28 (privacy mínima): zero behavioral signal exportado.
 * Capability state futuro será 100% local (SQLite + Zustand).
 */

import type { ReactNode } from 'react'
import { DriftButton } from '../components/UI/DriftButton'

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
  },
  {
    id: 'location',
    title: '📍 location é opcional',
    body: () => (
      <>
        <p>
          Se ativar em <code>Ajustes → localização</code>, seus drifts aparecem no
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
 * Lookup helper — usado por tests + futuros PRs (PR2 capability checks).
 * Returns rule por id ou undefined.
 */
export function getOnboardingRule(id: string): GuidanceRule | undefined {
  return ONBOARDING_RULES.find((r) => r.id === id)
}
