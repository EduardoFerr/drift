//! SOCKS5 → Tor bridge (Fase 6.4 etapa 1).
//!
//! Listener TCP local que aceita conexões SOCKS5 (RFC 1928) e
//! encaminha cada CONNECT request via `arti-client::TorClient` —
//! ou seja, traduz SOCKS5 → circuit Tor.
//!
//! ## Por que listener próprio em vez de spawn `arti-cli`?
//!
//! A alternativa de embarcar o binário `arti` (CLI completo) e
//! spawnar como child process custa ~5MB no bundle final +
//! gerência de processo (signal handling, port collision,
//! shutdown gracioso). Listener próprio em Rust:
//!  - usa o mesmo `Arc<TorClient>` que `tor_connect` já bootou
//!  - dimensiona ~150 LOC
//!  - shutdown trivial (drop do `Arc` libera tudo)
//!  - sem child process / sem IPC interno
//!
//! ## Por que não system proxy do webview?
//!
//! Webview Tauri (Edge/WebView2 em Windows, WebKit em macOS,
//! WebKitGTK em Linux) **ignora** `Proxy-Settings` programático
//! em runtime. Mesmo se setasse SOCKS5 via env var, fetch/WebSocket
//! nativos do webview continuam direto. Por isso a estratégia
//! adotada é custom WebSocket transport TS-side (etapa 3) que
//! invoca IPC commands → este SOCKS5 listener → arti.
//!
//! Aqui ficamos com a peça SOCKS5 funcional/auditável: clientes
//! Rust-side ou tools externos (curl --socks5-hostname, browser
//! com SOCKS5 manual) podem testar via porta exposta sem precisar
//! da bridge TS.
//!
//! ## Subset SOCKS5 implementado
//!
//! - Greeting: aceita só `NO_AUTH` (0x00). Auth não faz sentido —
//!   listener escuta apenas em `127.0.0.1`.
//! - Address types: `DOMAIN` (0x03) e `IPV4` (0x01). IPv6 (0x04)
//!   rejeitado por enquanto (nostr relays anunciam hostname, não
//!   IPv6 literal).
//! - Commands: `CONNECT` (0x01) só. `BIND` (0x02) e `UDP_ASSOC`
//!   (0x03) rejeitados — Nostr é WSS sobre TCP, basta CONNECT.
//!
//! ## Manifesto
//!
//! §15 (anti-censura por país) — peça crítica do transporte Tor.
//! §17 (sem chave mestra) — auditável: ~150 LOC sem dependências
//! exóticas (tokio + arti-client + std).
//! §28 (privacidade pelo mínimo) — listener bind em loopback,
//! nunca em interface pública. Externo só fala via webview Tauri
//! (mesmo processo).

#![cfg(feature = "arti")]

use std::net::SocketAddr;
use std::sync::Arc;

use arti_client::{TorClient, TorClientBuilder};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tor_rtcompat::PreferredRuntime;

/// Tipo encurtado pra evitar repetir o generic `<PreferredRuntime>`.
type ArtiClient = TorClient<PreferredRuntime>;

// ─── Constantes do protocolo SOCKS5 ──────────────────────────────────
//
// Mantém em consts pra leitura clara de quem revisa o protocolo.
// Valores definidos em RFC 1928 §3 e §4.

const SOCKS5_VERSION: u8 = 0x05;
const METHOD_NO_AUTH: u8 = 0x00;
const METHOD_NONE_ACCEPTABLE: u8 = 0xFF;

const CMD_CONNECT: u8 = 0x01;

const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;

const REP_SUCCESS: u8 = 0x00;
const REP_GENERAL_FAILURE: u8 = 0x01;
const REP_COMMAND_NOT_SUPPORTED: u8 = 0x07;
const REP_ADDR_TYPE_NOT_SUPPORTED: u8 = 0x08;

// ─── API pública ─────────────────────────────────────────────────────

