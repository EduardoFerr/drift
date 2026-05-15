# Relay Health — degradação adaptativa de relays flaky

**Autor:** Barney (security/peer review/threat modeling)
**Data:** 2026-05-15
**Status:** shipped
**Tests:** 24 novos em `tests/relay-health.test.ts` · suite total 1000 verde
**Build:** verde · lint zero

## Contexto

Lighthouse run de 2026-05-15 reportou:

```
WebSocket connection to 'wss://relay.damus.io/' failed
```

emitido nativamente pelo browser (não vem de `console.error` nosso) —
penalizou Best Practices de 100 → 96. O erro nativo é sintoma de um
problema maior: **não havia sistema de degradação de relays flaky**.

Cada boot tentava o relay, falhava visivelmente no console, sem
aprendizado. Manifesto §20 (anti-eclipse) implica que diversificação
de relays é defesa — relay morto na seed list polui o conjunto ativo,
atrasa fetch da seed real, e pode ser usado como sinal lateral por
um observador.

## Design

### Estados rastreados (por device, in-memory + SQLite)

- `consecutiveFails` — incrementa a cada erro de conexão ou probe
  silent/incomplete/error; reset em qualquer sucesso.
- `demotedUntil` — ms epoch até quando o relay está demoted.
- `lastSuccessAt`, `lastFailureAt` — telemetria local.

### Política

- **Threshold:** `DEMOTE_THRESHOLD = 3` falhas consecutivas → demoted.
- **Backoff exponencial:** `15min → 30min → 60min` (cap em 1h).
  - `backoffMs(fails)`: pura, `DEMOTE_BASE_MS * 2^(fails - 3)`,
    clamp em `DEMOTE_CAP_MS`.
- **Recuperação:**
  - Timeout natural (passa de `demotedUntil`).
  - Probe periódico (`probe.ts`, intervalo 30min) que recebe `ok`
    chama `recordRelayOk()` → reset imediato.
  - Qualquer publish/subscribe bem-sucedido em hot path
    (`wssTransport.publish` em `transport/wss.ts`) também reset.

### Integração no hot path

- `recordRelayOk(url)` / `recordRelayError(url, err)` em
  `src/lib/relays.ts` são as únicas portas de escrita do contador.
  Chamados por:
  - `wssTransport.publish` — após cada `pool.publish` por relay.
  - `wssTransport.health` — em `onopen`/`onerror`/`timeout` (esse era
    o caminho que produzia o erro nativo do Lighthouse; agora ele
    alimenta o tracker, e o relay é demoted após 3 tentativas).
  - `probe.ts:runProbe` — flag `silent`/`incomplete`/`error` → erro;
    flag `ok` → sucesso.
- `activeReadRelays()` / `activeWriteRelays()` / `activeRelays()`
  filtram via `filterDemoted` antes de aplicar `NetworkMode`.

### Anti-eclipse residual (manifesto §20)

O risco óbvio de filtrar demoted é o cliente ficar isolado: e.g.
durante outage de CDN regional, **todos** os relays podem falhar ao
mesmo tempo.

`filterDemoted(urls, getHealth, now)` cobre o caso:

- Se há pelo menos 1 relay live → retorna só os live.
- Se TODOS estão demoted → retorna **1** (o de menor `demotedUntil`,
  ou seja, o que vai re-tentar mais cedo). Não-empty é invariante.

Combinado com o fallback de `activeRelays` (puxa seeds removidas pra
completar lista <2), garantimos que o cliente nunca fica desconectado
por self-config.

## Threat Model

### T1 — Atacante derruba 1 relay popular

**Cenário:** atacante DDoSa `wss://relay.damus.io`.

**Impacto local:** após 3 falhas consecutivas no device, o relay
fica demoted localmente por 15min. Cliente continua usando os outros
2 seeds + qualquer relay que o user adicionou.

**Impacto global:** zero. Não há canal de comunicação entre clientes
pra propagar opinião de saúde. Cada device forma estado independente.
Atacante não consegue "demotar globalmente" via DDoS local.

**Veredito:** mitigação cumpre o que promete. Manifesto §20 (defesa
local) sem dependência de coordenação cross-client.

### T2 — Relay malicioso que sempre conecta mas filtra eventos

