-- ═══════════════════════════════════════════════════════════════════
-- Drift — Schema SQLite WASM
-- ═══════════════════════════════════════════════════════════════════
--
-- Este schema é a fonte LOCAL da verdade. A fonte real são os eventos
-- Nostr — esta tabela é estado materializado a partir deles.
--
-- Regra invariante: APENAS onNostrEvent() escreve em tabelas de
-- domínio (posts, spreads, buries, reports, users). Identity, sync_log
-- e user_prefs são exceções operacionais locais.
-- ═══════════════════════════════════════════════════════════════════

-- ── Identidade local ──────────────────────────────────────────────
-- `identity` (singular) era a tabela da Fase 1-2.5. A partir da Fase 5
-- mantemos pra compatibilidade — uma row continua sendo "a identidade
-- ativa atual". A tabela `identities` (plural) substitui em uso real
-- e é populada por migração ao primeiro boot Fase 5+.
CREATE TABLE IF NOT EXISTS identity (
  npub           TEXT PRIMARY KEY,
  nsec_encrypted TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- ── Múltiplas identidades (Fase 5 — manifesto §4 Anonimato por Design)
-- Usuário pode ter N identidades simultâneas no mesmo dispositivo.
-- Útil para anti-perseguição (uma pública, outra para tópicos sensíveis)
-- e para compartimentalizar contextos.
--
-- `label` é etiqueta livre escolhida pelo user (ex: "principal", "ativismo").
-- Active identity está em `user_prefs` com key='active_identity'.
CREATE TABLE IF NOT EXISTS identities (
  npub           TEXT PRIMARY KEY,
  label          TEXT,                    -- nullable; sem label = "sem nome"
  nsec_encrypted TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  imported       INTEGER DEFAULT 0        -- 0 = gerada localmente; 1 = importada via nsec1
);
CREATE INDEX IF NOT EXISTS idx_identities_created ON identities(created_at DESC);

-- ── Posts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,
  author_pub      TEXT NOT NULL,
  content         TEXT NOT NULL,           -- JSON com subposts
  created_at      INTEGER NOT NULL,        -- unix seconds
  category        TEXT,
  location        TEXT,                    -- JSON GeoPoint
  client          TEXT,                    -- 'drift-official' ou outro
  content_warning TEXT,                    -- 'nsfw' | 'violence' | 'spoiler' | 'ad' | string livre
  raw_event       TEXT,                    -- JSON do evento original (re-broadcast Fase 5+, manifesto §16)
  -- ATENÇÃO: a partir de 2026-04-29 (manifesto §23 "Score weighted"),
  -- `score` e `spreads`/`buries` têm UNIDADES DISTINTAS:
  --   • score   = (Σ weight(spreader) − 0.3·Σ weight(burier)) / (idade+2)^1.5
  --                weight ∈ [0..100] da identidade Drift; Sybil novo ≈ 0
  --   • spreads = COUNT distinct users com ação líquida = 'spread' (p/ UI)
  --   • buries  = COUNT distinct users com ação líquida = 'bury'   (p/ UI)
  -- Ranking continua monotônico em `score`. UI mostra spreads/buries como
  -- contadores ("3 espalharam"). Ver `events.ts:recalculateScore`.
  score           REAL DEFAULT 0,
  spreads         INTEGER DEFAULT 0,
  buries          INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_score    ON posts(score DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_author   ON posts(author_pub);
CREATE INDEX IF NOT EXISTS idx_posts_created  ON posts(created_at DESC);

-- ── Spreads ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spreads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      TEXT NOT NULL,
  spreader_pub TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  location     TEXT,
  event_id     TEXT NOT NULL,
  raw_event    TEXT,                       -- JSON do evento original (re-broadcast Fase 5+)
  UNIQUE(post_id, spreader_pub)
);
CREATE INDEX IF NOT EXISTS idx_spreads_post    ON spreads(post_id);
CREATE INDEX IF NOT EXISTS idx_spreads_created ON spreads(created_at);

-- ── Buries ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    TEXT NOT NULL,
  burier_pub TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  event_id   TEXT NOT NULL,
  raw_event  TEXT,                         -- JSON do evento original (re-broadcast Fase 5+)
  UNIQUE(post_id, burier_pub)
);
CREATE INDEX IF NOT EXISTS idx_buries_post ON buries(post_id);

