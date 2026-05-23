# Barney — dead UX/UI audit (user-facing) 2026-05-23

**Persona:** Barney Stinson (peer review crítico, threat model, ceticismo)
**Foco:** confusão do usuário, superfícies incoerentes, ações destrutivas.
Ted faz audit arquitetural em paralelo (primitives duplicados, dead code
arquitetural). Esse doc cobre o lado **user-facing**.
**Método:** investigação aggressive em `src/components/**/*.tsx` + `src/App.tsx`.
Doc-only, não tocou código.

---

## Sumário executivo

- **18** inconsistências de copy/vocabulário pra mesma feature (P0: 6 · P1: 9 · P2: 3)
- **5** entry points duplicados pra Settings sub-cards
- **3** primitives mortos no repo (sem consumer real)
- **4** ações destrutivas com confirm inconsistente (1 usa native `window.confirm`)
- **2** spots com vocabulário SPREAD/protocol vazando pra UI (viola CLAUDE.md vocab mapping)
- **1** comentário JSDoc estruturalmente ENGANOSO em primitive ativo
- **6** títulos de Settings cards em `title=` (tooltip desktop-only num app mobile-first)

**Threat model UX**: 1 P0 confirmado (AppErrorBoundary destrutivo com UX
nativa que parece phishing), 2 P1 (silent enable de permissões sem feedback).

---

## 1. Duplicações de UI surface — mesmo target, paths divergentes

### 1.1. P0 — "Configurações" é acessível por 5 paths com 5 LABELS distintos

`src/App.tsx:1467` registra NavBar slot direito como:
```jsx
{ icon: <SlidersIcon />, label: 'config', onClick: () => pushLayer({ id: 'settings', component: SettingsRoot }) }
```

Mas o componente que abre tem `title="configurações"` (App.tsx:2335).

Tracing os entry points:

| Path | Label / Title | Arquivo:linha |
|---|---|---|
| NavBar bottom direita | `config` | App.tsx:1466 |
| Card title quando abre | `configurações` | App.tsx:2335 |
| StatusIndicators ícone GPS | abre `LocationCard` (sub de Settings) | App.tsx:1603 |
| StatusIndicators ícone NetIcon | abre `NetworkModeCard` | App.tsx:1590 |
| StatusIndicators ícone events | abre `StatusCard` | App.tsx:1616, 1629 |
| Onboarding step 'location' | refere `Ajustes → localização` | guidance.tsx:174 |
| PostViewer block confirm | refere `Ajustes → listas` | PostViewer.tsx:322 |
| GpsErrorBanner copy | `Ajustes → Safari` / `Ajustes → Privacidade` | GpsErrorBanner.tsx:160-164 |
| SpreadMap footer | `Ajustes ▸ Mapa` | SpreadMap.tsx:60 |
| SpreadMap action label | `abrir GPS settings` | SpreadMap.tsx:181 |
| GuideCard text | `Settings → identidade` / `Settings → location` | GuideCard.tsx:522, 538 |

User precisa de **3 vocabulários ativos na cabeça** ao mesmo tempo:
- "config" (NavBar)
- "configurações" / "Ajustes" (PT, em copy interna)
- "Settings" / "location" (EN, em strings JSX e onboarding)

E **4 deep-links** pro mesmo card. User abre via ícone GPS, depois via NavBar,
não tem mapa mental que é o mesmo lugar.

**Severidade P0**: user busca "Configurações" no app, vê só "CONFIG" (truncado),
não associa.

**Recomendação**: lock LOCK_VIA_TEST que strings JSX user-facing usam
`configurações` (mesma família "DRIFT/SINK" do CLAUDE.md). NavBar label
"configurações" cabe em 14 chars; só remover uppercase tracking-widest e
tornar text-[10px] cabe perfeitamente.

### 1.2. P1 — Long-press MAPA e tap MAPA acessam fluxos paralelos

