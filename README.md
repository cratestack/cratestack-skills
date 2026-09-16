<div align="center">

# CrateStack Skills

**Agent skills for [CrateStack](https://github.com/cratestack/cratestack) — install them once and your coding agent stops guessing at the framework.**

[Framework](https://github.com/cratestack/cratestack) · [Documentation](https://cratestack.dev) · [Coverage map](COVERAGE.md) · [Contributing](AGENTS.md)

</div>

---

CrateStack is a large surface: a schema language, four facades, three entry
macros, two transports, three generated client languages, an embedded backend
that compiles to wasm, and a data-integrity layer with opinions. Most of what an
agent needs to know is not inferable from the code it is looking at — it is a
convention, a caveat, or a limit that was decided on purpose.

These skills carry that. Fourteen of them, verified against framework source
rather than prose, each stating the version it was checked against.

## Install

```bash
npx skills add cratestack/cratestack-skills
```

Pick a subset if you'd rather:

```bash
npx skills add cratestack/cratestack-skills --skill cratestack --skill cratestack-schema
npx skills add cratestack/cratestack-skills --list        # see what's here first
```

Works with Claude Code, Cursor, OpenCode, Codex and the rest of the agents
`npx skills` supports. Skills are plain `SKILL.md` files — nothing here executes.

**Start with `cratestack`.** It is the router: it picks the right facade for the
crate you are in and points at the specific skill for the task.

## What's here

| Skill | Load it when |
| --- | --- |
| `cratestack` | Any CrateStack project — the entry point and router |
| `cratestack-schema` | Writing or debugging a `.cstack` file |
| `cratestack-server` | Building the Postgres or no-database server |
| `cratestack-policy-auth` | `@@allow` / `@@deny`, auth providers, identity |
| `cratestack-data-integrity` | Idempotency, locking, audit, soft delete, money-shaped work |
| `cratestack-embedded` | On-device SQLite: mobile, desktop, browser |
| `cratestack-clients` | Generating or consuming Rust / Dart / TypeScript SDKs |
| `cratestack-rpc` | `transport rpc`, batching, streaming, subscriptions |
| `cratestack-migrations` | Migrations, snapshots, adopting an existing database |
| `cratestack-cli` | Any `cratestack` command, or wiring one into CI |
| `cratestack-studio` | The admin and testing surface |
| `cratestack-editor-tooling` | LSP, VS Code, Neovim / Helix / Zed |
| `cratestack-troubleshooting` | A failure that isn't self-explanatory, or a green run that looks too good |
| `cratestack-contributing` | Working on the framework repo itself |

Full feature-to-skill map, including the gaps: [COVERAGE.md](COVERAGE.md).

## Versions matter here more than usual

CrateStack is **pre-1.0**. Every public crate shares one version and minor
releases break. A fact that is true for 0.12.0 can be false for the 0.9.x you are
actually running — and a fact true on `main` can be in no published release at
all.

So every skill opens with the version it was verified against, every
release-specific fact is marked *(since X.Y.Z)*, and
[the feature-to-release map](skills/cratestack/references/version-history.md)
records what landed when — including a list of things that are **declared but
inert**, which is the category most likely to waste an afternoon.

Check what you are on before trusting any of it:

```bash
cratestack --version
grep cratestack Cargo.toml
```

CI enforces that every skill carries a version line and that they all agree.

## The rule these are written to

**A wrong skill is worse than a missing one.**

A missing skill leaves an agent reading the docs and the source, appropriately
unsure. A wrong skill has it writing confident, fluent, incorrect code at scale —
and the human reviewing it has been told by the tooling that this is the house
style.

So: claims are verified against framework source, not against the docs site
(which drifts, in known ways these skills point out); examples are copied from
real tests and examples rather than composed; and a limit is stated as a limit.
Several of these skills exist mostly to say "this parses and then does nothing"
or "this returns 404, not 403" — the facts that cost people the most time.

## Keeping them honest

This repo is one of three that must agree:

| Repo | Audience | Fails by |
| --- | --- | --- |
| `cratestack/cratestack` | the compiler | — |
| `cratestack/cratestack-docs` | humans | going stale |
| `cratestack/cratestack-skills` | coding agents | teaching a surface that no longer exists |

A framework PR that announces a user-facing change must declare what happened
here — enforced upstream by `just verify-parity-declaration`. That gate checks
the declaration, not the parity; it cannot read this repository. The drift audit
that can is described in [AGENTS.md](AGENTS.md).

## Contributing

Read [AGENTS.md](AGENTS.md) — it is the whole contract, including how to write a
`description` that actually routes and why every skill name is prefixed.

```bash
node scripts/validate-skills.mjs
```

Checks frontmatter, name/directory agreement, version provenance, relative links,
and that `COVERAGE.md` accounts for every skill in both directions.

## License

MIT — see [LICENSE](LICENSE).