/// Inicia o listener SOCKS5 em `127.0.0.1:0` (porta dinâmica).
/// Spawna a task aceitadora em background e retorna o `SocketAddr`
/// real (com a porta resolvida pelo OS) pra ser exposta via IPC.
///
/// O listener vive enquanto `client` (e suas clones) viver. Quando
/// `tor_disconnect` faz `*c = None`, o último `Arc<TorClient>` cai
/// e o background task termina via select! drop awareness — mas como
/// o task captura `Arc<TorClient>` clone, manter-mos um clone só pra
/// listener é o que precisa cair pra parar.
///
/// Implementação atual: o task fica rodando até o processo morrer
/// (drop graceful do listener é follow-up — não é crítico porque
/// `tor_disconnect` é raro e o usuário pode encerrar o app).
pub async fn start_socks5_listener(client: Arc<ArtiClient>) -> Result<SocketAddr, String> {
    let bind: SocketAddr = "127.0.0.1:0".parse().expect("loopback parse infalível");
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|e| format!("bind socks5 listener falhou: {}", e))?;

    let local = listener
        .local_addr()
        .map_err(|e| format!("local_addr() falhou: {}", e))?;

    // Background task — aceita até o processo encerrar.
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, peer)) => {
                    let client_clone = client.clone();
                    tokio::spawn(async move {
                        if let Err(err) = handle_connection(socket, client_clone).await {
                            // Erro de cliente individual não derruba o listener.
                            // Log via eprintln pra ficar visível em dev (Tauri
                            // captura stderr do processo).
                            eprintln!(
                                "[socks5] conexão de {} terminou com erro: {}",
                                peer, err
                            );
                        }
                    });
                }
                Err(err) => {
                    // Erro de accept é raro mas pode acontecer (fd exhaustion).
                    // Sleep curto pra não tight-loop em caso de erro persistente.
                    eprintln!("[socks5] accept() falhou: {} — sleeping 100ms", err);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    });

    Ok(local)
}

// ─── Handler por conexão ─────────────────────────────────────────────

