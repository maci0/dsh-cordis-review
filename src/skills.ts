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
import { BUNDLED_SKILL_RANK, isSkillName } from '@deepseek-ai/dsh-skill'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillSummary,
} from '@deepseek-ai/dsh-skill'
import { parseFrontmatter, parseFrontmatterWithYaml } from './frontmatter.ts'
import type { Frontmatter } from './frontmatter.ts'

/**
 * Rank matching a harness bundled skill, re-exported from the registry so a
 * project-level or user-level skill of the same name still wins the duplicate.
 */
export { BUNDLED_SKILL_RANK }

/** Provider name inside the skill registry. */
const PROVIDER_NAME = 'cordis-review'

/** Instruction file every skill directory must carry. */
const INSTRUCTION_FILE = 'SKILL.md'

/** Frontmatter keys the harness defines; they project into named summary fields, never into `metadata`. */
const SUMMARY_KEYS = new Set(['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable'])

/** One parsed bundled skill. */
interface BundledSkill {
  /** Kebab-case skill name from frontmatter, or the directory name. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Extra routing hint from frontmatter, when present. */
  readonly whenToUse?: string
  /** Resolved invocation controls from the documented frontmatter keys. */
  readonly invocation: SkillInvocationPolicy
  /** Instruction body with frontmatter removed. */
  readonly content: string
  /** Remaining frontmatter keys (provider-specific only). */
  readonly metadata: Readonly<Record<string, unknown>>
  /** Absolute path of the instruction file. */
  readonly path: string
  /** Absolute path of the skill directory, used as the resource base. */
  readonly directory: string
}

/** Options for {@link createSkillProvider}. */
interface SkillProviderOptions {
  /** Directory holding one subdirectory per skill. */
  readonly skillsDir: string
  /** Receives non-fatal discovery problems instead of throwing. */
  readonly onWarn?: (message: string) => void
}

/** Pre-hyphenated invocation keys the harness refuses, with the key that replaced each. */
const LEGACY_INVOCATION_KEYS: Readonly<Record<string, string>> = {
  disableModelInvocation: 'disable-model-invocation',
  modelInvocable: 'disable-model-invocation',
  userInvocable: 'user-invocable',
}

/**
 * Read one invocation flag with the spellings the harness filesystem provider
 * accepts: a YAML boolean, `1`/`0`, or `true`/`yes`/`on`/`false`/`no`/`off`
 * in any case.
 * @param data - the frontmatter mapping.
 * @param key - the invocation key.
 * @returns the flag, or `undefined` when the key is absent.
 * @throws TypeError when the value is none of those spellings.
 */
