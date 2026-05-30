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
  /** Forma do swatch: 'dot' (círculo), 'line' (barra), 'ring' (anel
   *  vazado) ou 'badge' (texto). */
  shape?: 'dot' | 'line' | 'ring' | 'badge'
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
        'ESCOPO: só ESTE post — não a rede toda, não só você. Cada ponto é um lugar onde alguém viu o post e decidiu dar DRIFT (gesto ↑). A origem é onde o autor publicou. 💡 tamanho do pin ≠ qualidade do post — só conta DRIFTs geográficos (manifesto §22).',
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
          label: 'arco sólido (verde) — ligação à origem',
          hint: 'o post foi DRIFT-ado por essa pessoa: ligação REGISTRADA (o evento referencia o post)',
        },
        {
          swatch: 'rgb(120, 150, 180)',
          shape: 'line',
          label: 'arco fraco (cinza) — rota ESTIMADA',
          hint: 'cascata provável entre spreaders por tempo+proximidade. Drift NÃO registra de quem cada um viu (vazaria o grafo de atenção, §28) — esta aresta é um palpite, não um fato.',
        },
      ],
    }
  }
  if (context === 'global') {
    return {
      title: 'rede geográfica',
      purpose:
        'ESCOPO: TODA a rede Drift — todas as pessoas, todos os posts. NÃO é este post nem só você. Cada ponto é uma pessoa que já deu DRIFT em algum post, no local que ela declarou. Tamanho do ponto cresce com quantos drifts ela fez. Arcos mostram propagação cross-post no tempo. 💡 tamanho do ponto ≠ qualidade nem importância — só conta DRIFTs geográficos (manifesto §22).',
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
          hint: 'agregado de quem deu DRIFT em outros posts',
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
        'ESCOPO: só quem VOCÊ segue (NIP-02) — não a rede toda, não este post. Recorte do mapa global pela sua lista de follows: onde estão geograficamente as pessoas que importam pra você. É lente local — não afeta o feed canônico (manifesto §24). 💡 tamanho do ponto ≠ qualidade — só conta DRIFTs geográficos (§22).',
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
        {
          swatch: 'rgb(244, 130, 14)',
          shape: 'ring',
          label: 'anel — ponte na sua rede',
          hint: 'esta pessoa é a ÚNICA via até alguém que você segue: se deixar de seguir, esse alguém some do seu mapa. Fato estrutural da sua rede — não é juízo de valor sobre a pessoa (§22/§25). Você decide se importa.',
        },
      ],
    }
  }
  // overlay-default
  return {
    title: 'o que é o mapa',
    purpose:
      'O mapa mostra a geografia de quem deu DRIFT em posts na rede Drift. Você pode alternar entre 3 modos: post (este post), global (rede toda), network (só quem você segue).',
    legend: [
      { shape: 'badge', label: 'POST — propagação de um post específico' },
      { shape: 'badge', label: 'GLOBAL — agregado de toda a rede' },
      { shape: 'badge', label: 'NETWORK — filtrado por follows (NIP-02)' },
    ],
  }
}

/**
 * Guia curto dos 3 modos do mapa — renderizado em TODO contexto (exceto
 * 'overlay-default', cuja legenda já é esta lista). User 2026-05-29: o "?"
 * deve explicar o que POST/GLOBAL/NETWORK mostram, independente de qual modo
 * está aberto. Vocabulário UI (DRIFT, não SPREAD).
 */
const MODE_GUIDE: readonly { key: string; desc: string }[] = [
  { key: 'POST', desc: 'propagação de UM post — onde quem viu deu DRIFT nele (estrela a partir da origem).' },
  { key: 'GLOBAL', desc: 'agregado de toda a rede — cada pessoa que deu DRIFT em algum post, no local que declarou.' },
  { key: 'NETWORK', desc: 'só quem você segue (NIP-02) — sua lente local, não afeta o feed canônico (§24).' },
]

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

        {/* Os 3 modos — sempre presente (user 2026-05-29): abrir o "?" em
            qualquer modo explica TAMBÉM o que cada um dos 3 mapas mostra, pra
            o user entender as abas POST/GLOBAL/NETWORK. Omitido só no
            'overlay-default', cuja legenda JÁ é essa lista (evita duplicar). */}
        {context !== 'overlay-default' && (
          <section aria-labelledby="explainer-modes">
            <h3
              id="explainer-modes"
              className="mb-3 font-mono text-[10px] uppercase tracking-meta text-drift-muted"
            >
              os 3 modos do mapa
            </h3>
            <ul className="space-y-2">
              {MODE_GUIDE.map((m) => (
                <li key={m.key} className="text-[13px] leading-snug text-drift-text">
                  <strong className="font-semibold text-drift-accent2">{m.key}</strong>
                  <span className="text-drift-muted"> — {m.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

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
            localização ao postar ou dar DRIFT. Drift{' '}
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
  if (item.shape === 'ring' && item.swatch) {
    return (
      <span
        aria-hidden="true"
        className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full border-2 bg-transparent"
        style={{ borderColor: item.swatch }}
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
