//! Fase 6.4 — Tor transport IPC commands.
//!
//! Stub atual retorna placeholders. Real integração com `arti` (Tor
//! client puro Rust, github.com/arti-rs/arti) fica pra sessão dedicada.
//! Quando arti chegar:
//! - tor_connect() inicia client + cria circuit
//! - tor_disconnect() destrói client
//! - tor_status() consulta state real (circuit count, latency)
//!
//! API estável agora — implementação evolui sem quebrar TS callers.
//!
//! Manifesto §15 (anti-censura por país) — Tor é um dos transportes
//! que cliente nativo Tauri precisa pra cumprir o compromisso. WSS
//! clearnet (web) + Tor + WebRTC (Fase 6) compõem a multi-transport
//! orchestration.

use serde::Serialize;
use std::sync::Mutex;

/// Status do cliente Tor exposto ao frontend.
///
/// `state` é uma string fechada: `'disconnected' | 'connecting' |
/// 'connected' | 'error'`. TS espelha isso em `src/lib/transport/tor.ts`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TorStatus {
    /// Estado atual: 'disconnected' | 'connecting' | 'connected' | 'error'.
    pub state: String,
    /// Número de circuits ativos (0 quando desconectado).
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

/// State global compartilhado. `Mutex` pra thread-safety entre IPC calls
/// (Tauri serializa por default mas commands `async` podem concorrer).
///
/// TODO(arti): trocar por algo como
/// `pub struct TorState { status: Mutex<TorStatus>, client: Mutex<Option<TorClient<PreferredRuntime>>> }`
/// quando arti-client entrar como dependência.
pub struct TorState(pub Mutex<TorStatus>);

impl Default for TorState {
    fn default() -> Self {
        Self(Mutex::new(TorStatus::default()))
    }
}

/// Inicia conexão com a rede Tor.
///
/// STUB: hoje retorna `state: 'error'` com `last_error` explicando que
/// arti ainda não está integrado. UI usa isso pra desabilitar o toggle
/// "Use Tor" e mostrar mensagem clara em vez de falhar silenciosamente.
///
/// TODO(arti): bootstrap de `TorClient`, criar circuit inicial, transição
/// `disconnected` → `connecting` → `connected` (ou `error` com motivo).
#[tauri::command]
pub async fn tor_connect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    if s.state == "connected" {
        return Ok(s.clone());
    }
    // Real: spawn task que tenta bootstrap; transição connecting→connected
    // após circuit pronto. Hoje: marca como erro pra UI saber que não é Tor real.
    s.state = "error".to_string();
    s.circuit_count = 0;
    s.last_error =
        Some("STUB: arti integration pending — Fase 6.4 follow-up".to_string());
    Ok(s.clone())
}

/// Encerra conexão com a rede Tor.
///
/// STUB: hoje só reseta o status pra `disconnected`. Idempotente —
/// chamar quando já desconectado é no-op.
///
/// TODO(arti): drop do `TorClient`, fechar circuits, liberar runtime.
#[tauri::command]
pub async fn tor_disconnect(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.state = "disconnected".to_string();
    s.circuit_count = 0;
    s.last_error = None;
    Ok(s.clone())
}

/// Consulta status atual sem mutar nada. Read-only.
///
/// TODO(arti): expor também latência média do circuit, country exit
/// (opt-in pra debug), e timestamp do último bootstrap.
#[tauri::command]
pub async fn tor_status(state: tauri::State<'_, TorState>) -> Result<TorStatus, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}
