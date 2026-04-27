# DRIFT — Manifesto Técnico
**Versão:** 2.2
**Data:** Abril 2026
**Status:** Contrato. O que está aqui o Drift cumpre — em MVP, em V1, ou em V2 conforme indicado, mas cumpre. Não é aspiração; é roadmap vinculante.

---

> *"Se eu quero uma rede livre de censura, eu também devo ser incapaz de censurá-la."*
> — O Arquiteto

Este documento define os princípios que orientam o Drift e as
**garantias** que o protocolo + cliente oficial entregam. Não é
arquitetura — é o contrato que a arquitetura precisa cumprir.
Quando uma decisão técnica conflitar com um princípio aqui, o
princípio vence; a arquitetura se ajusta.

Cada princípio é seguido por **Regras** (verificáveis), **Implementação**
(onde no código vive ou viverá), e **Fase** (quando entra). Itens
marcados como Fase 5+ não são opcionais — são compromisso público
sob este manifesto.

---

## I. EXISTÊNCIA E IDENTIDADE

### 1. Existência Autônoma

> "O Drift não pede para existir. Existe."

O Drift opera sem dependência obrigatória de infraestrutura central.

**Regras:**
- Nenhum servidor é necessário para operação básica
- Participação é permissionless — qualquer pessoa entra sem pedir
- O fundador desligar o domínio não tira a rede do ar
- Cliente roda em qualquer ambiente: browser, desktop nativo, mobile nativo
- Há sempre pelo menos uma rota de acesso ao app que não depende de loja de apps

**Implementação:**
- PWA estática em CDN (MVP, hoje)
- APK direto via GitHub Releases (Fase 5)
- Cliente desktop nativo via Tauri (Fase 6) — habilita Tor + WebRTC
- F-Droid (Fase 6) — distribuição alternativa

### 2. Identidade Auto-Soberana


> "Identidade que pertence ao app não é identidade — é concessão."

A identidade é definida exclusivamente por criptografia. Pertence
ao usuário, não ao app.

**Regras:**
- Baseada em chave pública secp256k1 (padrão Nostr)
- Não existe autoridade emissora
- Não existe revogação global obrigatória
- O usuário pode usar a mesma identidade em qualquer cliente Nostr

**Implementação:** `src/lib/identity.ts` — `getOrCreateIdentity` gera
nsec local; `nsec` nunca sai do dispositivo em claro. Ver
`drift-arquitetura-v4.md` §5.

### 3. Identidade Portável; Dispositivo Descartável

Trocar de aparelho não pode perder identidade. Dispositivo é cache
reconstruível; nsec é o que importa.

**Regras:**
- Toda identidade pode ser exportada como `nsec1...`
- Toda identidade pode ser importada em outro device
- Após import, o histórico do author é reconstruível a partir dos relays
- Toda ação destrutiva à identidade exige opção de export antes
- Rebuild de histórico funciona mesmo se relays originais sumiram (ver §27 Disponibilidade)

**Implementação:** `setIdentityFromNsec()`, `exportIdentity()`,
`resetIdentity()` em `identity.ts`; `rebuildIdentityHistory(npub)`
em `sync.ts`; `IdentityPanel` em `components/Identity/`. Fase 2.5
fechada. Ver arquitetura §5.4.

### 4. Anonimato por Design

O Drift não pode saber quem você é no mundo real, e não pode permitir
que terceiros descubram só observando o tráfego ou os eventos.

**Regras:**
- Sem login com email, telefone, ou qualquer identificador do mundo real
- Sem KYC, sem verificação, sem prova de identidade humana
- Suporte a múltiplas identidades por usuário (anti-perseguição)
- Tag `location` é opt-in com granularidade controlada pelo usuário
  (off / país / cidade / GPS — default OFF)
- Em modo paranoia (cliente nativo), tráfego pra relays passa por Tor
- Nenhum analytics, nenhum telemetry, nenhuma correlação cross-device

**O que o Drift NÃO pode fazer (porque não dá):**
- Impedir que o usuário se identifique voluntariamente publicando
  alias, foto, ou nome real. Direito dele.
- Garantir anonimato se o usuário usa a mesma identidade em todos
  os contextos (correlação por padrão de uso). Multi-identidade
  ajuda a mitigar.
- **Anonimato forte contra adversário global passivo.** Drift NÃO
  é uma mixnet — não tem cover traffic, fragmentação, mixing entre
  clientes ou jitter temporal. Adversário com visão global da rede
  (ISP nacional, estado-nação) eventualmente correlaciona timing
  entre publicações de uma mesma identidade. Defesas que temos —
  Tor opt-in (Fase 6), multi-identidade pra compartimentar contextos,
  location off-default — elevam o custo do adversário, não o
  eliminam. Quem precisa de anonimato real-tempo contra adversário
  global usa **Tor + multi-identidade + cuidado operacional**;
  cliente oficial fornece as ferramentas, uso correto é
  responsabilidade do user. Threat model completo em
  `drift-arquitetura-v4.md` §35.

**Implementação:**
- Sem login (MVP, hoje)
- Múltiplas identidades por usuário (Fase 5)
- Modo Tor no cliente nativo (Fase 6)
- Padrão "location off" (Fase 3 — quando feature entrar)

### 5. Autenticidade Criptográfica

Todo evento é verificável independentemente da origem que o entrega.

**Regras:**
- Todo evento Drift é assinado (Schnorr sobre secp256k1)
- Assinatura é validada antes do evento afetar estado local
- Eventos inválidos são descartados silenciosamente
- O cliente não confia em relay nenhum — só na assinatura

