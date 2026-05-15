# Manifesto Drift — Coverage Matrix

**Versão analisada**: Manifesto v2.2 (Abril 2026) — 34 princípios
**Data da auditoria**: 2026-05-15
**Auditor**: Robin (research/docs) — análise estruturada
**Versão do projeto**: `0.6.0-alpha.4`
**Tests Vitest**: 980 (+6 todo, 74 files)

> Este documento é a **fonte única de verdade** sobre o status atual de
> entrega dos 34 princípios do manifesto. Substitui o status espalhado
> em `CLAUDE.md` (que agora aponta pra cá). Atualizar sempre que uma
> fase fechar ou um princípio mudar de status.

---

## Sumário

| Status | Contagem | % |
|---|---:|---:|
| ✅ Entregue | 22 | 64.7% |
| 🟡 Parcial | 9 | 26.5% |
| ⛔ Não-entregue | 0 | 0.0% |
| ⏳ Próxima fase | 3 | 8.8% |
| **Total** | **34** | **100%** |

**Barra de progresso (entregue + parcial / total):**

```
[████████████████████████████████░░░░] 91.2% (31/34)  ← inclui 🟡
[██████████████████████░░░░░░░░░░░░░░] 64.7% (22/34)  ← só ✅
```

**Legenda**:
- ✅ **Entregue**: implementação visível + cobertura de teste (ou evidência operacional forte). Cumpre o princípio em prod hoje.
- 🟡 **Parcial**: parte do princípio cumprido; gaps específicos listados na coluna `Gap`. Geralmente "PWA cumpre, falta cliente nativo" ou "feature shipped pra source-builders, falta distribuição binária".
- ⛔ **Não-entregue**: não há implementação. (Nenhum hoje.)
- ⏳ **Próxima fase**: planejado em Fase 7 com plano técnico definido; sem implementação ainda mas roadmap vinculante (§ROADMAP do manifesto).

---

## Matriz por princípio

### I. Existência e Identidade (§1-5)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §1 | Existência Autônoma — sem servidor obrigatório, múltiplas formas de instalação | 🟡 | PWA estática deployada (Vercel + `dist.zip` GitHub Releases); Tauri scaffold em `src-tauri/Cargo.toml`; TWA Bubblewrap CI em `scripts/bubblewrap-driver.sh` + `.github/workflows/twa.yml` | F-Droid manifest (Fase 7.2) pendente. APK universal sem store ainda não documentado como release artifact estável. |
| §2 | Identidade Auto-Soberana — secp256k1, sem autoridade emissora | ✅ | `src/lib/identity.ts:56` `getOrCreateIdentity` (nsec local, secp256k1 via `nostr-tools/pure`); `tests/no-master-key.test.ts` valida ausência de funções admin | — |
| §3 | Identidade portável; dispositivo descartável | ✅ | `src/lib/identity.ts:124` `exportIdentity`, `:139` `setIdentityFromNsec`; `src/lib/sync.ts` `rebuildIdentityHistory`; `tests/identity-backup.test.ts`; commit Fase 2.5 fechada | — |
| §4 | Anonimato por Design — sem KYC, multi-identidade, location opt-in, Tor opcional | 🟡 | Sem login ✅; multi-id ✅ em `src/lib/identities.ts:188` `setActiveIdentity` + `tests/identities.test.ts`; location off-default ✅ em `src/lib/geolocation.ts` + `tests/geolocation.test.ts`; `tests/no-telemetry.test.ts` valida zero telemetria/analytics; Tor 🟢 só em build Tauri `--features arti` (`src-tauri/src/tor.rs` + `src/lib/transport/tor.ts`) | Distribuição binária Tauri pra usuário final exigida; PWA browser não tem Tor (limitação física do runtime). Manifesto reconhece em §15. |
| §5 | Autenticidade Criptográfica — Schnorr verify antes de persistir | ✅ | `src/lib/nostr.ts` `verifyDriftEvent`; `src/lib/events.ts:134` chama verify ANTES de persistir; `tests/conformance-events-gate.test.ts` (pipeline gate) | — |

