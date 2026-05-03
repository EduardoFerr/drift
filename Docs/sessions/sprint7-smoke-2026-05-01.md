# Sprint 7 — Smoke test e2e Tor (resultado)

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual da execução manual do
> Sprint 7 do roadmap pós-auditoria. Não é documentação normativa.
> Decisão derivada (§15 VERIFIED) propaga pra `Docs/runtime-pwa-vs-
> tauri.md` matriz e `CLAUDE.md` rodapé.

**Executado em**: 2026-05-01
**Atribuição original**: Arquiteto (execução manual em Windows)
**Versão testada**: commit `0cd2362` (`main` pós-Sprint 4 + bundled SQLite fix)
**Plataforma**: host OS local (verificável via captura de pacote em interface real) · `cargo tauri build --features arti`
**Captura**: Wireshark — `<DOCS_LOCAIS>/drift-baseline.pcapng` (clearnet) + `<DOCS_LOCAIS>/drift-tor.pcapng` (após trocar pra onion-only)

## Resultado

✅ **PASS** — manifesto §15 (anti-censura por país) **VERIFIED**.

## Métricas comparadas

| Métrica | Baseline (clearnet) | Modo `onion-only` (Tor) |
|---|---|---|
| Frames totais | 17.955 | 930 |
| TCP frames | 16.040 | 264 (IPv4) + 117 (IPv6) |
| TLS frames | 8.281 | 60 + 126 |
| TLS SNI `nos.lol` / `nostr.wine` | ✓ presentes | ❌ AUSENTES |
| IPs externos únicos | 21+ | 11 |
| Portas destino externas | 443 (variado) | 110, 443, **444, 9001, 9100, 9200** |

## Evidência principal — TLS SNIs

### Baseline (clearnet)
```
nos.lol
nostr.wine
cloudflare-ech.com
mobile.events.data.microsoft.com
settings-win.data.microsoft.com
v20.events.data.microsoft.com
www.<random>.{org,net,com}  (vários — provável Encrypted Client Hello cover)
```

Confirmação: **conexões TLS direto pros relays Nostr** com SNI explícito,
exatamente o que se espera em modo clearnet.

### Modo `onion-only`
```
v10.events.data.microsoft.com
```

Confirmação: **ZERO SNI de relay Nostr**. O único SNI é telemetria
do Windows (Microsoft Azure), não relacionado a Drift. Tráfego do
app passa por circuit Tor com SNI cover/anônimo conforme padrão Tor.

## Cross-check IPs com Tor Onionoo registry

7 dos 11 IPs externos contactados em modo `onion-only` são **guards
Tor publicamente registrados**:

| IP | Nickname | País | AS |
|---|---|---|---|
| 104.244.79.44 | Quetzalcoatl | LU | FranTech Solutions |
| 193.189.100.205 | TORKeFFORG38 | SE | KeFF Networks Ltd |
| 207.90.194.2 | fluffypancakes002ca | CA | Rica Web Services |
| 37.221.209.76 | prsv | HU | ATW Internet Kft. |
| 45.80.158.142 | Quetzalcoatl | PL | 1337 Services GmbH |
| 5.2.79.190 | onionDAOrel0aded1 | NL | The Infrastructure Group B.V. |
| 82.67.111.215 | GigaTorOfHell2 | FR | Free SAS |

**Diversidade geográfica**: 7 países distintos (LU, SE, CA, HU, PL,
NL, FR). Exatamente o que se espera de Tor com path diversity ativa.

4 IPs restantes (`144.76.138.137`, `18.97.36.77`, `51.105.71.136`,
`95.216.33.150`) — telemetria de sistema operacional Windows
(`51.105.71.136` casa com SNI `v10.events.data.microsoft.com`,
Microsoft Azure). Não relacionado a Drift.

## Confirmação de portas Tor

Em modo `onion-only`, dentre as portas destino:

- **9001** — Tor ORPort canônica (default das relays Tor pra TLS
  client→guard)
- **443** — Tor pode usar 443 também (camuflagem como HTTPS regular)
- 444, 9100, 9200 — portas alternativas que alguns relays Tor
  expõem pra contornar firewalls corporativos

Em baseline clearnet: apenas 443 (HTTPS padrão pros relays Nostr).

## Análise

1. **Drift em modo `onion-only` NÃO conecta direto a relay Nostr
   clearnet** — confirmado por ausência de SNI.
2. **Tráfego sai exclusivamente por circuit Tor** — porta 9001 é a
   ORPort canônica + cross-check com registry público confirma 7
   guards.
3. **IP do user invisível pro relay** — relay enxerga apenas o exit
   Tor; conforme §28 (privacidade pelo mínimo).
4. **Path diversity preservada** — 7 países distintos.
5. **Bootstrap arti funcional** — `cargo tauri build --features arti`
   produziu binário que efetivamente bootou Tor + roteou tráfego.

## Issues encontradas durante execução

1. **`LINK : fatal error LNK1181: cannot open input file 'sqlite3.lib'`**
   no Windows MSVC durante build. Resolvido em commit `0cd2362` via
   feature `bundled` em `libsqlite3-sys` (compila SQLite from source).

2. **Cascata de MSRV** durante CI:
   - 1.83 → edition2024 (serde_spanned 1.1)
   - 1.85 → darling 0.23, icu 2.2
   - 1.88 → retry-error 0.12, tor-error 0.41
   - 1.89 → typed-index-collections 3.5
   Resolvido em `f34116d` trocando pin específico por `stable` em CI;
   `Dockerfile.reproducible` mantém pin 1.90.0 pra reprodutibilidade
   auditável.

## Conclusão

Manifesto §15 (anti-censura por país) — **VERIFIED em build local
Windows com `cargo tauri build --features arti`**.

A capability técnica está completa pra source-builders. Próximo
passo distribução: produzir binário Tauri `--features arti` em CI
matrix Linux/macOS/Windows pra tag `v0.6.0-alpha.3` (ainda pendente).

## Atualizações documentais derivadas

- `Docs/webrtc-6.4-plan.md §6 Próximos passos` — marcar smoke test ✅
- `Docs/runtime-pwa-vs-tauri.md` matriz — Tor 🟡 → ✅ (com data)
- `CLAUDE.md` rodapé — bumpar status §15
- `README.md` "Compromissos" — §15 com asterisco resolvido

## Captura de pacotes (referência)

Arquivos `.pcapng` originais ficam em diretório local do executor:
- baseline (clearnet)
- modo onion-only (Tor)

**Não commitados** no repo (artefatos pessoais; podem conter metadados
de rede do host). Reproduzir requer rodar Sprint 7 manual conforme
[`sprint7-manual-2026-05-01.md`](sprint7-manual-2026-05-01.md).