**Implementação:** `verifyDriftEvent` em `nostr.ts`; pipeline de
`onNostrEvent` (events.ts) faz verify ANTES de persistir.

---

## II. ESTADO E DETERMINISMO

> "Estado é interpretação. Eventos são fato. O Drift confia apenas no que não pode ser reescrito."

### 6. Verdade por Eventos

O sistema é definido por um log de eventos imutáveis. Estado é
sempre derivado.

**Regras:**
- Eventos são append-only — nunca alterados
- Não existe mutação direta de estado fora do pipeline de eventos
- O SQLite local é cache reconstruível, não fonte da verdade
- A fonte da verdade são os eventos Nostr distribuídos

**Implementação:** `onNostrEvent` é o ÚNICO ponto de escrita em
tabelas de domínio. Ver invariante #1 em `CLAUDE.md`.

### 7. Determinismo Global

Clientes independentes devem convergir para o mesmo estado lógico
dado o mesmo conjunto de eventos.

**Regras:**
- Mesma entrada → mesma saída → sempre
- Funções de negócio são puras (sem `Date.now()` implícito, sem I/O)
- Score, peso, threshold de moderação são determinísticos

**Implementação:** `calculateScore`, `calculateWeight`,
`getMaxSubposts` recebem `now` por parâmetro. Não consultam SQLite.
Ver invariante #3 em `CLAUDE.md`.

### 8. Ordenação Determinística

A ordem dos eventos é consistente entre clientes.

**Regras:**
- Ordenação primária: `created_at` (unix seconds)
- Desempate: `event.id` (hex SHA256, comparação lexicográfica)
- Não há dependência da ordem de chegada nos relays

**Implementação:** Queries de feed usam `ORDER BY score DESC,
created_at DESC, id ASC`. Idempotência via `INSERT OR IGNORE`.

### 9. Validação Determinística

Eventos são validados pelas mesmas regras em todos os clientes Drift.

**Regras:**
- Schema válido (tags obrigatórias, content parseável)
- Assinatura válida
- Regras de negócio válidas (limites de tamanho, etc.)
- Validação não depende de estado externo ao evento

**Implementação:** `passesSchemaCheck` em `events.ts`.

### 10. Persistência Local

O cliente é a autoridade sobre seu próprio estado.

**Regras:**
- Estado materializado em SQLite WASM (OPFS) ou IndexedDB (fallback)
- Leitura nunca depende de chamada de rede
- Escrita pode ser otimista no React state local
- Optimistic state nunca persiste no SQLite
- Cliente oficial NUNCA deleta posts/spreads/buries do SQLite por
  decisão própria. Marca como moderado (`score = -999`), não apaga.
  Apagar é decisão do usuário, no botão "limpar local".

**Implementação:** `db.ts` + `db.worker.ts`. Optimistic em
`useState` por componente, descartado quando evento real chega.

---

## III. REDE, TRANSPORTE E DISPONIBILIDADE

### 11. Rede como Meio, Não Fonte

A rede transporta dados, mas não define verdade.

**Regras:**
- Transportes são intercambiáveis
- Nenhum nó é confiável por padrão — apenas a assinatura é
- Falha de rede não corrompe estado local
- O que vem da rede sem assinatura válida é ruído

**Implementação:** `pool.subscribeMany` em `sync.ts` — qualquer
relay pode entregar; `verifyDriftEvent` é o filtro.

### 12. Múltiplos Transportes

O Drift não depende de um meio único de transporte. Se um adversário
bloqueia um, o cliente usa outro.

**Regras:**
- WSS público (relays Nostr clearnet) — transporte primário
- WSS via Tor (.onion) — transporte resistente a censura nacional
- WebRTC P2P entre clientes — transporte sem servidor de relay
- Tudo isso usando o mesmo formato de evento (independência do
  transporte, §13)

**Implementação:**
- WSS clearnet (MVP, hoje)
- WSS via Tor: cliente nativo Tauri integra `arti` ou `tor` (Fase 6)
- WebRTC P2P: signaling via Nostr (publica oferta como evento Drift,
  par responde via DM cifrado), conexão direta após handshake (Fase 6)
- API de transporte abstrata em `lib/transport/` que permite plugar
  novos meios sem mudar `sync.ts` (Fase 6)

### 13. Neutralidade de Transporte

Eventos são independentes do meio de transmissão.

**Regras:**
- O mesmo evento pode trafegar por WSS clearnet, WSS Tor, WebRTC,
  BitTorrent, sneakernet, QR code impresso
- Transporte não altera o evento (id é hash do conteúdo)
- Persistência independe da origem
- Eventos podem ser exportados como blob assinado e reimportados em
  outro cliente (importante pra sneakernet em país censurado)

**Implementação:**
- Eventos Drift são eventos Nostr padrão (MVP)
- Export/import de bundle de eventos via JSON ou QR (Fase 6)

### 14. Bootstrap Distribuído

A entrada na rede não depende de uma lista canônica de relays.

**Regras:**
- Cliente vem com seed list curta (4 relays públicos diversos
  geograficamente — `config/relays.ts`)
- Usuário pode adicionar/remover relays a qualquer momento
- Relays adicionados pelo usuário entram em rotação igual aos seed
- Cliente descobre relays novos via NIP-65 (lista de relays do user)
  e via tag opcional `recommend-relay` em eventos de pessoas
  seguidas
- Em modo paranoia, cliente preferencia .onion sobre clearnet

