# Cenários de Redundância — audit Satoshi 2026-05-21

**Trigger user:** "Backlog: satoshi deve analisar para verificar quais
cenarios de redundancia temos funcionais e quais ainda não estão
funcionais"

**Persona:** Satoshi Nakamoto (adversarial + game theory + invariantes)

---

## TL;DR — Drift NÃO falha em redundância core. Tem 2 gaps de
**automação** que reduzem durabilidade prática.

10 cenários auditados:
- ✅ 7 FUNCIONAIS (multi-relay, rebroadcast manual, backup nsec,
  multi-id, SQLite rebuild, probe, NIP-65)
- 🟡 3 PARCIAIS (WebRTC, IPFS pin manual, random walk pós-CONNECTED)
- 🔴 1 NÃO FUNCIONAL (sneakernet bundle — Fase 7)

---

## TABELA — Status por cenário

| # | Cenário | Status | Evidência | Manifesto |
|---:|---|:---:|---|---|
| 1 | Multi-relay publish | ✅ | `lib/nostr.ts:90-92` orchestrator + `config/relays.ts` 3 seeds | §14 |
| 2 | Re-broadcast oportunista | 🟡 | `lib/rebroadcast.ts:56-88` impl mas **manual** (não auto em `addRelay()`) | §16 |
| 3 | WebRTC P2P transport | 🟡 | 15 arquivos em `lib/transport/webrtc/`; sem bootstrap auto | §12 |
| 4 | IPFS pin posts virais | 🟡 | `lib/helia.ts:246-249` API B.1 ok; **B.2 auto-pin não shipado** | §16 |
| 5 | Sneakernet QR/JSON | 🔴 | 0 código; defer Fase 7 | §13 |
| 6 | Backup nsec / importação | ✅ | `lib/identity-backup.ts:60-178` parseBackup/buildBackup/serializeBackup completo | §3 |
| 7 | Multi-identidade | ✅ | `lib/identities.ts:71-244` CRUD + store reativa + `setActiveIdentity` | §4 |
| 8 | SQLite local cache rebuild | ✅ | `sync.ts:1-43` rebuildIdentityHistory; cap 500 events documentado | §3, §6 |
| 9 | Probe anti-eclipse | 🟡 | `lib/probe.ts:61-190` 30min ciclo OK; **random walk pós-CONNECTED defer** | §20 |
| 10 | NIP-65 relay discovery | ✅ | `lib/nip65.ts:45-158` publish + parse + fetchRelayList | §28 |

---

## Threat model — cenários CRÍTICOS

**Q: Quais cenários, se falharem, comprometem §17/§15/§16?**

