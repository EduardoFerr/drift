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
use std::sync::Mutex;

#[cfg(feature = "arti")]
use std::sync::Arc;

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
    /// Número de circuits ativos (0 quando desconectado). Em modo arti,
    /// hoje não temos métrica live desse contador — fica 1 enquanto
    /// bootstrap-completed, 0 caso contrário. Live counter é follow-up
    /// (depende de `TorClient::circmgr` introspection, API instável).
    pub circuit_count: u32,
    /// Mensagem de erro mais recente, se algum.
    pub last_error: Option<String>,
}

impl Default for TorStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".to_string(),
            circuit_count: 0,
            last_error: None,
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
}

impl Default for TorState {
    fn default() -> Self {
        Self {
            status: Mutex::new(TorStatus::default()),
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

    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(client) => {
            // Armazena cliente pra reuse nos commands seguintes.
            let mut c = state.client.lock().map_err(|e| e.to_string())?;
            *c = Some(Arc::new(client));
            s.state = "connected".to_string();
            s.circuit_count = 1; // placeholder — circmgr live count é follow-up
            s.last_error = None;
        }
        Err(err) => {
            s.state = "error".to_string();
            s.circuit_count = 0;
            s.last_error = Some(format!("arti bootstrap falhou: {}", err));
        }
    }
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
    let mut s = state.status.lock().map_err(|e| e.to_string())?;
    s.state = "disconnected".to_string();
    s.circuit_count = 0;
    s.last_error = None;
    Ok(s.clone())
}

// ─── tor_status ──────────────────────────────────────────────────────

/// Consulta status atual sem mutar nada. Read-only em ambos os modos.
#[tauri::command]
pub async fn tor_status(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let s = state.status.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}
