/**
 * The bundled cordis-review skill as a `ctx.skills` provider.
 *
 * Skills are read from this package's `skills/<name>/SKILL.md`, so that file
 * stays the single source of truth for `/cordis-review`.
 *
 * @module dsh-cordis-review/skills
 */
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';
import type { SkillCandidate, SkillDefinition, SkillInvocationPolicy, SkillLookupOptions } from '@deepseek-ai/dsh-skill';
/**
 * Rank matching a harness bundled skill, re-exported from the registry so a
 * project-level or user-level skill of the same name still wins the duplicate.
 */
export { BUNDLED_SKILL_RANK };
/** One parsed bundled skill. */
interface BundledSkill {
    /** Kebab-case skill name from frontmatter, or the directory name. */
    readonly name: string;
    /** Routing description from frontmatter. */
    readonly description: string;
    /** Extra routing hint from frontmatter, when present. */
    readonly whenToUse?: string;
    /** Resolved invocation controls from the documented frontmatter keys. */
    readonly invocation: SkillInvocationPolicy;
    /** Instruction body with frontmatter removed. */
    readonly content: string;
    /** Remaining frontmatter keys (provider-specific only). */
    readonly metadata: Readonly<Record<string, unknown>>;
    /** Absolute path of the instruction file. */
    readonly path: string;
    /** Absolute path of the skill directory, used as the resource base. */
    readonly directory: string;
}
/** Options for {@link createSkillProvider}. */
interface SkillProviderOptions {
    /** Directory holding one subdirectory per skill. */
    readonly skillsDir: string;
    /** Receives non-fatal discovery problems instead of throwing. */
    readonly onWarn?: (message: string) => void;
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
export declare function discoverSkills(skillsDir: string, onWarn?: (message: string) => void, signal?: AbortSignal): Promise<readonly BundledSkill[]>;
/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export declare function createSkillProvider(options: SkillProviderOptions): {
    name: string;
    list(lookup?: SkillLookupOptions): Promise<readonly SkillCandidate[]>;
    get(candidate: SkillCandidate, lookup?: SkillLookupOptions): Promise<SkillDefinition | undefined>;
};
