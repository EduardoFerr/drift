/**
 * GpsScopeButton — primitive pra decisão per-post de localização.
 *
 * **Por quê (manifesto §28):** ANTES, location era setting persistente em
 * `user_prefs.location_granularity`. User habilitava 'precise' uma vez
 * (curiosidade no mapa) e TODO post subsequente vazava GPS — privacy
 * mínima por inércia. Agora: setting vira "padrão pra novos posts"
 * (pre-selecionado quando user abre compose) e este botão permite
 * override per-post, com permissão GPS solicitada lazy (só quando user
 * seleciona cidade/precise).
 *
 * **4 estados** (LocationGranularity):
 * - `off` — sem localização (default seguro)
 * - `country` — ~111km, "alguém no Brasil"
 * - `city` — ~11km, área metropolitana
 * - `precise` — ~1m, identifica quarteirão (cuidado)
 *
 * Tap abre popover/sheet com 4 radios PT-BR + frase de impacto.
 * Permissão GPS solicitada na **seleção** (não no boot, não no publish).
 *
 * **Subposts/comentários:** este primitive não é usado em comentários
 * (ReplySheet ainda não tem location). Em subposts dentro do mesmo
 * ComposeOverlay, escolha é compartilhada (1 post = 1 location decision).
 *
 * **LOCK_VIA_TEST:** `tests/gps-scope-button-conformance.test.ts`.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LocationGranularity } from '../../types/drift'

/** Opções PT-BR com label curta + ícone + impact text pro popover. */
interface ScopeOption {
  value: LocationGranularity
  /** Label curta no botão header (ex: 'off', 'país', 'cidade', 'GPS'). */
  short: string
  /** Ícone visual (texto/emoji single-char). Mantém consistência mono. */
  icon: string
  /** Label completa no popover radio. */
  label: string
  /** Frase de impacto (manifesto §28). Lê alto pro user antes de optar. */
  impact: string
}

const SCOPE_OPTIONS: readonly ScopeOption[] = [
  {
    value: 'off',
    short: 'off',
    icon: '⊘',
    label: 'sem localização',
    impact: 'Default seguro. Ninguém vê de onde você publicou.',
  },
  {
    value: 'country',
    short: 'país',
    icon: '🌍',
    label: 'país (~111km)',
    impact: '"Alguém no Brasil postou". Só o país aparece, não cidade.',
  },
  {
    value: 'city',
    short: 'cidade',
    icon: '🏙️',
    label: 'cidade (~11km)',
    impact: 'Área metropolitana. Em cidade pequena pode identificar você.',
  },
  {
    value: 'precise',
    short: 'GPS',
    icon: '📍',
    label: 'GPS preciso (~1m)',
    impact: 'Quarteirão exato. Identifica seu prédio. Use com cuidado.',
  },
] as const

export interface GpsScopeButtonProps {
  /** Escopo atual selecionado pra ESTE post (state per-post no caller). */
  value: LocationGranularity
  /** Callback de mudança. Caller decide se solicita permission lazy. */
  onChange: (next: LocationGranularity) => void
  /** Disabled durante publishing (não permite trocar mid-publish). */
  disabled?: boolean
  /**
   * Quando true e user seleciona country/city/precise, dispara
   * `navigator.permissions.query` + getCurrentPosition pra solicitar
   * permission ao OS. Default true. Setar false em tests / quando
   * caller já controla permission lifecycle.
   */
  requestPermissionOnSelect?: boolean
  /**
   * Callback quando permission é negada (após user selecionar
   * country/city/precise). Caller pode mostrar toast. Quando isso
   * dispara, `onChange('off')` também é invocado pra revert state.
   */
  onPermissionDenied?: () => void
}

/**
 * Solicita permission GPS lazy. Retorna true se permitido, false se
 * negado ou indisponível. Não bloqueia se já permitido (cache do
 * browser). Manifesto §28 — permission só pedida quando user opta.
 */
export async function requestGpsPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false
  return new Promise<boolean>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve(false)
        else resolve(true) // timeout/unavailable: permission OK, GPS é que falhou
      },
      // maximumAge alto + timeout curto: queremos só CHECAR permission,
      // não esperar GPS lock. fix do browser pode vir do cache.
      { maximumAge: 600_000, timeout: 3000, enableHighAccuracy: false },
    )
  })
}

export function GpsScopeButton({
  value,
  onChange,
  disabled = false,
  requestPermissionOnSelect = true,
  onPermissionDenied,
}: GpsScopeButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const current = SCOPE_OPTIONS.find((o) => o.value === value) ?? SCOPE_OPTIONS[0]!

  // Click-outside + Esc pra fechar.
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

  async function handleSelect(next: LocationGranularity) {
    setOpen(false)
    if (next === value) return
    // 'off' nunca precisa permission.
    if (next === 'off') {
      onChange(next)
      return
    }
    if (requestPermissionOnSelect) {
      const ok = await requestGpsPermission()
      if (!ok) {
        // Permission negada — não aplica mudança; revert state via
        // onChange('off') + sinaliza pro caller pra mostrar toast.
        onPermissionDenied?.()
        onChange('off')
        return
      }
    }
    onChange(next)
  }

  // Label semantico p/ screen-reader: "localização: off" / "localização: cidade".
  const ariaLabel = `localização: ${current.short}`

  // Cor do estado: off neutro (muted), demais accent2 (mint) pra sinalizar
  // que vai vazar algo. Manifesto §28 — visibilidade do trade-off.
  const isActive = value !== 'off'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-gps-scope={value}
        className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 disabled:opacity-40 ${
          isActive
            ? 'border-drift-accent2/40 bg-drift-accent2/10 text-drift-accent2 hover:bg-drift-accent2/15'
            : 'border-drift-border/40 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/30 hover:text-drift-text'
        }`}
      >
        <span aria-hidden="true">{current.icon}</span>
        <span>{current.short}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="escolha de localização do post"
          // Posição: abaixo do botão, alinhado à direita pra não vazar viewport.
          // max-w fixo + z alto pra ficar acima do textarea.
          style={
            {
              // Inline pra evitar Tailwind purge issues com valores dinâmicos.
            } satisfies CSSProperties
          }
          className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-drift-border/60 bg-drift-bg shadow-xl"
        >
          <div className="border-b border-drift-border/40 px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            localização deste post — manifesto §28
          </div>
          <div role="radiogroup" aria-label="granularidade de localização" className="p-1.5">
            {SCOPE_OPTIONS.map((opt) => {
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-scope-option={opt.value}
                  onClick={() => void handleSelect(opt.value)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    active
                      ? 'bg-drift-accent2/10 text-drift-accent2'
                      : 'text-drift-text hover:bg-drift-surface/60'
                  }`}
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-[14px]">
                    {opt.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] uppercase tracking-meta">
                      {active ? '✓ ' : ''}
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] leading-snug text-drift-muted">
                      {opt.impact}
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

/** Export pra tests. */
export const _GPS_SCOPE_OPTIONS = SCOPE_OPTIONS
