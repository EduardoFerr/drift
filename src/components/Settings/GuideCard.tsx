/**
 * GuideCard — "guia do Drift" em Settings.
 *
 * Hub exploratório que explica o QUE serve cada coisa no Drift: os
 * mapas (4 contextos), as ações sociais (DRIFT/SINK/REPORT/BLOCK/MUTE/
 * PIN), os algoritmos (score, weight, threshold, PPR/Trust Lens, decay
 * temporal, lentes pluggable), as garantias de privacidade e a
 * responsabilidade que o usuário tem ao "cultivar" a rede.
 *
 * Origem: user feedback 2026-05-22 — "No menu de configurações
 * precisamos ter uma opção para explicar cada algoritmo e funções de
 * forma que o usuário entenda bem o que ele pode fazer e o que isso
 * traz de responsabilidade para ele e a rede que ele está cultivando".
 *
 * Não confundir com `MenuDetailCard` (em SettingsCards.tsx): aquele
 * controla QUANTO DETALHE aparece em outras settings (5 flags
 * granulares de exibição). Este aqui é o conteúdo educativo em si.
 *
 * Não confundir com `MapExplainerCard` (Feed/MapExplainerCard.tsx):
 * aquele é contextual (long-press 3s no botão de mapa abre legenda
 * do mapa atual). Este aqui é exploratório (user navega em settings
 * sem estar olhando pro mapa). Os dois apontam pra mesma fonte de
 * verdade — `getMapExplainerCopy()` — pra não divergir.
 *
 * Estrutura:
 *
 *   ┌─ GuideCard ────────────────────────────────────────┐
 *   │ intro: "como Drift funciona, em 5 minutos"        │
 *   │                                                    │
 *   │ ┌─ MAPS ─────────────────────────────────────────┐ │
 *   │ │ mapa do post · global · network · embedded   │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   │                                                    │
 *   │ ┌─ AÇÕES SOCIAIS ────────────────────────────────┐ │
 *   │ │ DRIFT · SINK · denunciar · bloquear · …       │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   │                                                    │
 *   │ ┌─ ALGORITMOS ───────────────────────────────────┐ │
 *   │ │ score · weight · threshold · PPR · decay · …  │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   │                                                    │
 *   │ ┌─ PRIVACIDADE ──────────────────────────────────┐ │
 *   │ │ GPS · nsec · denúncia pública · …             │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   │                                                    │
 *   │ ┌─ SUA RESPONSABILIDADE ─────────────────────────┐ │
 *   │ │ cultivar a rede — 3 verdades                  │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────┘
 *
 * Reusa primitives existentes:
 *   - FullPageCard (overlay padrão)
 *   - AccordionGroup + SettingExplainer (mesma anatomia das outras
 *     cards; SettingExplainer aceita `children` arbitrário, então
 *     usamos parágrafos em vez de toggles)
 *   - getMapExplainerCopy() pra source-of-truth dos textos de mapa
 *
 * Manifesto §17 (sem chave mestra), §22 (sem reputação subjetiva),
 * §24 (sem afinidade no feed), §26 (moderação reativa), §27
 * (auto-classificação voluntária), §28 (privacy mínima).
 *
 * LOCK_VIA_TEST: `tests/guia-coverage.test.ts` valida cobertura
 * mínima de seções.
 */

import type { ReactNode } from 'react'
import { FullPageCard } from '../UI/FullPageCard'
import { AccordionGroup } from '../UI/AccordionGroup'
import { SettingExplainer } from '../UI/SettingExplainer'
import { getMapExplainerCopy } from '../Feed/MapExplainerCard'

interface GuideCardProps {
  onClose: () => void
}

/**
 * Parágrafo padrão pro corpo de cada tópico. Usa drift-body com tracking
 * relaxado pra leitura corrida (não é control hint).
 */
function P({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[12px] leading-relaxed text-drift-body">
      {children}
    </p>
  )
}

/**
 * Caixa "🌱 SUA RESPONSABILIDADE" — destaca o que muda na rede quando
 * o user usa a ação. Estilo distinto de impact/default pra dar peso
 * político ao trecho (cultivar a rede ≠ usar app).
 */
