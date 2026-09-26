# dsh-cordis-review

CORDIS review skills in the composer. `/cordis-review` patches context-paradigm violations. `/cordis-doc-review` creates or repairs source-backed tutorials, references, cookbooks, subsystem docs, and package contracts.

```
/cordis-review
/cordis-doc-review
```

Paper: [A Programming Paradigm for Spatiotemporal Composability](https://arxiv.org/abs/2608.25512) (Shi, Zhang, Cui; arXiv:2608.25512).

## What you get

- **One command, one product.** `/cordis-review` loads the bundled skill body through the skill registry and lands in the `/` menu as DSH's command surface for user-invocable skills. Workspace defaults to the current one; `/cordis-review <path>` scopes it.
- **Rubrics that ship with the plugin.** `skills/cordis-review/SKILL.md` audits temporal and spatial composability. `skills/cordis-doc-review/SKILL.md` creates accurate tutorials, references, cookbooks, subsystem docs, and package contracts from source, tests, and configuration.
- **Patches, not advice.** The skill instructs the agent to fix every applicable hit, grep the callers of anything it touches, fix the shared primitive, and leave one dispose test per registration it adds or repairs. Hits outside the system boundary are skipped with a one-line reason.
- **A closed-form checker.** `cordis-review-check` prints the four tags that are grammar rather than judgment — `mix-export`, `inject`, `toplevel`, `id`. Every tag is an ast-grep query over JS/TS/TSX, JavaScript/JSX, Python, and YAML.
- **A real fallback path.** No `ast-grep` on PATH means each covered file warns on stderr and yields an LLM-fallback hit for the review agent to judge. `leak`, `inverse`, `hmr`, and `boundary` stay with the agent by design.
- **Honest frontmatter handling.** Skill frontmatter is parsed with `yaml`, so block scalars and nested maps behave as the registry expects. The documented invocation keys (`user-invocable`, `disable-model-invocation`) and `whenToUse` project into the registry's summary; unknown keys stay in `metadata`.

On DeepSeek Harness and `dsh-*` plugins the paper maps onto existing names: `ctx.effect`, `inject`, `ctx.get`, `apply`, HMR-safety tests.

## Install

> **Install it as a bundle.** `dsh plugin add …` mounts the row from the
> package's own patch layer, which is what the settings editor can write to. A
> row added with `--patch` is an overlay: it disappears at the next start, and
> the Plugins card cannot save into it — the editor refuses a write an overlay
> would win.

```sh
dsh plugin --profile web add github:maci0/dsh-cordis-review
dsh plugin --profile web update dsh-cordis-review   # refresh later
```

Then **restart `dsh web`**: bundle layers compose at boot, and `dsh.profile.bundles` is frozen there.

The package declares `dsh.bundle` and ships a built `lib/`, so `dsh plugin add` activates its layer. Do not also paste the `id: cordis-review` row into your profile's `cordis.patch.yml` — `insert` does not dedupe ids, so the plugin would mount twice. Override the row's `config` from your profile instead.

Uninstall with the **package name**:

```sh
dsh plugin --profile web remove dsh-cordis-review
```

`remove github:…` is `pnpm remove github:…`, and pnpm resolves the argument as a dependency key — it is not there, so the command fails with `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS` even though the plugin is installed.

Skill-only install, without the plugin row (DSH already watches `~/.dsh/skills`):

```sh
mkdir -p ~/.dsh/skills
ln -s /path/to/dsh-cordis-review/skills/cordis-review ~/.dsh/skills/cordis-review
```

Edits then load on the next `/cordis-review`. A user- or project-level skill of the same name outranks the bundled copy.

## Commands

| Command | What it runs |
|---|---|
| `/cordis-review` | Reviews the current workspace against CORDIS and implements every applicable fix. |
| `/cordis-review <path>` | Same audit, scoped to `<path>`. |
| `cordis-review-check [root]` | Prints `file:line: tag: message` per closed-form hit, or `cordis-check: clean`. The package exposes it as the `cordis-review-check` bin. |

Checker flags:

- `-h`, `--help` — prints the usage.

The ast-grep engine is auto-detected. With the binary on PATH, covered files get the closed-form pass; without it, every covered file warns on stderr and takes the LLM-fallback path.

Exit status: **0** clean, **1** findings, **2** usage or path error. An unknown flag, a missing flag value, or a root that is not an existing directory exits 2 with a one-line `cordis-check:` message on stderr.

## How a run goes

1. **Scope** — the current workspace, or the path argument.
2. **Get the rules** — the skill's own checklist, plus the repo's `AGENTS.md` / `docs/cordis-primer.md` in DSH workspaces.
3. **Map the runtime** — context object, effect primitives, entrypoints, loader.
4. **Closed-form pass** — run the checker first.
5. **Audit, then fix** — each hit becomes a code change unless it is a documented outside-boundary emission.
6. **Verify** — dispose the contributing fiber and assert the contribution is gone; re-run the checker.

A clean checker is not a pass. The runtime does not prove that an inverse actually reverts, or that operations published at one key commute — those are author obligations, and this review discharges them in code.

## Configure

None. The Loader row carries no `config`. The only knobs are the skill frontmatter keys:

| Key | Default | Meaning |
|---|---|---|
| `name` | directory name | Kebab-case skill name; must be valid or the file is skipped. |
| `description` | — | Required. Empty description means the skill is skipped with a warning. |
| `whenToUse` | unset | Extra routing hint, projected into the registry summary. |
| `disable-model-invocation` | `false` | `true` keeps the model from invoking the skill on its own. |
| `user-invocable` | `true` | `false` removes `/cordis-review` from the command surface. |

Provider-specific keys survive in `metadata`. One broken skill file is skipped with a warning; it never costs the catalog its other skills.

## Limits

- **The checker proves four tags, nothing more.** It is not a correctness oracle and not a substitute for the checklist. Inverse, leak, HMR, and boundary findings come from the agent's judgment.
- **Without `ast-grep`, every covered file becomes a judgment call.** Install the binary for deterministic results.
- **The paper is not fetched by default, and the PDF is not usable.** The abs page is the one fetchable URL; the checklist in the skill body is the rubric.
- **Host source edits remount only with `id: hmr` enabled** and this checkout in `config.root`. There is no browser chrome.

## Development

TypeScript built to `lib/`; the tests run from source through Node's type stripping, so no build is needed to test.

```sh
npm test            # node --test tests/*.test.ts (Node >= 22.19)
npm run typecheck   # tsc --noEmit
npm run build       # tsc -p tsconfig.build.json -> lib/
npm run check       # scan this checkout (runs the built lib/cli.js)
```

Coverage: every checker tag against real fixtures, CLI flag parsing, help, and each non-zero exit, frontmatter block scalars and chomping, skill discovery tolerating a broken sibling, abort settling promptly, and a real Cordis composition that mounts the skill provider and disposes it.

`npm run check` on this checkout exits 1 on purpose: `cordis.patch.yml` and `cordis.local.yml` both carry an `id: cordis-review` row, so the checker reports the duplicate Loader id. That is the finding it is supposed to report.

For a one-shot boot without installing:

```sh
pnpm dsh web --patch /path/to/dsh-cordis-review/cordis.local.yml
```

## Licence

MIT. Review criteria derived from arXiv:2608.25512; the paper is not redistributed.