**Cenário:** relay aceita `open` do WebSocket (passa health()) e responde
a REQ, mas devolve subconjunto censurado da rede (Sybil adaptativo).

**Impacto direto sobre `relay-health`:** nenhum. Connection-level health
não detecta filtering de aplicação.

**Mitigação complementar:** `probe.ts` faz round-trip de REQ com sample
de IDs conhecidos. Se relay devolve `silent` (zero matches) ou
`incomplete` (< IDs pedidos), é flag e dispara `recordRelayError`. Após
3 ciclos de probe ruins (1h30min total a 30min/probe), relay é demoted.

**Limitação honesta** (manifesto §20): probe pode ser bypass por relay
que mantém cache dos IDs probed mas filtra todo o resto. Defesa
restante é path diversity via WebRTC (Fase 6), não este módulo.

### T3 — Atacante envenenando state local

**Cenário:** atacante com acesso ao device modifica `relays_user` no
SQLite — define `demoted_until = +inf` em todos os relays.

**Impacto:** cliente fica isolado, MAS `filterDemoted` retorna pelo
menos 1 (o de menor `demoted_until`). Boot ainda funciona; após 1
sucesso de publish/subscribe, `recordRelayOk` reset o estado.

**Veredito:** local-attack já era game over via crypto.ts. Este vetor
não amplia a superfície.

### T4 — Eclipse via demotion forçada

**Cenário:** atacante injeta `recordRelayError` calls (via XSS, etc)
pra demotar todos os relays e direcionar tráfego pra 1 relay malicioso
que ele adicionou.

**Mitigação:** XSS é game over de qualquer forma (acessa nsec via
crypto.ts). Este vetor não é especifico de relay-health.

**Reforço residual:** `filterDemoted` mantém ≥1 relay mesmo demoted;
cliente sempre tenta. Manifesto §20 (cliente nunca fica isolado por
self-config) ainda vale.

## Schema migration

Migração idempotente em `db.worker.ts` adiciona 3 colunas a
`relays_user`:

```sql
ALTER TABLE relays_user ADD COLUMN consecutive_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE relays_user ADD COLUMN demoted_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE relays_user ADD COLUMN last_err_at INTEGER;
```

Bancos pré-2026-05-15 inicializam com defaults (0/0/null) — comportamento
é "todos online até primeiro sucesso/falha".

## Arquivos modificados

- **Novo:** `src/lib/relay-health.ts` — funções puras + store in-memory.
- **Novo:** `tests/relay-health.test.ts` — 24 testes (backoff, threshold,
  filterDemoted, store).
- `src/lib/relays.ts` — `RelayRecord` ganha `demotedUntil` +
  `consecutiveFails`; `recordRelayOk/Error` integram tracker; active*
  filtram demoted.
- `src/lib/probe.ts` — flag `ok` agora chama `recordRelayOk` (reabilita
  demoted antes do timeout); `error` também conta como falha.
- `src/lib/transport/wss.ts` — `health()` chama record* em
  open/error/timeout (caminho do erro nativo do Lighthouse).
- `src/lib/schema.sql`, `src/lib/db.worker.ts` — migration v10.x.
- `src/components/Settings/RelaySettings.tsx` — surface demoted state
  na UI (badge `demoted Xm`, tone `drift-warning`).
- `tests/probe.test.ts`, `tests/network-mode.test.ts` — atualizados pra
  cobrir nova API.

## Verificação

```
npm run test            # 1000 passed | 6 todo (75 files)
npm run lint:check      # 0 warnings
npm run build           # verde, entry chunk dentro do budget
```

## Observações finais

- **Não introduzimos chave mestra.** Health é local, sem signal global,
  sem central de reputação. Cumpre manifesto §17 e §20.
- **Não escaneamos conteúdo.** Tracker olha só conexão/round-trip de
  REQ. Cumpre manifesto §25.
- **Erro nativo do Lighthouse continua possível** se um relay ainda não
  passou pelos 3 fails: a primeira vez que o browser abre `wss://`
  morto, o erro nativo é emitido antes do nosso tracker poder demotar.
  Diferença: após 3 tries num boot, o relay é demoted e os boots
  seguintes não tentam mais → erro some até a janela passar. Melhora
  monotônica em uso real.

