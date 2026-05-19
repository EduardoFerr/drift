# Settings/menus friction audit — novice user lens

**Data:** 2026-05-18
**Trigger:** user 2026-05-18 — "a maior parte dos menus e configurações um usuário comum não sabe do que se trata, do impacto que a configuração tem, ou outras mais avançadas não dá para ele saber como configurar".
**Status:** audit inline (Lily agent falhou — org usage limit). HIMYM dispatch dedicado fica pendente.

---

## 1. Padrões transversais detectados

### 1.1. Hint text invisível em Velatura — `text-drift-muted/30` ou `/25`

Padrão recorrente em 6 cards (`AppearanceCard, DiscoverRelaysCard, LocalListsSettings, RelaySettings, SettingsCards, SuaLenteCard`):

```jsx
<p className="px-1 font-mono text-[10px] text-drift-muted/30">
  default off. cidade pequena + opinião política = identificável.
</p>
```

- `text-[10px]` + `text-drift-muted/30` = 30% opacity sobre fundo papel-claro em Velatura = quase ilegível.
- Já catalogado em `BACKLOG.md` (radio-group active state invisível em Velatura) — mesma raiz, propagação mais ampla.
- Hint que é a única explicação do impacto fica invisível justamente onde mais importa.

### 1.2. Jargão protocol-level vazando pra UI

Exemplos coletados:
- "kind 3 atualizado" — settings de moderação local
- "scaffold em PWA. tor real: build Tauri com --features arti."
- "modo onion-only sem nenhum relay com alias .onion"
- "NIP-65", "OPFS", "SAB" referenciados sem glossário
- "default false (lens off — feed canônico bit-exact)"
- "publica kind 3 atualizado removendo este autor" — hint do botão "deixar de seguir"

User novice não tem mapa mental pra:
- kind (= tipo de evento Nostr)
- relay (= servidor Nostr)
- NIP (= Nostr Improvement Proposal)
- canonical feed vs lens

### 1.3. Tooltips só desktop (`title=` attribute)

Maioria dos `<button title="...">` mostra hint só em hover desktop. Mobile (target primário do Drift) **não vê**. Padrão presente em todos os radio-groups da SettingsCards.

### 1.4. Hints SEM impacto observável

Hints curtos descrevem o setting MAS não o EFEITO no app:
- ❌ "filtros — NSFW / spoilers / anúncios" (menu entry hint)
- ✅ "Posts marcados como spoiler ficam ocultos no feed" (FiltersCard toggle hint — bom, mas só nesse caso)

User não sabe o que mudará VISIVELMENTE depois de toggle.

### 1.5. Defaults sem justificativa

Maioria dos toggles tem default mas nada explica POR QUÊ:
- `show_nsfw_default: false` — por que default off?
- `location_granularity: 'off'` — só LocationCard explica (curto: "default off. cidade pequena + opinião política = identificável.")
- `network_mode: 'clearnet'` — não justifica vs Tor opcional

### 1.6. Reversibilidade não comunicada

Cards destrutivos não explicam reversibilidade:
- "limpar local + recarregar" — irreversível, mas warning só no confirm modal
- "esquecer este device" (futuro) — irreversível, sem warning antecipado
- Trocar de tema é reversível mas user não sabe

---

## 2. Gold standard — SuaLenteCard

Esse card é EXEMPLO POSITIVO. Pattern que deveria propagar:

```ts
function labelFor(strength: number): string {
  if (strength < 0.05) return 'sem reordenação'
  if (strength < 0.34) return 'levemente prioriza quem você segue'
  // ... descrições da AÇÃO, não adjetivos abstratos
}

function helperText(strength: number): string {
  if (strength === 0) {
    return 'Feed em ordem canônica — drifts, sinks e idade. Todos os clientes Drift veem a mesma ordem.'
  }
  if (strength < 0.34) {
    return 'Posts de quem você acompanha (e do entorno deles) sobem um pouco. Resto do feed quase inalterado.'
  }
  // ... exemplo concreto do efeito
}
```

**O que SuaLenteCard faz certo:**
1. Label dinâmico DESCRITIVO da ação (não adjetivo abstrato)
2. Helper text com EXEMPLO concreto do efeito
3. Default explícito + por quê (`Default 0 (lens off — feed canônico bit-exact)`)
4. Reversibilidade implícita (slider 0-100% reversible)
5. CTA "ver feed agora" pra teste imediato — feedback loop
6. Manifesto §24 referenciado pro power user que quer fundo

---

## 3. Top 10 friction points (ordenado por impacto)

