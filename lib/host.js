/**
 * The slice of the DeepSeek Harness host surface this plugin calls.
 *
 * The contracts are the installed packages' own: `@deepseek-ai/dsh-skill` is a
 * runtime dependency, and `@deepseek-ai/cordis` (which ships `Context.inject`
 * and `Disposable`) is a devDependency used by the composition test. Both
 * resolve here, so this module carries no mirror of either. The skills service
 * is reached through `ctx.inject(['skills'])`, so a composition that does not
 * mount it simply omits the command.
 *
 * @module dsh-cordis-review/host
 */
export {};