### II. Estado e Determinismo (§6-10)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §6 | Verdade por Eventos — append-only, SQLite é cache | ✅ | `src/lib/events.ts:onNostrEvent` é única porta de INSERT em domínio (CLAUDE.md invariante #1); `tests/events.lastActionWins.test.ts`; eventos sempre `INSERT OR IGNORE` | — |
| §7 | Determinismo Global — funções puras, mesma entrada→mesma saída | ✅ | `src/lib/scoring.ts:46` `calculateScore` (pura, recebe `now` por param); `tests/scoring.test.ts` + `tests/weight.test.ts` + `tests/moderation.test.ts` + `tests/bip39.test.ts` + `tests/nip65.test.ts` + `tests/applyContentFilters.test.ts` cobrem todas as funções puras críticas | — |
| §8 | Ordenação Determinística — `created_at` + `id` lex tie-break | ✅ | Queries em `feed.ts` usam `ORDER BY score DESC, created_at DESC, id ASC`; `INSERT OR IGNORE` para idempotência; `tests/events.lastActionWins.test.ts` valida tie-break `kind` ASC pra empate exato | — |
| §9 | Validação Determinística — schema + Schnorr + regras puras | ✅ | `src/lib/events.ts:157` `passesSchemaCheck`; `tests/schemaCheck.test.ts` + `tests/manifesto-conformance.test.ts` | — |
| §10 | Persistência Local — SQLite WASM + OPFS, cliente nunca deleta moderado | ✅ | `src/lib/db.worker.ts` (worker exclusivo); `src/lib/db.ts` interface; `kvvfs` fallback (Fase 5); score = -999 esconde mas não deleta — confirmado em `src/lib/moderation.ts:maybeModerate` | — |

### III. Rede, Transporte e Disponibilidade (§11-16)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §11 | Rede como meio — verify por assinatura, não origem | ✅ | `src/lib/sync.ts` `pool.subscribeMany`; verify roda antes de persistir (§5) | — |
| §12 | Múltiplos Transportes — WSS, Tor, WebRTC | 🟡 | WSS ✅ (`src/lib/transport/wss.ts`); WebRTC ✅ (12 arquivos em `src/lib/transport/webrtc/` + orchestrator + tests T1-T4); Tor ✅ em Tauri `--features arti` (`src-tauri/src/tor.rs` + `src/lib/transport/tor.ts`). Smoke e2e VERIFIED 2026-05-01 (`Docs/sessions/sprint7-smoke-2026-05-01.md`) | Tor inacessível pra usuário PWA browser (runtime limit, esperado). Distribuição binária Tauri pra desktop end-user via `v0.6.0-alpha.3` em Releases mas adoção depende de download. Sneakernet (§13) pendente Fase 7. |
| §13 | Neutralidade de transporte — eventos não dependem do meio | 🟡 | Eventos Nostr puros (NIP-01); transport interface abstrata em `src/lib/transport/index.ts` (`publish/subscribe/health`); orchestrator dedup natural via `INSERT OR IGNORE` | Export/import bundle JSON ou QR (sneakernet) ⏳ Fase 7. Não há `lib/bundle-export.ts` ainda. |
| §14 | Bootstrap Distribuído — seed list + NIP-65 + user-defined | 🟡 | `src/config/relays.ts` seed list (4 relays); `src/lib/relays.ts` dynamic CRUD + `relays_user` SQLite table; NIP-65 publish/parse ✅ em `src/lib/nip65.ts` + `tests/nip65.test.ts`; UI Settings de relays shipped Fase 5 | Preferência `.onion` sobre clearnet existe em `network_mode=tor`, mas requer cliente nativo. Tutorial "run-your-own-relay" ✅ em `Docs/run-your-own-relay.md`. |
| §15 | Anti-Censura por País — múltiplos transportes + bootstrap + custo assimétrico | 🟡 | Tor real shipped em Tauri (`v0.6.0-alpha.3` + smoke VERIFIED 2026-05-01 — `Docs/fase-6-roadmap.md`); WebRTC P2P + path diversity (`src/lib/peerRegistry.ts`, `src/lib/peerScore.ts`); multi-bootstrap 4 relays; documentação pública pendente | Doc público "como instalar Drift em país censurado" não publicado ainda. Em PWA-only, §15 NÃO é cumprido — só pra source-builders + binários Tauri Releases. Aceito em arquitetura. |
| §16 | Disponibilidade Distribuída — espalhar = seedear | 🟡 | Eviction respeita spreads ✅ em `src/lib/cache.ts:49` `evictOldPosts` (LEFT JOIN spreads WHERE spreader_pub = current) + `tests/cache.test.ts`; re-broadcast oportunista ✅ em `src/lib/rebroadcast.ts:56` `rebroadcastToRelay` + `tests/rebroadcast.test.ts`; PoI WebRTC seed ✅ via `src/lib/seeder.ts` (Fase 7.1a antecipada) + `tests/seeder.test.ts`; IPFS Helia init em `src/lib/helia.ts` + `tests/helia.cid.test.ts` + `tests/blobs-ipfs-pref.test.ts` | IPFS pin **completo** de posts virais ⏳ Fase 7+ (blobs IPFS ✅ inicial, mas pin automático por score alto não implementado). Arweave/Hypercore não implementados. |

