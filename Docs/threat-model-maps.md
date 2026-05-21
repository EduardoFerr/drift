# Threat Model — SpreadMap (mapas do Drift)

**Data:** 2026-05-21
**Auditores:** Satoshi (game theory) + Ted (arquitetura), pair-dispatch
2026-05-21
**Escopo:** `src/components/Feed/SpreadMap.tsx` v0.6+ — 3 modes (post,
global, network).
**Status:** documento normativo. Atualizar quando schema/UX do mapa mudar.

---

## Sumário

5 vetores adversariais identificados. 1 mitigado nesta sessão (K=1
DOXX via UI warning). 4 com mitigações arquiteturais já em vigor
(opt-in default OFF, manifesto §28). Roadmap: Tor (Fase 6) fecha
relay correlation; Phase 2 K-anonymity fecha K=1 totalmente.

---

## Tabela de vetores

| # | Vetor | Severity | Observabilidade | Mitigação atual | Reopener |
|---:|---|:---:|---|---|---|
| 1 | **Location disclosure (LD)** | MEDIUM | Público — autor escolheu publicar GPS | `location_granularity='off'` default; UI granularity picker; Placeholder no mapa quando GPS off | Não fechado — defesa é opt-in |
| 2 | **Relay correlation (RC)** | HIGH | Logs relay vêem `(npub, lat, lng)` em claro via kind 9079 | Manifesto §14 publish em ≥2 relays; §28 zero query extra; Fase 6 Tor + WebRTC P2P | Fase 6.4 Tor mode (Tauri shell) — clearnet vaza até lá |
| 3 | **Follow-graph leak via map** | MEDIUM | Device-level — observador casual vê mapa colorido infere trust list | WoT colors NÃO implementadas no mapa; quando vier (item D), opt-in default OFF | Não shipado — risk preventivo |
| 4 | **Trust coloration leak** | LOW | Privado → semi-público se UI mostrar | Mapa hoje renderiza só chartreuse/mint; cores trust gated por `UserPrefs.lens_show_in_map` (item D futuro) | RFC item D — never default ON |
| 5 | **K=1 doxx** | HIGH (small towns) | Público — mapa mostra pin único em cidade pequena | **2026-05-21:** `isUserSoloSpreader` helper + `SoloSpreaderWarning` overlay. User vê warning quando é único com GPS. Dismissable session-only. Educa user sobre risco. | Phase 2 K-anonymity engine (suppression OR aggregation) quando user-base crescer + reports de small-town doxx |

---

## Análise por vetor

### 1. Location Disclosure (LD) — MEDIUM

**Vetor:** quando user publica spread com `granularity != 'off'`, o
evento Nostr kind 9079 inclui tag `["location", lat, lng, city, country]`.
Mapa de qualquer post acessível (canal público Nostr) revela onde
spreaders estão.

**Threat actor:** qualquer observer que monitora kind 9079 events
relevantes (regime, stalker, advertiser).

**Mitigação:**
- Default `location_granularity='off'` — Drift NÃO publica location até
  user opt-in explícito (Settings → Localização)
- Granularity discreta: 'country' (km-level), 'city' (km-level), 'precise'
  (GPS exato — apenas para power user consciente)
- Placeholder no mapa quando GPS off — UX honest sobre o trade-off

**Why não-fechado:** privacy mínima é responsabilidade compartilhada.
Drift entrega opt-in + warnings; user decide. Manifesto §28.

---

### 2. Relay Correlation (RC) — HIGH (clearnet)

**Vetor:** atacante operando relay malicioso (ou regime monitorando
ISP) cruza `(npub, IP, location)` mesmo sem cliente fazer query extra.
Cada SPREAD com location na tag = signal pra triangulação.

**Threat actor:** Estado-nação, regime autoritário, ISP em país com
data retention.

**Mitigação atual:** Manifesto §14 (publica em ≥2 relays paralelos);
zero query extra do cliente; cliente Drift oficial não scaneia (§25).

**Mitigação Fase 6 (em curso):** Tauri shell + arti (Tor embedded) +
WebRTC P2P transport. PWA sozinho NÃO fecha esse vetor — fora do escopo
manifesto §28 (que é "cliente não infere", não "infra esconde").

