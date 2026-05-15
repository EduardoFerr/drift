# ADR — Multi-identidade compartilha master key AES-GCM

**Date:** 2026-05-15
**Status:** Established (decisão histórica formalizada; flagged por Barney B2 — sem ADR anterior)
**Manifesto refs:** §3 (identidade portável, dispositivo descartável), §4 (anonimato), §8 (nsec nunca em claro), §17 (sem chave mestra)

## Context

Drift suporta múltiplas identidades por dispositivo (Fase 5, manifesto
§4 anonimato — user pode ter persona pública + persona anônima +
persona de teste, etc.). Implementado em `src/lib/identities.ts` com
tabela `identities` (plural; `npub`, `label`, `nsec_encrypted`,
`created_at`, `imported`).

Cada `nsec` por identidade é cifrado AES-GCM 256 com a **mesma**
master key não-exportável guardada em IndexedDB separada do OPFS
(`src/lib/crypto.ts:encrypt/decrypt`). Master key é gerada na primeira
boot e nunca exportada; é o único segredo que o browser detém em
runtime.

Trocar identidade ativa não rotaciona master key — só seleciona qual
row de `identities` carregar.

## Problem

Modelo alternativo: master key **por identidade** (cada nsec cifrado
com sua própria chave derivada / armazenada separadamente). Teoricamente
mais forte: comprometer master key de uma identidade não compromete
outras.

Barney (B2 — peer review crítico) flaggou ausência de ADR registrando
**por que master key é compartilhada** entre identidades.

Trade-off:

- **Compartilhada (atual):** 1 ponto de compromisso → todas as
  identidades caem juntas. Simpler. UX consistente (1 unlock por
  device).
- **Por identidade:** isolation forte (compromisso de A não derrama
  pra B). Multi-unlock no boot (N prompts ou switch-time unlock).
  Master key per-identity precisa derivar de **algo** — password
  forte (UX hostil) ou hardware-bound (passkey, mas user pode não
  ter authenticator).

## Decision

**Master key única compartilhada entre identidades no cliente
oficial padrão.**

Racional:

1. **Threat model do Drift assume dispositivo confiável.** Se o
   adversário tem extract-level access à IndexedDB do browser
   (extensão maliciosa, malware com privilege, forense físico),
   ele tem acesso à máquina inteira — a master key sair primeiro
   ou segunda não muda outcome real.

2. **Manifesto §3: dispositivo é descartável, identidade não é.**
   A defesa primária é portabilidade do nsec (export → import em
   device limpo), não isolation per-identity no mesmo device. Se
   user perde controle do device, ele migra para device novo
   — não tenta "salvar uma identidade enquanto perde outra" no
   mesmo aparelho comprometido.

3. **UX: 1 unlock per device é manifesto §1 (UX humana, gestos
   diretos).** N unlocks viraria fricção que afasta o user de
   usar múltiplas identidades — o oposto do objetivo (§4 anonimato
   por design exige multi-identity natural, não custosa).

4. **Passkey opt-in (§30.13) cobre o gap de UX-vs-segurança
   honestamente.** User que quer hardware gate ativa Passkey;
   isso protege a master key compartilhada via WebAuthn —
   compromisso mais simétrico que "uma chave por identidade
   derivada por password".

5. **Cliente alternativo pode implementar per-identity keys.**
   Manifesto §32 — protocolo é o contrato, cliente é escolha.
   Drift oficial padroniza UX-baixa-fricção; quem quer isolation
   máxima pode fork (ou usar npub direto em cliente Nostr standard
   que já trata cada nsec independente).

## Consequences

**Positivas:**

- 1 unlock per device — UX preserva manifesto §1 (gestos diretos,
  baixa fricção).
- Implementação simples — `encrypt()` único, sem key derivation per
  identidade, sem N prompts de auth no boot.
- Migration de device (export nsec → import novo device) funciona
  por identidade sem coreografia de "migrar a chave certa".

**Negativas:**

- Compromisso de master key vaza todas as identidades de uma vez.
  Aceito porque o modelo de ameaça **não inclui "device parcialmente
  comprometido onde quero salvar identidade B mas perder A"**.
- Per-identity isolation no mesmo device é deixada pra cliente
  alternativo. Documentar isso é responsabilidade da postura
  "software-not-service".

## Alternatives considered

1. **Master key por identidade derivada de password forte.** UX
   hostil (user inventa password forte por identidade, lembra todas,
   digita no boot). Rejeitado — afasta uso de multi-identidade,
   contradiz §4 (anonimato por design = natural).

2. **Master key por identidade derivada de Passkey distinto.** Exige
   N credenciais WebAuthn (ou N derivações da mesma). Hardware
   compatível inconsistente, opt-in baixo. Rejeitado para o
   default; passkey segue opt-in pra master key compartilhada
   (§30.13).

3. **Master key por identidade derivada do próprio nsec.** Auto-defeating
   — se adversário lê IndexedDB ele já tem o nsec_encrypted e a
   derivação. Rejeitado.

4. **Encrypted vault hierárquico (master key cifra DEKs por
   identidade).** Estrutura mais complexa, ganho real só contra
   adversário que lê **parte** da IndexedDB e não outra — modelo
   raro. Rejeitado por complexidade vs ganho.

## References

- `src/lib/identities.ts` — implementação multi-id (linhas 122-211).
- `src/lib/crypto.ts` — `encrypt/decrypt` AES-GCM 256, master key
  não-exportável.
- `Docs/decisions/2026-05-15-bip39-passkey-optin.md` referência
  cruzada (passkey gate da master key compartilhada). *(Nota: ADR
  ainda não criada — decisão atualmente vive em arquitetura §30.13.)*
- Manifesto §3, §4, §8, §17.
- Audit Barney B2 — flag de ausência de ADR (esta ADR responde).
- `CLAUDE.md` invariante §15 (multi-identidade pipeline).
