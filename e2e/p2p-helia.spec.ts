/**
 * p2p-helia.spec.ts — Sprint N+5 Batch B2 (Ted).
 *
 * Valida P2P (WebRTC mock) + Helia (IPFS mock) end-to-end multi-peer,
 * cobrindo os compromissos de manifesto §15 (anti-censura via P2P sem
 * relay) e §16 (disponibilidade distribuída via pin redundante).
 *
 * ── CONSTRAINT CRÍTICA: mesmo BrowserContext ───────────────────────────
 * Os mocks (`src/lib/dev-seed/mock-webrtc.ts` + `mock-helia.ts`) usam
 * `BroadcastChannel` pra formar a malha cross-page. BroadcastChannel SÓ
 * conecta páginas/abas da MESMA origin no MESMO BrowserContext — NÃO
 * atravessa contexts isolados (cada context tem seu próprio event loop /
 * storage partition).
 *
 * Por isso este spec NÃO usa `setupUser` (e2e/fixtures/users.ts), que
 * cria um `browser.newContext()` ISOLADO por user — ali a malha não
 * conecta. Usamos um helper local (`openUserPage`) que abre cada named
 * user como uma PÁGINA dentro de UM context compartilhado. Cada página
 * ainda boota com identidade própria (`?dev-seed=1&as=<name>`), mas
 * compartilha o BroadcastChannel → a malha P2P/IPFS conecta todos.
 *
 * Isto está documentado em playwright.config.ts (seção "Cross-context
 * P2P/IPFS mesh"). Quando um teste precisa isolamento total de storage
 * (multi-identidade §4), aí sim usa context isolado — mas perde a malha.
 *
 * ── Assinatura de eventos ───────────────────────────────────────────────
 * Spec 2 (P2P sem relay) precisa de um evento Drift ASSINADO válido pra
 * atravessar o pipeline cheap→caro do mock (verify Schnorr é real,
 * invariante #5). Assinamos no processo Node (nostr-tools + nsec do Dave,
 * mesma fonte do seed) e injetamos o evento pronto na página — o mock só
 * troca o MEIO de transporte, não a validação cripto.
 *
 * ── Execução ────────────────────────────────────────────────────────────
 * Playwright NÃO roda no sandbox deste agente. Run manual:
 *   npm run test:e2e -- p2p-helia            # ou: npx playwright test p2p-helia
 * O webServer (`npm run dev:tunnel`, HTTP + COOP/COEP) sobe automático.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { nip19, finalizeEvent } from 'nostr-tools'
import type { EventTemplate } from 'nostr-tools'
import { NAMED_NSECS } from '../src/lib/dev-seed/seed'
import { DRIFT_KIND } from '../src/config/constants'

// ─── Helper: páginas no MESMO context (malha BroadcastChannel) ──────────

/** Tipo mínimo dos hooks window que o mock expõe (main.tsx). */
interface DriftWindow {
  driftWebRTC: {
    getPeers: () => { id: string; status: string }[]
    connectTo: (peerId: string) => Promise<void>
    getMyPeerId: () => string
    transport: {
      publish: (event: unknown) => Promise<{ ok: number; failed: number }>
    }
  }
  driftHelia: {
    addBlob: (bytes: Uint8Array) => Promise<string>
    getBlob: (cid: string) => Promise<Uint8Array>
    pinBlob: (cid: string) => Promise<void>
    listPinned: () => Promise<string[]>
    heliaStats: () => Promise<{ running: boolean; peerCount: number; pinnedCount: number }>
  }
}

/**
 * Abre um named user como página DENTRO de `context` (malha compartilhada).
 * Boota com `?dev-seed=1&as=<name>` e espera o badge "dev seed" + os hooks
 * window (`driftHelia`/`driftWebRTC`) estarem disponíveis (import dinâmico
 * resolvido).
 */
async function openUserPage(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage()
  // dev-seed=lite: boot em segundos (full = drain floor > timeout). P2P/Helia
  // mesh independe do volume — lite tem eventos suficientes pra propagar.
  await page.goto(`/?dev-seed=lite&as=${name}`)
  await page.getByText('dev seed', { exact: true }).waitFor({ state: 'visible' })
  // Os hooks são wired via import() async em main.tsx — espera resolverem.
  await page.waitForFunction(() => {
    const w = window as unknown as Partial<DriftWindow>
    return !!w.driftHelia && !!w.driftWebRTC
  })
  return page
}

/** Bytes determinísticos pra um label — mesmo label ⇒ mesmos bytes ⇒ mesmo CID. */
function blobFor(label: string): number[] {
  return Array.from(new TextEncoder().encode(`drift-blob::${label}`))
}

