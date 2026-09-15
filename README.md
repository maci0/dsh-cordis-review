# dsh-cordis-review

**`/cordis-review` for DeepSeek Harness: review a codebase against the CORDIS context paradigm and apply the applicable fixes.**

Paper: [A Programming Paradigm for Spatiotemporal Composability](https://arxiv.org/abs/2608.25512) (Shi, Zhang, Cui; arXiv:2608.25512).

| Capability | Extension point | Effect |
|---|---|---|
| `/cordis-review` | `ctx.skills.registerProvider()` | The bundled `cordis-review` skill loads through the `skill` tool and appears as `/cordis-review` in the composer — DSH's command surface for user-invocable skills. The agent reviews the workspace against the paper and implements every applicable fix. |

No settings card, no always-on prompt, no extra tools. The skill body in `skills/cordis-review/SKILL.md` is the whole product.

## Install

```sh
# straight from GitHub
dsh plugin --profile web add github:maci0/dsh-cordis-review
# or from a local checkout
dsh plugin --profile web add /path/to/dsh-cordis-review
```

The package declares `dsh.bundle`, so `dsh plugin` adds it to the profile's `dsh.profile.bundles`, and the boot reads the plugin row from this package's own `cordis.patch.yml`. **Restart the profile**: a bundle list is composed at boot, so a running profile does not pick it up from a live patch reload.

Local overlay for development (no install; absolute path required):

```sh
pnpm dsh web --patch /path/to/dsh-cordis-review/cordis.local.yml
```

### Verify

After a restart of the profile and a **page refresh** of the Web client:

- `/cordis-review` is in the `/` menu;
- invoking it injects the CORDIS review instructions and the agent starts the audit.

## What it does

The skill tells the agent to:

1. Read [arXiv:2608.25512](https://arxiv.org/abs/2608.25512).
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

Restart the profile after removing.

## Develop

```sh
cd ~/dsh-cordis-review
npm test
npx tsc -p tsconfig.json
```

## License

MIT. Review criteria derived from arXiv:2608.25512; the paper is not redistributed.