### IV. Resistência e Defesa (§17-21)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §17 | Resistência ao Fundador — sem chave mestra, build reproduzível | 🟡 | Schnorr per-author preserva integridade ✅; `tests/no-master-key.test.ts` bloqueia funções proibidas (`deletePost`/`banUser`/`flagAsSpam` etc.); MIT license irrevogável; Dockerfile.reproducible + workflow `.github/workflows/reproducible-build.yml` + doc `Docs/build-reproducible.md` | Build reproduzível ✅ no Linux (Fase 6.7); Windows/macOS reprodutibilidade não verificada. F-Droid build reproduzível ⏳ Fase 7.2. |
| §18 | Cliente Oficial sem Privilégios | ✅ | `passesSchemaCheck` não checa `client` tag pra peso/prioridade; nenhum código privilegia `'drift-official'`; kind 9082 (boost pago) reservado, sem implementação privilegiada | — |
| §19 | Anti-Captura — nenhum relay/cliente/identidade obrigatório | ✅ | Relays dinâmicos (`relays.ts`); score local por cliente; moderados ficam no SQLite (`score = -999`); cliente alternativo pode exibir | — |
| §20 | Resistência a Isolamento — multi-bootstrap, probe, path diversity, cluster detection | 🟡 | Probe ✅ em `src/lib/probe.ts:61` `startProbe` + `tests/probe.test.ts`; relay-probe + relay-health em `src/lib/relay-probe.ts`/`src/lib/relay-health.ts` + tests; peerScore path diversity ✅ em `src/lib/peerScore.ts` + `tests/peerScore.test.ts`; peerRegistry persistente em `src/lib/peerRegistry.ts` + `tests/peerRegistry.test.ts` + `tests/orchestrator.test.ts` | Random walk runtime contínuo pós-CONNECTED em WebRTC: descoberta passiva ✅ via seeder, mas walk ativo periódico não shipped (TODO 6.2-D follow-up — `Docs/fase-6-roadmap.md` §6.2). Cluster detection threshold 70%/30% codificado mas auditoria de comportamento sob ataque real pendente. |
| §21 | Custo Assimétrico | 🟡 | Combinação derivada de §1+§3+§11+§12+§15+§16+§20; somente cumprido tão fortemente quanto seus componentes | Mesmos gaps de §15 (Tor só em Tauri) e §16 (IPFS pin Fase 7). |

