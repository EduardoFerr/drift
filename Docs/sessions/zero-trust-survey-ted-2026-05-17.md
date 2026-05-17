# Zero-Trust em Redes Descentralizadas — Survey de Casos Reais

**Autor:** Ted (persona arquitetura)
**Data:** 2026-05-17
**Contexto:** Complementar deliberação HIMYM 5/5 sobre Trust Lens. Insumo para decisões de Phase 2/3 (`Docs/plans/trust-lens-phase1-plan.md`).
**Escopo:** Mapear como sistemas descentralizados reais aplicam, ou tentam aplicar, zero-trust — e o que quebra em produção.

---

## 1. Executive summary

Cinco padrões que mais informam Trust Lens, em ordem de relevância:

1. **TOFU + cryptographic accountability** (Signal Safety Numbers, SSH, CT logs) — "trust on first use" funciona quando há mecanismo de detectar mudança depois. Trust Lens já tem isso: nsec é a chave, npub é a identidade, divergência observada no grafo é detectável. Aplicar.
2. **Capability-based > role-based** (Tahoe-LAFS) — opaque caps que carregam exatamente a autoridade necessária, nada além. Drift Trust Lens é leitor-local: capability é o `npub` que define o ponto-de-vista. Endossa o RFC.
3. **Pre-trusted seeds são inevitáveis no cold start, mas precisam ser substituíveis** (EigenTrust, Tor directory authorities, Bluesky PLC) — todo sistema "fully decentralized" tem âncora inicial. O que diferencia é se a âncora é hard-coded ou se o usuário pode trocar. Trust Lens deve permitir trocar o "ponto de origem" do walk (não só `self`).
4. **Social graph defenses (SybilGuard family) têm assumptions que quebram em redes públicas** — "fast-mixing social graph" e "limited attack edges" são frágeis em Nostr onde follow é zero-cost. PPR pessoal mitiga porque ranking é per-viewer, não global; um Sybil cluster só envenena quem follow ele.
5. **Centralização emergente é a falha mais comum** (Mastodon → mastodon.social, Nostr → damus relays, SSB → pubs, Bluesky → PLC directory). Federações tendem a power-law. Trust Lens é per-viewer e local; não tem catedral para colapsar.

**Bandeira vermelha para Phase 2:** evite qualquer feature que crie "trust catedral compartilhada" entre users (reputação global, share de scores, top-trust feed). Toda vez que isso foi tentado em sistema descentralizado, virou ponto de centralização ou vetor de gaming.

---

## 2. Sistemas analisados — tabela compacta

| Sistema | Zero-trust mechanism | Escala | Status | Lição central |
|---|---|---|---|---|
| **Tor** | Onion routing, 3-hop, 9 dir auths semi-confiáveis | ~7000 relays, 2M users | Production, sob ataque crônico | Dir authorities continuam single point of trust; 2024 attack via DDoS + IP spoof |
| **Signal Sealed Sender** | Server não sabe sender | ~100M users | Production | One-sided anonymity quebra em conversas (statistical disclosure ataca em <5 msgs) |
| **PGP / WoT** | Web of Trust manual, key signing parties | ~poucos milhares ativos | Falhou em escala | Usabilidade matou: 1/3 dos users em 90min nem encripta |
| **Matrix cross-signing** | SAS verification + master key | ~80M usuários, 100k servers | Production, com bugs sérios em 2022 | CVE-2022-39250: cross-signing confundia device IDs |
| **Nostr (atual)** | Signed events em relays burros | ~2M npubs | Production crescente | Relay discovery hardcoded → centralização de facto |
| **AT Protocol (Bluesky)** | DID + signed records, conta portável | ~30M users | Production | `did:plc` directory single-point-of-failure (mitigando via Swiss nonprofit 2026) |
| **Scuttlebutt** | Friend-of-friend gossip | ~poucos milhares ativos | Estagnado | Pubs viraram centralização; "download tudo dos amigos" não escala |
| **Holochain** | Agent-centric, no global ledger | Pre-beta | Não validado em produção | Agent-centric é elegante mas zero adoção prova nada |
| **Keybase** | Multi-proof identity (Twitter/GitHub/DNS) | ~milhões em pico | Zombie pós-Zoom | Acquihire matou desenvolvimento; "decentralized identity" centralizado num service falha quando service morre |
| **Tor Dir Authority** | 9-of-9 federation, majority required | 9 servers | Production crítico | "Equivocation attack" (Luo 2024): 1 dir auth comprometido pode entregar consensus malicioso a target específico |
| **Bitcoin P2P discovery** | "tried/new" address tables, peer churn | ~17k full nodes | Production | Eclipse attack (Heilman 2015) com poucos milhares de IPs; mitigations em v0.10.1+ |
| **IPFS** | Content addressing (CID = hash) | ~grande, números opacos | Production, com churn | Disponibilidade depende de pin ativo; GC come blocks não-pinned; CID não é IPNS, mudança quebra link |
| **Tahoe-LAFS** | Capability strings, POLA | Pequena (HRO Cloud) | Production em nicho | Modelo limpo, adoção restrita; UX assume sysadmin |
| **Certificate Transparency** | Append-only logs públicos auditáveis | TODO HTTPS desde 2018 | Production, mainstream | Funciona: post-mortem da DigiNotar/Symantec usou CT; mas log operator vira semi-trusted |
| **CONIKS** | Per-provider key directory auditável | Protótipo | Não-mainstream | Princípio sólido (>10 anos depois, ainda referência), zero deployment |
| **W3C DIDs/VCs** | Decentralized identifiers, signed creds | Enterprise nichos (Microsoft Entra, Dock) | Lento | Spec madura, adoção fraca; EU está empurrando contra em EUDI |