**Implementação:**
- Lista estática (MVP, hoje)
- UI de gerenciamento de relays no Settings (Fase 5)
- NIP-65 — descoberta de relays do user (Fase 5)
- Preferência por .onion no cliente nativo (Fase 6)

### 15. Anti-Censura por País

Um Estado-nação que tenta bloquear o Drift na sua jurisdição não
deve conseguir mais do que tornar o uso menos conveniente.

**Regras:**
- Bloqueio por DNS é contornável (PWA + IP direto + Tor)
- Bloqueio por SNI/DPI dos relays clearnet é contornável (Tor + WebRTC)
- Bloqueio das app stores é contornável (APK direto, F-Droid, PWA)
- Bloqueio do dev server / domínio do fundador não derruba a rede
  (cliente já distribuído continua funcionando, eventos seguem em
  relays fora da jurisdição, mais clientes podem ser distribuídos por
  qualquer outro canal)
- Custo do adversário cresce com o uso: censurar 100 relays é mais
  caro que censurar 4

**Implementação:**
- §12 (múltiplos transportes) + §14 (bootstrap distribuído) + §1
  (cliente em múltiplas formas) — combinação que cumpre §15
- Documentação pública "como instalar Drift em país censurado" no
  GitHub do projeto (Fase 5)
- Tutorial de auto-hospedagem de relay (Fase 5)

### 16. Disponibilidade Distribuída

> "O que a comunidade espalhou, a comunidade guarda."

Eventos publicados no Drift permanecem acessíveis mesmo que relays
individuais fechem, sejam confiscados ou bloqueados. Não dependemos
da boa vontade de operadores de relay.

**Regras:**
- Cada cliente arquiva localmente todos os eventos que publicou ou
  espalhou (já é feito no SQLite, mas com regra explícita: posts
  espalhados pelo usuário NUNCA são removidos pelo cache eviction)
- Cliente re-publica em relays novos os eventos próprios + os
  eventos espalhados (re-broadcast oportunista quando conecta a
  relay novo) — replicação social orgânica
- Camada de durabilidade descentralizada para conteúdo viral:
  posts com score alto são fixados em IPFS / Arweave / Hypercore
  pelo cliente oficial. Custo coberto por doações ou modelo
  econômico futuro (§Monetização da arquitetura)
- "Espalhar = seedear": quem espalhou um post se compromete (no
  cliente oficial) a republicá-lo se um par solicitar. Mecânica
  social vira infraestrutura técnica.

**Implementação:**
- Eviction respeita posts espalhados pelo user (MVP, na Fase 4)
- Re-broadcast em conexão a relay novo (Fase 5)
- Pin em IPFS/Arweave de posts virais (Fase 6)
- WebRTC seeding pelo cliente nativo (Fase 6)

> **Disponibilidade vs anonimato:** seedear posts pode revelar quem
> tem o quê. Em modo paranoia, seeding é desligado por padrão; user
> ativa explicitamente.

---

## IV. RESISTÊNCIA E DEFESA

### 17. Resistência ao Fundador

> "O fundador que pode censurar já construiu o que prometeu destruir."
> — Fundador do Drift

Nem o criador da rede pode censurá-la. Esta é a propriedade central.

**Regras:**
- **Não existe chave mestra.** Não escrever uma. Mesmo que pareça útil.
- Não existe função `deletePost()` que afete outros clientes
- Não existe função `banUser()` global
- Nenhuma feature do cliente oficial pode ser usada como vetor de
  censura sobre a rede
- Atualizações do cliente oficial não podem alterar eventos passados
- O fundador pode publicar opiniões, mas não decretos
- Build do cliente é reproduzível: usuários podem auditar que o
  binário publicado bate com o source público

**Implementação:**
- Assinatura Schnorr de cada evento — só o autor publica pelo seu npub
- Score local; cada cliente recalcula
- Licença MIT irrevogável desde o primeiro commit
- Build reproduzível via Tauri + lockfiles (Fase 6)

### 18. Cliente Oficial sem Privilégios sobre a Rede

O cliente oficial é uma implementação de referência, não uma
autoridade.

**Regras:**
- Eventos do cliente oficial não têm peso maior que outros
- Tag `['client', 'drift-official']` é informativa, não privilegiada
- Clientes alternativos têm acesso idêntico aos relays
- Premium do cliente oficial não pode comprar peso na rede
- Boost pago, se vier a existir, é evento Nostr público (qualquer
  cliente lê e exibe ou ignora) — não é manipulação oculta do feed
- Forks têm vida própria; não podem ser bloqueados pelo cliente
  oficial nos relays (impossível tecnicamente, mas declarado para
  ser claro)

**Implementação:** Validação de eventos não checa o `client` tag.
Boost pago (se vier) seria kind 9082 público. Ver arquitetura §24.

### 19. Anti-Captura

Nenhum participante deve dominar o fluxo da rede.

**Regras:**
- Nenhum relay é obrigatório
- Nenhum cliente é obrigatório
- Nenhuma identidade tem peso fixo desproporcional
- Score = -999 (moderado) é flag local; o evento continua na rede
- Cliente oficial NÃO deleta dados moderados — só esconde
- Cliente alternativo pode exibir conteúdo que o oficial esconde

**Implementação:** Posts moderados desaparecem do feed local mas
seguem em `posts` no SQLite e nos relays.

### 20. Resistência a Isolamento

A rede deve evitar aprisionamento em sub-redes maliciosas (eclipse
attack), incluindo Sybil adaptativo com mimicry estrutural.

