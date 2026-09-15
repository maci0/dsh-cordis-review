# dsh-cordis-review

**`/cordis-review` for DeepSeek Harness: review a codebase against the CORDIS context paradigm and apply the applicable fixes.**

Paper: [A Programming Paradigm for Spatiotemporal Composability](https://arxiv.org/abs/2608.25512) (Shi, Zhang, Cui; arXiv:2608.25512).

| Capability | Extension point | Effect |
|---|---|---|
| `/cordis-review` | `ctx.skills.registerProvider()` | The bundled `cordis-review` skill loads through the `skill` tool and appears as `/cordis-review` in the composer — DSH's command surface for user-invocable skills. The agent reviews the workspace against the paper and implements every applicable fix. |

The skill body in `skills/cordis-review/SKILL.md` is the product. A closed-form checker (`src/check.ts`) prints the four tags that are grammar, not judgment (`mix-export`, `inject`, `toplevel`, `id`) — every tag is one ast-grep query. Without `ast-grep` on PATH each covered file warns on stderr and yields an LLM-fallback hit for the review agent to judge; Zig (no ast-grep grammar) always takes that path. Inverse/leak/hmr/boundary stay with the agent.

## Install

Live-reload install: keep the package as a **plain dependency** (no `dsh.bundle`) and put the Loader row in the profile's own `cordis.patch.yml`. That file is what `patchReload: live` watches. `dsh.profile.bundles` is frozen at boot — do not put this package there.

```sh
dsh plugin --profile web add /path/to/dsh-cordis-review
# pnpm will warn "declares no dsh.bundle — installed as a plain dependency". That is the point.
```

Then paste this into `~/.dsh/profiles/web/cordis.patch.yml` (or merge into an existing `- insert:` list):

```yaml
- insert:
    - id: cordis-review
      name: dsh-cordis-review
```

Saving that file remounts the plugin. No profile restart.

A second `add` of the same spec is a no-op. Uninstall with the **package name**, not the git specifier:

```sh
dsh plugin --profile web remove dsh-cordis-review
```

`remove github:…` is `pnpm remove github:…`, and pnpm looks up the argument as a dependency key — it is not there, so it fails with `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS` even though the plugin is installed. The `allowBuilds` hint that follows is leftover CLI copy for a failed git `add`; ignore it. Then delete the `id: cordis-review` row from the profile patch; saving unmounts it.

Skill-only (no plugin row): DSH already watches `~/.dsh/skills`.

```sh
mkdir -p ~/.dsh/skills
ln -s /path/to/dsh-cordis-review/skills/cordis-review ~/.dsh/skills/cordis-review
```

Edits to the skill body load on the next `/cordis-review`. A user-level skill of the same name outranks a plugin-provided copy (rank 400 vs 600).

Local overlay for a one-shot boot (absolute path required):

```sh
pnpm dsh web --patch /path/to/dsh-cordis-review/cordis.local.yml
```

### Verify

After the profile patch save (and a **page refresh** of the Web client the first time):

- `/cordis-review` is in the `/` menu;
- invoking it injects the CORDIS review instructions and the agent starts the audit.

## What it does

The skill tells the agent to:

1. Use its own bundled checklist as the rubric — `SKILL.md` ships the
   operationalized rules, so the review never depends on a fetch. The abs page
   `arxiv.org/abs/2608.25512` works if the abstract is wanted; the PDF is not
   decodable here and no HTML rendering exists for this submission.
2. Map the workspace onto CORDIS (context, revertible effects, reactive coeffects, loader/fibers).
3. Audit against temporal composability (every mutation has an inverse the runtime holds), spatial composability (dependencies declared and reactively managed), and the context paradigm (no leaked `ctx`).
4. **Implement** every applicable fix. Report-only is failure. Hits outside the system boundary (§6.1) are skipped with a one-line reason.

On DeepSeek Harness / `dsh-*` plugins the paper maps onto existing names: `ctx.effect`, `inject`, `ctx.get`, `apply`, HMR-safety tests.

## Configuration

None. The Loader row has no `config`.

## Uninstall

```sh
dsh plugin --profile web remove dsh-cordis-review
```

and delete the `id: cordis-review` row from `~/.dsh/profiles/<profile>/cordis.patch.yml`. Saving unmounts it.

## Checker

One engine: every tag is an ast-grep query over JS/TS, Python, Go, C, C++, Java, Rust, and YAML. Without `ast-grep` on PATH each covered file warns on stderr and yields an LLM-fallback hit for the review agent to judge. Zig has no ast-grep grammar and always takes that path. Inverse/leak/hmr/boundary stay with the agent.

```sh
npm run check            # this checkout
npm run check -- /path   # another tree
```

Prints `file:line: tag: message` or `cordis-check: clean`. Exit 1 on hits.

## Develop

```sh
cd ~/dsh-cordis-review
npm test
npx tsc -p tsconfig.json
npm run check
```

Host source edits remount when the profile's `id: hmr` row is enabled with this checkout in `config.root`. Browser chrome is none.

## License

MIT. Review criteria derived from arXiv:2608.25512; the paper is not redistributed.