---

## HTTPS pre-probe (adendo — 2026-05-15)

### Problema residual

A degradação adaptativa (acima) ainda permite **uma janela inicial de
console.error nativo**: relay morto na 1ª boot ainda dispara
`WebSocket connection to 'wss://...' failed` no DevTools, porque o
log é emitido pelo networking layer do browser ANTES de qualquer
handler JS poder agir. Não há jeito de capturar (`ws.onerror`,
`window.onerror`, `unhandledrejection` — nenhum funciona).

### Solução

`src/lib/relay-probe.ts` — **HTTPS pre-probe** antes de instanciar o
WebSocket. Chave: `fetch()` rejections SÃO silenciáveis (Promise
rejection capturada em try/catch ≠ console.error nativo do networking
layer).

```ts
export async function probeRelayReachable(
  wssUrl: string,
  timeoutMs = 3000,
  now = Date.now,
  fetchImpl = fetch,
): Promise<ProbeReachResult>
```

Fluxo:
1. Converte `wss://host/path` → `https://host/path` (e `ws→http` em dev).
2. `fetch(httpsUrl, { headers: { Accept: 'application/nostr+json' },
   mode: 'cors', timeout: 3s })`.
3. Se CORS falha (TypeError), retry com `mode: 'no-cors'`. Opaque
   response ainda indica server vivo → `reachable = true`.
4. Se ambos falham (DNS/TLS/conn/timeout) → `reachable = false`.
   Erros silenciados em `try/catch` — não escapam.
5. Cache TTL 30s pra evitar re-probe em re-connects rápidos.

**Bônus NIP-11**: quando o response volta com `content-type:
application/nostr+json` e body parseável, extrai `name`, `description`,
`software`, `version`. Pode ser usado em UI futura (Settings →
"detalhes do relay") sem nova request. Não bloqueia o probe: parsing
falhar não muda `reachable`.

### Integração

`src/lib/transport/wss.ts:health()` agora pre-probeia antes de
`new WebSocket(url)`. Se `!reachable`, chama
`recordRelayError(url, 'pre-probe unreachable (DNS/TLS/conn)')` —
que via `noteFailure` em `relay-health.ts` incrementa
`consecutiveFails` e eventualmente demota. **WebSocket nem chega a
ser instanciado** → zero console.error nativo pra relays mortos.

Pre-probe timeout é `max(1000, timeoutMs/2)` pra deixar margem pro
WS handshake real quando o host está vivo.

### Threat model adicional

- **MitM responde 200 ao probe mas filtra WS upgrade** → probe passa,
  WS falha, `relay-health.noteFailure` demota normalmente. Pre-probe é
  otimista — blinda contra "morto + desconhecido", não contra "vivo +
  malicioso".
- **DoS slow-loris no HTTPS** → timeout curto (3s) + probes paralelos.
- **Privacy**: o probe HTTP faz DNS lookup + TLS handshake ao mesmo
  host que o WSS já faria. Zero info nova vazada. Em modo Tor (Fase
  6.4), pre-probe NÃO usa Tor automaticamente — daí integramos só no
  WSS clearnet. `torWebSocket` segue sem pre-probe (Tor circuit já
  silencia o erro de networking layer via processo separado).
- **Não vira chave mestra**: o probe roda no device do user, decisão
  100% local. Manifesto §17 cumprido.

### Tests

`tests/relay-probe.test.ts` — 13 tests Vitest:
- `wsToHttp` converte schemes corretamente
- reachable=true em 200 + JSON NIP-11 com metadata parseada
- reachable=true em 4xx (server vivo, sem NIP-11)
- reachable=true mas nip11=null quando content-type ≠ JSON
- fallback no-cors quando CORS rejeita com TypeError
- reachable=false quando ambos modes rejeitam
- rejeições silenciadas: probe sempre resolve, nunca rejeita
- cache TTL: hit dentro do TTL não re-fetcha; miss após expira
- URLs distintas têm entradas separadas

### Verificação adicional

```
npm run test -- --run tests/relay-probe.test.ts   # 13 passed
npm run test -- --run tests/relay-health.test.ts  # 20 passed
npx tsc --noEmit                                  # 0 erros
```
