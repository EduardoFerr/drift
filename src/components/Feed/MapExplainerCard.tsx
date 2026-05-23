/**
 * MapExplainerCard — overlay fullscreen explicando o que cada mapa
 * mostra, com legenda de cores/símbolos + disclaimer §28.
 *
 * V_2026-05-22 (user pedido): "se a gente pressionar por 3 segundos
 * o botão de ação para exibir o mapa, abre uma tela explicando para
 * que serve aquele mapa. Legenda do que significa cada coisa se
 * necessário."
 *
 * Wired via `useLongPress` em:
 *   - PostViewer botão 🗺 (embedded mini-map) → context='embedded'
 *   - NavBar botão MAPA (App.tsx) → context='overlay-default'
 *   - SpreadMap ModeToggle [post|global|network] → context= cada modo
 *
 * Manifesto §28 disclaimer sempre presente — usuário entende que
 * mapa SÓ aparece se autor publicou location.
 *
 * Beleza + WCAG: usa FullPageCard primitive (slide-up animation,
 * ESC dismissible, max-w-md, contraste AA já garantido pelo
 * design system).
 */

import { FullPageCard } from '../UI/FullPageCard'
import type { SpreadMapMode } from '../../hooks/useSpreadMap'

/**
 * Contexto de qual map abriu o explainer. Determina título + copy +
 * subset da legenda. 'embedded' = mini-map dentro do PostViewer
 * (sempre modo `post`). 'overlay-default' = MapOverlay sem modo
 * específico (entrada geral). Demais = modos do SpreadMap.
 */
export type MapExplainerContext = SpreadMapMode | 'embedded' | 'overlay-default'

export interface MapExplainerCardProps {
  context: MapExplainerContext
  onClose: () => void
}

interface ExplainerCopy {
  title: string
  purpose: string
  legend: LegendItem[]
}

interface LegendItem {
  /** Cor CSS (hex/rgb) pro swatch. Quando undefined, item é só texto/ícone. */
  swatch?: string
  /** Forma do swatch: 'dot' (círculo), 'line' (barra) ou 'badge' (texto). */
  shape?: 'dot' | 'line' | 'badge'
  /** Texto curto ao lado do swatch. */
  label: string
  /** Explicação curta abaixo do label (opcional). */
  hint?: string
}

/**
 * Copy por contexto. PT-BR, vocabulary DRIFT/SINK user-facing (não
 * SPREAD/BURY do protocolo — §CLAUDE.md vocabulary mapping).
 *
 * Pure function (sem state/effects) — testável.
 */
export function getMapExplainerCopy(context: MapExplainerContext): ExplainerCopy {
  if (context === 'embedded' || context === 'post') {
    return {
      title: 'mapa de propagação',
      purpose:
        'Este mapa mostra onde este post foi DRIFT-ado. Cada ponto é um lugar onde alguém viu o post e decidiu espalhar (gesto ↑). A origem é onde o autor publicou. 💡 tamanho do pin ≠ qualidade do post — só conta espalhamentos geográficos (manifesto §22).',
      legend: [
        {
          swatch: 'rgb(232, 255, 90)',
          shape: 'dot',
          label: 'origem',
          hint: 'local declarado pelo autor ao publicar (opcional)',
        },
        {
          swatch: 'rgb(52, 211, 153)',
          shape: 'dot',
          label: 'DRIFT remoto',
          hint: 'usuário em outro lugar espalhou o post',
        },
        {
          swatch: 'rgb(52, 211, 153)',
          shape: 'line',
          label: 'arco de propagação',
          hint: 'liga origem → drifts em ordem cronológica',
        },
      ],
    }
  }
  if (context === 'global') {
    return {
      title: 'rede geográfica',
      purpose:
        'Cada ponto é uma pessoa que já espalhou (DRIFT) algum post na rede Drift, no local que ela declarou. Tamanho do ponto cresce com quantos drifts ela fez. Arcos mostram propagação cross-post no tempo. 💡 tamanho do ponto ≠ qualidade nem importância — só conta espalhamentos geográficos (manifesto §22).',
      legend: [
        {
          swatch: 'rgb(232, 255, 90)',
          shape: 'dot',
          label: 'pessoa em foco',
          hint: 'alguém ligada ao post atualmente visível no feed',
        },
        {
          swatch: 'rgb(52, 211, 153)',
          shape: 'dot',
          label: 'outras pessoas',
          hint: 'agregado de quem espalhou outros posts',
        },
        {
          shape: 'badge',
          label: 'tamanho do ponto = √(quantos drifts)',
        },
      ],
    }
  }
  if (context === 'network') {
    return {
      title: 'sua rede geográfica',
      purpose:
        'Mesma visualização do mapa global, mas filtrado por quem você segue (NIP-02). Útil pra ver onde estão geograficamente as pessoas que importam pra você. É lente local — não afeta o feed canônico (manifesto §24). 💡 tamanho do ponto ≠ qualidade — só conta espalhamentos geográficos (§22).',
      legend: [
        {
          swatch: 'rgb(244, 130, 14)',
          shape: 'dot',
          label: 'alta confiança local',
          hint: 'PPR ≥ 0.7 na sua lente (se ativada)',
        },
        {
          swatch: 'rgb(200, 180, 80)',
          shape: 'dot',
          label: 'confiança média',
          hint: 'PPR entre 0.3 e 0.7',
        },
        {
          swatch: 'rgb(100, 150, 180)',
          shape: 'dot',
          label: 'baixa confiança / desconhecido',
          hint: 'PPR < 0.3 ou sem edge na sua rede',
        },
      ],
    }
  }
  // overlay-default
  return {
    title: 'o que é o mapa',
    purpose:
      'O mapa mostra a geografia de quem espalhou (DRIFT-ou) posts na rede Drift. Você pode alternar entre 3 modos: post (este post), global (rede toda), network (só quem você segue).',
    legend: [
      { shape: 'badge', label: 'POST — propagação de um post específico' },
      { shape: 'badge', label: 'GLOBAL — agregado de toda a rede' },
      { shape: 'badge', label: 'NETWORK — filtrado por follows (NIP-02)' },
    ],
  }
}

