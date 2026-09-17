/**
 * The bundled cordis-review skill as a `ctx.skills` provider.
 *
 * Skills are read from this package's `skills/<name>/SKILL.md`, so that file
 * stays the single source of truth for `/cordis-review`.
 *
 * @module dsh-cordis-review/skills
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BUNDLED_SKILL_RANK, isSkillName } from '@deepseek-ai/dsh-skill';
import { parseFrontmatter } from './frontmatter.js';
/**
 * Rank matching a harness bundled skill, re-exported from the registry so a
 * project-level or user-level skill of the same name still wins the duplicate.
 */
export { BUNDLED_SKILL_RANK };
/** Provider name inside the skill registry. */
const PROVIDER_NAME = 'cordis-review';
/** Instruction file every skill directory must carry. */
const INSTRUCTION_FILE = 'SKILL.md';
/** Frontmatter keys the harness defines; they project into named summary fields, never into `metadata`. */
const SUMMARY_KEYS = new Set(['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable']);
/**
 * Read and parse one skill file. Shared by discovery and direct loads so a
 * single file enforces the name/description/frontmatter rules everywhere.
 * @param path - absolute path of the `SKILL.md` file.
 * @param onWarn - optional non-fatal problem sink.
 * @param entryName - directory name fallback when frontmatter omits `name`.
 * @param signal - aborts the read for a caller that no longer wants the result.
 * @returns the parsed skill, or `undefined` with a warning when invalid.
 */
async function readSkillFile(path, onWarn, entryName, signal) {
    if (signal?.aborted)
        return undefined;
    let source;
    try {
        source = await readFile(path, { encoding: 'utf8', signal });
    }
    catch {
        return undefined;
    }
    let parsed;
    try {
        parsed = parseFrontmatter(source);
    }
    catch (error) {
        onWarn?.(`skipping ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
    const fallback = entryName ?? basename(path);
    const name = String(parsed.data['name'] ?? fallback).trim();
    const description = String(parsed.data['description'] ?? '').trim();
    if (!isSkillName(name)) {
        onWarn?.(`skipping ${path}: "${name}" is not a valid kebab-case skill name`);
        return undefined;
    }
    if (description === '') {
        onWarn?.(`skipping ${path}: frontmatter has no description`);
        return undefined;
    }
    const metadata = {};
    for (const [key, value] of Object.entries(parsed.data)) {
        if (SUMMARY_KEYS.has(key))
            continue;
        metadata[key] = value;
    }
    const whenToUse = String(parsed.data['whenToUse'] ?? '').trim();
    return {
        name,
        description,
        ...whenToUse === '' ? {} : { whenToUse },
        invocation: {
            modelInvocable: parsed.data['disable-model-invocation'] !== true,
            userInvocable: parsed.data['user-invocable'] !== false,
        },
        content: parsed.body.trim(),
        metadata,
        path,
        directory: dirname(path),
    };
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
 * @param signal - aborts discovery for a caller that no longer wants the result.
 * @returns the parsed skills, sorted by name.
 */
export async function discoverSkills(skillsDir, onWarn, signal) {
    if (signal?.aborted)
        return [];
    let entries;
    try {
        entries = await readdir(skillsDir, { withFileTypes: true });
    }
    catch (error) {
        if (signal?.aborted)
            return [];
        onWarn?.(`cannot read skills directory ${skillsDir}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
    const skills = [];
    for (const entry of entries) {
        if (signal?.aborted)
            break;
        if (!entry.isDirectory())
            continue;
        const path = join(skillsDir, entry.name, INSTRUCTION_FILE);
        const skill = await readSkillFile(path, onWarn, entry.name, signal);
        if (skill !== undefined)
            skills.push(skill);
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
}
/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export function createSkillProvider(options) {
    const summaryOf = (skill) => ({
        path: skill.path,
        name: skill.name,
        description: skill.description,
        ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
        invocation: skill.invocation,
        source: 'bundled',
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: skill.directory },
    });
    return {
        name: PROVIDER_NAME,
        async list(lookup) {
            const skills = await discoverSkills(options.skillsDir, options.onWarn, lookup?.signal);
            return skills.map((skill) => ({
                ...summaryOf(skill),
                rank: BUNDLED_SKILL_RANK,
                locator: skill.path,
                metadata: skill.metadata,
            }));
        },
        async get(candidate, lookup) {
            if (typeof candidate.locator !== 'string')
                return undefined;
            // Read the locator directly: one file instead of a full re-discovery.
            // The name check keeps a stale candidate (path reused by another skill)
            // from loading under the wrong identity.
            const skill = await readSkillFile(candidate.locator, options.onWarn, undefined, lookup?.signal);
            if (skill === undefined || skill.name !== candidate.name)
                return undefined;
            return { ...summaryOf(skill), content: skill.content, metadata: skill.metadata };
        },
    };
}