---

## 3. Deep dives — 7 sistemas relevantes para Drift

### 3.1 Signal Safety Numbers — TOFU bem feito

**Arquitetura:**
```
Alice ↔ Server (não-confiável) ↔ Bob
  └─ X3DH key agreement bootstrap
  └─ Double Ratchet steady-state
  └─ Safety Number = fn(Alice.identity_key, Bob.identity_key)
```

**Zero-trust mechanism:** server pode ser hostil; Alice e Bob detectam MITM via Safety Number out-of-band. Sealed Sender adiciona "server não sabe quem manda mensagem" mas com caveats sérios.

**Problemas reais:**
- **Per-user → per-conversation** (Signal 2017 redesign): 4 hex strings + 2 QR codes confundiam usuários. Mudaram para per-conversation com QR único.
- **Sealed Sender de-anon em ≤5 msgs**: delivery receipts + statistical disclosure attack quebra one-sided anonymity (Sane Security Guy + UMD/NDSS 2021).
- **Receiver key comprometida → de-anon retroativa**: chave estática de longo prazo é fragilidade fundamental.

**Lição para Drift:** Trust Lens deve mostrar mudanças no grafo do viewer (alguém que `self` segue mudou drasticamente seu follow set?). Isso é o equivalente Safety Number — TOFU + alarm on divergence. Nostr não tem isso hoje.

### 3.2 PGP Web of Trust — o aviso histórico

**Arquitetura:** chaves PGP assinadas por outras chaves PGP; níveis "marginal/full"; trust depth configurável.