function frontmatterBoolean(data: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    const word = value.toLowerCase()
    if (word === 'true' || word === 'yes' || word === 'on') return true
    if (word === 'false' || word === 'no' || word === 'off') return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * Resolve the invocation policy the way the harness filesystem provider does.
 * @param data - the frontmatter mapping.
 * @returns the policy; both surfaces default to on.
 * @throws Error for a legacy camelCase key or a non-boolean value.
 */
function parseInvocationPolicy(data: Readonly<Record<string, unknown>>): SkillInvocationPolicy {
  for (const [legacy, canonical] of Object.entries(LEGACY_INVOCATION_KEYS)) {
    if (Object.hasOwn(data, legacy)) throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
  return {
    modelInvocable: frontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: frontmatterBoolean(data, 'user-invocable') !== false,
  }
}

/**
 * Read and parse one skill file. Shared by discovery and direct loads so a
 * single file enforces the name/description/frontmatter rules everywhere.
 * @param path - absolute path of the `SKILL.md` file.
 * @param onWarn - optional non-fatal problem sink.
 * @param entryName - directory name fallback when frontmatter omits `name`.
 * @param signal - aborts the read for a caller that no longer wants the result.
 * @returns the parsed skill, or `undefined` with a warning when invalid.
 */
async function readSkillFile(
  path: string,
  onWarn?: (message: string) => void,
  entryName?: string,
  signal?: AbortSignal,
): Promise<BundledSkill | undefined> {
  if (signal?.aborted) return undefined

  let source: string
  try {
    source = await readFile(path, { encoding: 'utf8', signal })
  } catch (error) {
    if (!signal?.aborted) onWarn?.(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  let parsed: Frontmatter
  try {
    // The flat reader covers every header this package ships. Its refusal is
    // what selects the real YAML parser, so the fallback stays the contract.
    parsed = parseFrontmatter(source) ?? await parseFrontmatterWithYaml(source)
  } catch (error) {
    onWarn?.(`skipping ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  const fallback = entryName ?? basename(path)
  const name = String(parsed.data['name'] ?? fallback).trim()
  const description = String(parsed.data['description'] ?? '').trim()

  if (!isSkillName(name)) {
    onWarn?.(`skipping ${path}: "${name}" is not a valid kebab-case skill name`)
    return undefined
  }
  if (description === '') {
    onWarn?.(`skipping ${path}: frontmatter has no description`)
    return undefined
  }

  let invocation: SkillInvocationPolicy
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    onWarn?.(`skipping ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (SUMMARY_KEYS.has(key)) continue
    metadata[key] = value
  }

  const whenToUse = String(parsed.data['whenToUse'] ?? '').trim()

  return {
    name,
    description,
    ...whenToUse === '' ? {} : { whenToUse },
    invocation,
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
 * the reader refuses, and a file with a missing description or an invalid
 * invocation key are reported through `onWarn` and skipped: one broken file
 * must not cost the catalog its other skills.
 * @param skillsDir - directory holding one subdirectory per skill.
 * @param onWarn - optional non-fatal problem sink.
 * @param signal - aborts discovery for a caller that no longer wants the result.
 * @returns the parsed skills, sorted by name.
 */
export async function discoverSkills(
  skillsDir: string,
  onWarn?: (message: string) => void,
  signal?: AbortSignal,
): Promise<readonly BundledSkill[]> {
  if (signal?.aborted) return []

  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    if (signal?.aborted) return []
    onWarn?.(`cannot read skills directory ${skillsDir}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }

  const skills: BundledSkill[] = []
  for (const entry of entries) {
    if (signal?.aborted) break
    if (!entry.isDirectory()) continue

    const path = join(skillsDir, entry.name, INSTRUCTION_FILE)
    const skill = await readSkillFile(path, onWarn, entry.name, signal)
    if (skill !== undefined) skills.push(skill)
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export function createSkillProvider(options: SkillProviderOptions) {
  const summaryOf = (skill: BundledSkill): SkillSummary => ({
    path: skill.path,
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    invocation: skill.invocation,
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directory },
  })

  return {
    name: PROVIDER_NAME,

    async list(lookup?: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
      const skills = await discoverSkills(options.skillsDir, options.onWarn, lookup?.signal)
      return skills.map((skill) => ({
        ...summaryOf(skill),
        rank: BUNDLED_SKILL_RANK,
        locator: skill.path,
        metadata: skill.metadata,
      }))
    },

    async get(
      candidate: SkillCandidate,
      lookup?: SkillLookupOptions,
    ): Promise<SkillDefinition | undefined> {
      if (typeof candidate.locator !== 'string') return undefined

      // Read the locator directly: one file instead of a full re-discovery.
      // The name check keeps a stale candidate (path reused by another skill)
      // from loading under the wrong identity.
      // Same directory-name fallback `list` applies, so a skill that omits
      // `name` in frontmatter is not listed under an identity `get` refuses.
      const skill = await readSkillFile(candidate.locator, options.onWarn, basename(dirname(candidate.locator)), lookup?.signal)
      if (skill === undefined || skill.name !== candidate.name) return undefined

      return { ...summaryOf(skill), content: skill.content, metadata: skill.metadata }
    },
  } satisfies SkillProvider
}
