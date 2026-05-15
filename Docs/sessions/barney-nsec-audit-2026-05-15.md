# Barney — Re-Audit nsec / Crypto (Manifesto §8)

**Data:** 2026-05-15
**Persona/escopo:** revisão de segurança (Barney). Foco em manuseio
de `nsec` (chave secp256k1 privada), master key AES-GCM, persistência,
multi-identidade, BIP39 (NIP-06) e WebAuthn opt-in.

**Alvos auditados:**

- `src/lib/crypto.ts`
- `src/lib/identity.ts`
- `src/lib/identities.ts`
- `src/lib/bip39.ts`
- `src/lib/passkey.ts`
- `src/components/Identity/IdentityPanel.tsx` (read-only)
- `src/components/Identity/IdentitySwitcher.tsx` (read-only)
- `vite.config.ts` (sourcemaps)

**Resultado executivo:** o pipeline cripto está sólido. Nenhuma
vulnerabilidade que vaze `nsec` foi encontrada. Um bug de
disponibilidade multi-identidade (não exposição) foi identificado e
está documentado abaixo como ⚠️-alto. Várias recomendações de
hardening listadas no fim, sem urgência.

---

## Threat model curto

| Atacante | Capacidade | Defesa atual |
|---|---|---|
| **XSS no DOM** (e.g., injeção via dependência comprometida) | Pode chamar `getOrCreateIdentity()` e ler `cached.nsec` da memória | Mitigação parcial: CSP em prod (Vercel), master key não-exportável evita exfil via `crypto.subtle.exportKey`. **Sem defesa total** — JS rodando no mesmo origin tem acesso integral. Manifesto §8 já reconhece "dispositivo é fronteira de confiança". |
| **Acesso raw ao IndexedDB / OPFS** (forense, dump do perfil do browser) | Lê ciphertext do nsec no SQLite + CryptoKey object no IndexedDB | Master key é `extractable: false` → CryptoKey serializa no IDB mas a chave bruta não pode ser extraída via JS (browser enforce). Mover o profile pra outra instância pode ou não funcionar dependendo de scoped key storage. |
| **Device fisicamente unlocked** | Abre o app, navega pra IdentityPanel → reveal → copy | Defesa = nada no nível cripto. UX (toggle "revelar", confirm checkbox) força ato deliberado. Passkey opt-in (Fase 5) adiciona prompt biométrico antes de boot. |

Defesa primária é o limite do device. Cripto-local protege contra:
exposição casual em logs, dumps de backup, sync de extensão maliciosa
no SQLite, leitura de OPFS via outra origem.

---

## Itens auditados

### 1. nsec gerado por CSPRNG — ✅ PASS

- `identity.ts:89`, `identities.ts:118`, `bip39.ts:60` usam
  `generateSecretKey` (nostr-tools/pure) — internamente delega a
  `@noble/secp256k1` que usa `crypto.getRandomValues`.
- `bip39.ts` deriva via `mnemonicToSeed` (PBKDF2-HMAC-SHA512 2048
  iters via `@scure/bip39`) + HDKey BIP32.
- `crypto.ts:93`: IV via `crypto.getRandomValues(new Uint8Array(12))`.
- `passkey.ts:112,157`: challenge via `crypto.getRandomValues(32)`.
- Grep `Math.random` em paths cripto = **clean**. As ocorrências de
  `Math.random` no codebase (`upload.ts`, `webrtc/boot.ts`, etc.) são
  para jitter / IDs não-criptográficos, não para keys.

### 2. Master key `extractable: false` — ✅ PASS

- `crypto.ts:44-48` — `crypto.subtle.generateKey({name:'AES-GCM',
  length:256}, false /*extractable*/, ['encrypt','decrypt'])`.
- O segundo argumento `false` proíbe `crypto.subtle.exportKey` e
  `wrapKey` na master key. Browser enforce nativo.
- Único ataque que extrai a chave: alguém com acesso de baixo nível
  ao IndexedDB raw + reconstrução interna de Chrome — fora do
  threat model do cliente PWA.

### 3. AES-GCM com IV único por encrypt — ✅ PASS

- `crypto.ts:93`: cada `encrypt()` gera **novo** IV de 12 bytes via
  CSPRNG. Não há reuso possível (sem counter persistente, sem cache
  do IV).
