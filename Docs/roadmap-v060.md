# Drift — Roadmap v0.6.0

> last-updated: 2026-05-02 · curador: Arquiteto · status: ativo

Roteiro consolidado pós-`v0.6.0-alpha.3` até `v0.6.0` stable. Síntese de:
- 5 personas HIMYM (Ted/Marshall/Barney/Lily/Robin) sobre propostas
  externas (`conversa.txt`, `dbdp.txt`)
- Estado real das fases (`CLAUDE.md` "Estado da implementação")
- Backlog Lily acumulado das 10 sprints pós-auditoria

---

## Decisões firmes (não reabrir sem motivo novo)

### Vetos (5/5 personas convergiram)
- ❌ **Bordas/regiões/feeds-por-borda** — fere §11 (sem afinidade) +
  §24 (sem bolha) + §7 (determinismo). Feed global continua global;
  UX pode mostrar "perto de mim" como filtro local opt-in, mas o
  ranking é puro. (proposta `dbdp.txt:28`)
- ❌ **Guardião com score-boost** — fere §22 (score determinístico) +
  §17 (sem chave mestra). Quem opera o "boost" herda chave mestra.
  Voluntário-sem-recompensa OK; com privilégio NÃO. (`dbdp.txt:27`)
- ❌ **DHT como discovery primário** — overlay social NIP-65 + NIP-02
  já cobre. DHT entra só como fallback opcional em cliente nativo
  (Fase 7+ se necessário). (4/5 personas)

### Diferimentos (não-vetos, mas sem deadline)
- ⏸ **Erasure coding 6:10 (Reed-Solomon)** — overkill pra blobs
  sociais 1-10MB. Sobrecarga banda + complexidade não justifica
  ganho marginal. Reavaliar se blobs >100MB ou churn seeders >70%.
- ⏸ **Onion-only forçado** — quebra disponibilidade pra users sem
  Tor. `NetworkMode = 'onion-only'` continua opt-in (Fase 6.4 etapa 4).
- ⏸ **DBDP como protocolo separado** — Helia + NIP-94 (`imeta` com
  `x` SHA-256) cobre 90% do caso. RFC formal só se Helia provar
  insuficiente. (`dbdp.txt` proposta inteira diferida)

### Adoções
- ✅ **Helia (IPFS browser)** — camada de distribuição de blobs
  (~500KB bundle, MIT). Substitui DBDP custom.
- ✅ **NIP-94 reuse** — tag `imeta` com `x` SHA-256 referencia blob
  IPFS. Compat Nostr mantida (§28).
- ✅ **"Favorito = mirror automático"** — quando user favorita post,
  cliente pina blob no IPFS local. Distribui carga sem violar §16/§22.
- ✅ **HTTP fallback** — se Helia falhar, blob via gateway IPFS
  público. Degradação graceful.
- ✅ **RFC-first** — antes de código, spec curta em
  `Docs/blob-distribution.md` pra revisão personas.

---

## Tracks

### Track A — Distribuição cross-platform (~13h, prioridade 1)

**Por quê primeiro:** §15 anti-censura (Tor) só cumprido em build
Tauri+arti. Hoje: Linux source-builders ✅; macOS/Windows ⛔.

| Item | Status | Esforço | Bloqueador |
|------|--------|---------|------------|
| A.1 — CI matrix Tauri (Linux/macOS/Windows) com `--features arti` | 🟡 nesta sessão | ~9h | nenhum |
| A.2 — Code signing macOS (Apple Developer $99/ano) + Windows EV cert (~$200/ano) | ⛔ | ~4h | user fornece certs |
| A.3 — Tauri updater (auto-update, no-op pra alpha) | ⛔ | ~6h | A.1 done |

**A.1 entrega:** `.github/workflows/tauri-distribution.yml` em push de
tag `v*` produz `.AppImage`/`.deb` (Linux), `.dmg` (macOS arm64),
`.msi`/`.exe` (Windows), todos com Tor real, anexa ao Release. Sem
signing — README documenta workaround SmartScreen/Gatekeeper.

### Track B — §16 Disponibilidade distribuída (~14-18h, prioridade 2)

**Por quê segundo:** Sem distribuição cross-platform, §16 não tem
quem servir. Ordem natural é A→B.

