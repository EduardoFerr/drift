/**
 * webrtc/config — constantes compartilhadas pelos sub-módulos.
 *
 * Magic numbers que antes viviam espalhados pelo `webrtc.ts` 1190 LOC,
 * agora centralizados. Ver `Docs/archive/webrtc-6.2-plan.md` §5/§7
 * pra justificativas históricas.
 *
 * **Ponto único de sintonia**: ajustar caps/thresholds aqui afeta
 * peer/health/reconnect/rate-limit consistentemente. Sem dupla-fonte.
 */

// ─── Caps + thresholds (Fase 6.2-C) ──────────────────────────────────
//
// Re-exportado pelo `webrtc/index.ts` pra preservar
// `import { WEBRTC_LIMITS } from '../webrtc'` em `seeder.ts` e
// `webrtcCaps.test.ts`. Manifesto §15 (DoS resistance) + §20 (anti-eclipse).

export const WEBRTC_LIMITS = {
  /** Hard cap de peers conectados simultaneamente. */
  MAX_PEERS: 32,
  /** Em modo Nostr, remoteId é npub: Map dedupe garante 1 conn/pubkey.
   *  Em modo mock, UUID é aleatório por aba — proteção não aplica (OK).
   *  Documental — não há check runtime explícito; ver getOrCreatePeer. */
  MAX_PEERS_PER_PUBKEY: 1,
  /** Sustained rate por peer (já implementado em RATE_REFILL_PER_SEC). */
  RATE_LIMIT_MSG_PER_SEC: 100,
  /** Burst rate por peer (já implementado em RATE_BURST). */
  RATE_LIMIT_BURST: 200,
  /** [legado] Após N eventos de kind fora de DRIFT_KIND_SET, peer era
   *  killed sem janela. Substituído por janela deslizante (Threat audit
   *  T1 — 2026-05-08): violações fora de
   *  CROSS_PROTO_VIOLATION_WINDOW_MS são descartadas; threshold real é
   *  CROSS_PROTO_VIOLATION_THRESHOLD em janela. Mantido como constante
   *  pública pra preservar API histórica (peerScore/peerRegistry consomem
   *  o counter monotônico só pra telemetria). */
  CROSS_PROTO_THRESHOLD: 50,
  /** TTL de blacklist quando peer cruza um threshold. */
  BLACKLIST_TTL_MS: 60 * 60 * 1000,
} as const

// ─── Cross-protocol violations (Threat audit T1, 2026-05-08) ────────
// Janela deslizante substitui counter monotônico. Atacante paciente
// (49 violações + espera + mais 49) não bypassa: violações fora da
// janela decaem. Mesmo padrão de `rateViolations[]`.

/** Janela de 24h pra contar violações cross-proto. Fora da janela
 *  são pruned automaticamente. */
export const CROSS_PROTO_VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000
/** Hard cap do array (defesa contra atacante spammar mais que isso
 *  numa janela e estourar memória). */
export const CROSS_PROTO_VIOLATION_CAP = 32
/** Threshold em violações dentro da janela → kill + blacklist. */
export const CROSS_PROTO_VIOLATION_THRESHOLD = 10

// ─── Subscription dedup ──────────────────────────────────────────────

/** LRU cap pra `seenIds` por subscription — evita memória crescer linear
 *  em sessões longas com posts virais. */
export const SEEN_IDS_CAP = 1000

// ─── Health check ping/pong (Fase 6.3-C) ─────────────────────────────

export const HEALTH_PING_INTERVAL_MS = 15_000
/** Latência acima disso → degraded. */
export const HEALTH_LATENCY_DEGRADED_MS = 5_000
/** Sem ping enviado/respondido nesta janela → degraded. */
export const HEALTH_STALE_MS = 30_000
/** Pings enviados mas pong stale ignorado (proteção contra replay tardio). */
export const HEALTH_PONG_MAX_AGE_MS = 5 * 60_000
/** ID prefix dos ping messages no DataChannel — evita colisão com SignedEvent. */
export const PING_PREFIX = '__drift-ping__:'
export const PONG_PREFIX = '__drift-pong__:'

// ─── Random walk anti-eclipse (Fase 6.2-C) ───────────────────────────

/** Intervalo do random walk (manifesto §20). 30min alinha com probe.ts. */
export const RANDOM_WALK_INTERVAL_MS = 30 * 60 * 1000
/** Quantos slots o random walk tenta encher por tick. */
export const RANDOM_WALK_TARGET = 8
/** Razão de slots aleatórios vs scored (manifesto §20 — 25% random). */
export const RANDOM_WALK_RANDOM_RATIO = 0.25

// ─── Peer lifecycle ──────────────────────────────────────────────────

/** Timeout pra peer stuck em 'connecting' (Barney audit #1, HIGH).
 *  Sem isso, ICE travado em firewall vira zombie peer + RAM leak linear. */
export const ICE_CONNECT_TIMEOUT_MS = 30_000

// ─── Rate limit (Barney audit #3, anti-DoS) ──────────────────────────
// Token bucket por peer. Sustained ~100 msgs/seg, burst 200.
// 3 violações em 60s → peer killed. Manifesto §15.

export const RATE_BURST = 200
export const RATE_REFILL_PER_SEC = 100
export const RATE_VIOLATION_CAP = 16
export const RATE_VIOLATION_WINDOW_MS = 60_000
export const RATE_VIOLATION_THRESHOLD = 3
/** Throttle do warn pra evitar log flood do próprio defensor. */
export const RATE_WARN_THROTTLE_MS = 5_000