### V. Julgamento e Moderação (§22-27)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §22 | Score Determinístico, não reputação subjetiva | ✅ | `src/lib/scoring.ts:46` `calculateScore` pura; `src/lib/weight.ts` pura (idade + engajamento, sem opinião); `tests/scoring.test.ts` + `tests/weight.test.ts` | — |
| §23 | Bury Não é Punição — sem `p` tag, sem reason, sem engajamento debit | ✅ | `src/lib/protocol.ts:164` `buryPost` cria evento sem `p` tag; `events.ts:recalculateScore` não chama `updateEngagement` em buries; "última ação vale" implementado + `tests/events.lastActionWins.test.ts` | — |
| §24 | Sem Algoritmo Personalizado de Feed — score público, sem afinidade | ✅ | `scoring.ts` não recebe input do user-leitor; `feed.ts:getGlobalFeed` query idêntica entre users; block/mute em `moderation-local.ts` é só visualização (`applyContentFilters` não muda score) | — |
| §25 | Sem Scan Automático Obrigatório — sem PhotoDNA/ML/blocklist no oficial padrão | ✅ | `src/lib/csam.ts` **não existe** (confirmado via Glob); `src/lib/upload.ts` faz upload pro nostr.build sem inspeção; `passesSchemaCheck` valida formato, não conteúdo; manifesto v2.2 §25 reconhece como decisão arquitetural permanente | — |
| §26 | Moderação Comunitária Reativa — reports kind 9081 + threshold dinâmico | ✅ | `src/lib/moderation.ts:84` `getReportThreshold` pura (max(5, 0.1% activeUsers), 'illegal' 2x agressivo); `src/lib/moderation.ts:156` `maybeModerate` aplica score = -999; `tests/moderation.test.ts`; ReportModal UI shipped + UX denúncia autoridades em `src/components/Post/ReportModal.tsx` | — |
| §27 | Auto-Classificação + Filtros Locais | ✅ | Tag `content-warning` em `passesSchemaCheck`; `src/lib/feed.ts:384` `applyContentFilters` + `:424` `applyContentFiltersComment`; `tests/applyContentFilters.test.ts`; `user_prefs` toggles em `src/lib/prefs.ts` | — |

### VI. Privacidade e Compatibilidade (§28-34)

| § | Princípio | Status | Evidência | Gap |
|---|---|---|---|---|
| §28 | Privacidade pelo Mínimo — sem analytics, location off | 🟡 | `tests/no-telemetry.test.ts` valida zero SDK analytics + zero URL analytics no código; location off-default em `geolocation.ts`; sem login real-world | Tor pra IP não vazar ao relay ⏳ disponível só em Tauri `--features arti` (§4). |
| §29 | Privacidade Opcional para Conteúdo — DMs NIP-44 opcional | ⏳ | `src/lib/nostr-dm.ts` existe + `tests/nip44-facade.test.ts` (NIP-44 facade usado em WebRTC signaling 6.1b) | UI de DMs para usuário final **não shipped**. Manifesto coloca como "roadmap, sem data" — não-bloqueante. ⏳ pós-Fase 7. |
| §30 | Compatibilidade com Ecossistema Nostr — NIP-01 padrão, kinds próprios | ✅ | Kinds 9078..9081 (faixa regular events); tag `drift-version` em `passesSchemaCheck`; sem extensões de relay obrigatórias; documentado em `Docs/protocol-spec.md` | — |
| §31 | Compatibilidade entre Versões Drift — tag `drift-version` | ✅ | `passesSchemaCheck` exige `drift-version`; decisões em `Docs/drift-arquitetura-v4.md` §30; CHANGELOG mantido; auto-update Tauri (§31 preserve) | — |
| §32 | Compatibilidade entre Clientes Drift — spec pública versionada | ✅ | `Docs/manifesto.md` (CC0) + `Docs/drift-arquitetura-v4.md` + `Docs/protocol-spec.md` públicos; código MIT; sem kinds privados | — |
| §33 | Anti-Spam Pela Mecânica Social — bury + reports + limite por peso | ✅ | Buries reduzem score em `scoring.ts`; reports via `moderation.ts`; `getMaxSubposts` cresce com peso em `weight.ts`; PoW (NIP-13) é opt-in, não invariante | — |
| §34 | Simplicidade Operacional | ✅ | Estrutura `src/lib/` com módulos de responsabilidade única; invariantes em `CLAUDE.md`; pipeline `onNostrEvent` linear documentado; 980 tests reproduzíveis | — |

