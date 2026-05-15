/**
 * a11y test — `<SlideUpOverlay>` primitive (modal wrapper).
 *
 * Modal a11y é alta-prioridade — focus trap, role=dialog + aria-modal,
 * accessible name discoverable, ESC dismiss. Aqui axe valida o que ele
 * consegue inspeccionar estaticamente (role, aria-modal, label). Focus
 * trap é runtime e exige test manual ou Playwright.
 *
 * Composto com ModalHeader pra simular uso real (V3.4+ todas as modals
 * consomem este pattern).
 */
import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { SlideUpOverlay } from '../../src/components/UI/SlideUpOverlay'
import { ModalHeader } from '../../src/components/UI/ModalHeader'
import { expectNoViolations } from './axeRunner'

describe('SlideUpOverlay — a11y', () => {
  it('com ariaLabel + ModalHeader (uso típico)', async () => {
    const { container } = render(
      <SlideUpOverlay onClose={() => {}} ariaLabel="perfil">
        <ModalHeader title="perfil" onClose={() => {}} />
        <p>conteúdo do modal</p>
      </SlideUpOverlay>,
    )
    await expectNoViolations(container)
  })

  it('sem ariaLabel mas com heading discoverable via ModalHeader', async () => {
    const { container } = render(
      <SlideUpOverlay onClose={() => {}}>
        <ModalHeader title="ajustes" onClose={() => {}} />
        <p>body</p>
      </SlideUpOverlay>,
    )
    await expectNoViolations(container)
  })

  it('maxWidth=lg + padded=false (custom)', async () => {
    const { container } = render(
      <SlideUpOverlay
        onClose={() => {}}
        ariaLabel="editor"
        maxWidth="lg"
        padded={false}
      >
        <ModalHeader title="editor" onClose={() => {}} />
        <div className="p-4">conteúdo custom-padded</div>
      </SlideUpOverlay>,
    )
    await expectNoViolations(container)
  })

  it('backdropDismissible=false (modal obrigatório)', async () => {
    const { container } = render(
      <SlideUpOverlay
        onClose={() => {}}
        ariaLabel="confirmação"
        backdropDismissible={false}
      >
        <ModalHeader title="confirmação" onClose={() => {}} />
        <p>ação destrutiva — confirme</p>
      </SlideUpOverlay>,
    )
    await expectNoViolations(container)
  })
})