function Responsibility({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      aria-label="sua responsabilidade"
      className="mt-3 rounded-lg border border-drift-accent/30 bg-drift-accent/5 px-3 py-2.5"
    >
      <p className="mb-1 font-mono text-[10px] uppercase tracking-meta text-drift-accent">
        🌱 sua responsabilidade
      </p>
      <p className="font-mono text-[11px] leading-relaxed text-drift-body">
        {children}
      </p>
    </div>
  )
}

/**
 * Header de seção dentro do card (separa MAPS / AÇÕES / ALGORITMOS /
 * PRIVACIDADE / RESPONSABILIDADE).
 */
function SectionHeader({ title, kicker }: { title: string; kicker: string }) {
  return (
    <header className="mb-2 mt-1">
      <p className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
        {kicker}
      </p>
      <h2 className="mt-0.5 font-display text-[16px] font-bold text-drift-text">
        {title}
      </h2>
    </header>
  )
}

export function GuideCard({ onClose }: GuideCardProps) {
  const postCopy = getMapExplainerCopy('post')
  const globalCopy = getMapExplainerCopy('global')
  const networkCopy = getMapExplainerCopy('network')

  return (
    <FullPageCard
      onClose={onClose}
      title="guia do drift"
      ariaLabel="guia explicando o que cada função faz e qual sua responsabilidade na rede"
    >
      <div className="space-y-6 px-4 py-5">
        {/* ─── Intro ───────────────────────────────────────────────── */}
        <section aria-labelledby="guia-intro">
          <h2
            id="guia-intro"
            className="mb-2 font-display text-[14px] font-bold text-drift-text"
          >
            como o drift funciona, em 5 minutos
          </h2>
          <P>
            Drift é uma rede social sem dono. Não tem botão "deletar"
            global, não tem moderador-chefe, não tem algoritmo que
            decide o que você vê com base em quem você é. Em vez disso,
            cada gesto seu — DRIFT, SINK, denunciar, seguir —
            cultiva a rede de um jeito específico. Essa página explica
            o que cada coisa faz e o que isso significa pra você e pros
            outros.
          </P>
        </section>

        {/* ─── MAPS ───────────────────────────────────────────────── */}
        <section aria-labelledby="guia-maps">
          <SectionHeader kicker="seção 1 / 5" title="os mapas" />
          <P>
            Drift tem 4 contextos de mapa diferentes. Eles parecem
            iguais à primeira vista, mas mostram coisas distintas.
            Saber qual é qual ajuda a entender o que você está
            cultivando quando publica com localização.
          </P>

          <div className="mt-3">
            <AccordionGroup defaultOpen="none">
              <SettingExplainer
                accordionId="guia-map-post"
                label="mapa do post (mini-map no card)"
                description={postCopy.purpose}
                impact="Quando você abre um post, aparece um pequeno mapa no card mostrando onde ele foi DRIFT-ado. Só posts que tiveram pelo menos 1 DRIFT com location aparecem populados — o resto fica vazio."
                defaultExplained="Sempre visível no card de post. Não consome dados extras — usa o que o relay já entregou."
                reversible
              >
                <P>
                  Cada ponto verde é um lugar onde alguém viu o post e
                  decidiu DRIFT-ar (↑). O ponto amarelo é a
                  origem — o local que o autor escolheu declarar
                  ao publicar. Posts sem location publicada não
                  aparecem aqui — Drift nunca infere local a partir
                  de IP, GPS automático ou metadados de imagem.
                </P>
                <Responsibility>
                  Ao DRIFT-ar um post com GPS ligado, você adiciona um
                  ponto verde ao mapa daquele post. Os outros usuários
                  conseguem ver que alguém espalhou daqui — não veem
                  quem. Se você quer DRIFT-ar sem deixar rastro, basta
                  ter location off (default).
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-map-global"
                label="mapa global (rede inteira)"
                description={globalCopy.purpose}
                impact="Mostra a topologia social do Drift no mundo — onde estão as pessoas que dão DRIFT, e quanto. Útil pra ver concentração geográfica, eventos locais virando posts, regiões frias."
                defaultExplained="Aberto pelo botão de mapa na navbar. Lê dados que já estão no seu cache local — não busca nada extra do relay."
                reversible
                reference="manifesto §28"
              >
                <P>
                  Pontos são pessoas; tamanho cresce com quantos DRIFTs
                  cada uma fez. Cores indicam densidade no cluster.
                  Não é "quem está online" — é "quem tem histórico de
                  dar DRIFT e em qual local declarou".
                </P>
                <Responsibility>
                  Se você publica com GPS, vira um ponto aqui. Quanto
                  mais DRIFTs você faz, maior seu ponto. Isso é
                  voluntário — você pode usar Drift inteiro sem nunca
                  aparecer no mapa global (basta deixar location off).
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-map-network"
                label="mapa da sua rede (network)"
                description={networkCopy.purpose}
                impact="Mostra o mesmo conjunto de pontos do global, mas filtrado por quem você segue (NIP-02) e tingido pela sua lente (Trust Lens). Cores indicam confiança local — laranja = alta, azul = baixa/desconhecido."
                defaultExplained="Modo opt-in dentro do mapa. Não afeta seu feed canônico — é só visualização. Se você não usa Trust Lens nem segue ninguém, fica vazio."
                reversible
                reference="manifesto §24"
              >
                <P>
                  Network é uma lente local — funciona no seu device,
                  com seus dados, e não muda o que outras pessoas veem.
                  Manifesto §24 garante que ranking é função pura de
                  score; sua lente reordena LOCALMENTE sem alterar o
                  feed canônico que outros clientes Drift veem.
                </P>
                <Responsibility>
                  Você decide qual lente aplicar. Você pode trocar de
                  lente, desligar, ou usar lente customizada — sem que
                  isso afete a rede dos outros. É a sua janela, não a
                  régua do mundo.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-map-embedded"
                label="mini-map dentro do post"
                description="O quadradinho de mapa que aparece no rodapé de cada post quando você abre ele — é o mapa do post (modo POST), em versão compacta."
                impact="É a forma mais leve de ver propagação geográfica. Tocando longo (3s) no botão 🗺 do post, abre a legenda completa contextual."
                defaultExplained="Sempre visível em posts que têm ≥1 DRIFT com location. Posts sem geo ficam sem o mini-map."
                reversible
              >
                <P>
                  Mesma fonte de dados do mapa do post, só que
                  inline no card. Útil pra escanear rapidamente sem
                  abrir overlay full.
                </P>
              </SettingExplainer>
            </AccordionGroup>
          </div>
        </section>

        {/* ─── AÇÕES SOCIAIS ──────────────────────────────────────── */}
        <section aria-labelledby="guia-acoes">
          <SectionHeader kicker="seção 2 / 5" title="ações sociais" />
          <P>
            Os gestos que você faz num post — DRIFT, SINK, denunciar,
            bloquear, silenciar, fixar — têm consequências diferentes.
            Algumas afetam só o seu device; outras viajam pela rede e
            ficam registradas pra sempre. Saber a diferença evita usar
            denúncia como super-SINK.
          </P>

          <div className="mt-3">
            <AccordionGroup defaultOpen="none">
              <SettingExplainer
                accordionId="guia-acao-drift"
                label="DRIFT (↑) — amplificar"
                description="Gesto principal do Drift. Você faz swipe pra cima (ou toca no ↑) num post e ele ganha alcance — é como um repost com peso de score."
                impact="O post recebe +1 no score global. Esse evento (kind 9079) é publicado em ≥2 relays e replicado pela rede. Se você tem GPS ligado, sua localização declarada vira um ponto no mapa do post."
                defaultExplained="Não tem default — é ação explícita do user. Cada DRIFT é um evento Nostr assinado com sua chave."
                reversible
                reference="manifesto §16 (disponibilidade via mecânica social)"
              >
                <Responsibility>
                  Cada DRIFT seu amplifica o post pro mundo inteiro.
                  Drift NUNCA é silencioso — sua npub fica visível no
                  evento como quem deu DRIFT. Pense duas vezes antes
                  de amplificar conteúdo duvidoso: você não está só
                  "curtindo", está aumentando o alcance.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-acao-sink"
                label="SINK (↓) — afundar"
                description="Gesto oposto do DRIFT. Swipe pra baixo (ou toca no ↓) e o post perde score."
                impact="O post recebe -1 no score (kind 9080). NÃO é denúncia — é só 'esse post não merece estar no topo do meu feed'. Acumulando SINKs sem reports, o post some pra ranking mais baixo, mas continua acessível."
                defaultExplained="Não tem default. É voto negativo, não censura."
                reversible
                reference="manifesto §22 (sem reputação subjetiva)"
              >
                <Responsibility>
                  SINK é seu voto contra a relevância do post — não
                  contra a pessoa. Não é denúncia (não vira pedido de
                  moderação). Não some o post da rede; apenas baixa
                  o ranking. Use livremente: dar SINK é menos
                  político do que denunciar.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-acao-report"
                label="denunciar (report)"
                description="Reporta o post como violação grave — spam, ilegal, abuso. Publica um evento kind 9081 com o motivo."
                impact="Quando o post acumula reports suficientes (threshold dinâmico — varia por relay e por trust local), o score local cai pra -999 e ele some do feed. Reports são PÚBLICOS na rede Nostr — sua npub fica visível como quem denunciou."
                defaultExplained="Não tem default. UI sempre mostra warning sobre privacidade do reporter ANTES de enviar."
                reversible={false}
                warning="Seu npub fica visível como reporter. Reports são eventos públicos Nostr — outras pessoas (e o autor do post) podem ver que você denunciou."
                reference="manifesto §26 (moderação reativa) + §28 (privacy mínima)"
              >
                <Responsibility>
                  Denúncia é ato político — não é "super-SINK".
                  Use só pra spam grave, ilegal, ou abuso. Para
                  conteúdo que apenas te incomoda, prefira SINK ou
                  BLOCK. Para conteúdo ilegal (CSAM, ameaças
                  concretas), denuncie também às autoridades
                  competentes (NCMEC, SaferNet) — Drift não
                  encaminha automaticamente.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-acao-block"
                label="bloquear (block)"
                description="Esconde TODOS os posts daquele npub da sua view local. Permanente, mas reversível."
                impact="Posts da pessoa bloqueada deixam de aparecer no seu feed e mapas. NÃO afeta o feed dos outros — Drift não tem block global. A pessoa não fica sabendo que você bloqueou."
                defaultExplained="Lista local, não publicada. Vive em `local_lists` SQLite, nunca sai do device."
                reversible
                reference="manifesto §24 (lente local) + §28"
              >
                <Responsibility>
                  Block é seu filtro pessoal — não é punição da rede.
                  A pessoa continua publicando normalmente, e outros
                  usuários continuam vendo. Você apenas para de ver.
                  Trocar de device requer reconfigurar a lista (ou
                  exportar/importar manualmente).
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-acao-mute"
                label="silenciar (mute)"
                description="Mais leve que block. Esconde do feed mas posts continuam acessíveis se você abrir o profile da pessoa direto."
                impact="Posts mutados não aparecem no feed Global nem Following. Diferente de block: mute = 'não me empurre', block = 'esconda completamente'."
                defaultExplained="Lista local, igual block."
                reversible
                reference="manifesto §24"
              >
                <Responsibility>
                  Mute serve pra reduzir ruído sem cortar conexão.
                  Útil pra pessoa que você respeita mas posta muito
                  sobre tema que não te interessa. É menos drástico
                  que block — você ainda pode ver o profile dela.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-acao-pin"
                label="fixar (pin)"
                description="Marca um post como 'guarda no meu cache local pra sempre'. Protege contra eviction automática."
                impact="O post entra em `posts_pinned` e nunca é removido do SQLite local pelo `evictOldPosts()`, mesmo se ficar antigo ou cair de score. Útil pra posts importantes que você quer relembrar."
                defaultExplained="Sem default — ação manual. Cada pin é local, não publicado pra rede."
                reversible
                reference="manifesto §16"
              >
                <Responsibility>
                  Pin é seu arquivo pessoal — não dá ao post status
                  especial na rede. Eviction respeita pinned + spreads
                  (posts que você espalhou também ficam protegidos —
                  manifesto §16 garante disponibilidade via mecânica
                  social).
                </Responsibility>
              </SettingExplainer>
            </AccordionGroup>
          </div>
        </section>

        {/* ─── ALGORITMOS ─────────────────────────────────────────── */}
        <section aria-labelledby="guia-algos">
          <SectionHeader kicker="seção 3 / 5" title="os algoritmos" />
          <P>
            Drift tem 7 algoritmos centrais. Você não precisa entender
            matemática — basta saber o que cada um decide. Detalhes
            completos em <em>Docs/algoritmos.md</em>.
          </P>

          <div className="mt-3">
            <AccordionGroup defaultOpen="none">
              <SettingExplainer
                accordionId="guia-algo-score"
                label="score (popularidade do post)"
                description="Quanto cada post 'vale' na rede. É a soma de DRIFTs menos SINKs, ajustada por decay temporal."
                impact="Score determina ordem no feed Global. Sobe com DRIFTs, cai com SINKs, cai com o tempo (decay). Não há personalização — todo cliente Drift calcula o MESMO score pra cada post (manifesto §24)."
                defaultExplained="Função pura: mesma entrada, mesma saída. Não consulta servidor central — cada cliente calcula localmente a partir dos eventos Nostr que recebeu."
                reversible
                reference="Docs/algoritmos.md §1"
              >
                <Responsibility>
                  Você cultiva o score de cada post com seus DRIFT/
                  SINK. Não tem like passivo — todo gesto é registrado
                  na rede e altera o ranking globalmente. Esse é o
                  contrato: a rede é o que vocês fazem dela.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-algo-weight"
                label="weight (peso de perfil)"
                description="Mede quão ativo um perfil é, baseado em DRIFTs que ele fez e recebeu. Usado em algumas visualizações (mapa) e como sinal opcional na lente."
                impact="Perfis com weight alto aparecem maior no mapa global. Não afeta feed canônico — é só visualização. Manifesto §22 proíbe reputação subjetiva (boas/ruins): weight é puramente quantitativo."
                defaultExplained="Calculado local. Não shared via Nostr. Cada cliente que aplique pesos define o seu critério."
                reversible
                reference="manifesto §22 + Docs/algoritmos.md §2"
              >
                <P>
                  Weight NÃO é "perfil confiável". É só "perfil ativo".
                  Spammer pode ter weight alto. A defesa contra spam
                  vem do threshold dinâmico de reports (próximo item),
                  não da reputação.
                </P>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-algo-threshold"
                label="threshold de moderação"
                description="Quantos reports = post oculto (-999). Não é número fixo — varia em função da idade do post, do número de DRIFTs e da diversidade dos reporters."
                impact="Post com 3 reports de pessoas diferentes (geograficamente diversas, com algum histórico) pode bastar; 30 reports de bots idênticos pode não bastar. Threshold é local — cada cliente Drift pode decidir o seu (manifesto §26)."
                defaultExplained="Default conservador no cliente oficial. Configurable em settings (avançado)."
                reversible
                reference="manifesto §26 + Docs/algoritmos.md §3"
              >
                <Responsibility>
                  Threshold dinâmico depende da QUALIDADE dos reports,
                  não só da quantidade. Reports coordenados (mesma
                  rede, mesmo timing) pesam menos. É o desenho que
                  evita brigada de denúncia.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-algo-ppr"
                label="PPR (Personalized PageRank) / Trust Lens"
                description="Mede o quão 'próximo' cada autor está de você, na sua rede de follows (NIP-02). Vai de 0 (desconhecido) a 1 (você mesmo)."
                impact="Quando Trust Lens está ativa (opt-in), PPR vira um multiplier LOCAL que reordena seu feed sem alterar o score canônico. Você vê primeiro quem está mais próximo da sua rede social — sem que isso afete o que outros veem."
                defaultExplained="Lens off por default. User decide ativar e ajustar força (0-100%). Manifesto §24: PPR nunca é persisted em posts.score, nunca shared via Nostr, nunca escapa do device."
                reversible
                reference="manifesto §24 (adendo Trust Lens 2026-05-17) + Docs/algoritmos.md §5"
              >
                <Responsibility>
                  Trust Lens é a sua perspectiva, não a régua da rede.
                  Você decide quanta lente aplicar. Você decide trocar
                  por outra lente quando quiser. É a versão honesta
                  de "algoritmo personalizado" — explícito, local,
                  reversível, e não-escondido do user.
                </Responsibility>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-algo-decay"
                label="decay temporal"
                description="Posts envelhecem. Após algumas horas, score cai gradualmente — meia-vida típica ~12-24h."
                impact="Garante que feed sempre tem coisa nova no topo, mesmo sem moderação. Post viral de ontem cai naturalmente; post fresco com poucos DRIFTs pode subir acima dele."
                defaultExplained="Função pura, parâmetros fixos no código. Manifesto §7: determinismo — mesmo timestamp, mesmo decay, em qualquer cliente."
                reversible
                reference="Docs/algoritmos.md §7"
              >
                <P>
                  Decay é o que diferencia feed do Drift de timeline
                  cronológica pura. Não favorece "novo demais"
                  (precisa de DRIFTs pra subir) nem "antigo demais"
                  (decay puxa pra baixo). O equilíbrio é o que mantém
                  a rede viva.
                </P>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-algo-lentes"
                label="lentes pluggable (avançado)"
                description="Trust Lens é só UMA lente possível. O Drift está construindo um registry de lentes — você poderá trocar PPR por outra fórmula (ex: cronológica pura, diversidade geográfica, foco em certas categorias)."
                impact="Quando lentes pluggable shipa (Sprint N+2 POC), você poderá baixar / importar lente como plugin local. Cada lente continua sendo aplicada no view-boundary do render — nunca persisted, nunca shared (mesma invariante de Trust Lens)."
                defaultExplained="Roadmap. Manifesto §24 garante que NENHUMA lente afeta o feed canônico — só a sua visualização."
                reversible
                reference="Docs/lens-pluggable-design.md (PROPOSED)"
                level="advanced"
              >
                <P>
                  Lentes existem pra resolver um dilema: você quer
                  personalização sem se entregar a um algoritmo
                  central. Solução Drift: o algoritmo personalizado
                  vive no SEU device, sob sua escolha explícita, e o
                  feed canônico continua determinístico pra todo
                  mundo.
                </P>
              </SettingExplainer>
            </AccordionGroup>
          </div>
        </section>

        {/* ─── PRIVACIDADE ────────────────────────────────────────── */}
        <section aria-labelledby="guia-privacy">
          <SectionHeader kicker="seção 4 / 5" title="privacidade" />
          <P>
            Drift tem 3 garantias mínimas — e algumas trade-offs
            inerentes ao Nostr que você precisa conhecer pra usar com
            consciência.
          </P>

          <div className="mt-3">
            <AccordionGroup defaultOpen="none">
              <SettingExplainer
                accordionId="guia-privacy-nsec"
                label="sua chave (nsec) nunca sai do dispositivo"
                description="A chave privada que assina seus posts é gerada localmente e fica criptografada (AES-GCM 256) no IndexedDB do navegador / OPFS no Tauri."
                impact="Drift não tem servidor de identidade. Não tem conta. Não tem 'esqueci senha'. Se você perde a chave (formatar, limpar storage sem export), perde a identidade. Por isso o export está sempre disponível em Settings → identidade."
                defaultExplained="Geração local de chave secp256k1 + master key não-exportável do browser. Nunca enviada pra relay."
                reversible={false}
                warning="Exporte sua nsec antes de limpar dados do navegador, formatar device, ou desinstalar o app. Sem export, identidade se perde."
                reference="manifesto §28"
              >
                <P>
                  Identidade Drift é portável: a mesma nsec funciona em
                  Damus, Snort, Coracle ou qualquer cliente Nostr. O
                  dispositivo é descartável — a chave, não.
                </P>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-privacy-gps"
                label="GPS off por default"
                description="Drift nunca pega sua localização sem você ligar explicitamente em Settings → location."
                impact="Posts sem location publicada NÃO aparecem no mapa. Quando você ativa, escolhe granularidade (país / cidade / GPS preciso) — mais detalhe = mais visibilidade no mapa. Manifesto §28: privacy pelo mínimo."
                defaultExplained="Default off em todas as instalações. UI sempre lembra o trade-off antes de mudar."
                reversible
                reference="manifesto §28"
              >
                <P>
                  Lembrete prático: cidade pequena + opinião política
                  específica = identificável, mesmo sem nome. Granularidade
                  "país" é seguro pra maioria dos casos; GPS preciso
                  ative só quando o contexto exigir (eventos públicos,
                  cobertura ao vivo).
                </P>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-privacy-reports"
                label="denúncias são públicas (trade-off Nostr)"
                description="Eventos Nostr são assinados — sua npub fica visível em tudo que você publica, incluindo reports (kind 9081)."
                impact="Quem ler o evento de report sabe quem denunciou. O autor do post denunciado consegue ver. Drift não pode mascarar isso sem quebrar compat com NIP-56 e o ecossistema Nostr."
                defaultExplained="UI sempre mostra warning ANTES do envio. Você sempre vê quem você é assinando."
                reversible={false}
                warning="Reports não podem ser apagados — uma vez publicados, ficam na rede Nostr indefinidamente em qualquer relay que recebeu."
                reference="manifesto §28 + NIP-56"
              >
                <P>
                  Por isso a Responsabilidade #3 (próxima seção):
                  denúncia é ato político. Use SINK / BLOCK / MUTE pra
                  "não quero ver"; deixe denúncia pra spam grave,
                  ilegal ou abuso.
                </P>
              </SettingExplainer>

              <SettingExplainer
                accordionId="guia-privacy-no-scan"
                label="cliente oficial não escaneia conteúdo"
                description="Drift não roda PhotoDNA, classificador NSFW, ML de moderação ou blocklist embutida. Manifesto §25: scan automático = chave mestra disfarçada."
                impact="Conteúdo é endereçado por (a) auto-classificação voluntária do autor (tag content-warning) + (b) moderação comunitária reativa (reports + threshold). Não há filtro silencioso. Cliente alternativo pode adicionar scan opt-in se quiser."
                defaultExplained="Decisão de design fundacional. Não vai mudar no cliente oficial."
                reversible={false}
                reference="manifesto §25 + §7"
              >
                <P>
                  Razão técnica: scanner externo (PhotoDNA, classificador
                  de terceiro) significa que o operador do scanner
                  decide o que pode passar pelo cliente. Isso é a chave
                  mestra disfarçada — e por isso o cliente oficial
                  recusa, mesmo quando seria conveniente.
                </P>
              </SettingExplainer>
            </AccordionGroup>
          </div>
        </section>

        {/* ─── RESPONSABILIDADE ───────────────────────────────────── */}
        <section aria-labelledby="guia-responsabilidade">
          <SectionHeader
            kicker="seção 5 / 5"
            title="cultivar a rede — 3 verdades"
          />
          <P>
            Drift é uma rede que você cultiva, não uma plataforma que
            você consome. Essas 3 verdades resumem a diferença.
          </P>

          <div className="mt-3 space-y-3">
            <article className="rounded-lg border border-drift-border bg-drift-surface/40 px-4 py-3.5">
              <h3 className="mb-1 font-display text-[13px] font-bold text-drift-text">
                1. cada DRIFT seu amplifica. cada SINK reduz.
              </h3>
              <P>
                Você não "consume conteúdo" — você decide o que ganha
                alcance. Esse poder não tem ctrl-z global: uma vez que
                você espalhou, o evento Nostr está na rede.
              </P>
            </article>

            <article className="rounded-lg border border-drift-border bg-drift-surface/40 px-4 py-3.5">
              <h3 className="mb-1 font-display text-[13px] font-bold text-drift-text">
                2. ninguém pode silenciar ninguém globalmente — nem
                você, nem o fundador.
              </h3>
              <P>
                Manifesto §17: Drift não tem chave mestra. Não existe
                botão "deletar" global, não existe banimento de npub
                pela administração. O que existe é (a) sua lente
                local (block / mute / Trust Lens), (b) reports
                comunitários que viram threshold dinâmico, e (c) o
                fato de que clientes alternativos podem mostrar
                conteúdo que o oficial esconde.
              </P>
            </article>

            <article className="rounded-lg border border-drift-border bg-drift-surface/40 px-4 py-3.5">
              <h3 className="mb-1 font-display text-[13px] font-bold text-drift-text">
                3. denúncia é ato político — não use como super-SINK.
              </h3>
              <P>
                Reports são públicos, ficam pra sempre na rede, e
                pesam só quando vêm de fontes diversas. Usar denúncia
                pra "discordar" gasta a credibilidade do mecanismo
                que existe pra conteúdo realmente grave (spam,
                ilegal, abuso). Para "não quero ver", existe SINK,
                BLOCK e MUTE.
              </P>
            </article>
          </div>
        </section>

        {/* ─── Footer / referência ────────────────────────────────── */}
        <footer className="border-t border-drift-border/40 pt-4">
          <P>
            Quer ir mais fundo? O manifesto completo (34 princípios)
            está em <em>Docs/manifesto.md</em>. A matemática dos 7
            algoritmos está em <em>Docs/algoritmos.md</em>. O guia
            user-facing em pt-BR está em <em>Docs/guia-do-usuario.md</em>.
          </P>
        </footer>
      </div>
    </FullPageCard>
  )
}
