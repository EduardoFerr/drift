# Privacy

## O que este repositório é

Código-fonte de um cliente de referência. Não é um serviço. Não há
operador. Distribuições específicas (PWA hospedada, binários Tauri,
APK) são instâncias possíveis entre infinitas outras — qualquer fork
verificável tem peso equivalente.

**Implicação:** este documento descreve o que **o software faz**
quando executado, não o que "Drift" — como entidade — faz com seus
dados. Não há entidade.

## O que o software processa localmente

Quando executado, o cliente:

- Gera ou aceita uma chave secp256k1 (`nsec`). A chave é cifrada com
  AES-GCM 256 e armazenada em IndexedDB. **A chave nunca sai do
  dispositivo** — invariante #8 do `CLAUDE.md`.
- Mantém um SQLite WASM local (OPFS quando disponível, kvvfs como
  fallback) com eventos Nostr recebidos, materializações de feed, e
  preferências do usuário (`user_prefs`).
- Processa eventos das kinds 9078–9081 conforme `Docs/manifesto.md`
  §5–9.

Nada disso requer servidor remoto sob controle de qualquer mantenedor.

## O que sai do dispositivo

Eventos Nostr assinados saem para os **relays configurados pelo
usuário** (ver `lib/relays.ts` e [Docs/runtime-pwa-vs-tauri.md](Docs/runtime-pwa-vs-tauri.md)).
Relays são serviços independentes; cada relay tem sua própria política
de privacidade e jurisdição. A seed list inicial (`config/relays.ts`)
é uma sugestão substituível — adicionar/remover relays é trivial via
UI ou editando `relays_user`.

## Terceiros que potencialmente recebem dados

Quando o cliente é distribuído **através de uma instância específica**,
essa instância pode envolver os terceiros abaixo. Cada um é
substituível:

| Terceiro | Quando | O que vê | Substituição |
|----------|--------|----------|--------------|
| Hospedeiro do PWA (ex.: Vercel) | Visita à página | IP, User-Agent, fingerprint padrão de CDN | Self-host estático em qualquer servidor; binário Tauri elimina |
| `nostr.build` (upload de imagens, Fase 3) | Quando usuário faz upload | Imagem em si, IP do uploader | Configurável; qualquer endpoint NIP-96/NIP-94 serve |
| CARTO tiles (mapa, opt-in) | Quando usuário abre mapa | Viewport solicitado, IP | Tiles OSM diretos; ou desabilitar mapa |
| Relays Nostr | Sempre que cliente conecta | Eventos publicados, `pubkey`, IP | Lista totalmente configurável; rodar o próprio é suportado |
| Gateway IPFS (Fase 7+, opcional) | Fetch de blobs sem peer local | Hash solicitado, IP | Helia local; outro gateway |
| Tor (`arti`, Fase 6.4, opt-in) | Quando `NetworkMode=tor`/`onion-only` | Substitui IP visível por exit relay Tor | — |

**A combinação destes terceiros depende de qual distribuição está
sendo usada.** Forks podem remover, substituir, ou adicionar terceiros.
A distribuição hospedada em Vercel **não é canônica** — é uma das
formas de obter o cliente.

## Dados que **não** são processados

- Sem telemetria. Sem analytics. Sem reports automáticos de erro.
  (`grep` no repositório confirma — invariante derivada de §17.)
- Sem fingerprinting de usuário entre sessões além do que o navegador
  expõe naturalmente.
- Sem scan automático de conteúdo (PhotoDNA, ML, blocklists embutidas)
  no cliente oficial — invariante #7 do `CLAUDE.md`, manifesto §25.

## Identidade e portabilidade

`nsec` é o identificador. Exportável em qualquer momento (Settings →
Export). Importável em qualquer cliente Nostr (Damus, Snort, Coracle,
Iris, ou outro fork de Drift). Trocar de dispositivo perde estado
local mas nunca a identidade — manifesto §3.

## Bases legais aplicáveis (informativo, não exaustivo)

- **LGPD (Brasil):** o software roda inteiramente no dispositivo do
  usuário. Operadores de instâncias específicas (hospedeiros, relays)
  podem ser controladores ou operadores de tratamento; o código-fonte
  por si só não realiza tratamento.
- **GDPR (UE):** mesma análise; cada distribuição responde por sua
  superfície.
- **Marco Civil da Internet (Lei 12.965/2014):** conteúdo veiculado
  pela rede Nostr é hospedado por relays terceiros; este repositório
  não armazena conteúdo de usuários.

Nenhuma destas afirmações constitui aconselhamento jurídico.