**Por que falhou:**
- **Whitten & Tygar 1999** (Why Johnny Can't Encrypt): 12 participantes, 90min, PGP 5.0; só 1/3 conseguiu encriptar; 1/4 vazou o secret achando que tinha encriptado.
- **Ruoti et al. 2015** (Why Johnny Still Can't Encrypt, Mailvelope): 1 par em 10 conseguiu, em 1h. **16 anos depois**, mesmo problema.
- **Key signing parties** assumem geografia presencial; não escala globalmente.
- **Revogação é o problema mais difícil de WoT**: chave comprometida continua aparecendo válida via fanout social.

**Lição para Drift:** explicit user-driven trust modeling (Trust Lens manual com sliders) **vai fracassar** se exposto ao usuário comum. Trust Lens deve ser **implicit** (deriva do follow graph que user já tem). Não pedir ao user para configurar "trust level" de ninguém manualmente — isso é PGP de novo.

### 3.3 Tor Directory Authorities — single point of trust em sistema "trustless"

**Arquitetura:**
```
[9 hard-coded dir authorities] → consensus document (votado, hourly)
                                      ↓
                          [all clients trust majority]
                                      ↓
                          [list of valid relays + flags]
```

**Zero-trust claim:** "trust no single relay". Mas a meta-confiança (quais relays existem) está em 9 servidores hard-coded no source.

**Problemas reais:**
- **2021-01 DDoS**: dir auths offline; sem consensus, hidden services down por horas.
- **2024-10/11 IP spoof**: SYN packets forjados como vindos de Tor relays; abuse reports em cascata.
- **Luo et al. IEEE S&P 2024** (Attacking and Improving the Tor Directory Protocol): "equivocation attack" — 1 dir auth comprometido pode entregar consensus malicioso a target específico, indetectável pelo cliente.

**Lição para Drift:** **toda rede descentralizada tem âncora no cold start**. Drift tem `SEED_RELAY_CONFIGS`. A pergunta certa não é "como eliminar a âncora" mas "como permitir o usuário trocar". Trust Lens deve aceitar `viewpoint != self` para visualizações exploratórias ("e se eu fosse @alice, que feed eu veria?"). Isso normaliza o conceito de âncora trocável.

### 3.4 Scuttlebutt — friend-of-friend gossip que travou

**Arquitetura:** identidade = ed25519 pubkey, feed = append-only log assinado, sync = "give me feeds of people my friends follow" via gossip.

**Zero-trust mechanism:** você só replica feeds dentro do seu hops-limit (default 2). Nenhum servidor central decide o que você vê.

**Problemas reais:**
- **Pubs viraram centralização**: rehosting servers que mantêm rede online; comunidade reconhece risco mas depende deles.
- **Onboarding requer invite a pub ou peer**: cold start hostil. Manyverse migrou para "room servers" mais leves.
- **"Download tudo dos amigos" não escala**: storage cresce sem ceiling.
- **Comunidade estagnou** desde ~2022; muito do dev migrou para outras tecnologias.

**Lição para Drift:** o modelo "todo conteúdo dos meus amigos vem comigo" tem charme técnico (offline-first total) mas custo proibitivo em smartphones. Drift faz o oposto certo: cache local com eviction respeitando spreads, busca lazy. Trust Lens PPR deve seguir o mesmo princípio — não carregar grafo inteiro do mundo, só friends-of-friends até hops definido.

### 3.5 AT Protocol (Bluesky) — DID + PLC como caso de centralização planejada

**Arquitetura:**
```
DID (did:plc:xyz) ─── PLC directory ─── DID document (signing keys, PDS URL)
       ↓
   handle (@alice.bsky.social)  via DNS TXT verification
       ↓
   PDS (Personal Data Server) ─── signed records (posts, follows, likes)
```

**Zero-trust mechanism:** records são signed; cliente verifica. PDS pode trocar (account portability). Handle pode usar DNS próprio.

**Problemas reais:**
- **`did:plc` é single registry hosted by Bluesky** (até 2026): "probably the single most centralized and not easily replaceable element of the protocol" — fonte: atprotocol.dev.
- **Mitigation 2026**: transferindo para PLC Foundation (Swiss nonprofit), board independente. Mas ainda 1 entidade.
- **App view (timeline, search) é serviço fornecido por Bluesky**: protocol permite alternativas mas raríssimo em prática.

**Lição para Drift:** Bluesky está sendo explícito sobre onde está a centralização e tem roadmap para tirar. Drift deve ser igualmente explícito sobre `SEED_RELAY_CONFIGS` e onboarding default — manifesto §17/§18 são os equivalentes do PLC Foundation. Trust Lens herda: ranking é local (cliente faz PPR), não há "app view central que Drift Inc roda".

### 3.6 Keybase — multi-proof identity que morreu de aquisição

**Arquitetura:** usuário prova identidade em N redes (Twitter, GitHub, Reddit, DNS, HN); cada prova é tweet/post/file com assinatura PGP-style; rede mantém log de proofs.

**Zero-trust mechanism:** "don't trust Keybase; verify the proofs yourself in those networks". Belíssimo no papel.

**Problemas reais:**
- **Zoom acquisition 2020**: acquihire essencialmente; dev parou.
- **keybase.pub offline em março 2023**.
- **Mobile apps degradando** porque frameworks subjacentes não atualizam.
- **GitHub issue #24577 "KeyBase is DEAD"** documenta o desespero.

**Lição para Drift:** depender de service runs por uma empresa para "decentralized identity verification" é contradição. Trust Lens não pode delegar ranking a "drift-trust-service.com". O custo desse erro é tudo morrer junto com o app principal. Manter cálculo local é decisão estrutural correta.

### 3.7 Tahoe-LAFS — capability-based feito direito

**Arquitetura:**
```
storage grid (N storage servers, M-of-N erasure coded)
        ↑
caps: write-cap → read-cap → verify-cap (derivação one-way)
        ↑
client deriva caps localmente
```

**Zero-trust mechanism:** servers não veem plaintext. Quem tem write-cap modifica; read-cap lê; verify-cap só checa integridade. Você dá exatamente a capability que precisa.

**Adoção real:**
- **HRO Cloud** (Least Authority): human rights orgs em regimes hostis. Pequeno mas legítimo.
- **Tor adopted Tahoe-LAFS** para alguns workflows internos.
- **Não viralizou** porque UX assume sysadmin: configurar grid, gerenciar caps, fazer backup.

**Lição para Drift:** capability-based é exatamente o modelo certo para Trust Lens. O `npub` do viewer é a "capability" que abre uma view do grafo. Não há "admin trust dashboard"; cada viewer tem sua lente; capabilities não se compõem em poder global. Robustez moral: ninguém pode "ver o ranking de outra pessoa sem ser ela".

---

## 4. Cross-cutting patterns — tabela patterns × problemas

| Pattern | Onde aparece | Problema recorrente | Mitigation conhecida |
|---|---|---|---|
| **TOFU** | SSH, Signal, HSTS, Nostr npub | Primeiro contato comprometido = comprometido para sempre | Out-of-band verification (Safety Number), CT-style accountability |
| **Web of Trust** | PGP, GnuNet, Scuttlebutt | UX hostil, revogação intratável, rotation impossível | Substituir por implicit trust derivado de comportamento já natural (follow, interaction) |
| **Hierarchy with redundancy** | Tor dir auths (9), DNS root (13) | Captura de subset suficiente compromete tudo | Diversidade geográfica/jurisdicional + threshold criptográfico |
| **Content addressing** | IPFS, Git, DAT | Mutability hostil, GC come dados, link rot | IPNS-style mutable pointers; pinning explícito; archive social |
| **Cryptographic accountability** | CT, CONIKS, Sigstore | Auditoria post-fact ≠ prevenção | Combinar com pre-flight check (browser blocks if no SCT) |
| **Reputation systems** | EigenTrust, Stack Overflow karma | Gaming, Sybil colluding, pre-trusted seed problem | Personal/per-viewer ranking (PPR family); no global score |
| **Capability-based** | Tahoe-LAFS, Pony, object-cap OS | Adoption barrier (UX assumes sysadmin) | Embed in app, never expose raw cap to user |
| **Personal trust graph** | SSB, Drift Trust Lens (proposto) | Cold start brutal para novo user | Default a algum seed comportamental (e.g., quem manifesto autores follow) — opt-out |
| **Federation trust** | Mastodon, Matrix, email | Power-law collapse para poucas instâncias dominantes | Resistir a instance-level features que criam lock-in (custom emojis fixed pra Mastodon...) |
| **Sub-sampled voting** | Avalanche, Algorand VRF | Network partition adversarial | Repeated rounds, threshold escalation |

---

## 5. Problemas recorrentes — incident catalog

### 5.1 Centralização emergente
- **Mastodon → mastodon.social domina**: distribuição "Dirac delta function" (Rosenzweig). [Fonte](https://alyssarosenzweig.ca/blog/the-federation-fallacy.html)
- **Nostr default relay hardcoded**: Damus/Primal/Amethyst todos embarcam mesma lista de partida. [Leon Acosta](https://leonacosta.medium.com/nostr-is-centralizing-by-design-da67b8f53966)
- **SSB pubs**: aquisição pode lockear rede inteira. [SSB Handbook](https://handbook.scuttlebutt.nz/stories/design-challenge-avoid-centralization-and-singletons.html)
- **Bluesky PLC**: 1 directory, agora migrando. [atprotocol.dev](https://atprotocol.dev/bluesky-and-did-plc/)

### 5.2 Sybil real-world
- **Bitcoin eclipse**: Heilman 2015 USENIX, <5000 IPs eclipsam node; mitigations em Bitcoin Core v0.10.1+. [Paper](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-heilman.pdf)
- **Stack Overflow/Reddit karma farming**: reputation gaming clássico, sem solução técnica.
- **SybilGuard/SybilLimit limitations**: O(log n) sybils ainda passam; assume fast-mixing graph. [SybilLimit TR](https://www.comp.nus.edu.sg/~yuhf/sybillimit-tr.pdf)

### 5.3 UX failures
- **PGP Whitten 1999 + Ruoti 2015**: 16 anos, mesmo fracasso. [Whitten](https://people.eecs.berkeley.edu/~tygar/papers/Why_Johnny_Cant_Encrypt/USENIX.pdf), [Ruoti](https://ar5iv.labs.arxiv.org/html/1510.08555)
- **Signal Safety Numbers v1**: false positives/negatives em comparação humana; redesign per-conversation.

### 5.4 Cryptographic implementation bugs
- **Matrix 2022 CVE-2022-39250**: cross-signing confundia device-IDs com signing-keys; emoji verification quebrada. [Matrix advisory](https://matrix.org/blog/2022/09/28/upgrade-now-to-address-encryption-vulns-in-matrix-sdks-and-clients/)
- **Signal Sealed Sender Android injection**: malicioso server podia injetar mensagens. [eprint 2026/484](https://eprint.iacr.org/2026/484.pdf)
- **Tor equivocation attack 2024**: dir auth comprometido = consensus malicioso a target específico. [arXiv 2503.18345](https://arxiv.org/abs/2503.18345)

### 5.5 Service death of "decentralized" provider
- **Keybase pós-Zoom**: zombie state; keybase.pub offline 2023. [GitHub issue #24577](https://github.com/keybase/client/issues/24577)
- **Diaspora pods churn**: alta mortalidade de pods leva users a re-registrar.

### 5.6 Disponibilidade
- **IPFS garbage collection**: blocks não-pinned são apagados; "stops the world"; gateway re-requests slow. [docs.ipfs.tech](https://docs.ipfs.tech/concepts/persistence/), [Kubo #8870](https://github.com/ipfs/kubo/issues/8870)
- **Tor 2021-01 DDoS dir auths**: hidden services down por horas.

### 5.7 Revogação / rotation
- **PGP key rotation** continua sendo dor. Compromised keys ficam circulando em keyservers.
- **Nostr `nsec` rotation**: protocol não tem nativo; user perde histórico ou continua com chave possivelmente comprometida.

---

## 6. Aplicação ao Drift Trust Lens

### 6.1 Patterns que endossam o RFC do Ted

- **Capability-based + personal trust graph + content addressing**: Trust Lens = capability (viewer npub) × content (eventos signed Nostr). Tahoe-LAFS confirma que esse triplet funciona, mesmo que adoção mainstream nunca tenha vindo.
- **PPR per-viewer evita "trust catedral"**: Mastodon/Bluesky/Nostr mostram que centralização emergente é o fracasso #1; ranking local elimina o vetor.
- **Implicit signal sobre explicit configuration**: PGP morreu de UX manual; Trust Lens deriva de follows naturais. Aposta certa.
- **Determinism + manifesto §7**: PPR puro (mesma entrada → mesma saída) é o que permite test em Vitest e impossibilita a chave-mestra disfarçada (§25). Importante manter.

### 6.2 Patterns que sugerem mudanças

- **Não dar trust score visível ao usuário no Phase 1**: Stack Overflow karma e EigenTrust gaming mostram que scores expostos viram alvos. Phase 1 deve usar PPR só como **ordering interno** do feed "Seguindo" e talvez **filtro de spam**. Sem badge "trust: 0.87" no perfil. Reavaliar em Phase 3.
- **Permitir trocar viewpoint** (não só `self`): aprendendo com Tor dir authorities, normalize a âncora-substituível. Even Phase 1 pode ter um debug switch "view as @other_npub" — útil para o user entender que Trust Lens é uma lente, não verdade.
- **Detectar mudanças bruscas no grafo do viewer** (TOFU + accountability, ao estilo Safety Number): se `self` follow set muda 40% em 24h, é evento sinalizável (compromised account?). Phase 2 candidate.
- **Cold start**: novo user com 0 follows tem PPR vazio. Mitigations possíveis na ordem de preferência:
  1. Default feed = global ranking (já implementado pré-Trust-Lens).
  2. Onboarding sugere seguir manifesto authors / contributors (opt-in, visível).
  3. NÃO importar "trust default list" de servidor central — viola §17.

### 6.3 Bandeiras para Phase 2/3

- **NÃO compartilhar PPR scores entre users.** Tentação clássica: "achei que @alice tem trust 0.9 para mim; deixa eu publicar isso para outros se beneficiarem". Isso vira EigenTrust, vira gaming, vira catedral. Manifesto §22 (sem reputação subjetiva).
- **NÃO usar PPR para moderation ações destrutivas.** Score baixo nunca deve resultar em `score = -999` automático (isso é prerrogativa de §26 reports + threshold dinâmico). PPR só ordena/filtra view local.
- **CUIDADO com "trust your friends' trust"** (transitive 2+ hops com peso alto): SybilGuard/SybilLimit mostram que assumption "few attack edges" quebra em redes públicas. Cap hops em 2-3 com decay forte.
- **PERFORMANCE**: SSB caiu em parte porque "download tudo dos amigos" não escalou. PPR sobre grafo Nostr precisa ser lazy + cached, não rebuilt full a cada feed query. Provavelmente queue worker assíncrono, store em SQLite, recalcular debounced.
- **MIGRATION across nsecs**: se Trust Lens cache está vinculado a `active_identity`, switching identidade deve nukar cache (já é forced reload — bom).

### 6.4 Phase 3 candidatos (não Phase 2)

- **Trust Lens explorável** (view as alt npub): valor pedagógico + ferramenta debug.
- **Signal-style change alarm** ("seu grafo de trust mudou bruscamente"): defesa contra account compromise.
- **Sharing trust hints offline com peers conhecidos** (sneakernet/BLE em Fase 7): manter local-first mas permitir "tenho um cache de PPR que posso compartilhar com você manualmente". Cuidado: isso flerta com a catedral; só faz sentido se for opt-in explícito e per-peer.

---

## 7. Recommendations (3-5 actionables)

1. **Adotar capability-based mental model explicitamente no design doc.** Trust Lens é "viewer npub × event graph → ordering". O `npub` ATIVO é a capability. Documentar em RFC: nenhuma view escapa dessa restrição.
2. **Cold start: default = global feed, com sugestões de seguir explícitas e opt-in.** Sem importar trust default. Sem ranking implícito antes do user fazer ≥ N follows (suggestion: N=5).
3. **Cap hops em 2 para Phase 1, com decay alpha=0.85 estilo PageRank original** (já no RFC). Não dar bypass para "trust paths longos com peso alto" — abre porta para SybilGuard-style ataques.
4. **Não expor scores numéricos.** Phase 1 usa só ordering interno. Discussão pública de "trust 0.87" fica para depois de pelo menos 1 trimestre em produção observando comportamento real.
5. **Test de conformance bloqueando "score sharing"**: criar `tests/trust-lens-locality.test.ts` que falha se função PPR escapar do client (e.g., import em `sync.ts`, publish em event tag, etc.). LOCK_VIA_TEST consistente com §17/§22/§25.

---

## 8. Sources

### Tor
- [Tor Project blog — directory authority attack](https://blog.torproject.org/tor-security-advisory-relay-early-traffic-confirmation-attack/)
- [Attacking and Improving the Tor Directory Protocol (Luo 2024)](https://arxiv.org/abs/2503.18345)
- [Tor IP spoofing attack 2024](https://www.securityweek.com/ip-spoofing-attack-tried-to-disrupt-tor-network/)
- [Thirteen Years of Tor Attacks (catalog)](https://github.com/Attacks-on-Tor/Attacks-on-Tor)

### Signal
- [Sealed Sender blog](https://signal.org/blog/sealed-sender/)
- [Improving Signal's Sealed Sender (NDSS 2021)](https://www.ndss-symposium.org/ndss-paper/improving-signals-sealed-sender/)
- [No safety in numbers (arXiv 2305.09799)](https://arxiv.org/abs/2305.09799)
- [Signal Lost (Integrity) — eprint 2026/484](https://eprint.iacr.org/2026/484.pdf)
- [Signal Safety number updates blog](https://signal.org/blog/safety-number-updates/)
- [Sane Security Guy — Signal de-anon](https://sanesecurityguy.com/articles/signal-knows-who-youre-talking-to/)

### PGP / WoT
- [Whitten & Tygar — Why Johnny Can't Encrypt (USENIX 1999)](https://people.eecs.berkeley.edu/~tygar/papers/Why_Johnny_Cant_Encrypt/USENIX.pdf)
- [Ruoti et al. — Why Johnny Still, Still Can't Encrypt (arXiv 1510.08555)](https://arxiv.org/abs/1510.08555)

### Matrix
- [Matrix encryption vulnerabilities 2022 advisory](https://matrix.org/blog/2022/09/28/upgrade-now-to-address-encryption-vulns-in-matrix-sdks-and-clients/)
- [Practically-exploitable Cryptographic Vulnerabilities in Matrix (eprint 2023/485)](https://eprint.iacr.org/2023/485.pdf)

### Mastodon / Federation
- [Rosenzweig — The Federation Fallacy](https://alyssarosenzweig.ca/blog/the-federation-fallacy.html)
- [Fediverse in Numbers 2026](https://fediview.com/articles/fediverse-in-numbers-mastodon-stats-2026/)

### AT Protocol / Bluesky
- [Bluesky and DID PLC critique](https://atprotocol.dev/bluesky-and-did-plc/)
- [How decentralized is Bluesky really (Dustycloud)](https://dustycloud.org/blog/how-decentralized-is-bluesky/)
- [PLC Directory Organization announcement](https://docs.bsky.app/blog/plc-directory-org)
- [Bluesky and the AT Protocol (arXiv 2402.03239)](https://arxiv.org/html/2402.03239v2)

### Scuttlebutt
- [SSB Design Challenge: Avoid Centralization](https://handbook.scuttlebutt.nz/stories/design-challenge-avoid-centralization-and-singletons.html)
- [Cheapskate's Guide — Initial Exploration of SSB](https://cheapskatesguide.org/articles/secure-scuttlebutt.html)

### Nostr
- [Leon Acosta — Nostr Is Centralizing By Design](https://leonacosta.medium.com/nostr-is-centralizing-by-design-da67b8f53966)

### Keybase
- [GitHub issue #24577 "KeyBase is DEAD"](https://github.com/keybase/client/issues/24577)
- [Decrypt — Keybase users revolt](https://decrypt.co/28121/keybase-users-revolt-following-zoom-acquisition)
- [SCHULZ:DK — Cryptographic Zombie](https://schulz.dk/2026/04/06/the-cryptographic-zombie-how-keybase-went-from-privacy-darling-to-zooms-cleanup-crew/)

### IPFS / Tahoe-LAFS
- [IPFS persistence concepts](https://docs.ipfs.tech/concepts/persistence/)
- [IPFS GC awareness (Kubo #8870)](https://github.com/ipfs/kubo/issues/8870)
- [Tahoe-LAFS FAQ](https://tahoe-lafs.org/trac/tahoe-lafs/wiki/FAQ)
- [Tahoe-LAFS capabilities](https://tahoe-lafs.org/trac/tahoe-lafs/wiki/Capabilities)
- [HRO Cloud / Least Authority](https://leastauthority.com/community-matters/)

### Bitcoin / Sybil / Eclipse
- [Heilman et al. — Eclipse Attacks on Bitcoin (USENIX 2015)](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-heilman.pdf)
- [Sybil attack — Wikipedia](https://en.wikipedia.org/wiki/Sybil_attack)
- [EigenTrust paper (Kamvar/Schlosser/Garcia-Molina)](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- [SybilLimit TR (NUS)](https://www.comp.nus.edu.sg/~yuhf/sybillimit-tr.pdf)
- [Hoffman et al. — Survey of Attacks on Reputation Systems](https://cnitarot.github.io/papers/p2p-reputation-survey.pdf)

### Certificate Transparency / CONIKS / DID
- [Educated Guesswork — CT in Reality](https://educatedguesswork.org/posts/transparency-part-2/)
- [Let's Encrypt CT logs docs](https://letsencrypt.org/docs/ct-logs/)
- [CONIKS USENIX 2015 paper](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-melara.pdf)
- [W3C DID v1.1 spec](https://www.w3.org/TR/did-1.1/)
- [W3C DID WG minutes 2025-10-16](https://www.w3.org/2025/10/16-did-minutes.html)

### Holochain
- [Holochain whitepaper (alpha)](https://www.holochain.org/documents/holochain-white-paper-alpha.pdf)
- [Holochain agent-centric review 2025 (DeFi Planet)](https://defi-planet.medium.com/can-holochain-replace-traditional-blockchains-reviewing-its-agent-centric-approach-in-2025-bf48fd9f6483)

### Bootstrap / Cold start
- [Bootstrapping Web of Trust (0xIntuition)](https://medium.com/0xintuition/bootstrapping-the-web-of-trust-d9dbaff12335)
- [Bootstrapping Trust in Distributed Systems (Princeton)](https://www.cs.princeton.edu/~mfreed/docs/blockstack-login16.pdf)

---

*Documento de sessão — não-vinculante, insumo para decisões de Phase 2/3 do Trust Lens. Persona Ted (arquitetura, padrões, camadas, abstrações).*
