# ADR — CSP estrita em produção

**Date:** 2026-05-15
**Status:** Accepted (shipped `4402acc`, hardened `331c2b1`)
**Manifesto refs:** §4 (anonimato/anti-telemetria), §17 (sem chave mestra)

## Context

Drift é um PWA hospedado no Vercel servindo identidade soberana
(nsec criptografado em OPFS/IndexedDB). Um XSS ou injeção de tag
script externa em qualquer página seria catastrófico: exfiltração
de master key, beacon de telemetria contornando a postura "sem
analytics", chave mestra disfarçada pela porta dos fundos.

Cliente PWA roda no browser do user — não controlamos extensões,
versão do browser, ou ataques de cadeia de suprimentos via CDN
externo. CSP é a defesa em profundidade que sobra.

## Problem

Stack defaults (Vercel, Vite, Framer Motion, MapLibre, deck.gl,
nostr-tools) trazem necessidades reais que tentam empurrar a CSP pra
permissiva:

- Framer Motion injeta keyframes inline → `style-src 'unsafe-inline'`.
- MapLibre/deck.gl carregam tiles WebGL + workers → `worker-src blob:`,
  `img-src https: data: blob:`.
- nostr-tools abre WSS em N relays dinâmicos → `connect-src wss:`.
- Vite gera CSS inline em algumas otimizações.
- Vercel servia inicialmente sem CSP nenhuma; primeiro patch (`4402acc`)
  era restritiva mas sem documentação por diretiva.

Sem racional documentado pra cada exceção, revisões futuras tendem
a "abrir um pouco mais por conveniência" até a CSP virar `default-src *`.

## Decision

CSP estrita em `vercel.json` com **cada diretiva permissiva
justificada por escrito** em `Docs/security/csp-policy-2026-05-15.md`.

Estado atual (resumo):

- `default-src 'self'`
- `script-src 'self'` (sem `unsafe-inline`, sem `unsafe-eval`)
- `style-src 'self' 'unsafe-inline'` — *necessário pra Framer keyframes
  inline e CSS injetado; documentado como aceito*
- `connect-src 'self' wss: https:` — *relays Nostr dinâmicos +
  upload nostr.build*
- `img-src 'self' data: blob: https:` — *tiles CARTO + Nostr image hosts*
- `worker-src 'self' blob:` — *SQLite WASM worker + MapLibre*
- `frame-ancestors 'none'`
- `object-src 'none'`
- `upgrade-insecure-requests`

Lock: qualquer mudança na CSP requer atualização correspondente em
`Docs/security/csp-policy-2026-05-15.md` (uma seção por diretiva).
Revisão de PR enforça.

## Consequences

**Positivas:**

- XSS hipotético em renderização de conteúdo Nostr (kind 9078 content)
  não consegue exfiltrar dados: sem `script-src` permissivo, sem
  `connect-src *`.
- Chave mestra disfarçada via injeção de analytics externa fica
  bloqueada por design — manifesto §4 anti-telemetria virou enforcement
  ativo, não confiança em "não importar GA".
- Documentação inline força contributor novo a explicar **por quê**
  precisa relaxar uma diretiva, em vez de só relaxar.

**Negativas:**

- `style-src 'unsafe-inline'` permanece — Framer Motion injeta
  keyframes inline. Mitigação: tracking issue pra avaliar nonces ou
  migração progressiva pra CSS-only animations em hot paths.
- Manutenção: relays novos hardcoded fora de `wss:` quebrariam; hoje
  `wss:` é wildcard pra acomodar relays dinâmicos (Fase 5+). Trade-off
  aceito — alternativa seria CSP dinâmica por boot, complexidade alta.

## Alternatives considered

1. **CSP `default-src 'self'` puro sem exceções.** Quebra Framer
   Motion, MapLibre, deck.gl, nostr-tools — UI inteira inviável.
   Rejeitado por viabilidade.

2. **Nonces por request.** Vercel suporta via middleware. Mais forte
   que `unsafe-inline`, mas exige rewrite do build pra injetar nonce
   em todo `<style>` gerado por Framer. Custo alto, ganho marginal
   enquanto Framer for dependência. Diferido pra quando substituir
   ou tree-shake Framer mais agressivamente.

3. **CSP em `meta` tag em `index.html`.** Menos confiável (não cobre
   redirects, response headers preferidos). Rejeitado.

## References

- `vercel.json` — headers de produção.
- `Docs/security/csp-policy-2026-05-15.md` — racional por diretiva.
- Commits: `4402acc` (CSP inicial restritiva), `331c2b1` (hardening
  + media-src + upgrade-insecure-requests + doc).
- `Docs/sessions/barney-security-regression-round5-2026-05-08.md` —
  gap #2 da auditoria Barney que originou `4402acc`.
- Manifesto §4 (anti-telemetria), §17 (sem chave mestra disfarçada).