**Reopener:** Tor shipping concluído + telemetria de adoção; doc public
"como instalar em país censurado" (Sprint N+1 P0 #2).

---

### 3. Follow-Graph Leak via Map — MEDIUM (preventivo)

**Vetor:** se mapa mostra cor por trust score local (lens_edges.influence),
observador casual com acesso ao device deduz quem o user confia →
vaza lista de trusts.

**Status atual:** **NÃO IMPLEMENTADO** (item D do pipeline maps audit
2026-05-21 — defer com plano pronto). Mapa renderiza cores uniformes
(chartreuse para current, mint para demais).

**Mitigação prevista (item D, quando shipar):**
- `UserPrefs.lens_show_in_map` default OFF (opt-in)
- Spreader sem edge em `lens_edges` → cor default (não vaza nem
  "outros podem ver que esse foi seguido")
- Toggle visível em SuaLenteCard + warning "visível apenas pra você"

---

### 4. Trust Coloration Leak — LOW

**Sub-vetor de #3.** Atacante observando shoulder-surfing vê pin
laranja brilhante = "user confia muito nesse spreader" → social
engineering vector.

**Mitigação:** mesma do #3 (opt-in OFF). Quando opt-in ON, palette
distingue trust níveis via cor + accessibilidade RG-colorblind (Phase
2 polish).

---

### 5. K=1 Doxx — HIGH em comunidades pequenas (MITIGADO 2026-05-21)

**Vetor:** mapa de post controverso (manifesto sobre tema sensível em
regime autoritário) mostra pin único naquela cidade pequena → identifies
spreader via community knowledge ("era só Pedro na favela que viu").

**Mitigação shipada 2026-05-21:**

1. **Helper puro** `isUserSoloSpreader(data, activeNpub): boolean` em
   `src/hooks/useSpreadMap.ts`. Returns true quando
   `data.totalSpreads === 1 && firstSpread.spreaderPub === activeNpub`.
2. **Component** `SoloSpreaderWarning` em `SpreadMap.tsx`. Overlay
   top-right do mapa em modo `post`. Copy:
   > 📍 você é o único com GPS aqui
   > sua localização é identificável neste mapa. considere desligar
   > GPS pra próximos drifts em ajustes → localização.
3. **Trigger:** apenas modo `post` (global/network agregam por design,
   risk reduzido).
4. **Dismissal:** session-only via × button (`useState`, não
   persisted). Cada post K=1 novo → warning fresh. Pattern educa user
   organicamente.

**Mitigação RESIDUAL (Phase 2):** K-anonymity engine. Duas options:
- **Suppression:** suprimir pins quando K < 3 → mapa não renderiza
- **Aggregation:** bucket regional 50km quando K < 3 → menos identificável

Decisão arquitetural diferida. Reopener: DAU > 1000 + telemetria
empírica de distribuição K em produção; OR user report de doxx real
concreto em small-town community.

---

## Manifesto compliance

| § | Princípio | Mapa hoje |
|---|---|---|
| §17 | Sem chave mestra | ✓ — `map_tile_url_template` configurável (user override CARTO) |
| §22 | Score determinístico | ✓ — mapa NÃO afeta score; pure view-layer |
| §24 | Sem afinidade canônica | ✓ — `network` mode (item A) é local-only; não exporta |
| §25 | Sem scan automático | ✓ — mapa não escaneia conteúdo, apenas geo |
| §28 | Privacy mínima | ✓ — location opt-in, default OFF |

---

## Roadmap mitigações remanescentes

| Fase | Item | Fecha vetor |
|---|---|---|
| 6.4 | Tor mode (Tauri shell + arti) | #2 Relay correlation |
| Item D (futuro) | WoT colors opt-in OFF default | #3 Follow-graph leak (preventivo) |
| Phase 2 | K-anonymity engine | #5 K=1 doxx residual |

---

## Conformance hooks

- `tests/spread-map-network-mode-conformance.test.ts` — trava pattern
  empty states + scope query (não toca lens_edges/score/reports)
- `tests/spread-map-k1-warning-conformance.test.ts` (item C) — trava
  helper purity + SoloSpreaderWarning render conditional

---

## Reabertura deste doc

Atualizar quando:
- Schema `spreads.location` mudar (granularity nova, formato)
- WoT colors shippar (item D)
- K-anonymity engine implementado (Phase 2)
- Vetor adversarial novo identificado em pair-review
- Tor mode shipped (Fase 6.4 fecha #2)

---

*Auditoria normativa Satoshi+Ted 2026-05-21. Próxima review: pós
implementação item D OR pós-Fase 6.4 Tor shipping.*
