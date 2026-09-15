#!/usr/bin/env node
/**
 * `dsh-cordis-check [root]` — print closed-form CORDIS tags.
 * One engine (ast-grep) for every tag; without the binary (or for Zig, which
 * has no grammar) each file warns on stderr and yields an LLM-fallback hit.
 *
 * @module dsh-cordis-review/cli
 */

import { resolve } from 'node:path'
import { check } from './check.ts'

const root = resolve(process.argv[2] ?? '.')
const findings = await check(root)

if (findings.length === 0) {
  process.stdout.write('cordis-check: clean\n')
  process.exit(0)
}

for (const finding of findings) {
  process.stdout.write(`${finding.file}:${finding.line}: ${finding.tag}: ${finding.message}\n`)
}
process.exit(1)
