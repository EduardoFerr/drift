//! Fase 6.4 — Tor transport IPC commands.
//!
//! Dois modos de compilação:
//!
//! 1. **Default (sem `--features arti`)**: stub. Os 3 commands abaixo
//!    retornam status `error` com `last_error: "STUB: arti integration
//!    pending"`. Build leve (sem ~100 crates do arti workspace), PWA-only
//!    user / Tauri sem Tor seguem ok.
//!
//! 2. **`cargo build --features arti`**: bootstrap real via crate
//!    `arti-client` (Tor puro Rust, github.com/arti-rs/arti). `tor_connect`
//!    cria `TorClient<PreferredRuntime>`, faz bootstrap async (download
//!    consensus + handshake guards), retorna `connected` quando o circuit
//!    inicial está pronto. SOCKS5 local proxy fica como follow-up
//!    (Fase 6.4 §"SOCKS5 wire-up" em Docs/webrtc-6.4-plan.md) — sem ele,
//!    `tor_connect()` valida que arti consegue bootstrap, mas o transport
//!    TS (`src/lib/transport/tor.ts::publish/subscribe`) ainda não tem
//!    proxy pra rotear WSS.
//!
//! API estável em ambos os modos — TS callers (`src/lib/transport/tor.ts`)
//! invocam os mesmos 3 commands; trocar feature flag é transparente do
//! lado JS exceto pelo erro mais explícito quando feature off.
//!
//! Manifesto §15 (anti-censura por país) — Tor é um dos transportes
//! que cliente nativo Tauri precisa pra cumprir o compromisso. WSS
//! clearnet (web) + Tor + WebRTC (Fase 6) compõem a multi-transport
//! orchestration.

use serde::Serialize;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(feature = "arti")]
use arti_client::{TorClient, TorClientConfig};

#[cfg(feature = "arti")]
use tor_rtcompat::PreferredRuntime;

/// Status do cliente Tor exposto ao frontend.
///
/// `state` é uma string fechada: `'disconnected' | 'connecting' |
/// 'connected' | 'error'`. TS espelha isso em `src/lib/transport/tor.ts`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TorStatus {
    /// Estado atual: 'disconnected' | 'connecting' | 'connected' | 'error'.
    pub state: String,
    /// Número de circuits/streams ativos. 0 quando desconectado.
    /// Em modo arti: contador live de conexões SOCKS5 ativas, atualizado
    /// pelo listener (`socks5_proxy.rs`) via `Arc<AtomicU32>` shared.
    /// Cada conexão SOCKS5 corresponde a (pelo menos) 1 circuit Tor sendo
    /// usado — boa proxy pra "Tor está roteando ativamente". Em idle pós-
    /// bootstrap = 0 (circuit guard existe mas não está carregando stream).
    /// Métrica exata de circuits internos do arti exige `TorClient::circmgr`
    /// introspection (API instável); active SOCKS streams é proxy estável.
    pub circuit_count: u32,
    /// Mensagem de erro mais recente, se algum.
    pub last_error: Option<String>,
    /// Endereço do listener SOCKS5 local (`127.0.0.1:<porta>`) quando
    /// `state == 'connected'`. `None` em qualquer outro estado. TS-side
    /// usa pra abrir streams via Tor (etapa 3 — bridge WSS).
    pub proxy_addr: Option<String>,
}

impl Default for TorStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".to_string(),
            circuit_count: 0,
            last_error: None,
            proxy_addr: None,
        }
    }
}