**Premissa de ameaça:** o adversário inteligente não tenta isolar a
rede inteira (impraticável); tenta **controlar a percepção local** do
usuário novo nos primeiros segundos pós-bootstrap. Mimica
distribuição, infiltra-se gradualmente, evita formar cluster óbvio.

**Regras (defesa em camadas — diversidade de caminho, não só local):**

- **Multi-bootstrap obrigatório:** cliente nunca confia em um único
  ponto de entrada. Mínimo 3 (recomendado 5–10) endpoints
  independentes na inicialização.
- **Validação por assinatura, não origem:** cliente só confia no que
  está criptograficamente assinado pelo autor. Origem do transporte
  é irrelevante.
- **Probe periódico:** cliente pede eventos conhecidos a cada
  endpoint; quem esconde eventos válidos é flagado e desconectado.
- **Random walk obrigatório:** mesmo após `CONNECTED`, cliente
  continua descobrindo via amostragem aleatória de peers conhecidos
  → atravessa fronteiras de cluster, expõe inconsistências
  estruturais. Bots dependem de cluster controlado; random walk os
  corrói estatisticamente.
- **Path diversity scoring (não trust local):** peer/relay é avaliado
  por **quantos caminhos independentes** levam até ele, não por
  "comportamento bom no vizinho imediato". Diversidade local é
  enganável por mimicry; diversidade de caminho não é.
- **Limite de influência:** nenhum peer/relay pode contribuir com
  mais de ~30% do conjunto conhecido. Quebra dominância silenciosa.
- **Cluster detection:** se >70% dos peers conhecidos vêm da mesma
  origem inferida, cliente entra em estado `ISOLATED` e força
  expansão antes de aceitar a visão como válida.
- **Relay aleatório fora da preferência do user:** sempre manter ao
  menos 1 endpoint que o user não escolheu — anti-eclipse contra
  manipulação da própria configuração local.

**Limite honesto:** nenhuma defesa elimina manipulação. O objetivo é
**reduzir tempo e probabilidade de captura local**, não garantir
visão global perfeita. Conjunto de bots não consegue manter visão
estável da rede para sempre — random walk + path diversity garantem
que bolhas falsas se desfazem ao longo do tempo.

> *"O Drift não impede mentira; impede consenso estável da mentira."*

**Implementação:**
- 4 relays seed diversos (MVP, hoje)
- Probe de relay + cluster detection + relay aleatório externo (Fase 5)
- Random walk + path diversity scoring no transporte WebRTC P2P
  (Fase 6 — quando o protocolo de transporte abstrai descoberta de
  peers além de relays clearnet). Ver arquitetura §32.3.

### 21. Custo Assimétrico

Interromper o sistema deve ser significativamente mais difícil que
usá-lo.

**Regras:**
- Múltiplos relays — derrubar um não afeta a rede
- Múltiplos clientes — banir o oficial não derruba o protocolo
- Múltiplos transportes — bloquear WSS clearnet ainda deixa Tor + WebRTC
- Múltiplas formas de instalação — bloquear app stores ainda deixa APK + PWA
- Identidade portável — confiscar device não confisca identidade
- Disponibilidade distribuída — confiscar relay não apaga eventos virais

**Implementação:** Combinação de §1, §3, §11, §12, §15, §16, §20.

---

## V. JULGAMENTO E MODERAÇÃO

> "Reputação é poder concentrado com outro nome. Score é cálculo aberto."


### 22. Score Determinístico, Não Reputação Subjetiva

Score é função pura de eventos públicos. Não há "reputação" pessoal
calculada de forma diferente em cada cliente.

**Regras:**
- Score é calculado pela mesma fórmula em todos os clientes Drift
- Peso de perfil é função pura de antiguidade + engajamento (eventos
  públicos), não opinião subjetiva
- Cliente oficial expõe a fórmula; clientes alternativos podem usar
  outra mas perdem interoperabilidade de ranking

**Implementação:** `calculateScore`, `calculateWeight` em
`scoring.ts` / `weight.ts`. Ver arquitetura §8 e §9.

### 23. Bury Não é Punição

Enterro é julgamento estético, não ético. Posts ruins descem;
autores não são punidos.

**Regras:**
- Bury reduz o score do post (peso 0.3x do spread)
- Bury **não** reduz engajamento do autor
- Bury não notifica o autor (sem tag `p`)
- Bury não tem `reason` — não precisa de justificativa
- Posts enterrados descem por gravidade, não somem abruptamente

**Implementação:** `persistBury` em `events.ts` — sem chamada a
`updateEngagement`. Ver arquitetura §8.

### 24. Sem Algoritmo Personalizado de Feed

Ranking é determinístico e público. Sem feed "para você", sem bolha,
sem afinidade automática.

**Regras:**
- Ordem do feed é função pura: `score = (spreads − buries × 0.3) /
  (idade + 2)^1.5`, depois `created_at` desc, depois `id` asc
- Qualquer cliente Drift mostra a mesma ordem global
- Não há scoring personalizado por usuário
- Bloquear / silenciar / seguir são camada de filtragem **local** na
  visualização, não de ranking
- O usuário pode escolher categorias para filtrar; a ordenação
  dentro da categoria continua determinística

**Por que essa regra dura existe:**
Afinidade no feed é o que cria bolha. Se o app começa a
"personalizar" o que você vê com base em quem você seguiu ou no que
você espalhou, estamos construindo o mesmo algoritmo central que o
Drift se propõe a substituir — só que rodando localmente em vez de
num servidor da Meta. O resultado social é idêntico: bolhas,
manipulação, captura.