1. **Multi-relay (#1) regredir a single-relay** → §14 viola (bootstrap não-distribuído). Defesa atual: orchestrator code review + race-to-first.

2. **Re-broadcast manual (#2) ficar invisível ao user** → manifesto §16 promete "disponibilidade" mas user que importa relay novo não sabe clicar Settings → posts antigos sumiram do novo relay por semanas.

3. **Probe (#9) não detectar relay malicioso** → §20 (resistência isolamento) falha. Mitigação atual: probe roda 30min, flags relays. **Gap:** random walk pós-CONNECTED não shipado (já em known-limitations).

4. **WebRTC P2P (#3) nunca inicializar em prod** → §12 (múltiplos transportes) parcial — só WSS funciona. Código existe mas bootstrap não ativa em Fase 5.

---

## Recomendação — Top 3 closures Sprint N+2

### #1 PRIORIDADE — Auto-trigger re-broadcast em `addRelay()`

- **Manifesto:** §16 + §14
- **Current:** `rebroadcastToRelay()` 100% funcional, manual em Settings
- **Gap:** user importa relay novo → histórico fica invisível até ele
  saber clicar "re-broadcast manual"
- **Fix:** ~30min. Callback em `relays.ts:addRelay()` →
  `rebroadcastToRelay(url, npub)` async fire-and-forget
- **Risk:** ZERO — função pura, já existe, só auto-trigger
- **Success:** novo relay adicionado → console "re-broadcast iniciado"
  → diagnostics mostra posts antigos no relay novo em 30s
- **Por que P0 N+2:** ROI altíssimo (~30min pra fechar gap §16 real)

### #2 PRIORIDADE — Auto-pin IPFS em score > threshold

- **Manifesto:** §16 (durabilidade viral) + §17 (user controla)
- **Current:** `pinBlob()` API B.1 funcional; **auto-pin B.2 defer**
- **Gap:** posts viralizam, ninguém pina → falha durabilidade
  descentralizada
- **Fix:** ~60min. Hook em `events.ts:onNostrEvent` pós
  `recalculateScore` — se `score > VIRAL_THRESHOLD=50`, dispara
  `pinBlob(cid_from_tags)` async fire-and-forget
- **Risk:** MODERATE. Storage cap IndexedDB 500MB exige LRU eviction
  futura. **Mitigation:** opt-in pref `auto_pin_enabled` default OFF
  até telemetria validar
- **Success:** post spread 5x → score crosses 50 → Helia mostra CID
  pinado → Settings mostra "servindo N blobs"
- **Por que P0 N+2:** alinha com Sprint N+2 item 0.1 do plan Ted+Satoshi
  (§16 IPFS pin automático já priorizado)

### #3 PRIORIDADE — Random walk pós-CONNECTED (DOC ONLY)

- **Manifesto:** §20 (resistência isolamento)
- **Current:** probe periodic OK; random walk active não shipado
- **Fix:** ZERO código. Doc em `known-limitations.md` §X com reopener
  explícito: "Quando WebRTC discovery em Fase 6 permitir descoberta
  P2P além relays, implementar random walk com path diversity"
- **Risk:** ZERO
- **Por que:** alinha expectativa user; honestidade radical sobre gap

---

## Cenários OK — NÃO TOCAR (gold-plating risk)

| # | Cenário | Reopener específico |
|---:|---|---|
| 6 | Backup nsec | Se v2 format (password-encrypted) surgir |
| 7 | Multi-identidade | Regressão em UI IdentitySwitcher |
| 8 | SQLite rebuild | Se densidade events > 500/janela for problema real |
| 10 | NIP-65 | Sync com other user relay list em UI precisar test |
| 9 | Probe ciclo periódico | Telemetria falsos positivos > 5% |

---

## Síntese adversarial

Drift está **honesto na redundância core**:
- Code paths existem (`rebroadcast`, `helia`, `probe`, `multi-id`)
- Tests + manifesto compliance OK
- 2 gaps de **automação** (não de código) são as falhas residuais

**Impacto em manifesto:**
- §17 sem chave mestra: ✅ OK (user controla pin/republish)
- §15 anti-censura país: ✅ OK (múltiplos transportes + multi-id)
- §16 disponibilidade: 🟡 PARCIAL (mecânica existe, **não ativa
  sozinha** — depende user clicar manual)
- §20 anti-eclipse: 🟡 PARCIAL (probe OK, random walk pós-CONNECTED
  defer Fase 6)

**Custo das 3 closures:** ~90min (#1) + ~60min (#2) + 0min (#3) =
**~2.5h pra Sprint N+2.** Fecha §16 promessa real, alinha §20
documentação.

---

## Reopener deste audit

- Telemetria de adoção `auto_pin_enabled` > 20% → revisar storage caps
- Caso real de Sybil ring contra probe → reabrir random walk impl
- WebRTC P2P shipar em Fase 6 → revisar #3 como mitigação real

Próximo audit redundância: pós Sprint N+2 closures (#1 + #2).

---

*Audit Satoshi 2026-05-21. Convergente com Sprint N+2 plan Ted+Satoshi
(§16 IPFS pin já é P0 0.1). Adiciona #1 rebroadcast auto + #3 random
walk doc.*