/// State global compartilhado.
///
/// **Sem feature `arti`**: só guarda o status (Mutex pra thread-safety
/// entre IPC calls — Tauri serializa por default mas `async` commands
/// podem concorrer).
///
/// **Com feature `arti`**: também guarda o `TorClient` quando bootstrap
/// completa. `Arc` permite compartilhar com tasks futuras (SOCKS5 proxy,
/// stream pool) sem clonar todo o client. Wrapper `Mutex<Option<...>>`
/// porque o client só existe pós-`tor_connect` e deve ser dropable em
/// `tor_disconnect`.
pub struct TorState {
    pub status: Mutex<TorStatus>,
    #[cfg(feature = "arti")]
    pub client: Mutex<Option<Arc<TorClient<PreferredRuntime>>>>,
    /// Contador atômico de streams SOCKS5 ativos. `Arc` permite clone
    /// pra dentro do listener task (move semantics) sem mover ownership
    /// do counter. Incrementado em `start_socks5_listener` quando uma
    /// conexão é aceita; decrementado no fim do `handle_connection`.
    /// Refletido em `TorStatus.circuit_count` no read path de
    /// `tor_status`. Atomic permite incrementar sem lock na hot path.
    pub active_streams: Arc<AtomicU32>,
}

impl Default for TorState {
    fn default() -> Self {
        Self {
            status: Mutex::new(TorStatus::default()),
            active_streams: Arc::new(AtomicU32::new(0)),
            #[cfg(feature = "arti")]
            client: Mutex::new(None),
        }
    }
}

// ─── tor_connect ─────────────────────────────────────────────────────

/// Inicia conexão com a rede Tor.
///
/// **STUB (default)**: retorna `state: 'error'` com `last_error` claro.
/// UI gate visualmente já desabilita o picker em PWA; este erro é a
/// rede de segurança caso o gate seja contornado (eg. dev forçando
/// `setPref('network_mode', 'tor')` via console em PWA).
///
/// **arti (feature)**: bootstrap async. Sequência:
///   1. transição `disconnected → connecting` no status mutex
///   2. spawn task tokio com `TorClient::create_bootstrapped(config)`
///   3. quando ready: armazena `Arc<TorClient>` em state.client e
///      transita `connecting → connected` (circuit_count = 1)
///   4. erro: transita `error` com mensagem do bootstrap
#[cfg(not(feature = "arti"))]
#[tauri::command]
pub async fn tor_connect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    s.state = "error".to_string();
    s.circuit_count = 0;
    s.last_error = Some(
        "STUB: arti integration pending — recompile with `--features arti` (Fase 6.4)"
            .to_string(),
    );
    Ok(s.clone())
}

#[cfg(feature = "arti")]
#[tauri::command]
pub async fn tor_connect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    // Idempotência: se já conectado, no-op.
    {
        let s = state.status.lock().map_err(|e| e.to_string())?;
        if s.state == "connected" {
            return Ok(s.clone());
        }
    }

    // Transiciona pra `connecting` antes do bootstrap (UI mostra spinner).
    {
        let mut s = state.status.lock().map_err(|e| e.to_string())?;
        s.state = "connecting".to_string();
        s.last_error = None;
    }

    // Bootstrap. `create_bootstrapped` faz TODO o setup: directory consensus
    // download, guard handshake, primeiro circuit. Pode levar 10-60s na
    // primeira vez (sem cache); depois ~5s com cache local de consensus.
    //
    // Config default = sem onion service own + cache em data dir do user.
    // Pra produção, talvez customizar `cache_dir` pra ficar dentro do
    // app data folder do Tauri (não usar $HOME/.arti default), mas isso é
    // refinement.
    let config = TorClientConfig::default();
    let result = TorClient::with_runtime(PreferredRuntime::current().map_err(|e| e.to_string())?)
        .config(config)
        .create_bootstrapped()
        .await;

    let client_arc = match result {
        Ok(client) => Arc::new(client),
        Err(err) => {
            let mut s = state.status.lock().map_err(|e| e.to_string())?;
            s.state = "error".to_string();
            s.circuit_count = 0;
            s.last_error = Some(format!("arti bootstrap falhou: {}", err));
            return Ok(s.clone());
        }
    };

    // Sobe o SOCKS5 listener (etapa 1) usando o client recém-bootado.
    // Failure aqui é fatal pra `connect` — sem listener, transport TS
    // não tem onde se ligar. Mas mantemos o client armazenado pra o
    // próximo retry de tor_connect reusar (idempotência via "connected"
    // check no topo).
    // Clone do Arc<AtomicU32> — listener captura próprio handle, o
    // estado da app continua dono do original. Increment/decrement
    // atômico é shared-memory entre listener task e tor_status read.
    let stream_counter = state.active_streams.clone();

    let proxy_addr = match crate::socks5_proxy::start_socks5_listener(
        client_arc.clone(),
        stream_counter,
    )
    .await
    {
        Ok(addr) => addr,
        Err(err) => {
            let mut s = state.status.lock().map_err(|e| e.to_string())?;
            s.state = "error".to_string();
            s.circuit_count = 0;
            s.last_error = Some(format!("socks5 listener falhou: {}", err));
            return Ok(s.clone());
        }
    };

    // Sucesso completo: arti bootstrapped + listener escutando.
    {
        let mut c = state.client.lock().map_err(|e| e.to_string())?;
        *c = Some(client_arc);
    }
    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    s.state = "connected".to_string();
    // circuit_count fica 0 em idle (sem streams ativos) — atualizado via
    // atomic load em `tor_status`. Só ficar "1 hardcoded" era enganoso.
    s.circuit_count = state.active_streams.load(Ordering::Relaxed);
    s.last_error = None;
    s.proxy_addr = Some(proxy_addr.to_string());
    Ok(s.clone())
}

