//! WebSocket bridge sobre Tor (Fase 6.4 etapa 3).
//!
//! Webview Tauri (Edge/WebView2 / WebKit / WebKitGTK) **ignora** system
//! proxy programático em runtime. Mesmo se setasse SOCKS5 via env var,
//! o `WebSocket()` JS nativo continuaria direto. Solução: implementar
//! WebSocket client TS-side que invoca estes IPC commands → tokio-
//! tungstenite no shell Rust, que opera *dentro* do arti `DataStream`
//! (handshake WS frames + TLS sobre circuit Tor).
//!
//! ## Modelo de comunicação
//!
//! TS → Rust:    invoke('tor_ws_open', { url })   → handle: u64
//!               invoke('tor_ws_send', { handle, data })
//!               invoke('tor_ws_close', { handle, code, reason })
//!
//! Rust → TS:    app.emit('tor_ws::msg', { handle, data })
//!               app.emit('tor_ws::close', { handle, code, reason })
//!               app.emit('tor_ws::error', { handle, error })
//!
//! TS-side (`src/lib/transport/torWebSocket.ts`) embrulha isso numa
//! classe que mimetiza a API `WebSocket` nativa (onopen/onmessage/
//! onclose/onerror/send/close) e é injetada em nostr-tools via
//! `useWebSocketImplementation`.
//!
//! ## Por que tokio-tungstenite?
//!
//! Crate maduro pra cliente WS, suporta async via tokio (pareia com
//! arti). `client_async` aceita qualquer `AsyncRead+AsyncWrite` —
//! passamos o `arti::DataStream` direto (que já implementa essas
//! traits via tor-rtcompat tokio feature). TLS via `rustls-tls-
//! webpki-roots` pra alinhar com o resto do build (sem deps C).
//!
//! ## Lifecycle de handles
//!
//! Cada open allocs um u64 monotônico via `AtomicU64`. Map global
//! handle → `tokio::sync::mpsc::Sender<Message>` permite send. Receive
//! task lê do stream e emit eventos Tauri; quando stream encerra,
//! handle é removido do map.
//!
//! Drop de handle (close) sinaliza task pra terminar. Se TS perder a
//! ref e nunca chamar close, o handle vaza memory pequena (~bytes) —
//! aceitável pra MVP.
//!
//! Manifesto §15 + §17 + §28 (idem socks5_proxy.rs).

#![cfg(feature = "arti")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use arti_client::TorClient;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{client_async_tls_with_config, tungstenite};
use tor_rtcompat::PreferredRuntime;

use crate::tor::TorState;

type ArtiClient = TorClient<PreferredRuntime>;

/// Handle alocado por open. u64 evita issues de wrapping (max ~10^19
/// opens, fim do universo antes disso na prática).
type Handle = u64;

/// Sender pro task que escreve no stream WS.
type SendChannel = mpsc::UnboundedSender<tungstenite::Message>;

/// Map global de handles ativos. Compartilhado via Arc<Mutex>.
/// Mutex sync (não tokio) — só locks curtos pra get/insert/remove.
type Handles = Arc<Mutex<HashMap<Handle, SendChannel>>>;

// ─── State global do módulo ──────────────────────────────────────────

/// Counter monotônico pra alocar handles. Atomic pra evitar lock no
/// caminho rápido. Wrap-around teórico em ~10^19 chamadas — não
/// preocupação prática.
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

/// Singleton de handles. Inicializado lazy no primeiro `tor_ws_open`.
/// `OnceLock` garante init único thread-safe.
static HANDLES: std::sync::OnceLock<Handles> = std::sync::OnceLock::new();

fn handles() -> &'static Handles {
    HANDLES.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

