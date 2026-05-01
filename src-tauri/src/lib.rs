// Drift desktop shell — Tauri v2 entrypoint.
//
// Fase 6.5 (scaffold): apenas embarca o build Vite numa janela nativa.
// Fase 6.4 vai adicionar Tor (arti) via comando IPC. Fase 6.7 endereça
// build reproduzível e code signing.
//
// Manifesto §17: nada de chave mestra disfarçada. Comandos IPC que
// adicionarmos aqui devem ser auditáveis e mínimos. Sem clipboard,
// notification, dialog ou fs por default.

#[cfg(debug_assertions)]
use tauri::Manager;

mod tor;

#[cfg(feature = "arti")]
mod socks5_proxy;

#[cfg(feature = "arti")]
mod tor_ws;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Wire de IPC commands: stub IPC tor (sempre presente) + bridge
    // WS (apenas com feature arti). Tauri valida em compile-time que
    // todos os symbols passados ao macro existem; usar cfg-gated
    // generate_handler! pra alternar conjuntos.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(tor::TorState::default());

    #[cfg(not(feature = "arti"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        tor::tor_connect,
        tor::tor_disconnect,
        tor::tor_status,
    ]);

    #[cfg(feature = "arti")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        tor::tor_connect,
        tor::tor_disconnect,
        tor::tor_status,
        tor_ws::tor_ws_open,
        tor_ws::tor_ws_send,
        tor_ws::tor_ws_close,
    ]);

    builder
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                // Em dev, abrir devtools automaticamente ajuda no debug.
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