test.describe('P2P + Helia multi-peer (§15/§16)', () => {
  let context: BrowserContext

  // Context compartilhado pra todo o describe — a malha BroadcastChannel
  // vive aqui. Serial (workers:1 em playwright.config.ts) evita cross-talk.
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
  })

  test.afterAll(async () => {
    await context.close()
  })

  // ── Spec 1: Helia pin redundância §16 ─────────────────────────────────
  // Grace pina um blob. Alice (autor original) fica offline (página fecha).
  // Heidi, que NUNCA viu o blob, faz getBlob → o mock resolve via malha
  // (Grace anunciou no pin) mesmo com Alice fora. Disponibilidade
  // distribuída: o conteúdo sobrevive à saída do autor.
  test('Helia: Grace pina → Alice offline → Heidi retrieves via malha (§16)', async () => {
    const grace = await openUserPage(context, 'grace')
    const alice = await openUserPage(context, 'alice')

    // Alice "origina" o blob (addBlob no store dela). Em IPFS real seria o
    // autor que adiciona; aqui Alice adiciona e Grace pina (replica + anuncia).
    const bytes = blobFor('viral-post-payload')
    const cid = await alice.evaluate(async (b) => {
      const w = window as unknown as DriftWindow
      return w.driftHelia.addBlob(Uint8Array.from(b))
    }, bytes)

    expect(cid).toMatch(/^b[a-z2-7]+$/) // CIDv1 base32 multibase 'b'

    // Grace pina o MESMO cid — no mock, pin re-anuncia os bytes na malha.
    // (Grace ainda não tem os bytes; primeiro retrieve via malha, depois pin.)
    const graceGotLen = await grace.evaluate(async (c) => {
      const w = window as unknown as DriftWindow
      const got = await w.driftHelia.getBlob(c) // puxa de Alice via malha
      await w.driftHelia.pinBlob(c) // agora Grace serve o blob (§16)
      return got.byteLength
    }, cid)
    expect(graceGotLen).toBe(bytes.length)

    // Alice sai de cena — fecha a página (autor offline).
    await alice.close()

    // Heidi entra DEPOIS, nunca viu o blob. getBlob deve resolver via Grace
    // (a única peer que ainda serve o cid). Prova §16: conteúdo disponível
    // sem o autor original.
    const heidi = await openUserPage(context, 'heidi')
    const retrieved = await heidi.evaluate(async (args) => {
      const w = window as unknown as DriftWindow
      const got = await w.driftHelia.getBlob(args.cid)
      return Array.from(got)
    }, { cid })

    expect(retrieved).toEqual(bytes)

    await grace.close()
    await heidi.close()
  })

  // ── Spec 2: P2P sem relay §15 ─────────────────────────────────────────
  // Dave (P2P-only) connectTo Erin. Dave publica um evento Drift ASSINADO
  // via driftWebRTC.transport.publish (malha P2P, sem WSS). Erin, subscrita
  // na malha, recebe pelo MESMO pipeline cheap→caro (verify Schnorr real).
  // Nenhum relay WSS envolvido — anti-censura via P2P (§15).
  test('P2P: Dave → Erin sem relay, evento assinado atravessa malha (§15)', async () => {
    const dave = await openUserPage(context, 'dave')
    const erin = await openUserPage(context, 'erin')

    // connectTo + getPeers: a conexão P2P aparece (malha viva).
    const erinPeerId = await erin.evaluate(() => {
      const w = window as unknown as DriftWindow
      return w.driftWebRTC.getMyPeerId()
    })
    await dave.evaluate(async (id) => {
      const w = window as unknown as DriftWindow
      await w.driftWebRTC.connectTo(id)
    }, erinPeerId)

    // Dave enxerga Erin como peer conectado.
    await expect
      .poll(async () =>
        dave.evaluate(() => {
          const w = window as unknown as DriftWindow
          return w.driftWebRTC.getPeers().length
        }),
      )
      .toBeGreaterThan(0)

    // Assina um evento Drift SPREAD válido no Node (nsec do Dave = seed).
    const daveNsec = NAMED_NSECS['dave']
    expect(daveNsec, 'NAMED_NSECS["dave"] presente no seed').toBeTruthy()
    const sk = nip19.decode(daveNsec).data as Uint8Array
    const template: EventTemplate = {
      kind: DRIFT_KIND.SPREAD,
      created_at: 1_716_000_500,
      tags: [
        ['e', 'f'.repeat(64)],
        ['p', '1'.repeat(64)],
        ['drift-version', '2'],
      ],
      content: '',
    }
    const signed = finalizeEvent(template, sk)

    // Erin subscreve a malha P2P direto via transport e aguarda o evento.
    // (Usamos o transport exposto no hook — mesma instância que o app usa.)
    const received = erin.evaluate(
      (eventId) =>
        new Promise<{ id: string; kind: number; pubkey: string } | null>((resolve) => {
          const w = window as unknown as DriftWindow & {
            __mockSub?: unknown
          }
          // O transport mock expõe subscribe via a mesma API Transport.
          const transport = w.driftWebRTC.transport as unknown as {
            subscribe: (
              filter: { kinds?: number[] },
              handlers: { onevent: (e: { id: string; kind: number; pubkey: string }) => void },
            ) => () => void
          }
          const timeout = setTimeout(() => resolve(null), 5000)
          const unsub = transport.subscribe(
            { kinds: [9079] },
            {
              onevent: (e) => {
                if (e.id === eventId) {
                  clearTimeout(timeout)
                  unsub()
                  resolve({ id: e.id, kind: e.kind, pubkey: e.pubkey })
                }
              },
            },
          )
        }),
      signed.id,
    )

    // Pequena folga pra subscribe registrar antes do publish. Espera em
    // `dave` (não `erin`) — `erin` está ocupada com o evaluate de subscribe
    // (Playwright serializa operações por página).
    await dave.waitForTimeout(150)

    // Dave publica via malha P2P (sem relay WSS).
    const pubResult = await dave.evaluate(async (ev) => {
      const w = window as unknown as DriftWindow
      return w.driftWebRTC.transport.publish(ev)
    }, signed as unknown as Record<string, unknown>)

    expect(pubResult.failed).toBe(0)
    expect(pubResult.ok).toBeGreaterThan(0)

    // Erin recebeu o evento — assinado, pelo pipeline, sem relay.
    const got = await received
    expect(got, 'Erin recebeu o evento de Dave pela malha P2P').not.toBeNull()
    expect(got?.id).toBe(signed.id)
    expect(got?.kind).toBe(DRIFT_KIND.SPREAD)
    expect(got?.pubkey).toBe(signed.pubkey)

    await dave.close()
    await erin.close()
  })

  // ── Spec 3: CID determinístico (content-addressed §7) ─────────────────
  // Mesmo conteúdo → mesmo CID. addBlob 2× com bytes idênticos = 1 CID.
  // E bytes diferentes = CIDs diferentes (sanity de content-addressing).
  test('Helia: CID determinístico — mesmo conteúdo, mesmo CID (§7)', async () => {
    const grace = await openUserPage(context, 'grace')

    const bytesA = blobFor('deterministic-payload-A')
    const bytesB = blobFor('deterministic-payload-B')

    const { cid1, cid2, cidOther } = await grace.evaluate(async (args) => {
      const w = window as unknown as DriftWindow
      const cid1 = await w.driftHelia.addBlob(Uint8Array.from(args.a))
      const cid2 = await w.driftHelia.addBlob(Uint8Array.from(args.a)) // mesmos bytes
      const cidOther = await w.driftHelia.addBlob(Uint8Array.from(args.b))
      return { cid1, cid2, cidOther }
    }, { a: bytesA, b: bytesB })

    expect(cid1).toBe(cid2) // content-addressed: idempotente
    expect(cid1).not.toBe(cidOther) // bytes diferentes ⇒ CID diferente
    expect(cid1).toMatch(/^b[a-z2-7]+$/)

    await grace.close()
  })

  // ── Spec 4: heliaStats reflete pins reais ─────────────────────────────
  // pinnedCount cresce com pins reais; running=true; peerCount≥0.
  test('Helia: heliaStats.pinnedCount reflete pins reais', async () => {
    const grace = await openUserPage(context, 'grace')

    const result = await grace.evaluate(async () => {
      const w = window as unknown as DriftWindow
      const before = await w.driftHelia.heliaStats()
      const cidX = await w.driftHelia.addBlob(
        Uint8Array.from(new TextEncoder().encode('stat-blob-x')),
      )
      const cidY = await w.driftHelia.addBlob(
        Uint8Array.from(new TextEncoder().encode('stat-blob-y')),
      )
      await w.driftHelia.pinBlob(cidX)
      await w.driftHelia.pinBlob(cidY)
      await w.driftHelia.pinBlob(cidX) // pin duplicado = no-op (Set)
      const after = await w.driftHelia.heliaStats()
      const pinned = await w.driftHelia.listPinned()
      return { before, after, pinnedLen: pinned.length, cidX, cidY }
    })

    expect(result.before.running).toBe(true)
    // 2 cids distintos pinados (o terceiro pin é duplicado).
    expect(result.after.pinnedCount).toBe(result.before.pinnedCount + 2)
    expect(result.pinnedLen).toBe(result.after.pinnedCount)
    expect(result.after.peerCount).toBeGreaterThanOrEqual(0)

    await grace.close()
  })
})