/// Trata uma conexão SOCKS5 do início ao fim:
/// 1. Greeting (negociação de método)
/// 2. Request (CONNECT + endereço de destino)
/// 3. Abrir stream Tor via `client.connect`
/// 4. Bridge bidirecional `socks ↔ tor`
async fn handle_connection(
    mut socks: TcpStream,
    client: Arc<ArtiClient>,
) -> Result<(), String> {
    // ─── 1. Greeting (RFC 1928 §3) ────────────────────────────────────
    //
    // Cliente envia:
    //   +----+----------+----------+
    //   |VER | NMETHODS | METHODS  |
    //   +----+----------+----------+
    //   | 1  |    1     | 1 to 255 |
    //   +----+----------+----------+
    //
    // Respondemos com método escolhido (NO_AUTH se ofertado;
    // 0xFF se não conseguimos).

    let ver = socks
        .read_u8()
        .await
        .map_err(|e| format!("greeting ver: {}", e))?;
    if ver != SOCKS5_VERSION {
        return Err(format!("versão SOCKS inesperada: {:#x}", ver));
    }
    let nmethods = socks
        .read_u8()
        .await
        .map_err(|e| format!("greeting nmethods: {}", e))?;
    let mut methods = vec![0u8; nmethods as usize];
    socks
        .read_exact(&mut methods)
        .await
        .map_err(|e| format!("greeting methods read: {}", e))?;

    if !methods.contains(&METHOD_NO_AUTH) {
        socks
            .write_all(&[SOCKS5_VERSION, METHOD_NONE_ACCEPTABLE])
            .await
            .ok();
        return Err("cliente não ofereceu NO_AUTH".to_string());
    }
    socks
        .write_all(&[SOCKS5_VERSION, METHOD_NO_AUTH])
        .await
        .map_err(|e| format!("greeting reply: {}", e))?;

    // ─── 2. Request (RFC 1928 §4) ─────────────────────────────────────
    //
    //   +----+-----+-------+------+----------+----------+
    //   |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
    //   +----+-----+-------+------+----------+----------+
    //   | 1  |  1  | X'00' |  1   | Variable |    2     |
    //   +----+-----+-------+------+----------+----------+

    let mut header = [0u8; 4];
    socks
        .read_exact(&mut header)
        .await
        .map_err(|e| format!("request header: {}", e))?;
    let req_ver = header[0];
    let cmd = header[1];
    let _rsv = header[2];
    let atyp = header[3];

    if req_ver != SOCKS5_VERSION {
        return Err(format!("request ver inesperado: {:#x}", req_ver));
    }
    if cmd != CMD_CONNECT {
        send_reply(&mut socks, REP_COMMAND_NOT_SUPPORTED).await.ok();
        return Err(format!("comando SOCKS5 não suportado: {:#x}", cmd));
    }

    // Decodifica DST.ADDR conforme ATYP.
    let host: String = match atyp {
        ATYP_IPV4 => {
            let mut buf = [0u8; 4];
            socks
                .read_exact(&mut buf)
                .await
                .map_err(|e| format!("ipv4 addr: {}", e))?;
            format!("{}.{}.{}.{}", buf[0], buf[1], buf[2], buf[3])
        }
        ATYP_DOMAIN => {
            let len = socks
                .read_u8()
                .await
                .map_err(|e| format!("domain len: {}", e))?;
            let mut buf = vec![0u8; len as usize];
            socks
                .read_exact(&mut buf)
                .await
                .map_err(|e| format!("domain addr: {}", e))?;
            String::from_utf8(buf).map_err(|e| format!("domain utf-8: {}", e))?
        }
        ATYP_IPV6 => {
            send_reply(&mut socks, REP_ADDR_TYPE_NOT_SUPPORTED).await.ok();
            return Err("IPv6 ainda não implementado".to_string());
        }
        _ => {
            send_reply(&mut socks, REP_ADDR_TYPE_NOT_SUPPORTED).await.ok();
            return Err(format!("ATYP desconhecido: {:#x}", atyp));
        }
    };
    let port = socks
        .read_u16()
        .await
        .map_err(|e| format!("dst port: {}", e))?;

    // ─── 3. Abrir stream Tor ──────────────────────────────────────────
    //
    // arti faz resolução DNS *dentro* do circuit (sem leak via DNS
    // local) — comportamento default do `connect((host, port))` quando
    // host é string. Preserva manifesto §28.

    let tor_stream = match client.connect((host.as_str(), port)).await {
        Ok(s) => s,
        Err(err) => {
            send_reply(&mut socks, REP_GENERAL_FAILURE).await.ok();
            return Err(format!("arti connect({}:{}): {}", host, port, err));
        }
    };

    // Sucesso: respondemos REP=0x00 com BND.ADDR/BND.PORT zerados.
    // Cliente SOCKS5 ignora esses campos pra CONNECT na prática.
    send_reply(&mut socks, REP_SUCCESS).await.ok();

    // ─── 4. Bridge bidirecional ───────────────────────────────────────
    //
    // `tokio::io::copy_bidirectional` precisa de ambos os lados serem
    // tokio AsyncRead+AsyncWrite. arti `DataStream` em modo `tokio`
    // feature já implementa via tor-rtcompat. Ambas direções rodam até
    // EOF/erro.

    let (mut tor_r, mut tor_w) = tokio::io::split(tor_stream);
    let (mut socks_r, mut socks_w) = tokio::io::split(socks);

    let up = async {
        let _ = tokio::io::copy(&mut socks_r, &mut tor_w).await;
        let _ = tor_w.shutdown().await;
    };
    let down = async {
        let _ = tokio::io::copy(&mut tor_r, &mut socks_w).await;
        let _ = socks_w.shutdown().await;
    };
    tokio::join!(up, down);

    Ok(())
}

/// Helper: monta resposta SOCKS5 com REP code + BND zerado (0.0.0.0:0).
/// RFC 1928 §6. Cliente que faz CONNECT ignora BND.ADDR/PORT.
async fn send_reply(socks: &mut TcpStream, rep: u8) -> std::io::Result<()> {
    // VER REP RSV ATYP=IPv4 BND.ADDR(4) BND.PORT(2) = 10 bytes.
    socks
        .write_all(&[
            SOCKS5_VERSION,
            rep,
            0x00,
            ATYP_IPV4,
            0,
            0,
            0,
            0,
            0,
            0,
        ])
        .await
}

// `TorClientBuilder` referenciado nas docs internas de tor.rs; manter
// import pra evitar warning quando este módulo é compilado isolado.
// (No-op se não usado — Rust strip dead imports em release.)
#[allow(dead_code)]
fn _ensure_builder_visible() -> Option<TorClientBuilder<PreferredRuntime>> {
    None
}
