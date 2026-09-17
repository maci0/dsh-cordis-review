/**
 * YAML-frontmatter reader for the bundled `SKILL.md` files.
 *
 * Built on `yaml`, the parser the harness's own filesystem skill provider
 * uses, so `|`/`|-`/`>-` block scalars and nested maps behave exactly as the
 * registry expects instead of being hand-rolled. The delimiter scan stays
 * local: frontmatter with no closing `---` is not frontmatter, and the body is
 * then the whole source.
 *
 * @module dsh-cordis-review/frontmatter
 */
/** Parsed frontmatter plus the markdown body that follows it. */
export interface Frontmatter {
    /** Frontmatter mapping, values as the YAML parser produced them. */
    readonly data: Readonly<Record<string, unknown>>;
    /** Everything after the closing delimiter, or the whole source when absent. */
    readonly body: string;
}
/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed mapping and the remaining body.
 */
export declare function parseFrontmatter(source: string): Frontmatter;
