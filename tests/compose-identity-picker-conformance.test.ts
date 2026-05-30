// Per-post identity picker (manifesto §4 compartimentalização) —
// LOCK_VIA_TEST conformance (source-grep style, espelha
// map-explainer-conformance.test.ts).
//
// Este picker é DEANON-CRITICAL: assinar com a identidade errada funde
// duas personas de forma irreversível (evento público + imutável). As
// asserções abaixo travam as 7 regras de UI de segurança da review —
// cada uma falha se a regra correspondente for removida.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const COMPOSE = readFileSync('src/components/Create/ComposeOverlay.tsx', 'utf8')
const PICKER = readFileSync('src/components/Create/IdentityPickerButton.tsx', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

describe('IdentityPickerButton — componente do picker', () => {
  it('exporta IdentityPickerButton', () => {
    expect(PICKER).toMatch(/export function IdentityPickerButton/)
  })

  // Regra 1: display PERSISTENTE (identicon + label) no próprio botão,
  // não tap-to-reveal. O swatch determinístico + o label renderizam
  // SEMPRE (fora de qualquer `open &&`).
  it('renderiza identicon (swatch) + label persistentes no trigger', () => {
    expect(PICKER).toMatch(/IdentitySwatch/)
    // swatch derivado do npub (determinístico, sem dep nova)
    expect(PICKER).toMatch(/parseInt\(npub\.slice\(0,\s*8\),\s*16\)/)
    // label curto renderizado no trigger (currentLabel) fora do popover
    expect(PICKER).toMatch(/\{currentLabel\}/)
  })

  // Regra 2: estado visual distinto quando escolhida ≠ ativa.
  it('aplica estado visual distinto quando value !== activeNpub', () => {
    expect(PICKER).toMatch(/const isNonActive = value !== activeNpub/)
    // borda/tint accent condicional ao isNonActive
    expect(PICKER).toMatch(/isNonActive\s*\n?\s*\?\s*'border-drift-accent/)
  })

  it('expõe radiogroup acessível (role=radio + aria-checked)', () => {
    expect(PICKER).toMatch(/role="radiogroup"/)
    expect(PICKER).toMatch(/role="radio"/)
    expect(PICKER).toMatch(/aria-checked=/)
  })

  it('NUNCA toca em segredo — sem decrypt/getIdentitySecretKey no picker', () => {
    // O picker é puro display+seleção: nunca decifra nsec nem chama a
    // porta de secret key. Assinar é responsabilidade de createPost (lib).
    expect(PICKER).not.toMatch(/getIdentitySecretKey/)
    expect(PICKER).not.toMatch(/\bdecrypt\b/)
    expect(PICKER).not.toMatch(/nsec_encrypted/)
  })
})

describe('ComposeOverlay — wiring do picker (regras de segurança)', () => {
  it('importa IdentityPickerButton', () => {
    expect(COMPOSE).toMatch(/import \{ IdentityPickerButton \} from '\.\/IdentityPickerButton'/)
  })

  // Regra 7: só renderiza com >1 identidade (1 id = comportamento atual).
  it('renderiza o picker SOMENTE quando há >1 identidade (regra 7)', () => {
    expect(COMPOSE).toMatch(/identities\.length > 1/)
    // o JSX do picker está atrás do gate showIdentityPicker
    expect(COMPOSE).toMatch(/showIdentityPicker && \(\s*<IdentityPickerButton/)
  })

  // Regra 3: per-compose state, default = ativa, lazy-init no mount.
  it('default da escolha = npub ativo, per-compose state (regra 3)', () => {
    expect(COMPOSE).toMatch(/useState<string>\(\(\) => activeNpub \?\? ''\)/)
  })

  // Regra 5: captura SÍNCRONA do npub no topo de handlePublish, ANTES de
  // qualquer await. A const local deve ser declarada antes do primeiro
  // `await` da função.
  it('captura o npub escolhido SÍNCRONO antes de qualquer await (regra 5)', () => {
    const fnStart = COMPOSE.indexOf('async function handlePublish()')
    expect(fnStart).toBeGreaterThan(-1)
    const fnBody = COMPOSE.slice(fnStart)
    const captureIdx = fnBody.indexOf('const chosenNpub = signWithNpub')
    // Primeira EXPRESSÃO await real (não a palavra em comentário): casa
    // `await <ident>(` ou `await dialog.`. Comentários explicativos com a
    // palavra "await" não contam.
    const firstAwaitIdx = fnBody.search(/\bawait\s+[a-zA-Z_$][\w$.]*\(/)
    expect(captureIdx).toBeGreaterThan(-1)
    expect(firstAwaitIdx).toBeGreaterThan(-1)
    // captura ANTES do primeiro await — se alguém mover a captura pra
    // depois de um await, isto falha (downstream poderia re-ler state stale).
    expect(captureIdx).toBeLessThan(firstAwaitIdx)
  })

  // Regra 5 (cont.): threading explícito — onPublish recebe o const local,
  // não o state cru.
  it('threada o npub capturado (chosenNpub) pra onPublish (regra 5)', () => {
    expect(COMPOSE).toMatch(/onPublish\(\{[^}]*signWithNpub: chosenNpub/s)
  })

  // Regra 6: hard-confirm exige AMBOS gpsScope !== 'off' E não-ativa.
  it('hard-confirm referencia gpsScope !== off E identidade não-ativa (regra 6)', () => {
    expect(COMPOSE).toMatch(/if \(gpsScope !== 'off' && isNonActive\)/)
    // usa dialog.confirm + bloqueia no cancel
    expect(COMPOSE).toMatch(/await dialog\.confirm\(/)
    expect(COMPOSE).toMatch(/ligar essa persona ao seu local/)
    // o `if (!ok) return` bloqueia o publish (cancel)
    expect(COMPOSE).toMatch(/if \(!ok\) return/)
  })

  // Regra 4: CTA nomeia a persona quando não-ativa.
  it('CTA "publicar como «X» ↑" quando assina como outra persona (regra 4)', () => {
    expect(COMPOSE).toMatch(/publicar como «\$\{chosenPersonaName\}» ↑/)
  })

  // Regra 2 (ambiente): chrome distinto no corpo enquanto não-ativa.
  it('aplica chrome ambiente (ring accent) quando postingAsOther (regra 2)', () => {
    expect(COMPOSE).toMatch(/postingAsOther \? 'ring-2 ring-inset ring-drift-accent/)
  })

  it('onPublish type inclui signWithNpub obrigatório (não opcional)', () => {
    // assinatura obriga o caller a capturar — `signWithNpub: string` (sem ?)
    expect(COMPOSE).toMatch(/signWithNpub: string\b/)
    // e NÃO a forma opcional (que deixaria downstream re-ler/ignorar)
    expect(COMPOSE).not.toMatch(/signWithNpub\?: string/)
  })
})

describe('App.tsx — threading até createPost', () => {
  it('handlePublish recebe signWithNpub e repassa pra createPost', () => {
    expect(APP).toMatch(/signWithNpub: string/)
    expect(APP).toMatch(/input\.signWithNpub \? \{ signWithNpub: input\.signWithNpub \}/)
  })
})