-- ── Reports ──────────────────────────────────────────────────────
-- Reports (kind 9081 Drift native + kind 1984 NIP-56 dual stack).
--
-- Manifesto §29 (compat Nostr): Drift emite AMBOS kind 9081 (pipeline
-- interno com weight + threshold dinâmico §26) E kind 1984 NIP-56
-- (compat Damus/Snort/Iris). Cliente ingere ambos; dedup LWW por
-- (post_id, reporter_pub, created_at) — primeiro report do par stays;
-- segundo (mesmo reporter+post, kind diferente) faz UPDATE só se
-- created_at é mais recente.
--
-- `kind`: 9081 (Drift native) ou 1984 (NIP-56). Default 9081 pra retro
-- compat com bases pré-2026-05-17 (migration adiciona coluna com
-- default; rows existentes herdam 9081).
--
-- `reason`: bucket Drift normalizado ('illegal' | 'spam' | 'harassment').
-- NIP-56 emite 7 reasons canônicos (nudity, malware, profanity, illegal,
-- spam, impersonation, other); ingestão mapeia via tabela em
-- src/lib/nip56-mapping.ts antes do INSERT. Tag `reason` Drift no kind
-- 9081 é o source bruto.
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      TEXT NOT NULL,
  reporter_pub TEXT NOT NULL,
  reason       TEXT NOT NULL,            -- 'illegal' | 'spam' | 'harassment'
  weight       REAL NOT NULL,
  created_at   INTEGER NOT NULL,
  kind         INTEGER NOT NULL DEFAULT 9081, -- 9081 Drift | 1984 NIP-56
  UNIQUE(post_id, reporter_pub)
);
CREATE INDEX IF NOT EXISTS idx_reports_post   ON reports(post_id);
CREATE INDEX IF NOT EXISTS idx_reports_reason ON reports(reason);

-- ── Comments (Track C — kind 1111 NIP-22) ───────────────────────
-- Threads de comentários reusando NIP-22 (manifesto §29 compat). Drift
-- adiciona tags `drift-version` + `client`; outros clientes Nostr
-- NIP-22-aware renderizam normalmente.
--
-- IMPORTANTE: SEM FK pra posts(id). Race comment-antes-do-post existe e
-- é compromisso do manifesto §16 (disponibilidade distribuída — eventos
-- chegam fora de ordem por relays distintos). buildThread (futuro C.3)
-- trata órfãos como top-level temporários.
--
-- `reply_to` é id do parent direto: igual a `post_id` se top-level
-- reply ao post; ou outro `comments.id` se reply a outro comment. Sort
-- determinístico em buildThread: created_at ASC, tie-break id ASC.
--
-- Score = -999 esconde do thread (manifesto §17, igual posts);
-- moderação reativa (Fase C.5+) opera por mesmo mecanismo.
CREATE TABLE IF NOT EXISTS comments (
  id              TEXT PRIMARY KEY,         -- event.id hex 64
  post_id         TEXT NOT NULL,            -- root event.id (kind 9078)
  reply_to        TEXT NOT NULL,            -- direct parent id (= post_id se top-level)
  author_pub      TEXT NOT NULL,            -- pubkey hex 64 do autor do comment
  content         TEXT NOT NULL,            -- texto plain UTF-8 (NIP-22 content)
  created_at      INTEGER NOT NULL,         -- unix seconds
  raw_event       TEXT NOT NULL,            -- JSON do evento original (imetas parsed daqui no read path — C.6.3)
  score           REAL DEFAULT 0,           -- moderação: -999 esconde
  content_warning TEXT                      -- C.6.2: 'nsfw'|'violence'|'spoiler'|'ad'|string livre, NIP-36 reuse
);
CREATE INDEX IF NOT EXISTS idx_comments_post  ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_reply ON comments(reply_to);