// ─── Payloads dos eventos emitidos pra TS ────────────────────────────
//
// Sprint 3 (Marshall item 1): `#[serde(rename_all = "camelCase")]` em
// todos os structs. `TorStatus` em tor.rs já fazia isso; estes não, e
// funcionavam por coincidência (`is_binary` snake batia com TS snake).
// Padronização preventiva — quando alguém renomear no Rust ou trocar
// pra camelCase no TS, contrato continua válido.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsMsgPayload {
    handle: Handle,
    /// Payload em UTF-8 quando text frame; base64 quando binary.
    /// `is_binary` permite o TS roteador decidir o decode.
    data: String,
    is_binary: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsClosePayload {
    handle: Handle,
    /// Close code (1000-4999 por convenção WS). 1006 = abnormal closure
    /// (sem frame close formal; ex: peer dropou sem cerimônia).
    code: u16,
    reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsErrorPayload {
    handle: Handle,
    error: String,
}

// ─── IPC command: tor_ws_open ────────────────────────────────────────

/// Abre WebSocket via circuit Tor. Retorna handle pra refs subsequentes.
///
/// Falhas comuns:
/// - `Tor não conectado` se `tor_connect` ainda não rodou
/// - `URL inválida` se não tem ws://, wss:// ou parse falha
/// - `connect timeout` (arti não conseguiu chegar no host via guard)
/// - `TLS handshake` (cert inválido — pouco comum em relays Nostr públicos)
/// - `WS handshake` (servidor não falou WebSocket; ex: 404)
#[tauri::command]
pub async fn tor_ws_open(
    app: AppHandle,
    state: State<'_, TorState>,
    url: String,
) -> Result<Handle, String> {
    // Pega o TorClient bootado por tor_connect. Se ainda não conectou,
    // erro claro pra TS lidar com fallback ou reportar pro user.
    let client_arc: Arc<ArtiClient> = {
        let c = state
            .client
            .lock()
            .map_err(|e| format!("client mutex envenenado: {}", e))?;
        c.clone()
            .ok_or_else(|| "Tor não conectado (chame tor_connect antes)".to_string())?
    };

    // Parse da URL pra extrair host:port. tokio-tungstenite faz isso
    // internamente em `client_async`, mas precisamos abrir o stream
    // *antes* — então parseamos aqui pra passar ao arti::connect.
    let parsed = url::Url::parse(&url).map_err(|e| format!("URL inválida: {}", e))?;
    let scheme = parsed.scheme();
    let is_secure = match scheme {
        "wss" => true,
        "ws" => false,
        other => return Err(format!("scheme inesperado: {} (esperado ws/wss)", other)),
    };
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL sem host".to_string())?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "URL sem porta resolvível".to_string())?;

    // Abre stream Tor (TCP + circuit). DNS resolution acontece dentro
    // do circuit (sem leak via stub local). Ver socks5_proxy.rs §3.
    let tor_stream = client_arc
        .connect((host.as_str(), port))
        .await
        .map_err(|e| format!("arti connect({}:{}) falhou: {}", host, port, e))?;

    // Handshake WS. Em wss://, tokio-tungstenite aplica TLS sobre o
    // stream automaticamente (feature `rustls-tls-webpki-roots` traz
    // o rustls + roots); em ws://, sem TLS. Connector=None usa o
    // default vindo das features.
    let _ = is_secure; // hint pra dev: scheme já validado acima
    let (ws_stream, _resp) =
        client_async_tls_with_config(url.as_str(), tor_stream, None, None)
            .await
            .map_err(|e| format!("WS handshake falhou: {}", e))?;

    // Aloca handle e canal de envio.
    let handle = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = mpsc::unbounded_channel::<tungstenite::Message>();
    handles().lock().await.insert(handle, tx);

    // Spawna task bidirecional: divide stream em sink+stream;
    // - leitura: emit Tauri events com cada frame recebido
    // - escrita: pull do mpsc rx
    let (mut ws_sink, mut ws_source) = ws_stream.split();

    // Task de escrita
    let app_w = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(err) = ws_sink.send(msg).await {
                let _ = app_w.emit(
                    "tor_ws::error",
                    WsErrorPayload {
                        handle,
                        error: format!("send falhou: {}", err),
                    },
                );
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Task de leitura
    let app_r = app.clone();
    tokio::spawn(async move {
        while let Some(item) = ws_source.next().await {
            match item {
                Ok(tungstenite::Message::Text(text)) => {
                    let _ = app_r.emit(
                        "tor_ws::msg",
                        WsMsgPayload {
                            handle,
                            data: text.to_string(),
                            is_binary: false,
                        },
                    );
                }
                Ok(tungstenite::Message::Binary(_bytes)) => {
                    // NIP-01 é text/JSON. Binary frames de relay Nostr
                    // são raros (algumas extensões). Drop silencioso —
                    // se aparecer caso real, adicionar base64 encode +
                    // is_binary: true.
                }
                Ok(tungstenite::Message::Close(frame)) => {
                    let (code, reason) = match frame {
                        Some(f) => (u16::from(f.code), f.reason.into_owned()),
                        None => (1000, String::new()),
                    };
                    let _ = app_r.emit("tor_ws::close", WsClosePayload { handle, code, reason });
                    break;
                }
                Ok(tungstenite::Message::Ping(_))
                | Ok(tungstenite::Message::Pong(_))
                | Ok(tungstenite::Message::Frame(_)) => {
                    // tungstenite responde Ping com Pong automaticamente
                    // quando consumimos o stream. Pong/Frame raw ignorados.
                }
                Err(err) => {
                    let _ = app_r.emit(
                        "tor_ws::error",
                        WsErrorPayload {
                            handle,
                            error: format!("recv falhou: {}", err),
                        },
                    );
                    let _ = app_r.emit(
                        "tor_ws::close",
                        WsClosePayload {
                            handle,
                            code: 1006,
                            reason: "abnormal".to_string(),
                        },
                    );
                    break;
                }
            }
        }
        // Stream fim (normal ou erro): remove handle.
        handles().lock().await.remove(&handle);
    });

    Ok(handle)
}

// ─── IPC command: tor_ws_send ────────────────────────────────────────

/// Envia text frame pelo WebSocket. Caller TS já decidiu que é text
/// (NIP-01 é JSON sobre text). Binary support fica como follow-up se
/// alguma extensão Nostr precisar.
#[tauri::command]
pub async fn tor_ws_send(handle: Handle, data: String) -> Result<(), String> {
    let map = handles().lock().await;
    let tx = map
        .get(&handle)
        .ok_or_else(|| format!("handle {} não existe ou já fechado", handle))?;
    tx.send(tungstenite::Message::Text(data.into()))
        .map_err(|e| format!("canal de envio fechado: {}", e))
}

// ─── IPC command: tor_ws_close ───────────────────────────────────────

/// Fecha WebSocket gracefully. Idempotente — chamar em handle já
/// fechado é no-op (retorna Ok).
#[tauri::command]
pub async fn tor_ws_close(
    handle: Handle,
    code: Option<u16>,
    reason: Option<String>,
) -> Result<(), String> {
    let map = handles().lock().await;
    if let Some(tx) = map.get(&handle) {
        let frame = tungstenite::protocol::CloseFrame {
            code: tungstenite::protocol::frame::coding::CloseCode::from(code.unwrap_or(1000)),
            reason: reason.unwrap_or_default().into(),
        };
        // Best-effort — drop do tx no read-task end remove do map.
        let _ = tx.send(tungstenite::Message::Close(Some(frame)));
    }
    Ok(())
}

