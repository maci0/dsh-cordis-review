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
export {};