---

## Riscos — princípios 🟡 priorizar

Princípios com status parcial são o **trabalho honesto restante**. Em ordem de criticidade pro manifesto:

### Críticos (cumprem §15 anti-censura)

1. **§15 Anti-Censura por País** — Tor verificado em Tauri build, mas:
   - PWA browser (a grande maioria dos users) ainda não tem Tor (runtime limit aceito)
   - Doc público "como instalar Drift em país censurado" ⏳ Fase 5 listada mas não publicada
   - **Próximo passo**: terminar follow-ups Fase 6.4 (CI `cargo check --features arti`, Capacitor/Android Orbot) + publicar doc.

2. **§12 Múltiplos Transportes** — Tor em Tauri ✅, mas distribuição binária dependendo de download manual do GitHub Releases. F-Droid (Fase 7.2) + TWA + Capacitor multiplicam canais.

3. **§16 Disponibilidade Distribuída** — re-broadcast ✅ + WebRTC seed ✅; IPFS pin **automático** por score alto ainda não shipped. Helia init existe mas seleção de posts virais pra pin não tem trigger. **Próximo passo**: hook em `events.ts:recalculateScore` que dispara `helia.addBlob` quando score > threshold.

### Média prioridade (defesa em profundidade)

4. **§17 Build Reproduzível** — Linux ✅, Windows/macOS verificação cross-platform pendente. Não é bloqueante se source-builders Linux conseguem reproduzir, mas Windows é runtime majoritário no projeto (usuário final dev) — auditoria assimétrica.

5. **§20 Resistência a Isolamento** — random walk runtime contínuo pós-CONNECTED em WebRTC pendente (TODO 6.2-D). Descoberta passiva via seeder cobre parte; expansão ativa periódica não.

6. **§13 Neutralidade de Transporte** — sneakernet bundle (export/import JSON/QR) ⏳ Fase 7. Não-urgente em jurisdições sem bloqueio, crítico em país censurado.

### Baixa prioridade (operacional)

7. **§1 Existência Autônoma** — F-Droid manifest ⏳ Fase 7.2 listado.

8. **§4 Anonimato** — depende de §15 (Tor) e §12 (distribuição); resolve junto.

9. **§21 Custo Assimétrico** — derivado, melhora automaticamente com §15 + §16.

### ⏳ Próxima fase (não-gap, planejado)

- **§29 Privacidade Opcional pra Conteúdo (DMs)** — manifesto explicita "sem data fixada".
- **§13 sneakernet** — Fase 7.
- **§16 IPFS pin automático** — Fase 7.

---

## Como atualizar esta matriz

1. Quando uma feature fechar, mudar status (🟡 → ✅) e remover linha correspondente em "Riscos".
2. Quando manifesto bumpar versão (v2.3+), reler princípios novos/alterados e adicionar/atualizar linhas.
3. Não duplicar matriz em `CLAUDE.md` — apontar pra cá.
4. Substituir o doc inteiro em nova auditoria periódica (snapshot dated) ao invés de mutar — preserva histórico.

---

## Histórico

### 2026-05-15 (v1, este snapshot)

Auditoria inicial pós-Fase 5 + Fase 6 essencialmente fechada. 22 ✅ / 9 🟡 / 0 ⛔ / 3 ⏳. Maior bloqueio remanescente: distribuição binária Tauri pra usuário final não-técnico (§4, §12, §15, §21 todos dependem).

---

*Fonte: análise estática de `src/lib/`, `src-tauri/`, `tests/`, `Docs/` em `0.6.0-alpha.4` @ commit `1d0f5ed`.*
