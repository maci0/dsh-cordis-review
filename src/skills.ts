/**
 * The bundled cordis-review skill as a `ctx.skills` provider.
 *
 * Skills are read from this package's `skills/<name>/SKILL.md`, so that file
 * stays the single source of truth for `/cordis-review`.
 *
 * @module dsh-cordis-review/skills
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import type {
  SkillCandidateLike,
  SkillDefinitionLike,
  SkillProviderLike,
  SkillSummaryLike,
} from './host.ts'

/** Rank matching a harness bundled skill (600), so a project-level or user-level
 * skill of the same name still wins the duplicate. */
export const BUNDLED_SKILL_RANK = 600

/** Provider name inside the skill registry. */
const PROVIDER_NAME = 'cordis-review'

/** The grammar the registry enforces for skill names. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Instruction file every skill directory must carry. */
const INSTRUCTION_FILE = 'SKILL.md'

/** One parsed bundled skill. */
export interface BundledSkill {
  /** Kebab-case skill name from frontmatter, or the directory name. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Instruction body with frontmatter removed. */
  readonly content: string
  /** Remaining frontmatter keys (`argument-hint`, `license`, …). */
  readonly metadata: Readonly<Record<string, string>>
  /** Absolute path of the instruction file. */
  readonly path: string
  /** Absolute path of the skill directory, used as the resource base. */
  readonly directory: string
}

/** Options for {@link createSkillProvider}. */
export interface SkillProviderOptions {
  /** Directory holding one subdirectory per skill. */
  readonly skillsDir: string
  /** Receives non-fatal discovery problems instead of throwing. */
  readonly onWarn?: (message: string) => void
}

/**
 * Read and parse one skill file. Shared by discovery and direct loads so a
 * single file enforces the name/description/frontmatter rules everywhere.
 * @param path - absolute path of the `SKILL.md` file.
 * @param entryName - directory name fallback when frontmatter omits `name`.
 * @param onWarn - optional non-fatal problem sink.
 * @returns the parsed skill, or `undefined` with a warning when invalid.
 */
export async function readSkillFile(
  path: string,
  onWarn?: (message: string) => void,
  entryName?: string,
): Promise<BundledSkill | undefined> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch {
    return undefined
  }

  let parsed: ReturnType<typeof parseFrontmatter>
  try {
    parsed = parseFrontmatter(source)
  } catch (error) {
    onWarn?.(`skipping ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  const fallback = entryName ?? basename(path)
  const name = (parsed.data['name'] ?? fallback).trim()
  const description = (parsed.data['description'] ?? '').trim()

  if (!SKILL_NAME.test(name)) {
    onWarn?.(`skipping ${path}: "${name}" is not a valid kebab-case skill name`)
    return undefined
  }
  if (description === '') {
    onWarn?.(`skipping ${path}: frontmatter has no description`)
    return undefined
  }

  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key === 'name' || key === 'description') continue
    metadata[key] = value
  }

  return {
    name,
    description,
    content: parsed.body.trim(),
    metadata,
    path,
    directory: dirname(path),
  }
}

/**
 * Read every valid skill directory under `skillsDir`.
 *
 * A missing directory, a directory without `SKILL.md`, a file whose frontmatter
 * the reader refuses, and a file with a missing description are reported
 * through `onWarn` and skipped: one broken file must not cost the catalog its
 * other skills.
 * @param skillsDir - directory holding one subdirectory per skill.
 * @param onWarn - optional non-fatal problem sink.
 * @returns the parsed skills, sorted by name.
 */
export async function discoverSkills(
  skillsDir: string,
  onWarn?: (message: string) => void,
): Promise<readonly BundledSkill[]> {
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    onWarn?.(`cannot read skills directory ${skillsDir}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }

  const skills: BundledSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const path = join(skillsDir, entry.name, INSTRUCTION_FILE)
    const skill = await readSkillFile(path, onWarn, entry.name)
    if (skill !== undefined) skills.push(skill)
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProviderLike {
  const summaryOf = (skill: BundledSkill): SkillSummaryLike => ({
    path: skill.path,
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directory },
  })

  return {
    name: PROVIDER_NAME,

    async list(): Promise<readonly SkillCandidateLike[]> {
      const skills = await discoverSkills(options.skillsDir, options.onWarn)
      return skills.map((skill) => ({
        ...summaryOf(skill),
        rank: BUNDLED_SKILL_RANK,
        locator: skill.path,
        metadata: skill.metadata,
      }))
    },

    async get(candidate: SkillCandidateLike): Promise<SkillDefinitionLike | undefined> {
      if (typeof candidate.locator !== 'string') return undefined

      // Read the locator directly: one file instead of a full re-discovery.
      // The name check keeps a stale candidate (path reused by another skill)
      // from loading under the wrong identity.
      const skill = await readSkillFile(candidate.locator, options.onWarn)
      if (skill === undefined || skill.name !== candidate.name) return undefined

      return { ...summaryOf(skill), content: skill.content, metadata: skill.metadata }
    },
  }
}