-- ── Pinned (Fase 5+) ─────────────────────────────────────────────
-- Posts que o user "fixou" — cliente garante re-broadcast e mantém em
-- cache (eviction nunca remove). Manifesto §16 (Disponibilidade
-- Distribuída) — quem espalha, seedeia.
CREATE TABLE IF NOT EXISTS pinned (
  post_id   TEXT PRIMARY KEY,
  pinned_at INTEGER NOT NULL,
  /** CID IPFS quando pin em IPFS estiver ativo (Fase 6 — cliente nativo) */
  cid       TEXT
);

-- ── Relays do user (Fase 5 — manifesto §14 Bootstrap Distribuído) ──
-- Lista dinâmica que substitui o seed estático em config/relays.ts.
-- A seed list segue como fallback inicial — relays_user é o que o
-- user/cliente acumulou via UI ou descoberta NIP-65.
--
-- `read`/`write` seguem a semântica NIP-65: alguns relays só servem
-- pra ler, outros pra escrever, default = ambos.
-- `source` rastreia origem ('user', 'nip65', 'seed', 'recommend')
-- pra eventual reputação por fonte.
CREATE TABLE IF NOT EXISTS relays_user (
  url               TEXT PRIMARY KEY,
  read              INTEGER DEFAULT 1,
  write             INTEGER DEFAULT 1,
  source            TEXT NOT NULL DEFAULT 'user',
  added_at          INTEGER NOT NULL,
  last_ok_at        INTEGER,                    -- última conexão bem-sucedida
  last_err          TEXT,                       -- última mensagem de erro (se houve)
  last_err_at       INTEGER,                    -- ms epoch da última falha (relay-health)
  consecutive_fails INTEGER NOT NULL DEFAULT 0, -- contador p/ demotion (relay-health)
  demoted_until     INTEGER NOT NULL DEFAULT 0, -- ms epoch até quando o relay está demoted
  enabled           INTEGER DEFAULT 1           -- user pode pausar sem remover
);
CREATE INDEX IF NOT EXISTS idx_relays_user_enabled ON relays_user(enabled);

-- ── Bloqueio/silenciamento local (Fase 5 — visualização, não ranking)
-- Manifesto §24: filtro local. Não muda score, não publica nada na
-- rede. Bloquear = esconder posts E spreads/buries do user bloqueado.
-- Silenciar = só esconder posts (ainda vê interações).
CREATE TABLE IF NOT EXISTS blocked (
  npub       TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL,
  reason     TEXT                        -- nota local opcional do user
);

CREATE TABLE IF NOT EXISTS muted (
  npub      TEXT PRIMARY KEY,
  muted_at  INTEGER NOT NULL
);

-- ── Usuários (perfis agregados) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  npub        TEXT PRIMARY KEY,
  alias       TEXT,
  avatar      TEXT,
  created_at  INTEGER NOT NULL,
  engagement  REAL DEFAULT 0,
  weight      REAL DEFAULT 0,
  last_active INTEGER
);

-- ── Follows ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  follower_pub  TEXT NOT NULL,
  following_pub TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (follower_pub, following_pub)
);

-- ── Sync log (rastreia o cursor de cada relay) ───────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  relay      TEXT NOT NULL,
  namespace  TEXT NOT NULL,
  last_since INTEGER DEFAULT 0,
  PRIMARY KEY(relay, namespace)
);