- IV é prependado ao ciphertext (`crypto.ts:97-100`), padrão correto
  pra AES-GCM.
- 12 bytes = 96 bits = espaço de 2^96, probabilidade de colisão pra
  qualquer volume realístico de identidades é nula (manifesto §28
  cliente local; nem milhões de encrypts colidiriam).

### 4. Auth tag verificada no decrypt — ✅ PASS

- `crypto.ts:108`: usa `crypto.subtle.decrypt({name:'AES-GCM',iv},
  key, ciphertext)`. WebCrypto **sempre** verifica o auth tag em
  AES-GCM; tag inválido = `OperationError` thrown. Não há flag pra
  desabilitar.
- `identity.ts:65-83`: trata `decrypt` failure com `console.warn` +
  `resetIdentity()`. **Não** ignora silenciosamente — falha de tag
  = identidade local descartada (defesa contra ciphertext adulterado
  ou master key dessincronizada).

### 5. nsec em memória só durante uso, zeroed após — ⚠️ best-effort

- `identity.ts:27`: `let cached: DriftIdentity | null = null` —
  cache global durante sessão. Mantém `nsec` (hex string), `npub`,
  `nsecBech32` em memória pro tempo de vida da aba.
- **JS não permite zeroing real:** strings são imutáveis, GC
  decide quando coletar. Mesmo `Uint8Array.fill(0)` antes de drop
  só funciona se a engine não copiou pra outro lugar.
- `getOrCreateIdentity` faz cache aware: já decriptado uma vez,
  segue em memória pra assinar eventos sem re-decrypt (perf trade-off
  explícito — comentário no header do arquivo).
- **Não é exposição** — XSS já tem o mesmo poder via `crypto.subtle`
  call no contexto. Compromise de DOM = compromise de nsec, com ou
  sem cache.
- Recomendação só de hardening (ver fim).

### 6. Persistência: só ciphertext em IndexedDB/SQLite, nunca em
   localStorage — ✅ PASS

- Grep `localStorage.*nsec` = clean (no matches).
- Grep `localStorage.*sk\b|localStorage.*secret` em `src/lib/` =
  clean.
- `identity.ts:103`: `INSERT INTO identity (npub, nsec_encrypted,
  ...) VALUES (?, ?, ?)` com `await encrypt(nsecHex)` — só
  ciphertext entra no SQLite.
- `identities.ts:126,171`: idem na tabela `identities` (plural).
- Master key: CryptoKey object no IndexedDB `drift-keys/keys`
  store, separado do OPFS onde SQLite vive. Cumpre invariante #8 +
  comentário em `crypto.ts:13`.

### 7. Export exige confirm; reset oferece export antes — ✅ PASS

- `IdentityPanel.tsx:218-233`: BackupTab tem checkbox "guardei o
  nsec em local seguro" + reveal toggle. Não-gate (manifesto §3
  user detém a chave) mas guia UX deliberado.
- `IdentityPanel.tsx:285-292`: ImportTab usa `dialog.confirm(
  'Importar uma nova identidade APAGA a identidade atual ...
  Você fez backup?', { dangerous: true })` antes de chamar
  `setIdentityFromNsec`.
- `IdentitySwitcher.tsx:161-167`: removeIdentity dispara dialog
  com cópia explícita "Recomendado exportar antes" + manifesto §3
  ref.
- Não é gate hard (user pode skipar) — alinha com filosofia §17
  (sem chave mestra disfarçada de "proteção contra você mesmo").

### 8. Multi-id isolation: id A não pode decifrar B — ⚠️ NÃO, mas
   sem exposição

**Achado:** A master key é **única por dispositivo**, não
**por identidade**. Todas as N identidades em `identities` (plural)
são encriptadas com a mesma `drift-master-key` em IndexedDB.

Isso significa:

- **Isolation efetivo:** nenhuma identidade "vê" o nsec da outra em
  runtime (cada `nsec_encrypted` é decifrado on-demand quando a
  identidade vira ativa).
- **Compromise scope:** atacante que extrair a master key + dump do
  SQLite decifra TODAS as identidades. Não é mais ruim que single-id
  porque já parte do mesmo dispositivo.