**Implementação:** `scoring.ts` é função pura sem inputs do user
individual. `feed.ts` query é genérica e idêntica entre users.

### 25. Sem Scan Automático Obrigatório de Conteúdo (Sem Chave Mestra Disfarçada)

O **protocolo Drift não obriga scan automático**. O **cliente
oficial padrão não embute scan automático ligado por default**.
Qualquer scanner externo embutido e ligado por default é uma chave
mestra disfarçada (§17): o operador do scanner (Microsoft, Cloudflare,
NCMEC, ou modelo treinado por alguém) passa a decidir o que pode
passar — vetor de censura inaceitável independente da boa-fé do
fundador.

**Regras (cliente oficial padrão):**
- Sem PhotoDNA, sem CSAI Match, sem Cloudflare CSAM Tool — embutidos
  e ligados por default
- Sem modelos ML locais de moderação ligados por default
- Sem blocklists/safelists embutidas que filtrem antes do user ver
- Sem "heurísticas anti-spam" automáticas pré-render
- O cliente oficial padrão **publica o que o user pediu pra publicar**,
  e **mostra o que chegou pelos relays**, sujeito apenas a:
  - assinatura criptográfica válida (§5)
  - schema válido (§9)
  - moderação reativa pela comunidade (§26)
  - auto-classificação voluntária do autor + filtros locais opt-in
    do leitor (§27)

**Regras (compatibilidade com plugins / clientes alternativos):**
- Plugin opt-in de scan (PhotoDNA, classificador NSFW local, etc.)
  pode existir, sempre **OFF por default**, com consent explícito do
  user pra ligar e desligar a qualquer momento
- Plugin não pode ser carregado sem ação do user; não pode ser
  imposto via auto-update ou config remota
- Clientes alternativos Drift podem implementar políticas próprias
  (mais permissivas ou mais restritivas) — direito deles, manifesto
  §32 (Compatibilidade entre Clientes Drift)
- Em qualquer caso, o protocolo Nostr subjacente NÃO é alterado
  — eventos publicados são os mesmos; clientes diferem só em o que
  exibem ao user

**Por quê a distinção "obrigatório" vs "opt-in":**
- "Obrigatório embutido" = chave mestra. Operador do scanner
  decide o que passa, falso positivo plausível, vetor de censura.
- "Opt-in pelo user" = agência do user. User escolhe a ferramenta,
  user escolhe quando ligar/desligar, scanner é local.
- Drift recusa o primeiro. Tolera (sem encorajar) o segundo, e só
  como plugin / cliente alternativo, nunca como default do oficial.

**Implementação:**
- `lib/csam.ts` no cliente oficial padrão: **não existe** no MVP
  nem na Fase 3. Pode existir como plugin opt-in OFF-by-default em
  fase posterior, com decisão registrada em §30 da arquitetura.
- Upload de imagem em `lib/upload.ts` — só faz upload pro nostr.build
  (ou IPFS na Fase 6), sem inspeção de conteúdo
- `passesSchemaCheck` em `events.ts` valida formato, não conteúdo

**O que o Drift faz no lugar:** §26 e §27.

### 26. Moderação Comunitária Reativa

> "A rede não tem juiz. Tem peso — e o peso é distribuído."

Conteúdo problemático é moderado pela comunidade, não pelo cliente.
Reports são eventos públicos assinados; threshold dinâmico decide
quando esconder do feed default.

**Regras:**
- Reports são eventos kind 9081, públicos, assinados
- `reason` no report é uma das categorias: `illegal`, `nsfw-unmarked`,
  `spam`, `harassment`, `other`
- Threshold de remoção é função do tamanho da base ativa
  (`getReportThreshold`)
- Pesos de report seguem o peso do reporter (§9 do arquitetura) —
  anti-sybil
- Quando threshold é atingido, post recebe `score = -999` no SQLite
  local — some do feed default
- O evento continua nos relays e no SQLite local — `score = -999` é
  flag local, não delete
- Cliente alternativo pode exibir conteúdo que o oficial esconde —
  isto é feature, não bug
- Categoria `illegal` aciona threshold mais agressivo (menos reports
  necessários) — comunidade defende a si mesma de conteúdo crime
- O fundador não decide o que é removido — a comunidade decide pelo
  volume de reports válidos

**O que reports não fazem:**
- Não notificam o autor (manifesto §23 — bury não é punição; report
  é mais sério, mas o fluxo é processar e esconder, não punir
  individualmente fora da fórmula de peso)
- Não removem da rede — Drift não tem capacidade técnica de fazer
  isso (§17)
- Não censuram retroativamente histórico do reporter

**Implementação:** `processReport` em `events.ts` (Fase 4),
`getReportThreshold` em `moderation.ts`, `getReportWeight` em
`moderation.ts`. Ver arquitetura §10.

### 27. Auto-Classificação Voluntária + Filtros Locais

O autor pode marcar o próprio post com tags de aviso de conteúdo.
O leitor pode configurar localmente quais tipos quer ver, quais
quer ver com blur, e quais quer esconder.

**Regras:**
- Tag opcional `content-warning` no POST com valores enumerados:
  `nsfw`, `violence`, `spoiler`, `ad`, ou string livre
- Cliente oficial respeita marcações: posts com `nsfw` ficam blurred
  por default no feed
