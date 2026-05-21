# Audit — `bg-drift-surface/30` + `border-*/30` cross-codebase

**Data:** 2026-05-20
**Trigger:** BACKLOG item — preocupação que `/30` opacity classes possam
ser invisíveis em tema Velatura (mesmo padrão que motivou fix
[45cd93f] do radio-group active state).
**Scope:** doc-only (sem replace bulk — Marshall pick: bulk seria
catástrofe; caso-a-caso quando user reportar fricção visual).

---

## Counts (131 ocorrências em 22 arquivos)

| File | Count |
|---|---|
| `src/components/Identity/IdentitySwitcher.tsx` | 22 |
| `src/components/Settings/SettingsCards.tsx` | 13 |
| `src/components/Post/ReplySheet.tsx` | 11 |
| `src/components/Identity/IdentityPanel.tsx` | 11 |
| `src/App.tsx` | 10 |
| `src/components/Settings/RelaySettings.tsx` | 8 |
| `src/components/Settings/DiscoverRelaysCard.tsx` | 7 |
| `src/components/Create/ComposeOverlay.tsx` | 7 |
| `src/components/Post/ReportModal.tsx` | 6 |
| `src/components/Profile/{ProfileModal,EditProfileCard}.tsx` | 10 |
| `src/components/UI/{GpsErrorBanner,DialogHost,DriftAlert,RelayTierBadge,PeerInterstitial}.tsx` | 14 |
| `src/components/Settings/{SuaLenteCard,LocalListsSettings,AppearanceCard}.tsx` | 8 |
| `src/components/Post/{ThreadHeader,PostViewer,CommentCard}.tsx` | 4 |

---

## Classificação dos usos (sample audit em 10 callsites)

Vasta maioria dos `/30` é **uso passivo legítimo**, não active state.
Padrões observados:

1. **Divider sutil** (`border-drift-border/30` em separadores)
   → OK em todos 3 temas; divider deve ser sutil por design

2. **Background "papel"** (`bg-drift-surface/30` em rows alternadas,
   chip backgrounds inativos, modal backdrops)
   → OK; é o estado base low-emphasis intencional

3. **Outline de input idle** (`border-drift-border/30`)
   → OK; idle state deve ter low contrast; focus-ring assume o destaque

4. **Active state** — **NENHUM caso encontrado** com `/30` no active
   path nos arquivos amostrados. O fix [45cd93f] do radio-group +
   commit [05ac4d6] que migrou `text-drift-muted/30 → /60` em bulk
   parecem ter coberto os reais ofensores.

---

## Diagnóstico

**Não há ação imediata necessária.** O padrão `/30` em opacity
**é apropriado pra estados passivos** (divider, idle outline,
background sutil). Substituir por `/60` ou `/50` em bulk **pioraria**
a hierarquia visual desnecessariamente.

O LOCK_VIA_TEST específico que protege contra regressão futura é o
**`RadioGroupButton` primitive shipped em [e3415d3]**: previne que
novos radio-groups usem `/30` no active state via centralização do
primitive + conformance test.

---

## Recomendação

- **Manter status quo** nas 131 ocorrências atuais
- **Adicionar review check** em PR review: se uma classe `/30`
  aparecer em **active/selected state** (não passivo), questionar e
  pedir migração pra triplet WCAG-safe `border-drift-accent +
  bg-drift-accent/15 + text-drift-accent`
- **Não criar LOCK_VIA_TEST global** — falso positivo overhead seria
  alto (centenas de matches legítimos)

---

## Reabrir se

- User reportar fricção visual concreta em Velatura/Cinder/Rosenholz
  numa view específica
- Acessibilidade audit external (WCAG AAA) flagar
  contrast specifico de um componente
- Lily UX session revisitar hierarquia visual e questionar padrão

---

*Audit registrado 2026-05-20. BACKLOG item fechado em [hash do
commit deste arquivo]. Reabrir requer caso concreto, não suspicion
geral.*