export function MapExplainerCard({ context, onClose }: MapExplainerCardProps) {
  const copy = getMapExplainerCopy(context)

  return (
    <FullPageCard
      onClose={onClose}
      title={copy.title}
      ariaLabel={`explicação do ${copy.title}`}
    >
      <div className="space-y-6 px-5 py-6">
        {/* Propósito */}
        <section aria-labelledby="explainer-purpose">
          <h3
            id="explainer-purpose"
            className="mb-2 font-mono text-[10px] uppercase tracking-meta text-drift-muted"
          >
            propósito
          </h3>
          <p className="text-[14px] leading-relaxed text-drift-text">
            {copy.purpose}
          </p>
        </section>

        {/* Legenda */}
        <section aria-labelledby="explainer-legend">
          <h3
            id="explainer-legend"
            className="mb-3 font-mono text-[10px] uppercase tracking-meta text-drift-muted"
          >
            legenda
          </h3>
          <ul className="space-y-3">
            {copy.legend.map((item, i) => (
              <LegendRow key={i} item={item} />
            ))}
          </ul>
        </section>

        {/* Disclaimer §28 — sempre presente */}
        <section
          aria-labelledby="explainer-privacy"
          className="rounded-lg border border-drift-border bg-drift-surface/40 px-4 py-3"
        >
          <h3
            id="explainer-privacy"
            className="mb-1 font-mono text-[10px] uppercase tracking-meta text-drift-accent2"
          >
            privacidade — manifesto §28
          </h3>
          <p className="text-[12px] leading-relaxed text-drift-muted">
            O ponto de alguém só aparece no mapa se essa pessoa{' '}
            <strong className="text-drift-text">escolheu publicar</strong> a
            localização ao postar ou espalhar. Drift{' '}
            <strong className="text-drift-text">nunca</strong> infere local via
            IP, GPS automático ou metadados de imagem.
          </p>
        </section>
      </div>
    </FullPageCard>
  )
}

function LegendRow({ item }: { item: LegendItem }) {
  return (
    <li className="flex items-start gap-3">
      <Swatch item={item} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] leading-tight text-drift-text">
          {item.label}
        </div>
        {item.hint && (
          <div className="mt-0.5 text-[11px] leading-tight text-drift-muted">
            {item.hint}
          </div>
        )}
      </div>
    </li>
  )
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.shape === 'line' && item.swatch) {
    return (
      <span
        aria-hidden="true"
        className="mt-1.5 inline-block h-[3px] w-5 shrink-0 rounded-full"
        style={{ backgroundColor: item.swatch }}
      />
    )
  }
  if (item.shape === 'badge' || !item.swatch) {
    return (
      <span
        aria-hidden="true"
        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full border border-drift-border"
      />
    )
  }
  // 'dot' (default)
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: item.swatch }}
    />
  )
}