- Settings local controla preferências: "mostrar NSFW por default
  off/on", "esconder spoilers off/on", "esconder ads off/on"
- Marcações são honestidade do autor — não há verificação automática
- Não-marcar conteúdo NSFW pode ser reportado como `nsfw-unmarked`
  (§26) — a comunidade reforça
- Filtros locais são camada de visualização, não afetam score nem
  ranking global (§24 mantido)

**Por quê marcação voluntária e não scan:**
- Respeita o princípio §17: cliente não decide automaticamente o
  que é o quê
- Coloca a responsabilidade no autor — quem postou sabe se é NSFW
- Cria um sinal honesto que a comunidade pode reforçar via report
  quando alguém burla
- Não dá poder a operador externo (Microsoft, Cloudflare, modelo de
  IA) sobre o que o cliente oficial mostra

**Implementação:**
- Schema: tag `content-warning` opcional no kind 9078
- UI de criação: checkbox "marcar como NSFW", "marcar como spoiler"
- `feed.ts`: aplica blur/hide no momento da renderização baseado em
  preferências locais — query do SQLite continua igual (determinismo)
- Settings: toggles em `user_prefs`

---

## VI. PRIVACIDADE E COMPATIBILIDADE

### 28. Privacidade Pelo Mínimo

O sistema coleta o mínimo de metadata possível.

**Regras:**
- Sem rastreamento de uso, sem analytics centralizados
- Tag `location` é OFF por default; se ligada, granularidade é
  escolha explícita (país / cidade / GPS)
- Sem login com email/telefone — só nsec
- Sem servidor central que possa correlacionar dados
- Em modo paranoia (cliente nativo), tráfego pra relays é via Tor —
  IP do user não vaza pro operador de relay

**Implementação:**
- Sem analytics (MVP, hoje)
- Location off por default (Fase 3)
- Tor no cliente nativo (Fase 6)

### 29. Privacidade Opcional para Conteúdo

Conteúdo pode ser cifrado ponta-a-ponta sem comprometer a
arquitetura aberta do feed público.

**Regras:**
- DMs (mensagens privadas) são opcionais; se entrarem, usam
  NIP-04/44 padrão Nostr (criptografia end-to-end)
- Feed público continua público — não vai virar uma camada
  criptografada
- Identidade é a mesma; cifragem é só do conteúdo
- DMs não estão no MVP; entram em fase futura como feature aditiva

**Implementação:** Roadmap, sem data fixada — entra quando fizer
sentido sem comprometer simplicidade do MVP.

### 30. Compatibilidade com Ecossistema Nostr

O Drift é cidadão do ecossistema Nostr. Não pode poluir, não pode
quebrar interoperabilidade.

**Regras:**
- Identidades Drift são identidades Nostr — funcionam em Damus,
  Snort, Coracle, Iris e qualquer outro cliente Nostr
- Eventos Drift usam kinds próprios (9078..9081) que não colidem com
  NIPs existentes
- Tag `drift-version` distingue eventos Drift de outros eventos no
  mesmo kind
- Cliente Drift só sobrescreve campos que entende; ignora o resto
- Cliente Drift não tenta exigir features de relay que não são
  padrão Nostr (relay público gratuito tem que servir Drift sem
  configuração especial)

**Implementação:**
- Kinds 9078..9081 escolhidos por análise de colisão (arquitetura §30.6)
- `passesSchemaCheck` exige tag `drift-version`
- Cliente Drift respeita NIP-01 (eventos básicos) sem extensões

### 31. Compatibilidade entre Versões Drift

O protocolo evolui sem fragmentar a rede.

**Regras:**
- Tag `drift-version` em todo POST sinaliza schema
- Bumps de versão preservam compatibilidade leitora — clientes
  velhos ignoram tags novas, não quebram
- Mudanças incompatíveis (raras) ganham kind novo, não quebram o antigo
- Decisões de mudança ficam registradas em `drift-arquitetura-v4.md` §30
- Cliente oficial mantém suporte a versão anterior por no mínimo
  6 meses após bump

**Implementação:** Tag `drift-version` validada em
`passesSchemaCheck`. Decisões em arquitetura §30.

### 32. Compatibilidade entre Clientes Drift

Forks e clientes alternativos do Drift são bem-vindos. O protocolo
não privilegia nenhum cliente.

**Regras:**
- Especificação Drift é documento público versionado
  (`Docs/drift-arquitetura-v4.md` + este manifesto)
- Qualquer um pode implementar um cliente Drift que lê e escreve
  os mesmos eventos
- Cliente oficial não tem capacidade de "expulsar" cliente
  alternativo dos relays
- Cliente oficial não inventa kinds privados que só ele entende —
  toda extensão é proposta como bump de `drift-version`

**Implementação:** Documentação pública desde o primeiro release.
Licença MIT no código.

### 33. Anti-Spam Pela Mecânica Social

Spam é mitigado por mecanismos sociais (bury, reports) e por
limites locais. Proof-of-Work não é obrigatório.

**Regras:**
- Buries reduzem score — spam afunda no feed
- Reports + threshold removem spam coordenado do feed
- Limite de subposts cresce com peso (anti-conta-nova-spammando)
- PoW (NIP-13) é opt-in pra relays exigentes; não é invariante Drift
- Em modo paranoia (anti-flooding), cliente oficial pode rate-limitar
  posts próprios — proteção do user, não do feed

**Por que PoW não é obrigatório:**
Em browser, PoW pesa mais no usuário honesto que em botnets com
hardware sobrando. A mecânica social do Drift (algoritmo humano +
score determinístico) é a defesa primária contra spam.