| Item | Status | Esforço |
|------|--------|---------|
| B.0 — RFC [`Docs/blob-distribution.md`](blob-distribution.md) v0.1 draft | 🟡 | drafted 2026-05-03; pendente revisão personas |
| B.1 — Helia spike (POC IPFS no PWA, mede bundle) | ⛔ | ~4h |
| B.2 — NIP-94 `imeta` + auto-pin no favorito | ⛔ | ~6h |
| B.3 — UI "servindo N blobs a M peers" (Lily Fase 7.1c) | ⛔ | ~4h |
| B.4 — Integração PoI seeder + Helia | ⛔ | ~2-4h |

### Track C — Polish pré-stable (~17-23h, prioridade 3)

**Por quê terceiro:** features completas; resta hardening + docs.

| Item | Status | Esforço |
|------|--------|---------|
| C.1 — `Docs/run-your-own-relay.md` | ⛔ | ~3h |
| C.2 — TWA keystore production setup | ⛔ | manual user (~30min) |
| C.3 — Backup/restore identidade UI flow | ⛔ | ~4h |
| C.4 — Lily debt cleanup (10 sprints acumuladas) | ⛔ | ~3-6h |
| C.5 — Legal hardening (postura "named contributor com papel limitado") | 🟡 parcial | ~7h |

**C.5 entregue (2026-05-02):** README opener "sem dono"; SECURITY.md
narrow scope; PRIVACY.md framing software-not-service; CONTRIBUTING.md
com DCO sem CLA; `Docs/continuity.md` (reprodução sem cooperação do
autor); `Docs/protocol-spec.md` (kinds 9078–9081 standalone — protocolo
sobrevive ao cliente); manifesto declarado CC0.

**C.5 pendente (gatilho-baseado, não preventivo):**

- Tags GPG-assinadas + pubkey publicada (~30min) — após primeiro
  co-maintainer ativo
- Tests executáveis de invariantes #7/#8/#12 do CLAUDE.md (~3h) —
  oportuno quando próximo refactor tocar `moderation.ts` ou `events.ts`
- DMCA agent registrado no US Copyright Office ($6) — só após
  documentar scope ("agente pra código no repositório, não conteúdo
  na rede")
- Mirrors automatizados (IPFS pin do source, gitea backup) — após
  primeiro relato de DMCA/Art.21 ou primeira tentativa de takedown
- Multi-sig 2-de-3 em tags — após 3+ contributors com merges
  substantivos
- SLU brasileira ou estrutura jurídica formal — após primeiro de:
  10k MAU / primeira notificação extrajudicial / doação recebida
  >R$5k

**Diferença vs. postura "Mastodon gGmbH" tradicional:** todos os docs
acima escopam papel, não criam plataforma. Não há ToS (contrato implica
operador); não há transparency report preventivo (não há dados pra ser
transparente sobre); não há DPO designado (argumenta-se NÃO ser
controlador LGPD por arquitetura local-first).

### Track D — Diferido (sem deadline)

- Erasure coding 6:10 (reavaliar se blobs ficarem grandes)
- DBDP custom protocol (RFC se Helia provar insuficiente)
- Sneakernet bundle (Fase 7+)
- Capacitor + Orbot integration (alternativa TWA)
- F-Droid metadata + submissão (depende A.1 + repo público)

---

## Total estimado pra `v0.6.0` stable

~37-44h efetivo, 8-10 sessões + 2 ações manuais (certs + keystore).

## Critério de aceite por Track

- **A:** binário Tauri com Tor rodando em macOS+Windows+Linux,
  baixável da página de Releases. Smoke test mínimo: `drift launch`
  → identity gen → publish kind 9078 via WSS → seguinte via Tor.
- **B:** post com imagem 5MB sai do device A, fica disponível pra
  device B em <30s mesmo após device A offline (foi favoritado por
  ≥1 outro user).
- **C:** novo user via Tauri segue tutorial em-app de 3 passos
  (gen identity → first post → backup nsec1 em arquivo).

---

## Referências

- Manifesto: `Docs/manifesto.md` (§11, §15, §16, §17, §22, §24, §28)
- Arquitetura: `Docs/drift-arquitetura-v4.md` v5.3
- Estado atual: `CHANGELOG.md` (último: v0.6.0-alpha.3 2026-05-01)
- Análise externa: `conversa.txt`, `dbdp.txt` + revisões personas
  (sessão 2026-05-02, não persistida como doc separado)
