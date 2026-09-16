# Working in this repository

This repo holds the **agent skills** for [CrateStack](https://github.com/cratestack/cratestack).
It contains no code that runs in a user's project — only instructions that a
coding agent loads before it writes CrateStack code.

That makes the failure mode unusual, and worth stating before anything else.

## The one rule that matters: a wrong skill is worse than a missing one

If a skill does not exist, an agent falls back on the docs site, the README, or
the source, and is appropriately unsure. If a skill exists and is **wrong**, the
agent writes confident, fluent, incorrect code at scale, and the human reviewing
it has been told by the tooling that this is the house style.

So:

- **Verify every claim against framework source**, not against the docs site and
  not against this repo's own history. `cratestack/cratestack-docs` is known to
  drift; where the two disagree, source wins and the skill says so.
- **Prefer a verbatim excerpt from a real example or test** over a paraphrase,
  and name the file it came from. Tests are the truth about behaviour.
- **An accurately reported gap beats a confident guess.** "Not verified — check
  `crates/x/src/y.rs`" is a legitimate thing to write in a skill. An invented
  flag is not.
- **Never invent a flag, an attribute, or a method name.** If you cannot find it
  in the source, it does not exist.

## Layout

```
skills/<skill-name>/SKILL.md       the skill itself; frontmatter name == directory name
skills/<skill-name>/references/    optional deep-dive files the SKILL.md links to
COVERAGE.md                        feature -> skill map; the parity contract
scripts/validate-skills.mjs        the gate (frontmatter, links, coverage)
```

`npx skills` discovers `skills/*/SKILL.md` with no manifest, so the directory
layout *is* the registration. Adding a directory adds a skill.

### Why every skill name starts with `cratestack-`

Skills install into a flat, shared namespace in the user's agent directory
alongside skills from every other source they have added. `schema` would collide;
`cratestack-schema` will not.

## Writing a SKILL.md

Frontmatter is two fields, both required:

```yaml
---
name: cratestack-something        # must equal the directory name, lowercase-kebab
description: One sentence saying when an agent should load this. This is the
  ONLY text an agent reads when deciding whether to load the skill, so it must
  name the triggers concretely.
---
```

The description is a routing decision, not a summary. Write it as *when to load
me*, with the words a user would actually say — file extensions, command names,
error text, symbol names. "Everything about CrateStack" routes nothing.

Body conventions:

- Lead with the decision the reader is about to make, not with background.
- Show the smallest thing that works, then the caveats that bite.
- State limits as limits. "Policies are not enforced in embedded mode" is a
  load-bearing fact, not a disclaimer to soften.
- Keep a SKILL.md skimmable; push long tables and exhaustive enumerations into
  `references/` and link them.

### Version provenance is mandatory

CrateStack is pre-1.0, every public crate shares one version, and minor releases
break. A skill with no version on it reads as timeless and is therefore a lie.

Every SKILL.md body carries, right under its `#` heading:

> **Verified against CrateStack X.Y.Z.** …

CI fails a skill without that line, and fails the repo if two skills name
different versions — because a repo where the schema skill was re-checked last
release and the client skill three releases ago has no way to tell you so.

Beyond the banner:

- Mark a fact that arrived in a specific release **inline**, as *(since X.Y.Z)*,
  wherever a reader on an older version would be misled without it.
- Mark a fact that is on `main` and in no published release as *(unreleased)*.
- Record the landing release in
  [`skills/cratestack/references/version-history.md`](skills/cratestack/references/version-history.md),
  which also carries the standing list of things that are **declared but inert**.
  That list is the highest-value section in this repo; keep it current.

When you re-verify against a new release, bump **every** banner in the same
change. Aligning them is the point.

## Gate

```bash
node scripts/validate-skills.mjs
```

Checks frontmatter, `name`/directory agreement, description budget, relative
links, and that `COVERAGE.md` accounts for every skill in both directions. CI
runs this plus a real `npx skills add . --list` against the PR's own tree.

## Parity with the framework and the docs

This repo is one of three that must agree:

| Repo | Audience | Fails by |
| --- | --- | --- |
| `cratestack/cratestack` | the compiler | — |
| `cratestack/cratestack-docs` | humans | going stale |
| `cratestack/cratestack-skills` | coding agents | teaching a surface that no longer exists |

A framework PR that adds a `### ` entry under `## Unreleased` must declare, in
its PR body, what happened here — the framework repo gates that with
`just verify-parity-declaration`. The reciprocal duty is this repo's: when a
change lands here, update `COVERAGE.md` so the next person can find which skill
owns which feature.

**That gate checks a declaration, not the parity.** It cannot read this
repository. Nothing automated proves these skills are current; that is what the
drift audit below is for.

## Auditing for drift

The method that works, in order:

1. Read the framework `CHANGELOG.md` section headings for the releases since the
   last audit (`grep -n '^## \|^### ' CHANGELOG.md`). That is the feature
   inventory.
2. For each shipped identifier (an attribute, a flag, a macro argument), grep
   this whole repo. **A zero-hit grep is the finding.**
3. For anything the changelog calls *removed*, grep for it as a live claim.
   Removed things linger longest — a transport that was deleted stayed
   documented as shipped for nine releases in the docs site.
4. Verify against source, not the changelog narrative. When they disagree,
   source wins.