### 34. Simplicidade Operacional

O sistema é compreensível e previsível.

**Regras:**
- Regras explícitas vencem comportamento implícito
- Pipeline de eventos é debugável localmente
- Mesma entrada → mesma saída — bugs são reproduzíveis
- Documentação acompanha o código (CLAUDE.md, drift-arquitetura-v4.md, este)
- Quando houver dúvida entre solução elegante e solução simples, vence
  a simples (princípio operacional do projeto)

**Implementação:** Estrutura de código em `src/lib/` com módulos de
responsabilidade única. Invariantes documentadas em CLAUDE.md.

---

## ESTRUTURA CONCEITUAL

```
Identidade (nsec1 — usuário)
    ↓ assina
Eventos (Nostr — imutáveis, públicos, sem scan automático)
    ↓ trafegam por
Múltiplos transportes (WSS / Tor / WebRTC / sneakernet)
    ↓ chegam a
Múltiplos relays (público / .onion / self-hosted)
    ↓ validados por
Pipeline determinístico (kind + schema + Schnorr)
    ↓ persistem em
Estado local (SQLite — derivado, reconstruível)
    ↓ ranqueado por
Score determinístico (função pura, igual em todos os clientes)
    ↓ moderado por
Reports comunitários + filtros locais opt-in
    ↓ exibido na
UI (lê do estado, não da rede)
```

Cada seta é função pura ou append-only. Nenhuma seta é negociável.
Nenhum scanner externo entra na cadeia.

---

## SÍNTESE — AS GARANTIAS DO DRIFT

O Drift é um sistema onde:

- **Identidades são auto-soberanas e portáveis** — pertencem aos
  usuários, sobrevivem a perda de device
- **Anonimato é por design** — sem KYC, sem login real-world,
  multi-identidade, Tor opcional
- **Eventos são imutáveis** — assinados, verificáveis, públicos,
  arquivados de forma distribuída
- **Estado é derivado** — qualquer cliente reconstrói a partir dos eventos
- **A rede é meio** — múltiplos transportes (WSS, Tor, WebRTC),
  múltiplos relays, intercambiáveis
- **Disponibilidade é garantida pela mecânica social** — quem
  espalha, seedeia
- **Nem o fundador censura** — não existe chave mestra, e nenhum
  scanner externo é chave mestra disfarçada
- **Bury é estética, não punição** — posts ruins descem, autores
  não somem
- **Score é determinístico** — sem algoritmo oculto, sem afinidade,
  sem bolha
- **Moderação é comunitária e reativa** — reports + threshold
  dinâmico, sem scan prévio
- **Anti-censura por país funciona** — múltiplos transportes,
  bootstrap distribuído, custo assimétrico para o adversário
- **Compatibilidade preservada** — com Nostr, entre versões Drift,
  entre clientes oficiais e alternativos

Quando a arquitetura conflitar com isso, a arquitetura cede.

---

## NOTA LEGAL E DE RESPONSABILIDADE

Drift é uma rede social descentralizada. O cliente oficial e o
protocolo são publicados sob licença MIT.

**Sobre conteúdo ilegal:**
- O Drift não escaneia conteúdo automaticamente. Usuários publicam
  o que querem; a comunidade modera reativamente via reports.
- Conteúdo ilegal (especialmente CSAM) reportado com `reason='illegal'`
  é tratado com threshold mais agressivo (§26) — comunidade defende
  a si mesma rapidamente.
- O cliente oficial **encoraja** denúncias a autoridades competentes
  quando o user encontra conteúdo crime. Isso é parte da UX de report
  (Fase 4) — botão "denunciar às autoridades" abre link pra canal
  oficial do país do user (NCMEC nos EUA, SaferNet no Brasil, etc.).
- Drift não impede tecnicamente publicação de conteúdo crime, da
  mesma forma que SMTP não impede emails crime, e a Internet não
  impede sites crime. A arquitetura é neutra; a moderação é social.

**Para mantenedores de relays:** operadores de relay têm
responsabilidades legais em suas jurisdições. Cliente oficial não
pode opinar — cada operador decide o que aceita. A arquitetura Drift
não exige que nenhum relay específico aceite tudo.

**Para o fundador:** o fundador publica código (MIT) e mantém o
cliente oficial. Não opera relays, não armazena conteúdo, não modera
globalmente. A pergunta "por que você não impede X?" tem resposta
arquitetural: porque impedir X criaria a chave mestra que permitiria
impedir Y, Z, W amanhã, e o Drift seria o que está tentando substituir.

---

## ROADMAP DE COMPROMISSOS

Para cada princípio, qual fase entrega:

| Princípio | MVP atual | Fase 3-4 | Fase 5 | Fase 6 |
|---|---|---|---|---|
| §1 Existência Autônoma | PWA | — | APK + F-Droid | Tauri desktop |
| §2 Auto-soberania | ✓ | — | — | — |
| §3 Identidade portável | ✓ | — | Multi-identidade | — |
| §4 Anonimato | ✓ (sem login) | Location off-default | Multi-identidade | Tor |
| §5 Autenticidade | ✓ | — | — | — |
| §6-10 Estado/determinismo | ✓ | — | — | — |
| §11 Rede como meio | ✓ | — | — | — |
| §12 Múltiplos transportes | WSS | — | NIP-65 | Tor + WebRTC |
| §13 Neutralidade transporte | ✓ | — | Export bundle | QR / sneakernet |
| §14 Bootstrap distribuído | Seed estático | — | UI relays + NIP-65 | Pref .onion |
| §15 Anti-censura por país | Parcial | — | APK + tutorial | Tor + run-your-own |
| §16 Disponibilidade | Cache local | Eviction respeita spreads | Re-broadcast | IPFS pin + WebRTC seed |
| §17 Resistência fundador | ✓ | — | — | Build reproduzível |
| §18 Cliente sem privilégios | ✓ | — | — | — |
| §19 Anti-captura | ✓ | — | — | — |
| §20 Resistência isolamento | 4 relays | — | Probe + relay aleatório | — |
| §21 Custo assimétrico | Parcial | — | + APK + relays user | + Tor + WebRTC + IPFS |
| §22-24 Score/Bury/Feed | ✓ | — | — | — |
| §25 Sem scan automático | ✓ (decisão registrada) | — | — | — |
| §26 Moderação comunitária | — | Reports + threshold básico | Threshold dinâmico + UX de denúncia | — |
| §27 Auto-classificação | — | Tag content-warning + filtros locais | — | — |
| §28 Privacidade mínima | ✓ | Location off | — | Tor |
| §29 Privacidade conteúdo | — | — | — | DMs (NIP-44) opcional |
| §30-32 Compatibilidade | ✓ | — | — | — |
| §33 Anti-spam social | Score + bury | + Reports | Threshold dinâmico | — |
| §34 Simplicidade | ✓ | — | — | — |

**Definições de fase:**
- **MVP (atual):** publicar/spread/bury via PWA, identidade portável, sem scan
- **Fase 3:** swipes Framer Motion, upload imagem (sem CSAM scan), tag content-warning, filtros locais, location off-default
- **Fase 4:** mapa, peso, moderação reativa (reports + threshold), onboarding, UX de denúncia a autoridades
- **Fase 5:** PWA polish, APK, F-Droid, NIP-65, multi-identidade, probe anti-eclipse, re-broadcast
- **Fase 6:** cliente desktop nativo (Tauri) com Tor e WebRTC, IPFS pin, run-your-own-relay, build reproduzível

**Compromisso:** Fase 6 não é "talvez". É "vai acontecer". Se em
algum momento o caminho técnico mostrar que algo da Fase 6 é
inviável como prometido, o manifesto é atualizado com bump de
versão e justificativa pública. Não cala, não promete e não entrega.

---

> "Um sistema que se reserva exceções já escolheu quem vai trair."

## HISTÓRICO

### v2.2 — Abril 2026

Refinamento do §25 — distinção entre "scan automático obrigatório"
(rejeitado) e "scan opt-in via plugin / cliente alternativo" (tolerado
sob restrições estritas):

- §25 reescrito: o que é proibido é embutir scanner ligado por
  default, não a existência de scanner como ferramenta opt-in
- Adicionada seção "Regras (compatibilidade com plugins / clientes
  alternativos)" — plugin opt-in OFF-by-default permitido se
  user-controlled e não-imposto
- `lib/csam.ts` deixou de ser "nunca existirá" para "não existe no
  cliente oficial padrão MVP/Fase 3; pode existir como plugin
  opt-in em fase posterior" — preserva o princípio (sem chave mestra
  disfarçada por default) sem absolutismo desnecessário
- Justificativa: outro cliente Drift pode legitimamente querer
  scanner; protocolo não pode obrigar e cliente oficial padrão não
  embute, mas a tecnologia em si pode existir como ferramenta do user

### v2.1 — Abril 2026

Decisão sobre moderação de conteúdo (substitui CSAM scan PhotoDNA):

- Removida menção a PhotoDNA / CSAM check pre-upload em §25
- Reescrito §25 como "Sem Scan Automático" — princípio explícito de
  recusa de scanners externos como chave mestra disfarçada
- Adicionado §26 "Moderação Comunitária Reativa" — formaliza reports
  + threshold dinâmico como única moderação
- Adicionado §27 "Auto-Classificação Voluntária + Filtros Locais" —
  tag `content-warning` no autor + filtros locais opt-in
- Adicionada "Nota Legal e de Responsabilidade" — explicita postura
  do fundador sobre conteúdo ilegal e responsabilidade de operadores
- Renumerado §26-32 (antiga numeração) → §28-34
- Roadmap atualizado: Fase 3 ganha tag content-warning + filtros
  locais; Fase 4 ganha UX de denúncia a autoridades

### v2.0 — Abril 2026

Reestruturação para refletir compromisso explícito (não é MVP, é
para valer):

- Adicionado §4 Anonimato por Design
- Adicionado §12 Múltiplos Transportes
- Adicionado §15 Anti-Censura por País
- Adicionado §16 Disponibilidade Distribuída
- Reescrito §14 Bootstrap Distribuído
- Reescrito §20 Resistência a Isolamento
- Adicionado §28 (agora §30) Compatibilidade com Ecossistema Nostr
- Adicionado §30 (agora §32) Compatibilidade entre Clientes Drift
- Reforço §10 — cliente NÃO deleta dados moderados
- Reforço §17 — build reproduzível
- Reforço §18 — boost pago (se vier) é evento público
- Adicionado roadmap de compromissos

### v1.0 — Abril 2026

Manifesto inicial consolidado a partir de §0 do
`drift-arquitetura-v4.md` + manifesto técnico v3 externo + decisões
em §30 da arquitetura.

---

*Drift — onde o conteúdo se espalha pelo comportamento humano, e
permanece acessível porque a comunidade carrega.*
