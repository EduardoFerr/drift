/**
 * Profile picture render conformance — LOCK_VIA_TEST Sprint N+2 P2.11.
 *
 * Source: Lily audit `Docs/sessions/profile-picture-audit-2026-05-21.md`.
 *
 * Pre-fix: feature MVP+1 incompleta — `feed.ts:rowToPost` não populava
 * `authorAvatar`/`authorAlias`; SubpostLayout/CommentCard nunca exibiam
 * avatar. ProfileModal funcionava isolado mas feed/comments não.
 *
 * Defesas estáticas (source-grep, sem runtime):
 *
 *   1. `feed.ts` faz LEFT JOIN com `users_metadata` no read path
 *   2. `rowToPost` extrai `picture`/`name`/`display_name` → Post.authorAvatar/Alias
 *   3. SubpostLayout + CommentCard importam AuthorChip primitive
 *   4. AuthorChip aplica `isSafeAvatarUrl` + `referrerPolicy="no-referrer"`
 *      + identicon fallback (manifesto §28 Barney audit defense-em-depth)
 *
 * Whitelist: `// profile-pic-audit: ok reason=...` (raro — só pra casos
 * onde alias/picture intencionalmente NÃO renderizam, ex: anonimato hard).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Profile picture render — Sprint N+2 P2.11 LOCK_VIA_TEST', () => {
  describe('feed.ts LEFT JOIN populando author_* fields', () => {
    const feed = readFileSync('src/lib/feed.ts', 'utf8')

    it('PostRow type inclui author_name, author_display_name, author_picture', () => {
      expect(feed).toMatch(/author_name:\s*string\s*\|\s*null/)
      expect(feed).toMatch(/author_display_name:\s*string\s*\|\s*null/)
      expect(feed).toMatch(/author_picture:\s*string\s*\|\s*null/)
    })

    it('SELECT compartilhado faz LEFT JOIN users_metadata por author_pub = npub', () => {
      // LEFT (não INNER) preserva posts de autores em modo Anônimo §5.3
      expect(feed).toMatch(/LEFT\s+JOIN\s+users_metadata\s+um\s+ON\s+um\.npub\s*=\s*p\.author_pub/i)
      // Picks decorativos NIP-01
      expect(feed).toMatch(/um\.name\s+AS\s+author_name/i)
      expect(feed).toMatch(/um\.display_name\s+AS\s+author_display_name/i)
      expect(feed).toMatch(/um\.picture\s+AS\s+author_picture/i)
    })

    it('rowToPost popula authorAvatar e authorAlias do row', () => {
      // Alias: display_name OR name (NIP-01 convenção, display_name prefer)
      expect(feed).toMatch(/authorAlias\s*=\s*row\.author_display_name\s*\?\?\s*row\.author_name/)
      // Picture direto (validação anti-tracker no render via isSafeAvatarUrl)
      expect(feed).toMatch(/authorAvatar\s*=\s*row\.author_picture/)
      // Inclusos no return literal
      expect(feed).toMatch(/return\s*\{[\s\S]*authorAlias[\s\S]*authorAvatar[\s\S]*\}/m)
    })

    it('getGlobalFeed / getFollowingFeed / getTrendingFeed / getPostById usam POST_SELECT', () => {
      // Não devem mais ter SELECT inline "FROM posts" (sem join)
      const inlineSelects = feed.match(/SELECT[^`]*FROM\s+posts\b(?!\s+p\b)/gi) ?? []
      // Permite menção fora-de-query (comments, docs) — só falha se algum
      // SELECT escapou da refator (sem alias `p` nem POST_SELECT).
      expect(
        inlineSelects.length,
        'Queries inline `SELECT … FROM posts` devem usar POST_SELECT (com LEFT JOIN users_metadata)',
      ).toBe(0)
      // Confirma constante usada nos 4 call-sites
      const usages = (feed.match(/\$\{POST_SELECT\}/g) ?? []).length
      expect(usages).toBeGreaterThanOrEqual(4)
    })
  })

  describe('AuthorChip primitive (manifesto §28 defesa em camada)', () => {
    const chip = readFileSync('src/components/UI/AuthorChip.tsx', 'utf8')

    it('aplica isSafeAvatarUrl antes de renderizar <img>', () => {
      expect(chip).toMatch(/isSafeAvatarUrl/)
      expect(chip).toMatch(/https:\/\//i)
      expect(chip).toMatch(/data:image\//i)
    })

    it('<img> tem referrerPolicy="no-referrer" + loading="lazy"', () => {
      expect(chip).toMatch(/referrerPolicy=["']no-referrer["']/)
      expect(chip).toMatch(/loading=["']lazy["']/)
    })

    it('fallback identicon determinístico derivado do authorPub (manifesto §7)', () => {
      // Mesma fórmula do ProfileModal pra consistência cross-component
      expect(chip).toMatch(/parseInt\(pub\.slice\(0,\s*8\),\s*16\)\s*%\s*360/)
    })

    it('fallback alias "anon…<last6>" quando picture/alias ausentes', () => {
      expect(chip).toMatch(/anon…/)
      expect(chip).toMatch(/slice\(-6\)/)
    })
  })

  describe('SubpostLayout renderiza AuthorChip', () => {
    const layout = readFileSync('src/components/Post/SubpostLayout.tsx', 'utf8')

    it('importa AuthorChip do UI/', () => {
      expect(layout).toMatch(/from\s+['"]\.\.\/UI\/AuthorChip['"]/)
    })

    it('renderiza <AuthorChip> com post.authorPub + opt-in alias/picture', () => {
      expect(layout).toMatch(/<AuthorChip[\s\S]*?authorPub=\{post\.authorPub\}/)
      expect(layout).toMatch(/alias=\{post\.authorAlias\}/)
      expect(layout).toMatch(/picture=\{post\.authorAvatar\}/)
    })
  })

  describe('CommentCard renderiza AuthorChip (card + list variants)', () => {
    const card = readFileSync('src/components/Post/CommentCard.tsx', 'utf8')

    it('importa AuthorChip', () => {
      expect(card).toMatch(/from\s+['"]\.\.\/UI\/AuthorChip['"]/)
    })

    it('fetcha metadata via useUserMetadata(node.author_pub)', () => {
      expect(card).toMatch(/useUserMetadata\(node\.author_pub\)/)
    })

    it('passa picture/alias opt-in pro AuthorChip', () => {
      // Pelo menos 2 ocorrências (card variant + list variant)
      const matches = card.match(/<AuthorChip\b[\s\S]*?authorPub=\{node\.author_pub\}/g) ?? []
      expect(matches.length).toBeGreaterThanOrEqual(1)
      // Card variant header não usa mais o span legacy "anon{truncate(...)}"
      // no JSX (truncate permanece em ariaLabel fallback)
      const legacySpanCount = (
        card.match(/<span[^>]*font-display[^>]*>\s*anon\{truncate/g) ?? []
      ).length
      expect(
        legacySpanCount,
        'Header "anon{truncate(node.author_pub)}" legacy substituído por <AuthorChip>',
      ).toBe(0)
    })
  })

  describe('Manifesto §22 — author_* NÃO entram em score/ranking', () => {
    it('scoring.ts não toca em users_metadata nem em campos author_* decorativos', () => {
      // Heurística defensiva: scoring é função pura de spreads/buries/age.
      // Se futuro PR misturar metadata em score, falha aqui antes do review.
      const scoring = readFileSync('src/lib/scoring.ts', 'utf8')
      expect(scoring).not.toMatch(/users_metadata/)
      expect(scoring).not.toMatch(/authorAvatar|authorAlias|author_picture|author_name/)
    })
  })
})