-- ── Preferências locais (onboarding, flags etc.) ─────────────────
CREATE TABLE IF NOT EXISTS user_prefs (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Peer Registry WebRTC (Fase 6.2 — manifesto §20 anti-eclipse) ──
-- Persistência de peers conhecidos para path diversity scoring +
-- random walk. Hot path de DC permanece em memória em
-- transport/webrtc/state.ts (Map<peerId, PeerState>); esta tabela é o
-- estado durável que sobrevive reload e alimenta scoring.
--
-- `latency_ms` é EWMA (alpha=0.3) sobre RTT do data channel.
-- `cross_proto_count` rastreia tentativas de injetar kinds não-Drift
-- via WebRTC (anti-T-WRTC-007); ao atingir 50, peer é blacklisted 1h.
-- ASN/country: best-effort lookup local (pode ser null).
CREATE TABLE IF NOT EXISTS peers_known (
  npub               TEXT PRIMARY KEY,
  last_seen          INTEGER NOT NULL,
  conn_count         INTEGER NOT NULL DEFAULT 0,
  fail_count         INTEGER NOT NULL DEFAULT 0,
  latency_ms         INTEGER,
  asn                INTEGER,
  country            TEXT,
  blacklisted_until  INTEGER NOT NULL DEFAULT 0,
  cross_proto_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_peers_last_seen    ON peers_known(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_peers_score_inputs ON peers_known(latency_ms, fail_count);

-- ── Relay directory cache (NIP-11) — discovery UX ────────────────
-- Cache de fetch NIP-11 (`Accept: application/nostr+json`) dos relays
-- curados. Fonte estática vem de `Docs/curated-relays-YYYY-MM.json`
-- (importada em `src/config/relays-directory.ts`); ESTE cache armazena
-- metadata viva (latency, supported_nips, software, version, etc.)
-- com TTL de 24h.
--
-- Manifesto §17 adendo + invariante #18: directory é OPT-IN pro user
-- adicionar relay; SEED_RELAY_CONFIGS continua mínimo (anti-spam-only).
--
-- Tabela operacional/cache (não-domínio) — pode dropar sem perder dados
-- de eventos. Reconstrói via re-fetch.
CREATE TABLE IF NOT EXISTS relay_directory_cache (
  url            TEXT PRIMARY KEY,        -- WSS URL canônica
  json           TEXT NOT NULL,           -- NIP-11 raw response body
  latency_ms     INTEGER,                 -- TCP+TLS+resp roundtrip; null se timeout
  software       TEXT,                    -- extraído de json.software pra query rápida
  supported_nips TEXT,                    -- JSON array dos NIPs suportados
  fetched_at     INTEGER NOT NULL,        -- unix sec — TTL check
  ok             INTEGER DEFAULT 1        -- 0 = fetch falhou; mantém TTL pra evitar retry storm
);
CREATE INDEX IF NOT EXISTS idx_relay_directory_fetched ON relay_directory_cache(fetched_at);

-- ── User metadata kind 0 (NIP-01) — opt-in identity ───────────────
-- Cache de eventos kind 0 (perfil público Nostr canônico). Replaceable
-- event: LWW por `event_created_at` na ingestão. Tabela SEPARADA de
-- `users` (que é agregado de eventos Drift) — manifesto §17 sem chave
-- mestra: metadata é claim do user, não atributo derivado.
--
-- IMPORTANTE: nenhum campo aqui participa de score/weight/feed ranking
-- (LOCK_VIA_TEST). É puramente decorativo + opt-in. Default = vazio
-- = modo Anônimo (§5.3 drift-arquitetura-v4).
--
-- Whitelist NIP-01 puro: `name`, `display_name`, `about`, `picture`,
-- `nip05`, `banner`, `website`, `lud16`. Drift NÃO inventa campos
-- próprios em kind 0 (manifesto §30 compat Nostr).
CREATE TABLE IF NOT EXISTS users_metadata (
  npub             TEXT PRIMARY KEY,
  name             TEXT,                 -- handle curto
  display_name     TEXT,                 -- nome de exibição
  about            TEXT,                 -- bio (≤140 chars no client)
  picture          TEXT,                 -- URL avatar (https://, sem data:)
  banner           TEXT,                 -- URL banner (MVP+1)
  website          TEXT,                 -- URL externa (MVP+1)
  nip05            TEXT,                 -- handle@domain (display claim — sem verify externo §28)
  lud16            TEXT,                 -- Lightning address (MVP+1)
  raw_event        TEXT NOT NULL,        -- JSON do kind 0 original (re-broadcast §16)
  event_created_at INTEGER NOT NULL,     -- unix sec — tiebreaker LWW
  fetched_at       INTEGER NOT NULL      -- quando o cliente cacheou
);
CREATE INDEX IF NOT EXISTS idx_users_metadata_nip05 ON users_metadata(nip05);
