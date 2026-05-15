/**
 * a11y test — `<ModalHeader>` primitive.
 *
 * Cobre estrutura semântica do header de modal:
 * - <h2> presente com texto não-vazio
 * - close button com aria-label "fechar"
 * - tone='danger' não quebra structure
 *
 * Importante: ModalHeader renderiza um `<h2>` standalone. Axe-core
 * pode flagar "page must contain a level-one heading" se rodar
 * fora de contexto. Pra evitar false positive, embrulhamos em
 * `<section aria-label="modal">` simulando o uso real (dentro de
 * SlideUpOverlay com role=dialog).
 */
import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { ModalHeader } from '../../src/components/UI/ModalHeader'
import { expectNoViolations } from './axeRunner'

describe('ModalHeader — a11y', () => {
  it('default tone com title + close', async () => {
    const { container } = render(
      <section role="dialog" aria-modal="true" aria-label="perfil">
        <ModalHeader title="perfil" onClose={() => {}} />
      </section>,
    )
    await expectNoViolations(container)
  })

  it('com subtitle', async () => {
    const { container } = render(
      <section role="dialog" aria-modal="true" aria-label="config">
        <ModalHeader title="config" subtitle="ajustes locais" onClose={() => {}} />
      </section>,
    )
    await expectNoViolations(container)
  })

  it('tone=danger', async () => {
    const { container } = render(
      <section role="dialog" aria-modal="true" aria-label="denunciar">
        <ModalHeader title="denunciar" tone="danger" onClose={() => {}} />
      </section>,
    )
    await expectNoViolations(container)
  })

  it('hideClose=true (informativo)', async () => {
    const { container } = render(
      <section role="dialog" aria-modal="true" aria-label="info">
        <ModalHeader title="info" onClose={() => {}} hideClose />
      </section>,
    )
    await expectNoViolations(container)
  })
})
