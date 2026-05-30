/**
 * IdentityPickerButton — picker per-post de QUAL identidade assina o post.
 *
 * **Por quê (manifesto §4 — compartimentalização):** usuário pode ter N
 * identidades no mesmo device (uma pública, outra pra tópicos sensíveis).
 * Postar com a identidade errada FUNDE duas personas de forma irreversível
 * (o evento assinado é público + imutável na rede). Diferente do GPS — que
 * vaza no máximo uma cidade — identidade errada é deanon permanente.
 *
 * **Classe de risco ⇒ regras de UI (review BLOCKERS):**
 *  1. A identidade assinante fica PERSISTENTEMENTE visível no corpo do
 *     compose, ao lado do `publicar ↑` — NÃO escondida atrás de
 *     tap-to-reveal. Este componente renderiza esse display inline
 *     (identicon + label/npub-short) E o mecanismo de troca (popover,
 *     espelhando GpsScopeButton).
 *  2. Quando a identidade escolhida ≠ ativa, o display ganra estado
 *     visual distinto (tint/borda accent) — "postando como outra persona"
 *     é glanceable, não um fato pontual. O caller também aplica chrome
 *     ambiente (border do compose) com base em `value !== activeNpub`.
 *  3. Per-compose state (caller). Reseta pra ativa a cada abertura. NUNCA
 *     persiste a escolha como novo default (anti-deanon).
 *
 * **Determinismo do identicon:** hue derivado dos 8 primeiros chars do
 * npub hex. Mesma fórmula do AuthorChip/ProfileModal — consistência
 * cross-component (manifesto §7). Sem dep nova.
 *
 * Só deve ser montado quando `identities.length > 1` (caller decide).
 *
 * **LOCK_VIA_TEST:** `tests/compose-identity-picker-conformance.test.ts`.
 */

import { useEffect, useRef, useState } from 'react'
import type { IdentityRecord } from '../../lib/identities'

export interface IdentityPickerButtonProps {
  /** Lista de identidades conhecidas (>1, caller garante). */
  identities: IdentityRecord[]
  /** npub hex 64 da identidade escolhida pra ESTE post (state per-post). */
  value: string
  /** npub hex 64 da identidade ATIVA — base pra detectar "não-ativa". */
  activeNpub: string
  /** Troca a identidade escolhida pra este post. Caller mantém o state. */
  onChange: (npub: string) => void
  /** Disabled durante publishing (não troca mid-publish). */
  disabled?: boolean
}

/**
 * Label curta pra exibição. Usa o label da identidade quando presente;
 * fallback `npub…<last6>` do bech32 (público — nunca o nsec).
 */
function shortIdentity(rec: IdentityRecord): string {
  const label = rec.label?.trim()
  if (label) return label
  const b = rec.npubBech32
  return b.length <= 12 ? b : `npub…${b.slice(-6)}`
}

/**
 * Identicon determinístico (swatch colorido) derivado do npub hex.
 * Espelha AuthorChip.Avatar — hue = primeiros 8 chars hex % 360,
 * fallback 180 (cyan) se não-hex. Manifesto §7.
 */
function IdentitySwatch({ npub, px = 18 }: { npub: string; px?: number }) {
  const parsedHue = parseInt(npub.slice(0, 8), 16)
  const hue = Number.isFinite(parsedHue) ? parsedHue % 360 : 180
  const initials = npub.slice(0, 2).toUpperCase()
  return (
    <span
      aria-hidden="true"
      style={{ width: px, height: px, background: `hsl(${hue}, 50%, 60%)` }}
      className="grid shrink-0 place-items-center rounded-full border border-drift-border/40 font-display text-[9px] font-bold text-drift-bg"
    >
      {initials}
    </span>
  )
}

export function IdentityPickerButton({
  identities,
  value,
  activeNpub,
  onChange,
  disabled = false,
}: IdentityPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const current =
    identities.find((i) => i.npub === value) ?? identities.find((i) => i.npub === activeNpub) ?? identities[0]!
  // Regra 2: identidade escolhida ≠ ativa → estado visual distinto
  // (glanceable). Não é fato pontual — fica enquanto a escolha durar.
  const isNonActive = value !== activeNpub

  // Click-outside + Esc pra fechar (espelha GpsScopeButton).
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const tgt = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(tgt) &&
        buttonRef.current && !buttonRef.current.contains(tgt)
      ) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleSelect(npub: string) {
    setOpen(false)
    if (npub !== value) onChange(npub)
  }

  const currentLabel = shortIdentity(current)
  // a11y: "assinar como: <persona>" — comunica que isto controla a
  // IDENTIDADE do post (deanon-critical), não uma preferência cosmética.
  const ariaLabel = isNonActive
    ? `assinar como: ${currentLabel} (diferente da identidade ativa)`
    : `assinar como: ${currentLabel} (identidade ativa)`

  return (
    <div className="relative">
      {/* Display PERSISTENTE (regra 1): identicon + label sempre visível.
          Estado distinto quando não-ativa (regra 2): borda + tint accent +
          rótulo "como". É também o trigger do popover. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-identity-picker={value}
        data-identity-nonactive={isNonActive ? 'true' : 'false'}
        className={`flex max-w-[150px] items-center gap-1.5 rounded-xl border px-2 py-1.5 font-mono text-[11px] tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 disabled:opacity-40 ${
          isNonActive
            ? 'border-drift-accent/50 bg-drift-accent/10 text-drift-accent hover:bg-drift-accent/15'
            : 'border-drift-border/40 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/30 hover:text-drift-text'
        }`}
      >
        <IdentitySwatch npub={current.npub} />
        {isNonActive && (
          <span aria-hidden="true" className="shrink-0 uppercase opacity-70">
            como
          </span>
        )}
        <span className="truncate">{currentLabel}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="escolha de identidade que assina o post"
          // Acima do botão (popover sobe): compose footer fica no rodapé,
          // então abrir pra cima evita vazar viewport. Alinhado à direita.
          className="absolute bottom-full right-0 z-50 mb-2 w-[260px] rounded-xl border border-drift-border/60 bg-drift-bg shadow-xl"
        >
          <div className="border-b border-drift-border/40 px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            assinar este post como — manifesto §4
          </div>
          <div role="radiogroup" aria-label="identidade assinante" className="max-h-[260px] overflow-y-auto p-1.5">
            {identities.map((rec) => {
              const active = rec.npub === value
              const isTheActive = rec.npub === activeNpub
              return (
                <button
                  key={rec.npub}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-identity-option={rec.npub}
                  onClick={() => handleSelect(rec.npub)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    active
                      ? 'bg-drift-accent2/10 text-drift-accent2'
                      : 'text-drift-text hover:bg-drift-surface/60'
                  }`}
                >
                  <IdentitySwatch npub={rec.npub} px={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] tracking-meta">
                      {active ? '✓ ' : ''}
                      {shortIdentity(rec)}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] leading-snug text-drift-muted">
                      {isTheActive ? 'identidade ativa' : rec.npubBech32}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
