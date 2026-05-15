#!/usr/bin/env node
/**
 * gen-sbom.mjs — gera Software Bill of Materials (SBOM) do Drift.
 *
 * Output: sbom.json (formato CycloneDX 1.5) na raiz do repo.
 *
 * Por que: manifesto §17 (sem chave mestra + build reproduzível) implica
 * auditabilidade. SBOM permite a auditores externos / F-Droid / users
 * paranóicos validar que o bundle publicado corresponde à árvore de deps
 * declarada.
 *
 * Uso:
 *   node scripts/gen-sbom.mjs           # produz sbom.json
 *   node scripts/gen-sbom.mjs --check   # valida que sbom.json existe
 *                                       # e cobre versão atual de package.json
 *
 * Integração futura (próxima sprint): anexar sbom.json em release.yml.
 *
 * Implementação: wrapper sobre `npm sbom --sbom-format=cyclonedx`
 * (npm 10+). Sem deps externas — roda em qualquer Node 20+.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const sbomPath = resolve(repoRoot, 'sbom.json')
const pkgPath = resolve(repoRoot, 'package.json')

const isCheck = process.argv.includes('--check')

function readPkgVersion() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return pkg.version
}

function generate() {
  const version = readPkgVersion()
  console.log(`Gerando SBOM para drift@${version}...`)

  // `npm sbom` retorna JSON no stdout. SBOM-format cyclonedx é o padrão
  // mais portável (também aceito por GH dependency graph, SLSA tooling).
  const stdout = execSync('npm sbom --sbom-format=cyclonedx --omit=dev', {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024, // 50 MB — árvore tem ~1500 deps
  })

  // Valida JSON antes de gravar.
  const sbom = JSON.parse(stdout)
  if (!sbom.bomFormat || sbom.bomFormat !== 'CycloneDX') {
    throw new Error(`SBOM inválido: bomFormat=${sbom.bomFormat}`)
  }

  // Pretty-print para diffs legíveis.
  writeFileSync(sbomPath, JSON.stringify(sbom, null, 2) + '\n', 'utf8')

  const componentCount = Array.isArray(sbom.components) ? sbom.components.length : 0
  console.log(`✓ sbom.json escrito (${componentCount} componentes runtime)`)
  console.log(`  caminho: ${sbomPath}`)
  console.log(`  formato: CycloneDX ${sbom.specVersion ?? '?'}`)
}

function check() {
  if (!existsSync(sbomPath)) {
    console.error(`✗ sbom.json não encontrado em ${sbomPath}`)
    console.error('  Rode: node scripts/gen-sbom.mjs')
    process.exit(1)
  }
  const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'))
  const pkgVersion = readPkgVersion()
  const sbomVersion = sbom.metadata?.component?.version

  if (sbomVersion !== pkgVersion) {
    console.error(`✗ sbom.json desatualizado: SBOM=${sbomVersion} vs package.json=${pkgVersion}`)
    console.error('  Rode: node scripts/gen-sbom.mjs')
    process.exit(1)
  }
  console.log(`✓ sbom.json cobre drift@${pkgVersion}`)
}

try {
  if (isCheck) {
    check()
  } else {
    generate()
  }
} catch (err) {
  console.error('Erro:', err.message)
  process.exit(1)
}
