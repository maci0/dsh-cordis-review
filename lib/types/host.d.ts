/**
 * The slice of the DeepSeek Harness host surface this plugin uses, declared
 * structurally.
 *
 * The plugin is installed from outside the harness checkout, so it cannot
 * resolve `@deepseek-ai/*` packages from its own directory and deliberately
 * carries no runtime dependency on them. These interfaces describe the exact
 * contracts the plugin calls; the host types remain authoritative. The skills
 * service is reached through `ctx.inject(['skills'])`, so a composition that
 * does not mount it simply omits the command.
 *
 * @module dsh-cordis-review/host
 */
/** Disposer returned by every host registration. */
export type Disposable = () => void;
/** Caller context for one provider lookup: workspace selector plus cancellation. */
export interface SkillLookupOptionsLike {
    /** Workspace selector for a cwd-sensitive provider; unused here. */
    readonly cwd?: string;
    /** Aborts discovery or loading work for the current caller. */
    readonly signal?: AbortSignal;
}
/** Invocation controls carried by every skill summary. */
export interface SkillInvocationPolicyLike {
    /** Whether model-facing catalogs and the `skill` tool include this skill. */
    readonly modelInvocable: boolean;
    /** Whether human-facing command catalogs include this skill. */
    readonly userInvocable: boolean;
}
/** Invocation-neutral skill metadata. */
export interface SkillSummaryLike {
    /** Absolute instruction file path, when the provider has one. */
    readonly path?: string;
    /** Kebab-case identifier. */
    readonly name: string;
    /** Short routing description. */
    readonly description: string;
    /** Extra routing hint, when frontmatter carries one. */
    readonly whenToUse?: string;
    /** Resolved invocation controls. */
    readonly invocation: SkillInvocationPolicyLike;
    /** Discovery source bucket. */
    readonly source: string;
    /** Owning provider name. */
    readonly provider: string;
    /** Base for resources referenced by the loaded body. */
    readonly resourceBase?: {
        readonly kind: 'directory';
        readonly path: string;
    };
}
/** Provider catalog entry the registry merges and later loads. */
export interface SkillCandidateLike extends SkillSummaryLike {
    /** Lower ranks win duplicate names before provider registration order. */
    readonly rank: number;
    /** Opaque provider-owned handle passed back to `get()`. */
    readonly locator: unknown;
    /** Parsed provider-specific frontmatter. */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Complete skill definition including the loaded body. */
export interface SkillDefinitionLike extends SkillSummaryLike {
    /** Instruction body after frontmatter removal. */
    readonly content: string;
    /** Parsed provider-specific frontmatter. */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** One source of skills. */
export interface SkillProviderLike {
    /** Unique provider name in the registry. */
    readonly name: string;
    /** List candidates for the current lookup. */
    list(options?: SkillLookupOptionsLike): Promise<readonly SkillCandidateLike[]>;
    /** Load a winning candidate's body, or `undefined` when it is gone. */
    get(candidate: SkillCandidateLike, options?: SkillLookupOptionsLike): Promise<SkillDefinitionLike | undefined>;
}
/** Host context this plugin actually calls. */
export interface HostContext {
    /** Restrict this fiber until the named services exist, then run `callback`. */
    inject(dependencies: readonly string[], callback: (scope: HostContext) => void): Disposable;
    /** Skill registry; present only inside `inject(['skills'], …)`. */
    readonly skills?: {
        registerProvider(create: () => SkillProviderLike): Disposable;
    };
}
