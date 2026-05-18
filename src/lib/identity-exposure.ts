/**
 * Identity exposure tracking + rate-limit + passkey gate.
 *
 * Adicionado 2026-05-17 — Satoshi HIMYM adversarial Lacuna 2.
 *
 * **Threat model:** §8 do manifesto promete "nsec NUNCA persiste em
 * claro". Mas `exportIdentity`/`IdentityPanel` retorna nsec1 plaintext
 * em memória + DOM + (potencialmente) QR canvas + clipboard. Vetores:
 *   - Screenshot OS-level (acidental ou intencional → outra pessoa)
 *   - Extensão Chrome com permissão DOM/clipboardRead
 *   - Shoulder surf
 *   - User compartilha screenshot do nsec "pra ver se funciona" e
 *     delega identidade sem perceber
 *
 * Não conseguimos prevenir todos os vetores (manifesto §3 — usuário
 * controla sua chave). Mas reduzimos:
 *   1. **Passkey gate**: se passkey opt-in está ON, exigir WebAuthn
 *      verify ANTES de revelar/copy/download. Atacante físico
 *      precisa biometria/key real.
 *   2. **Rate limit soft**: > 3 exposições em 10min = warning. Útil
 *      contra autoclicker / loop acidental.
 *   3. **Last-exposed timestamp**: visível em SettingsCards. User
 *      audita comportamento próprio ("eu fiz copy ontem? não!").
 *
 * Tudo local — manifesto §28 (zero side effect, zero kind Nostr,
 * zero telemetria).
 */

import { create } from 'zustand'
import { db } from './db'

const EXPORT_PREF_KEY = 'last_nsec_export_at'

/** Janela de rate-limit em ms (10 min). */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

/** Threshold antes de warning de frequência. */
export const RATE_LIMIT_THRESHOLD = 3

export type ExposureReason = 'reveal' | 'copy' | 'download' | 'qr'

interface ExposureState {
  /** Timestamp ms da última exposição (qualquer tipo). null = nunca. */
  lastExposedAt: number | null
  /** Timestamps recentes (ring buffer in-memory pra rate-limit). */
  recentExposures: number[]
  /** Loaded de SQLite? Evita flash inicial. */
  loaded: boolean
}

const INITIAL: ExposureState = {
  lastExposedAt: null,
  recentExposures: [],
  loaded: false,
}

export const useExposureStore = create<ExposureState>(() => INITIAL)

/**
 * Carrega `last_nsec_export_at` do SQLite. Chamado em bootstrap.
 * Idempotente — segunda chamada é no-op (flag `loaded`).
 */
export async function loadExposureState(): Promise<void> {
  if (useExposureStore.getState().loaded) return
  try {
    const row = await db.get<{ value: string }>(
      `SELECT value FROM user_prefs WHERE key = ?`,
      [EXPORT_PREF_KEY],
    )
    const ms = row?.value ? Number(row.value) : null
    useExposureStore.setState({
      lastExposedAt: Number.isFinite(ms) && ms !== null && ms > 0 ? ms : null,
      loaded: true,
    })
  } catch {
    // SQLite indisponível em boot ainda — silencioso. Próxima chamada
    // tenta de novo (loaded ainda false).
  }
}

/**
 * Registra que o nsec foi exposto. Atualiza timestamp + ring buffer.
 * Persiste timestamp no SQLite (lazy — não bloqueia caller).
 *
 * Manifesto §28: tudo local, nunca exportado.
 */
export function recordExposure(_reason: ExposureReason): void {
  const now = Date.now()
  useExposureStore.setState((s) => ({
    lastExposedAt: now,
    // Mantém só os timestamps dentro da janela de rate-limit
    recentExposures: [
      ...s.recentExposures.filter((t) => now - t < RATE_LIMIT_WINDOW_MS),
      now,
    ],
  }))
  // Persiste lazy — não importa se falhar (next boot lê o anterior).
  void db
    .run(
      `INSERT INTO user_prefs (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [EXPORT_PREF_KEY, String(now)],
    )
    .catch(() => {
      /* silent — DB pode estar fechando, retorno do app reabre */
    })
}

/**
 * Retorna `true` se já houve ≥ RATE_LIMIT_THRESHOLD exposições nos
 * últimos RATE_LIMIT_WINDOW_MS. UI mostra warning + confirm.
 */
export function isOverRateLimit(): boolean {
  const now = Date.now()
  const recent = useExposureStore
    .getState()
    .recentExposures.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  return recent.length >= RATE_LIMIT_THRESHOLD
}

/**
 * Formata "última exposição: X tempo atrás" pra UI display.
 * Returns null se nunca houve exposição.
 */
export function formatLastExposed(now: number = Date.now()): string | null {
  const last = useExposureStore.getState().lastExposedAt
  if (last === null) return null
  const elapsed = now - last
  if (elapsed < 60_000) return 'agora há pouco'
  if (elapsed < 3_600_000) {
    const min = Math.floor(elapsed / 60_000)
    return `${min} ${min === 1 ? 'minuto' : 'minutos'} atrás`
  }
  if (elapsed < 86_400_000) {
    const h = Math.floor(elapsed / 3_600_000)
    return `${h} ${h === 1 ? 'hora' : 'horas'} atrás`
  }
  const d = Math.floor(elapsed / 86_400_000)
  return `${d} ${d === 1 ? 'dia' : 'dias'} atrás`
}

/**
 * Gate de passkey: se passkey opt-in está ativo, exige verify ANTES
 * de retornar. Lazy import pra evitar overhead em boot.
 *
 * Returns true se OK pra prosseguir, false se user cancelou ou falhou
 * (caller deve abortar a exposure).
 *
 * NÃO chama recordExposure — caller faz isso após a exposure efetiva.
 */
export async function requirePasskeyForExport(): Promise<boolean> {
  try {
    const { isPasskeyEnabled, verifyPasskey } = await import('./passkey')
    if (!(await isPasskeyEnabled())) return true // passkey off → sem gate
    await verifyPasskey()
    return true
  } catch {
    // verifyPasskey throws em cancel/fail. Caller aborta.
    return false
  }
}
