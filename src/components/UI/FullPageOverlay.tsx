/**
 * @deprecated 2026-05-08 — use `<FullPageCard>` em vez de `<FullPageOverlay>`.
 *
 * Histórico: este primitive foi substituído por `<FullPageCard>` em
 * `./FullPageCard.tsx` que aplica fixes de TX-1 (sub-card flicker
 * mid-transition — opacity inicial 0.95 em vez de 0), TX-2 (max-w-md
 * cap forçado em todas as instâncias), e TX-11 (clickOutToClose opt-in).
 * Convergente com Ted UX spike §5 + Robin QA #1 §7
 * (`Docs/sessions/ted-ux-spike-deployed-2026-05-08.md`,
 *  `Docs/sessions/design-qa-baseline-2026-05-08.md`).
 *
 * Re-export mantido por retro-compat. Migração de callers pra
 * `<FullPageCard>` foi feita em sessão 2026-05-08; novos callers
 * devem importar `FullPageCard` direto.
 *
 * Próximo passo: deletar este arquivo após verificar que nenhum
 * import de `FullPageOverlay` permanece (grep + tsc passa).
 */

export {
  FullPageCard as FullPageOverlay,
  type FullPageCardProps as FullPageOverlayProps,
} from './FullPageCard'