// ─── tor_disconnect ──────────────────────────────────────────────────

/// Encerra conexão com a rede Tor.
///
/// **STUB**: só reseta o status pra `disconnected`. Idempotente.
///
/// **arti**: drop do `TorClient` (libera circuits + guard connections).
/// Idempotente — chamar quando já desconectado é no-op.
#[cfg(not(feature = "arti"))]
#[tauri::command]
pub async fn tor_disconnect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    s.state = "disconnected".to_string();
    s.circuit_count = 0;
    s.last_error = None;
    Ok(s.clone())
}

#[cfg(feature = "arti")]
#[tauri::command]
pub async fn tor_disconnect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    {
        let mut c = state.client.lock().map_err(|e| e.to_string())?;
        // Drop do Arc<TorClient>. Se for o último ref, arti libera tudo
        // (background tasks, channels, guard sockets). Há ainda o detalhe
        // de tasks tokio que arti pode ter spawn — eles morrem quando
        // tokio runtime terminar (no fim do processo). Refinement futuro:
        // graceful shutdown via TorClient::shutdown() quando essa API
        // estiver estável.
        *c = None;
    }
    // Reset do counter atômico — listener task ainda pode estar viva,
    // mas sem o TorClient ela vai falhar no próximo handle_connection
    // e dropar streams; mais robusto resetar aqui pra TorStatus refletir
    // estado real imediatamente.
    state.active_streams.store(0, Ordering::Relaxed);
    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    s.state = "disconnected".to_string();
    s.circuit_count = 0;
    s.last_error = None;
    Ok(s.clone())
}

// ─── tor_status ──────────────────────────────────────────────────────

/// Consulta status atual sem mutar nada. Read-only em ambos os modos.
///
/// Em modo arti, lê `active_streams` atomicamente e injeta no
/// `circuit_count` retornado — TS-side recebe contagem live de
/// conexões SOCKS5 ativas em vez de hardcode `1`.
#[tauri::command]
pub async fn tor_status(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let mut s = state.status.lock().map_err(|e| e.to_string())?.clone();
    // Live count: atomic load é cheaper que segurar o mutex de status
    // pra ler. Em estado != connected, o counter já é 0 por construção
    // (tor_disconnect zera; pré-bootstrap counter never increments).
    s.circuit_count = state.active_streams.load(Ordering::Relaxed);
    Ok(s)
}
