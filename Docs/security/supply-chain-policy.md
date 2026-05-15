# Supply-chain policy — Drift

**Versão:** 1.0 (2026-05-15)
**Mantenedor:** Eduardo Ferreira (Arquiteto)

Esta policy descreve como o Drift trata dependências npm para satisfazer
os compromissos do manifesto §17 (sem chave mestra, build reproduzível,
auditabilidade).

---

## 1. Princípios

1. **Lockfile é a fonte da verdade.** `package-lock.json` é comitado,
   nunca regenerado em CI. PRs que mexem no lockfile precisam justificar
   no commit message.
2. **Toda dep runtime é mínima e justificável.** Antes de adicionar dep
   nova, considerar: (a) implementar inline; (b) usar API web nativa;
   (c) reusar dep já presente. Adicionar dep nova requer entry em
   commit message explicando alternativa rejeitada.
3. **Deps criptográficas / de identidade são pinadas exato.** Hoje:
   `@sqlite.org/sqlite-wasm`. **Recomendado expandir** para:
   `nostr-tools`, `@scure/bip32`, `@scure/bip39`, `@noble/curves`,
   `@noble/hashes` — TODO Fase 6.

---

## 2. Cadência de audit

| Frequência | Ação |
|---|---|
| CI (todo push/PR) | `npm audit --audit-level=high` (soft fail) |
| Mensal | Revisar advisories abertos, decidir bump ou aceitar dívida |
| Pré-release (tag `v*`) | Gerar SBOM (`node scripts/gen-sbom.mjs`), anexar à GH Release |
| Trimestral | Audit completo (rerun deste doc com snapshot do npm audit) |
| Antes de Fase 6 GA | Audit dedicado de `helia`, `libp2p`, `@tauri-apps/*` |

---

## 3. Quando aceitar uma vuln aberta

Critérios para deixar uma CVE aberta sem fix imediato:

- ✅ Severity ≤ moderate **E** dep é dev/build only (não roda no
  client do user).
- ✅ Fix exige downgrade major incompatível **E** atacker model não
  se aplica (ex: GHSA do dev server vite quando o time não expõe
  `npm run dev` à internet).
- ✅ Documentar a decisão em `Docs/security/supply-chain-audit-*.md`
  com explicação clara.

**Nunca aceitar:**
- Critical em runtime dep.
- Vuln que afete crypto/identity (nostr-tools, @scure/*, @noble/*).
- Vuln com PoC público em runtime dep.

---

## 4. Adicionar dep nova — checklist

Antes de `npm install <pkg>`:

- [ ] É realmente necessário? (regra 2)
- [ ] Maintainer reputable? (org conhecida, histórico > 1 ano,
      release cadence consistente)
- [ ] Audit clean? (`npm view <pkg>` + check GHSA)
- [ ] Tamanho razoável? (BundlePhobia / `npm view <pkg> dist.unpackedSize`)
- [ ] License compatível com MIT (do Drift)?
- [ ] Documenta no commit message **por que** essa dep foi adicionada.

---

## 5. Bump policy

| Tipo | Quando aplicar | Review |
|---|---|---|
| Patch (x.y.Z) | Imediato em fix de CVE; mensal caso contrário | 1 reviewer |
| Minor (x.Y.0) | Após estabilidade (~2 semanas no npm) | 1 reviewer + tests verdes |
| Major (X.0.0) | Planejado, testes E2E manuais (PWA + Tauri) | Doc explicando breakage no CHANGELOG |

---

## 6. Forks internos / vendoring

Permitido em casos:
- Dep crítica abandonada (last publish > 18 meses, issues abertas
  sem resposta).
- Patch local urgente que upstream rejeitou.

Vendor copiado vai pra `vendor/<pkg>/` com `LICENSE` original
preservada + diff documentado.

---

## 7. SBOM

- Gerado por `scripts/gen-sbom.mjs` em formato CycloneDX 1.5.
- Anexado em todo GitHub Release a partir da v0.6.0.
- Permite a auditores externos / F-Droid validar build vs deps
  declaradas.

---

*Esta policy se renova com a v1.1 quando: Fase 6 GA fechar (helia
audit), ou quando uma vuln runtime crítica romper as premissas
acima.*