- **Bug de disponibilidade — ⚠️ MÉDIO-ALTO (ver §“Vulnerabilidade
  de disponibilidade”):** `setIdentityFromNsec` (legacy single-id
  import flow) chama `resetMasterKey()` antes de re-encriptar com
  uma master key NOVA. Se o user tem múltiplas identidades em
  `identities` (plural), todas viram lixo (ciphertext orphan
  decryptable só pela master anterior, que foi descartada). É bug
  de UX/disponibilidade, **não** exposição de nsec.

Recomendação: per-identity key derivation (HKDF da master + npub
como salt) — ver hardening §H1.

### 9. BIP39 path NIP-06 — ✅ PASS

- `bip39.ts:32` — `const NIP06_PATH = "m/44'/1237'/0'/0/0"` —
  exatamente como NIP-06 especifica (coin type 1237 reservado pra
  Nostr).
- Coverage: `tests/bip39.test.ts` cobre vectors NIP-06 oficiais
  (verify in `npm run test`).

### 10. WebAuthn: gate UX, não rest-crypto — ✅ PASS

- `passkey.ts:174-179`: comentário explícito "Validamos só que o
  user passou no prompt nativo. Não validamos a assinatura
  criptograficamente porque não temos backend".
- Não tenta proteger o nsec em rest (a master key continua sendo a
  defesa cripto). Passkey só é gate de UX antes do boot revelar o
  app.
- `IdentityPanel.tsx:470-472` deixa esse trade-off explícito pro
  user na PasskeyTab.

### 11. `console.log(nsec)` / debug leak — ✅ PASS

Grep `console\.(log|debug|info|warn|error).*nsec` (case-insensitive)
em `src/`: **0 matches**.

Grep `console\.(log|debug|info).*\b(sk|secret|nsec|privKey|
privateKey)\b`: **0 matches**.

Único console em `identity.ts:76` loga o **erro** de decrypt (sem
nsec, só `OperationError`). `IdentityPanel.tsx:113,122` logam erro
de QR/clipboard sem nsec.

### 12. Errors não vazam nsec em stack trace / message — ✅ PASS

Mensagens de erro em validação de input (`identity.ts:152,156`,
`identities.ts:155,159`, `bip39.ts:72,80`) só revelam o **tipo** ou
**tamanho** ou validade do checksum — nunca o conteúdo. Decoded
`nsecBytes` só passa em variáveis locais; nenhum throw os
interpola.

### 13. SourceMaps em prod — ✅ PASS

`vite.config.ts:229`: `sourcemap: 'hidden'`. Gera `.map` ao lado
dos `.js` mas o bundle minified **não** referencia (`//#
sourceMappingURL=` omitido). Lighthouse silent, debug em prod ainda
possível via upload manual do `.map`.

Comentário no arquivo (vite.config.ts:226-228) cita explicitamente:
"Manifesto §17 (sem chave mestra) não regride — bundle não embute
segredos (nsec/master key nunca em runtime)."

---

## Vulnerabilidade de disponibilidade (não nsec leak)

**Classificação:** ⚠️ médio-alto (data-loss bug, não cripto-vuln).
Não fixado neste commit por exigir migration plan + decisão de
schema (ver §H1). Documentado pra follow-up.

**Cenário:**

1. User adiciona N identidades via `IdentitySwitcher` (cria nova,
   importa nsec1 via NIP-06 — ambos chamam `importIdentityNsec` /
   `createNewIdentity` em `identities.ts`).
2. User abre `IdentityPanel` → tab "importar" → cola nsec1 antigo.
3. UI chama `setIdentityFromNsec` em `identity.ts:139`.
4. Linha 164: `await resetIdentity()` → `resetMasterKey()` apaga a
   master key.
5. Linha 165: `persistIdentity()` chama `encrypt(nsecHex)` →
   `getOrCreateMasterKey()` gera **nova** master key.
6. Resultado: `identities` (plural) tem N-1 rows com `nsec_encrypted`
   criptografado pela master ANTERIOR, agora não-decifrável. Mesmo
   tendo o nsec1 backup, o user precisa re-importar cada identidade
   pra recuperar.

**Por que não é nsec leak:** atacante não ganha acesso. User só
perde acesso local. nsec1 backup recupera.

**Por que não fixar inline:** o fix correto é tornar `setIdentityFromNsec`
um wrapper em torno do fluxo multi-id (delegar pra
`importIdentityNsec` + `setActiveIdentity`). Isso muda o contrato
da tabela `identity` (singular) e cruza com refactors que outros
agents podem estar tocando. Vai pra follow-up dedicado.

