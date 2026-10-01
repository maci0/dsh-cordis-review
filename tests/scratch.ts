/**
 * Test temp space: the package's gitignored `.scratch/`, never the OS temp
 * dir. Tests `mkdtemp` inside it and remove what they create.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of `<package root>/.scratch`, created on import. */
export const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', '.scratch')
mkdirSync(scratch, { recursive: true })