| # | Setting | Problema | Fix sugerido |
|---|---|---|---|
| 1 | NetworkModeCard `clearnet/tor/onion-only` | "scaffold em PWA. tor real: build Tauri" — jargão. Reload destrutivo escondido. | Plain language + warning "vai recarregar" antes de clicar |
| 2 | LocationCard `OFF/PAÍS/CIDADE/GPS` | Active state invisível em Velatura. Hint só em title (desktop). | Selected pill + hint sempre visível |
| 3 | FiltersCard NSFW toggle | "mostrar NSFW / violência sem blur" — não diz QUANDO vê NSFW (raro?). Default unclear. | "Default off — você verá imagens borradas até tocar pra revelar" |
| 4 | Botão "limpar local + recarregar" | Irreversível, perde identidade se não exportada antes. Warning só no confirm. | Warning antecipado VISÍVEL no card, não só no dialog |
| 5 | Menu "rede > relays" — RelaySettings | Lista de URLs wss:// sem explicar o que é relay. Add/remove sem warning de impacto. | Card de explicação "o que é relay?" no topo + impacto de cada ação |
| 6 | Settings "sovereignty" (3 endpoints) | upload/tile/threshold — usuário comum não tem clue. | Marcar como "avançado" + esconder por default; require power-user toggle |
| 7 | Permissões (GPS/camera/mic) | "solicitar"/"libere no navegador" — sem explicação do QUE será solicitado. | "GPS: pra anexar location aos seus posts (opt-in)" |
| 8 | NetworkMode radio "onion-only" | Hint diz "exige .onion alias em relay" — usuário não sabe configurar relay onion. | Disable se sem relay onion + CTA "configurar relay onion" linkando docs |
| 9 | AppearanceCard themes | Switching tema é reversível mas não diz. Names artísticos (Cinder/Rosenholz/Velatura) sem prévia. | Mini-preview thumbnail por tema + "trocar quando quiser" |
| 10 | LocalListsSettings (pinned/blocked/muted) | Listas sem explicação do que cada uma faz. Empty state silencioso. | Each list ganha 1 linha: "[lista] — quem você [verbo]" |

---

## 4. Approach proposto

### Opção A — Fix point-by-point por card
- Linear, fácil de revisar
- Inconsistente (cada autor inventa formato)
- Não previne regressão (novo card faz mesmos erros)

### Opção B — Primitive `<SettingExplainer>` ⭐ recomendado
Component reutilizável que envolve cada setting:

```tsx
<SettingExplainer
  label="Modo de rede"
  description="Como o app se conecta aos relays Nostr."
  impact="Tor contorna bloqueios regionais mas exige cliente desktop (Tauri). Em PWA browser, escolher tor não muda nada — IP continua exposto."
  defaultExplained="Default clearnet — funciona em qualquer dispositivo."
  reversible={true}
  level="basic" // ou 'advanced' pra esconder por default
>
  <SegmentedControl ... />
</SettingExplainer>
```

Vantagens:
- 1 primitive, 1 pattern, consistência garantida
- LOCK_VIA_TEST: novo Settings card sem usar `<SettingExplainer>` falha conformance
- Glossário centralizado (kind/relay/NIP traduzidos em 1 lugar)
- `level: 'advanced'` gate pra esconder power-user settings (resolve #6 Sovereignty)
- Helper text always-visible vence o problema de title-on-hover

### Opção C — Hint primitives da DAOP PR3
Já shipados: `HintChip`, `HintToast`, `HintModal`. Poderia adotar pra explicar settings inline.

Problema: hints DAOP são event-driven (gap detectado), settings precisam ALWAYS-ON explanation. Não bate.

### Recomendação: B — primitive novo + audit por Marshall pra LOCK

---

## 5. Próximos passos

Imediato (este sprint):
1. ✅ Audit (este doc)
2. ⬜ Registrar no BACKLOG como GROUP item (não 1 item linha)
3. ⬜ HIMYM round dedicado quando usage limit liberar:
   - Marshall: spec do primitive `<SettingExplainer>` + LOCK_VIA_TEST
   - Lily: copy guidelines (plain language, exemplos concretos, justificar defaults)
   - Robin: glossário (relay/NIP/kind/OPFS/SAB → traduções plain pt-BR)
   - Ted: arquitetura (level=advanced gate, integração com hint primitives)
   - Barney: audit security warnings (irreversíveis precisam warning visível)

Phase 2 (sprint seguinte):
4. ⬜ Ship `<SettingExplainer>` primitive
5. ⬜ Refactor cards na ordem do top 10 friction points
6. ⬜ LOCK_VIA_TEST conformance — novo card sem primitive falha CI

---

## 6. Métricas de sucesso (futuras)

- Time-to-first-useful-action (TTFUA) — quanto leva novo user descobrir como ativar X?
- Settings completion rate — % de users que mexem em alguma settings nos primeiros 7 dias
- Friction events — bootstrap errors, accidental destructive actions, abandono mid-settings

(Métricas precisam telemetry local — manifesto §28 zero export — registrar em SQLite, agregar localmente.)