`App.tsx:1451-1459` — NavBar MAPA tap → MapOverlay; long-press 3s →
MapExplainerCard. Zero affordance visível pro user descobrir que long-press
existe. (Documentado: "user descobre o que cada mapa significa sem ter que
abrir" — mas como descobre o long-press em si?)

Comparado com PR2 do onboarding que filtra steps por capability, esse "feature
oculto via long-press" é o oposto: feature pré-existe mas user não tem hint.

### 1.3. P1 — Dupla porta pra editar profile

`App.tsx:1265 onOpenProfile` + `IdentityPanel` também tem section profile
+ Header StatusIndicators tem ícone `<UserIcon>` → abre ProfileModal
(App.tsx:1577-1583).

ProfileModal vs EditProfileCard — dois arquivos. Ambos têm `dialog.confirm`
em diff confirmation flows (ProfileModal.tsx:105, EditProfileCard.tsx:73, 93).
User edita profile via 1 path, mas avatar header abre ProfileModal "vendo
profile" — dois fluxos paralelos.

---

## 2. Vocabulário SPREAD vazando pra UI (viola CLAUDE.md mapping)

### 2.1. P0 — `Feed/SpreadMap.tsx` mistura DRIFT (UI) com spread (protocol)

```ts
// linha 193 — empty state user-facing
'Nenhum spread com tag location ainda. Quando alguém com GPS ativo driftar, a rede aparece aqui.'

// linha 196 — empty state secundário
'Drifts deste post ainda não têm tag location. Quando alguém com GPS ativo driftar, aparece aqui.'
```

Mesma string mistura **"spread"** (raw protocol kind 9079) e **"driftar"** (UI).
CLAUDE.md vocab mapping é explícito: SPREAD é spec/código; DRIFT é UI.

**LOCK_VIA_TEST existente em `tests/manifesto-conformance.test.ts`** valida
`\bespalha|enterra\b` mas **NÃO valida "spread" em UI strings**. Gap no
conformance test.

### 2.2. P0 — `TimelineScrubber.tsx:73` aria-label/label "spread do post"

```ts
return `${count} ${count === 1 ? 'spread do post' : 'spreads do post'}`
```

User-facing, virou tooltip/label. Deveria ser "DRIFT" ou "drifts deste post".

### 2.3. P0 — `SettingsCards.tsx:288` FullPageCard title="mapa de spread"

```jsx
<FullPageCard onClose={onClose} title="mapa de spread" ariaLabel="enquadramento do mapa">
```

Card user-facing inteiro chamado "mapa de spread". Em outra ocorrência
(`MapExplainerCard.tsx`) chamamos de "mapa de DRIFT". Inconsistente.

### 2.4. P1 — `SettingsCards.tsx:1204, 1507` copy "mapa de spread"

Hint da permissão GPS: "necessário pra location nos posts e mapa de spread".
Description da privacy card: "mapa de spread mostra de onde os posts vieram".

User aprende "DRIFT" no onboarding e depois vê "spread" em Settings. Falha
mnemônica.

**Recomendação combo**: ampliar LOCK_VIA_TEST pra `\bspread(s)?\b` em strings
JSX (`>...<`). Whitelist controlada (DriftChip variant `spread` é prop, não
copy — ignorar tags onde está como prop).

---

## 3. Componentes "zumbi" e comentários stale

### 3.1. P1 — `HintModal.tsx` + `HintToast.tsx` — ZERO consumer real

Grep `<HintModal` e `<HintToast` em `src/`: nenhuma ocorrência. Só
`<HintChip>` é montado (App.tsx:1885).

Os arquivos existem com docstring elaborada explicando diferença vs
HintChip, mas nada renderiza. RFC DAOP-001 PR3 planejou expansão; PR3 não
veio. **Status: primitive infra pre-future, ~250 linhas total mortas em
produção.**

Não é catastrófico (não causa confusão user), mas é dead code que aparece
em audits subsequentes e em bundle/tree-shake analysis. **Flag pra Ted**:
mesma família dele (DRY/dead primitives), mas user-facing impact = zero,
então P1 pure cleanup.

### 3.2. P1 — `NavBar.tsx` comentário linha 25-29 MENTE

```jsx
* Status: ZERO CONSUMER em V3.3 — Drift atual usa header inline +
*   SubpostEditor always-mounted, o que torna bottom-nav structural
*   change (fora do escopo "visual only" de V3.x). Track futuro
*   (V7+ ou structural rework) consome este primitive.
```

Mas `App.tsx:1446` USA `<NavBar>` em produção há ≥V8. Comment stale por
~5 versões. Próximo dev/agent que ler vai pensar que é dead.

### 3.3. P2 — `LocalListsSettings.tsx:4` comentário usa "espalhar"

```
*   - Pinned: posts que o user "fixou" (manifesto §16, "espalhar = seedear")
```

Comentário interno — não vaza pra UI, então não quebra LOCK_VIA_TEST atual.
Mas viola filosofia de migrar vocab antigo. Vinheta histórica que deveria
sair.

---

## 4. Copy/strings inconsistentes (PT/EN, formal/informal)

### 4.1. P0 — "Ajustes" vs "Configurações" vs "Settings" em copy interno

Ocorrências:
- `PostViewer.tsx:322` — "Ajustes → listas" (no confirm de block)
- `guidance.tsx:174` — "Ajustes → localização"
- `GpsErrorBanner.tsx:160-178` — 4× "Ajustes" (Safari, Privacidade, sistema)
- `SpreadMap.tsx:60, 181` — "Ajustes ▸ Mapa" + "abrir GPS settings" (!!! mesma linha mistura PT + EN)
- `GuideCard.tsx:522, 538` — "Settings → identidade" / "Settings → location"
- `App.tsx:2335` — `title="configurações"`
- `App.tsx:1466` — NavBar `label: 'config'`

User vê 5 nomes pra mesma coisa. Severo.

### 4.2. P1 — "Configurações do site" (browser) vs "Ajustes" (sistema iOS) vs "configurações"(Drift)

`GpsErrorBanner.tsx:110, 160`:
- "Configurações do site" — copy ensinando user a navegar no Chrome
- "Ajustes → Safari → Localização" — copy iOS

Esse aqui faz sentido (vocab do device é o que ele tem). Mas o problema é
que o Drift também usa "Ajustes" no copy interno — user confunde com
"Ajustes do sistema". Sugiro Drift unificar pra **Configurações** sempre
(o título do card já é) e deixar "Ajustes" exclusivo pra iOS guidance.

### 4.3. P1 — Mistura tom verbo vs substantivo

Compare:
- ComposeOverlay botão: "publicar" (verbo) ✓
- IdentityPanel: "importar nsec" (verbo) ✓
- SettingsCards modes: "menu enxuto" / "menu detalhado" (substantivo)
- RelaySettings: "descobrir" (verbo) ✓
- ProfileModal: "ver perfil" + "editar" — botões em verbo, mas modal title é substantivo

Não tem PADRÃO. Em conformância visual com mockups (Syne uppercase
tracking-widest), substantivo curto é melhor. Padrão atual é caótico.

### 4.4. P2 — "voltar 1" vs "voltar pro topo" vs "atualizar"

`App.tsx:1818-1820` EndOfFeed exemplo — labels misturam concision/verbose.
Polish.

---

## 5. Affordances / threat model UX

### 5.1. P0 THREAT — `AppErrorBoundary.tsx:62` usa `window.confirm` nativo

```js
const ok = window.confirm(
  'Isso vai apagar TUDO armazenado localmente (posts, identidade, configurações). ' +
    'Se você tem o nsec backupado, pode re-importar depois.\n\nContinuar?',
)
```

**Resto do app inteiro usa `dialog.confirm` (DialogHost custom modal Drift).**
Native browser confirm:
1. Visual completamente diferente (parece bug ou phishing em PWA)
2. Não tem `dangerous: true` styling (button bold vermelho falta)
3. Não tem `okLabel` custom — botão "OK" genérico
4. Em iOS Safari PWA, native confirm às vezes bloqueia event loop ou nem aparece

**Threat real**: user em estado de erro (app travou) vê dialog estranho.
Pode aceitar achando que é "fix this error" — perde TUDO incluindo
identidade.

**Comparado com PostViewer.tsx:321 (block author)**:
```ts
await dialog.confirm(
  `Posts e interações deste autor somem do SEU feed (...). Você pode desbloquear depois em Ajustes → listas.`,
  { title: 'bloquear autor', dangerous: true, okLabel: 'bloquear' },
)
```
Esse aqui está certo. AppErrorBoundary deveria seguir mesmo padrão. Mas
não pode importar dialog/DialogHost porque error boundary é mounted
ABOVE provider — chicken/egg.

**Recomendação**: AppErrorBoundary inline custom modal (não native confirm)
estilizado igual DialogHost. Ou degradar pra `dialog.confirm` se boundary
foi triggered abaixo do provider tree (most cases).

### 5.2. P1 THREAT — Permissions card pede mic "reservado — futuro"

`SettingsCards.tsx:1226`:
```ts
{
  key: 'microphone',
  label: 'áudio / microfone',
  hint: 'reservado — speech e notas de voz (futuro)',
  requestFn: async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  },
},
```

User toca "permitir microfone" → browser pede permissão → user concede →
Drift NÃO USA. Mas a permissão browser-level fica granted. Cliente Drift
não pode forçar revoke. Footprint sem benefício.

**Threat**: user esquece, depois outra origem comprometida (XSS hipotético)
captura áudio. Manifesto §28 violação suave.

**Recomendação**: remove o item "microphone" do PERM_ITEMS até Drift
realmente usar. Ou pelo menos disabled com tooltip "indisponível —
versão futura".

### 5.3. P1 — Confirm `disablePasskey` (IdentityPanel:650) é UNDANGEROUS mas trata de identidade

```ts
const ok = await dialog.confirm(
  'O cliente vai parar de pedir autenticação no boot. ...',
  { title: 'desabilitar passkey', okLabel: 'desabilitar' },
)
```

Sem `dangerous: true`. Compara com `setIdentityFromNsec` (linha 495) que
TEM `dangerous: true`. Reversibilidade explica (passkey re-enable é
fácil; trocar identidade é destrutivo) — mas user não sabe disso. Visual
do confirm devia comunicar **gravidade da ação**, não reversibilidade
técnica. Disabling passkey = remoção de uma camada de segurança. Devia
ter destaque.

### 5.4. P1 — Silent enable de toggles em Settings

User toca Trust Lens strength slider → muda visualmente o feed. Sem
toast/feedback "lente aplicada". Audit anterior (settings-friction-audit
2026-05-18 §1.4) já flagou — confirmando aqui que ainda vale.

### 5.5. P2 — `title=` tooltip-only em mobile-first app

79 ocorrências de `title="..."` em components/. Tooltips só aparecem em
hover desktop. Drift é mobile-first. Affordance literalmente invisível.

Ex: `StatusIndicators` botões — todos têm `title=` (App.tsx:1580, 1594,
1607, 1620, 1631). Mobile user vê ícone, não sabe o que é.

Mitigado parcialmente por `aria-label`, que screen readers leem — mas
sighted mobile users sem screen reader não veem nada.

---

## 6. Empty / error / loading states

### 6.1. P1 — `HomeEmpty` (App.tsx:1781) seguindo mensagem assume "novo user"

```ts
tab === 'following'
  ? 'Você não segue ninguém ainda. Toque ➕ pra criar seu primeiro post — depois siga autores ao abrir os posts deles.'
```

Mas user pode estar na tab seguindo após **deixar de seguir** todo mundo.
Empty state oferece "criar primeiro post" mesmo pra user que já tem 50 posts.
Stale phrase pra esse cenário.

### 6.2. P1 — `SpreadMap.tsx:193` empty state spread map

Já citado em §2.1. "Nenhum spread com tag location" — user não sabe o que é
"tag location" (jargão protocol).

### 6.3. P1 — `FeedSnapshotAgeBadge` (App.tsx:1752-1779) só aparece quando stale

Quando snapshot é recente, badge invisível. User não sabe que existe
"feed atualizado há X" como conceito até feed envelhecer. Não é
problema crítico mas inconsistente — outros indicadores (events count,
GPS status) ficam visíveis sempre.

### 6.4. P2 — `DriftSkeleton` usado em 7 lugares; Comment tab usa diferente em ThreadView

`ThreadView.tsx:430` usa `<DriftSkeleton variant="card" count={3} />`. Outros
lugares usam `variant="card"` sem count, ou `variant="image"`. Consistente
em primitive, mas `count=3` em apenas 1 lugar é divergente. Ted's domain.

---

## 7. Top 10 confusões reais que user já bate (sem reportar)

1. **"Onde está Configurações?"** — vê CONFIG na NavBar, busca por
   "Configurações" e não acha (P0, §1.1).
2. **"Mapa de spread"** — abre Settings → "ah, mapa de spread? mas a UI
   chama DRIFT?" (P0, §2.3).
3. **Onboarding diz "Ajustes → localização"** — user procura "Ajustes"
   no app, não acha (P0, §4.1).
4. **Long-press MAPA** — feature existe, user nunca descobre (P1, §1.2).
5. **AppErrorBoundary native confirm** — alert estranho aparece, parece
   bug (P0 threat, §5.1).
6. **Permissão de microfone solicitada sem uso** — concede achando que
   feature usa, depois nada acontece (P1 threat, §5.2).
7. **GPS ícone no header** — user clica e abre o mesmo lugar que CONFIG
   abre, mas não percebe (P1, §1.1).
8. **PostViewer block confirm refere "Ajustes → listas"** — user nunca
   acha "Ajustes" (P0, §4.1 + §1.1).
9. **Trust Lens slider sem feedback** — user mexe, feed muda, mas zero
   toast (P1, §5.4 + 2026-05-18 audit).
10. **Tooltip `title=` em ícones de StatusIndicators** — mobile user
    não vê (P2, §5.5).

---

## 8. Top 5 threats UX

1. **P0 — AppErrorBoundary native `window.confirm` em fluxo destrutivo**
   (§5.1). Pior caso: user perde nsec achando que está consertando bug.
2. **P1 — Permissão de microfone solicitada SEM uso real** (§5.2).
   Footprint de permissão browser sem benefício.
3. **P1 — Silent enable de toggles** (§5.4). Trust Lens muda feed sem
   confirmar; user não sabe que mudou.
4. **P1 — `disablePasskey` sem `dangerous: true`** (§5.3). Reduz
   percepção de gravidade.
5. **P2 — `title=` tooltip-only em mobile** (§5.5). Ícones de
   StatusIndicators ficam mudos em mobile sem screen reader.

---

## 9. Itens "remova já" — quick wins zero cascading impact

| Item | Arquivo:linha | Ação | Impacto |
|---|---|---|---|
| Comment "ZERO CONSUMER" mentiroso | `NavBar.tsx:25-29` | Update docstring | doc-only |
| "espalhar = seedear" em comment | `LocalListsSettings.tsx:4` | Trocar pra "DRIFT = seedear" | doc-only |
| Empty state "Nenhum spread" | `SpreadMap.tsx:193, 196` | Trocar "spread" → "DRIFT" | copy-only |
| "mapa de spread" Settings title | `SettingsCards.tsx:288, 1204, 1507` | Trocar pra "mapa de DRIFT" | copy-only |
| "spread do post" / "spreads do post" | `TimelineScrubber.tsx:73` | Trocar pra "DRIFT do post" | copy-only |
| "Ajustes → ..." em copy interno Drift | `PostViewer.tsx:322`, `guidance.tsx:174`, `SpreadMap.tsx:60`, `GuideCard.tsx:522, 538` | Trocar pra "Configurações → ..." | copy-only |
| "abrir GPS settings" (mistura PT+EN) | `SpreadMap.tsx:181` | "abrir configurações de GPS" | copy-only |
| Microfone em PERM_ITEMS | `SettingsCards.tsx:1223-1231` | Remover ou disable visual + tooltip "futuro" | threat |
| `disablePasskey` confirm | `IdentityPanel.tsx:650` | Add `dangerous: true` | threat |
| AppErrorBoundary `window.confirm` | `AppErrorBoundary.tsx:62` | Substituir por custom modal estilo DialogHost | threat P0 |
| HintModal + HintToast files | `src/components/UI/HintModal.tsx`, `HintToast.tsx` | Remover ou mover pra `Docs/archive/primitives-reserved/` até PR3 chegar | cleanup |

---

## 10. Convergência com Ted (paralelo)

Itens onde Barney (user-facing) e Ted (arquitetura) provavelmente vão
sobrepor — heads-up:

- **HintModal/HintToast dead** (§3.1) — Ted vai pegar como primitive
  duplicado sem consumer; Barney cobre o side-effect (são primitives
  reservados pra PR3 que não veio).
- **NavBar stale comment** (§3.2) — Ted cobre como arquitetural drift
  (comment stale = doc rot); Barney cobre como next-dev confusion.
- **"mapa de spread" + variants** (§2) — Ted pode pegar via grep como
  inconsistência de naming; Barney enquadra como vocab UI vs protocol.
- **`title=` tooltip-only** (§5.5) — Ted talvez não pegue (não é
  arquitetural); Barney prioriza.
- **AppErrorBoundary native confirm** (§5.1) — Ted talvez pegue como
  divergência de pattern; Barney enquadra como threat UX.
- **Padrão recomendado**: nova primitive `<DriftConfirmInline>` que
  AppErrorBoundary pode usar pré-provider (Ted's territory). Flag pra
  ele caso valha DRY 3+ usages — atualmente seria 1 só, então provavelmente
  não merece primitive ainda.

---

## 11. Bonus — padrões que poderiam virar primitive (heads-up pra Ted)

Durante o audit, vi 3 ad-hocs candidatos a primitive:

1. **Deep-link Setting**: `onOpenLocation/Network/Status/Profile/Identity`
   callbacks proliferaram em 5+ components (App.tsx, PostViewer, SpreadMap,
   StatusIndicators). Padrão "abrir Setting X" merece tipo unificado
   `SettingsDeepLink = 'location' | 'network' | ...` + `openSetting(key)`.
   Ted's domain.
2. **Native vs custom dialog**: AppErrorBoundary usa native; resto usa
   `dialog.*`. Justifica primitive `<InlineConfirm>` pra error boundaries
   pré-provider. 1 callsite ainda — não merece primitive AINDA.
3. **Empty state cards** (HomeEmpty + SpreadMap empty + EndOfFeed +
   ThreadView "sem comentários"). 4 ad-hocs. Justifica primitive
   `<EmptyStateCard>` com props `icon | message | cta?`. Vale 3+ rule.
   Ted's call.

---

## Status

- Doc-only, zero código tocado.
- LOCK_VIA_TEST `manifesto-conformance.test.ts` continua verde (nada quebrei).
- Recomendação cycle: dispatch pra spawn task (`remove-spread-in-ui-copy`)
  + backlog para itens 5.1 e 5.2 (threats).

Legendary OR trash? **Trash mas reversível** — 6 P0 são todos copy/refactor
mecânicos. Threat UX P0 (5.1) precisa pensar (chicken/egg do provider
tree). Resto é polish.

— Barney
