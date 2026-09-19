---
name: cordis-doc-review
description: >
  Create, repair, or restructure documentation for Cordis plugins, DeepSeek
  Harness subsystems, cookbooks, and package contracts. Use when the user
  asks for CORDIS documentation, a documentation review, a cookbook, a
  subsystem document, or an update to existing technical documentation.
---

# CORDIS documentation review

Create or update documentation that gives a reader one accurate path from a
Cordis composition to its owned runtime behavior. Deliver documentation edits,
not a report alone. Treat source code, configuration, and tests as facts;
never invent API names, lifecycle behavior, commands, or verification results.

For DeepSeek Harness and `dsh-*` plugins, read the nearest `AGENTS.md` first.
When present, apply `docs/AGENTS.md`, `.agents/skills/dsh-doc/SKILL.md`, and
`.agents/skills/dsh-prose-standard/SKILL.md`. They define repository-specific
placement, scope, prose, bilingual, and validation rules. This skill supplies
the Cordis documentation model; repository rules own filenames and gates.

## Outcome

A complete result has:

1. documentation in its owning location;
2. an accurate topology and lifecycle explanation;
3. a runnable reader path for common work;
4. links to detailed owners instead of duplicated detail; and
5. focused validation or an explicit, concrete reason validation cannot run.

Do not add documentation for speculative extension points. Update an existing
owner when it already owns the fact. Create a new document only when its scope
cannot fit without mixing audiences or subjects.

## Workflow

### 1. Establish scope and readers

Read the request and nearest documentation rules. Identify the requested
outcome, target reader, current documents, source owners, configuration rows,
and tests. If scope is absent, use the named document or current subsystem;
do not expand to a repository-wide rewrite.

Classify each proposed page before writing:

- **Tutorial:** ordered route from starting state to an observable outcome.
- **Reference:** lookup document defining current contracts and behavior.
- **Cookbook:** narrow repeatable procedure with numbered actions and
  verification.
- **Subsystem document:** architecture, ownership, lifecycle, seams, and links
  to child documents.
- **Package README:** package contract, configuration, semantics, limits, and
  extension points.

One page has one primary reader goal. Split substantial teaching from lookup
content. Do not turn a subsystem overview into a catalog of child internals.

### 2. Recover runtime truth

Trace every statement through its owner before documenting it:

1. entry: profile, bundle, config patch, CLI, or public API;
2. composition: plugin `name`, `inject`, `apply`, and provided service;
3. lifecycle: registrations, effects, cleanup, unload, replacement, and HMR;
4. data: input shape, output shape, persistence boundary, error behavior; and
5. proof: closest tests, examples, and commands that exercise the path.

Use code for behavior, tests for exercised guarantees, and generated catalogs
only for generated facts. State a limitation only when source or tests prove
it. Link each detail to its lowest owning document.

### 3. Model Cordis accurately

Explain a Cordis subsystem in terms readers can act on:

- **Composition:** which configuration layer mounts it and ordering constraints.
- **Dependencies:** services declared by `inject`; optional dependencies and
  degraded behavior only when code supports them.
- **Contributions:** services, tools, events, commands, skills, or config rows
  added through context effects.
- **Lifecycle:** what happens at apply, replacement, disposal, and reload.
  Registrations are reversible effects, not permanent global mutations.
- **Ownership:** which component owns each fact, state transition, and cleanup.
- **Boundaries:** inputs and outputs crossing process, persistence, network, or
  user trust boundaries; validation and failure behavior at each boundary.

Never claim `ctx` survives outside its context lifetime. Never describe a
registration as globally permanent when its effect unwinds on unload. Do not
promise hot reload, teardown, ordering, or compatibility unless verified.

### 4. Write structure before prose

Start with title, audience outcome, and table of contents when page size makes
navigation useful. Put the shortest successful path before advanced detail.

Use this default shape when it fits:

```md
# <Subject>

<Audience outcome and scope.>

## Quick path

<Minimal working composition or procedure.>

## How it fits

<Composition, dependency, and ownership model.>

## Lifecycle

<Apply, use, dispose/reload behavior.>

## Reference

<Config, API, events, errors, or limitations.>

## Verify

<Exact focused command and observable result.>
```

A cookbook uses numbered steps and a verification step. A tutorial introduces
prerequisites before dependent concepts and verifies each milestone. A reference
uses stable headings and exhaustive coverage only within its own scope.

### 5. Edit with ownership discipline

Prefer targeted edits to a current canonical document. Keep one owner per
fact:

- source and types own exact API signatures;
- tests own executable guarantees;
- package README owns package contract and limits;
- subsystem docs own architecture and responsibility boundaries;
- cookbooks own procedures;
- configuration examples own minimal composition examples.

Replace stale claims rather than appending contradictory history. Preserve
existing navigation, translations, and links unless the repository standard
requires their update. If an English/Chinese pair exists or local policy
requires one, update both with aligned headings and equivalent meaning.

Write direct prose. Name prerequisites, side effects, limits, error cases, and
cleanup only where a reader needs them. Remove reasoning transcripts,
promotional claims, vague adjectives, repeated API restatements, and untested
commands.

### 6. Validate

Check every changed link, heading hierarchy, code fence, command, config key,
and symbol against source. Run the smallest documented Markdown, link, prose,
or package gate that covers changed files. Run an example command only when its
side effects and environment are understood.

For a documentation claim about runtime behavior, inspect the implementation
and closest test. For lifecycle prose, inspect the cleanup path. Do not report
a command as passed unless it ran and passed.

## Review checklist

Apply all relevant checks and patch every confirmed defect.

### Placement and scope

- [ ] Page location matches document type and tree ownership.
- [ ] Page names one subject, target reader, and bounded outcome.
- [ ] Parent pages describe child responsibility without copying child detail.
- [ ] Existing canonical document is updated instead of duplicated.
- [ ] Tutorial, reference, cookbook, subsystem, and README material are not
      materially mixed.

### Cordis correctness

- [ ] Mounting layer and configuration path are accurate.
- [ ] `inject` dependencies and optional behavior match source.
- [ ] Contributions identify their owner and registration mechanism.
- [ ] Apply, dispose, replacement, and reload claims match actual effects.
- [ ] State, events, tools, and persistence boundaries name real owners.
- [ ] No document promises global mutation, leaked context, or unsupported HMR.

### Reader usefulness

- [ ] Quick path starts from stated prerequisites and reaches an observable end.
- [ ] Examples are minimal, complete, and use current names.
- [ ] Reference entries define behavior, failure conditions, and limits needed
      for safe use.
- [ ] Details link downward to their owner instead of repeating them.
- [ ] Verification is concrete and proportionate to the change.

### Editorial quality

- [ ] Headings form a usable hierarchy and links resolve.
- [ ] Prose states contracts, not author reasoning or marketing.
- [ ] Facts have evidence in source, tests, configuration, or executed output.
- [ ] Translation and metadata requirements remain satisfied.
- [ ] Changed pages meet local word-count and documentation gates.

## Completion report

Report only changed documents, validated commands with results, and material
omissions with their trigger. Do not list unconfirmed findings. If no edit is
needed, state why the existing documentation already passes the applicable
checklist.