**Workaround imediato (já presente):** `IdentitySwitcher` tem fluxo
próprio que **não** passa por `setIdentityFromNsec` — user
multi-id é guiado pra UI correta. `IdentityPanel` "Import" tab é
legacy single-id flow; modificar exige UX review.

---

## Hardening sugerido (sprint futuro)

### H1. Per-identity key derivation

Hoje: 1 master key encripta N nsecs. Risco: 1 reset corrompe todos.

Proposta: derivar uma sub-key por identidade via HKDF:

```
identity_key(npub) = HKDF-SHA256(
  ikm = master_raw_key,
  salt = SHA256("drift-identity:" + npub),
  info = "drift-aes-gcm-256",
  length = 32
)
```

Master key precisaria virar `extractable: true` ou usar HKDF
diretamente via WebCrypto subtle (suporta — `deriveKey` com
HKDF). Pode manter master non-extractable e usar `subtle.deriveKey`
pra spawnar derived keys non-extractable também. Tradeoff: complica
o code path, mas isola identidades realmente.

### H2. Migração: tabela `identity` (singular) sai

Long-term: deletar a tabela legacy `identity` (singular) e ler
sempre da `identities` (plural) + `user_prefs.active_identity`.
Hoje há sync forçado em `identities.ts:208-212` (`DELETE FROM
identity; INSERT INTO identity ...`). Esse sync é a raiz da bug em
§"Vulnerabilidade de disponibilidade".

### H3. Memory hygiene best-effort

`identity.ts:cached` poderia expor `clearActiveNsec()` chamado em
`window.addEventListener('beforeunload')` pra zerar referências.
Não previne leak via XSS (atacante chama `getOrCreateIdentity()`
de novo) mas reduz superficie de heap dump pós-tab-close.

### H4. CSP estrita em produção

Adicionar header `Content-Security-Policy` em `vercel.json`
limitando `script-src` a `'self'` + hashes específicos. Defesa
em profundidade contra XSS via dependência comprometida.
(`'unsafe-inline'` precisaria fica fora; verificar se Vite-PWA
gerou inline scripts pra eliminar primeiro.)

### H5. IndexedDB integrity check no boot

Antes de tentar decifrar `nsec_encrypted`, checar
`crypto.subtle.encrypt + decrypt` round-trip com um sentinel
("drift-master-sentinel") armazenado junto da master key. Se
sentinel não decifra, master foi adulterada / dessincronizada —
emitir warning específico em vez de cair direto em "identidade
gerada nova".

### H6. Subresource Integrity já tem baseline

Manifesto / CLAUDE.md menciona "SRI sha384 baseline em dist
artifacts" — confirmado, fora do escopo desta auditoria.

---

## Tests

Tests existentes que cobrem este escopo (todos verdes em
`npm run test --run`, 1028 pass / 6 todo / 78 files):

- `tests/bip39.test.ts` — vectors NIP-06, derivação determinística.
- `tests/identities.test.ts` — CRUD multi-id, active switching.
- `tests/identity-backup.test.ts` — parse/serialize backup JSON.

**Não adicionado novo test** porque não há fix neste commit
(audit-only). Quando H1 for implementado, adicionar:

- Round-trip encrypt/decrypt com 2+ identidades sem cross-talk.
- Regressão para §“Vulnerabilidade de disponibilidade”:
  setActiveIdentity após `setIdentityFromNsec` em fluxo multi-id
  deve preservar os outros nsecs.

---

## Conclusão

Pipeline cripto-em-rest do nsec está alinhado com manifesto §8.
Geração CSPRNG, master key não-exportável, AES-GCM IV-unique,
auth tag enforce, persistência só de ciphertext, sourcemaps
ocultos, zero `console.log(nsec)`. Itens §1, §2, §3, §4, §6, §7,
§9, §10, §11, §12, §13 passam limpo.

Único achado material: §8 multi-id usa master key compartilhada e
o flow legacy `setIdentityFromNsec` reseta essa master — bug de
disponibilidade, sem exposição de nsec. Documentado pra follow-up
(plano H1 + H2).

Hardenings recomendados (H1-H5) ficam pra próximas iterações —
nenhum é blocker pra release atual.

— *Barney, 2026-05-15*
