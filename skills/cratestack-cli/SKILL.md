---
name: cratestack-cli
description: The cratestack CLI — check, generate-dart, generate-typescript, generate-wiremock, studio, print-ir, contract, migrate, diff — every subcommand, every flag, exit codes, the --check drift mode, JSON diagnostic shapes, and CI recipes. Load when running or scripting the cratestack binary, wiring schema validation or generated-client drift checks into CI, or installing @cratestack/cli.
---

# The `cratestack` CLI

> **Verified against CrateStack 0.19.1.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

Binary name is `cratestack`, crate name is `cratestack-cli`.

## Exactly nine subcommands

```
check  generate-dart  generate-typescript (alias generate-ts)  generate-wiremock
studio  print-ir  contract  migrate  diff
```

`contract` is *(since 0.15.1)* (`digest`, `print`), with `lock`, `check` and `prune`
*(since 0.15.2)*; on 0.15.0 and earlier there are eight.

**There is no top-level `init`, `run` or `eject`** — those three are `studio`
subcommands. There is no `migrate apply`, `rollback`, `verify` or `drift`, no
`generate-rust`, and no `generate-studio`. Documentation that lists `init`, `run`
or `eject` at top level is describing a flatter CLI than the one that ships.

## Install

```bash
npm install --global @cratestack/cli     # prebuilt binary, no Rust toolchain
cargo install cratestack-cli             # from source
cargo binstall cratestack-cli            # same GitHub Release assets as npm
```

The npm postinstall downloads a per-target archive plus its `.sha256` sidecar and
verifies the hash. **Five targets are supported** — `darwin-x64`, `darwin-arm64`,
`linux-x64` (gnu), `linux-arm64` (gnu), `win32-x64`. The package's `cpu` field
advertises `arm64` on all three platforms, but **`win32-arm64` has no prebuilt
binary** and the installer throws, pointing you at `cargo install`. There is no
musl target. Windows extraction shells out to PowerShell `Expand-Archive`.

`CRATESTACK_CLI_SKIP_DOWNLOAD=1` skips the download;
`CRATESTACK_CLI_BINARY_PATH` points the shim at a vendored binary. The shim
propagates the child's exit status, so gating CI through `npx` works.

In GitHub Actions, prefer the composite action over a Rust toolchain step:

```yaml
- uses: cratestack/cratestack/.github/actions/install-cratestack-cli@main
  with:
    version: "0.19.1"   # optional, defaults to "latest"
```

Pin `@main` to a tag or SHA for reproducibility.

## `check`

```bash
cratestack check --schema schema.cstack [--format human|json]
```

Human mode prints `schema OK: <path>` or a rendered diagnostic on stderr. JSON
mode prints to stdout and **also exits 1 on failure**, so capture the output
before the step fails:

```json
{ "ok": false, "schema": "schema.cstack",
  "diagnostics": [ { "message": "…", "file": "…", "line": 12, "start": 240, "end": 252 } ] }
```

`line` is 1-based; `start`/`end` are byte offsets. **`check` reports the first error
only**, in both modes, so `diagnostics` holds at most one entry: fix it and run again
(`crates/cratestack-cli/src/cli_support.rs` builds the array from one `SchemaError`;
`load_schema` keeps the first). The LSP is what reports several independent errors at once.
`file` is per-diagnostic: the file the error is in, which for a multi-file schema *(since
0.19.0)* can be a part or an import rather than the top-level `schema`.

### Multi-file schemas *(since 0.19.0)*

`check` loads the whole graph (`part`, `part of`, `import`; see
`cratestack-schema`, `references/multi-file.md`). **Every command that takes `--schema`
takes the root.** `check`, `print-ir`, `generate-dart`, `generate-typescript`,
`generate-wiremock`, `migrate diff`, `migrate baseline`, `diff <old> <new>` and
`contract …` all resolve the full graph. Given a part, every one of them is refused
(``` `{file}` is a part of `{root}`, not a schema root; point the macro or command at `{root}` ```)
**except `check`**, which follows `part of` to the root, checks the whole schema and says so:

```text
$ cratestack check --schema schema/task.cstack
`schema/task.cstack` is a part of `schema.cstack`; checked the whole schema
schema OK: schema.cstack
```

If the root does not list the part, that is an error, exit 1.

- `check --list-files` prints the resolved file set after `schema OK`: `files (N):`, then one
  `  role  path` line per file in load order (`root`, `part`, `import`, `import part` for an
  imported root's part). Without the flag the output is unchanged:

  ```text
  $ cratestack check --schema schema.cstack --list-files
  schema OK: schema.cstack
  files (4):
    root        schema.cstack
    part        schema/board.cstack
    part        schema/task.cstack
    part        schema/procedures.cstack
  ```
- In `--format json`: `"root"` is added only when it differs from `schema` (a part was given);
  `"files": [{ "path", "role" }]` is added by `--list-files`; a diagnostic gains
  `"related": [{ "file", "line", "start", "end", "message" }]` only when the error involves a
  second location (a duplicate name across files, a part that names another root, an import of a part or of a forbidden declaration). Labels: `` `{kind} {name}` is declared here first ``, `` `{part}` is listed here ``, `` `{file}` declares `part of` here ``, `` `{file}` is imported here ``. `file` and `line` always refer to
  the diagnostic's own file.
- Messages: `cratestack-troubleshooting`, "Multi-file schema errors".

## Code generation

All three generators share a `--check` drift mode and `--base-path` (default
`/api`).

### `generate-dart`

| Flag | Default |
| --- | --- |
| `--schema` / `--out` | required |
| `--library-name` | `cratestack_client` |
| `--base-path` | `/api` |
| `--template-dir` | none |
| `--preset default\|riverpod\|fespalier` | `default` |
| `--fespalier-ref <REF>` | `v0.21.0` (`--preset fespalier` only) |
| `--check` | off |
| `--run-build-runner` | off |

`--preset fespalier` *(since 0.16.0, cratestack#1204)* is the `riverpod` layout sending
through fespalier's `HttpTransport` instead of Dio: no `dio` in the pubspec, a generated
`CratestackFespalierTransport`, and `<prefix>TransportProvider` / `<prefix>BaseUriProvider`
the app overrides. `--fespalier-ref` is the git tag, branch or commit of
`github.com/fespalier/fespalier` that the pubspec pins `fespalier_transport` at; it is an
error with any other preset (`--fespalier-ref only applies to --preset fespalier`) and with an
empty value or one holding whitespace. See `cratestack-clients` for when to pick which preset.

`--run-build-runner` shells out to
`dart run build_runner build --delete-conflicting-outputs` in `--out`, and **has
no effect with `--check`**.

**`--no-native-cbor` is gone** *(removed in 0.18.0, cratestack#1281)*: passing it is an
unknown-argument error. Through 0.17.2 it swapped in pure-Dart `package:cbor`, for Linux arm64
or a plain-Dart program. Generated Dart clients now always depend on the Flutter plugin
`cratestack_cbor`, so Linux arm64 and plain-Dart programs (CLIs, servers on the standalone Dart
SDK) are unsupported. `--native-cbor` is an unknown-flag error too, not a silent no-op.

### `generate-typescript` (alias `generate-ts`)

| Flag | Default |
| --- | --- |
| `--schema` / `--out` | required |
| `--package-name` | `cratestack-client` |
| `--base-path` | `/api` |
| `--template-dir` | none |
| `--check`, `--full-selection` | off |
| `--swr`, `--refine`, `--tanstack`, `--rtk` | off |

**The four layer flags are purely additive** — the default `src/` layout is
always emitted. `--swr` adds `src/swr/`, `--refine` adds `src/refine.ts`,
`--tanstack` adds `src/react-query.ts`, `--rtk` adds `src/rtk-api.ts` plus the
RTK peer dependencies.

`--no-native-cbor` is gone here too *(removed in 0.18.0, cratestack#1281)*; through 0.17.2 it
swapped the RPC runtime's `@cratestack/cbor` for the pure-TypeScript `jsonRpcCodec` and did
nothing on a REST schema. Now every RPC-transport package depends on `@cratestack/cbor`, so
`win32-arm64` (no `@cratestack/cbor-node` binding) is unsupported, and JSON on the wire is
`codec: jsonRpcCodec` passed at construction. REST output did not change.

The docs site's flag table omits `--tanstack` and `--rtk` entirely.

### `generate-wiremock`

`--schema`, `--out`, `--base-path`, `--check`. Emits one stub per procedure and
**five per model** (list, get, create, update, delete; fewer when `@@internal(...)` suppresses a
verb, and on `transport rest` a `@version` model fans `update` / `delete` out into more,
`crates/cratestack-mock-wiremock/src/model_mapping.rs`). Note that `transport rest` model CRUD stubs are stateful and
need more than a plain WireMock.

### `--check`, precisely

Generates in memory, diffs against `--out`, **never writes**. Reports three
kinds — `modified`, `missing` (generator produces it, disk lacks it) and
`unexpected` (on disk, generator no longer produces it) — and exits 1.

It shells out to `git check-ignore` and **excludes gitignored files from the
`unexpected` arm**. Without that, `.dart_tool/`, `*.g.dart` and `pubspec.lock`
left by `flutter pub get` all report as drift while content matches perfectly. So
**run `--check` inside a real git checkout with the project's `.gitignore`
present**, or you get false positives. It returns empty (old behaviour) when git
is unavailable, when `--out` is not in a work tree, or when `--out` is itself
ignored.

## `diff`

```bash
cratestack diff <OLD> <NEW> [--json]
```

**Positional paths, not `--old`/`--new`, and files, not git refs.** In CI, pull
the base copy out first:

```yaml
- run: git show origin/${{ github.base_ref }}:schema.cstack > /tmp/old.cstack
- run: cratestack diff /tmp/old.cstack schema.cstack
```

Matching is by name only — a rename reads as a removal plus an addition, matching
`cratestack-migrate`'s philosophy.

`diff` parses both files, so an old schema that a newer CLI refuses fails the
gate on the *baseline*. The strict attribute parsing since 0.14.1
*(GHSA-69g4-xvcm-vm2j)* is such a change: fix the baseline in the same change.

| Severity | Examples |
| --- | --- |
| `BREAKING` | removing a model/field/procedure; **adding or removing `@@paged`** (it flips `.list()` between `T[]` and `Page<T>`); **adding `@@internal(...)`**; adding a required field with no default; retyping anything; narrowing arity; *(since 0.17.0)* removing an enum or a variant, and **adding a variant to an enum a response can carry** |
| `ADDITIVE` | adding a model, an optional field, a procedure; widening arity; **removing `@@internal(...)`**; *(since 0.17.0)* adding an enum, or a variant to an enum only requests carry |
| `INTERNAL` | `@@soft_delete`, `@@audit`, `@@retain`, `@@emit` — a known scope gap, not an oversight; *(since 0.17.0)* reordering an enum's variants |

**Enums** *(since 0.17.0, `cratestack-cli/src/schema_diff/enums.rs`)*: on 0.16.0 and earlier `diff`
never reads them, so an enum change reports nothing and exits 0. Since 0.17.0 an added variant is
breaking when the enum is reachable from any model, view, procedure result or query result
(through fields, `type`s, generic arguments), because the generated Dart and Rust decoders refuse
an unknown value; otherwise it is additive. A rename is a removal plus an addition. `type`
declarations and views are still not diffed as declarations.

Output is printed **first**, then the process exits 1 if there is any breaking
change — so a JSON consumer always gets a complete document even on a gating
failure.

```json
{ "changes": [ { "severity": "breaking", "category": "field_removed",
                 "subject": "…", "message": "…" } ],
  "summary": { "breaking": 1, "additive": 0, "internal": 0 } }
```

## `print-ir`

`cratestack print-ir --schema <path>` dumps the parser's fully-resolved
`Schema` as Rust pretty-`Debug`. **Not JSON, and not a machine contract** — it is
for seeing what mixins expanded to, what a `@relation` resolved to, and which
attributes actually attached. It is a *different* IR from `cratestack-migrate`'s
projections; nothing in the CLI prints that one.

`print-ir --no-spans` *(since 0.19.0)* prints the same dump with every source
position zeroed. Use it to compare a split schema with its single-file equivalent (they
print identically); without the flag the output is unchanged.

## `contract` *(since 0.15.1; `lock` / `check` / `prune` since 0.15.2)*

The per-op contract digests a signed client binds, and the lock file of older ones a server
keeps accepting (`include_server_schema!(.., contracts = "s.contracts.lock")`; see
`cratestack-server`). Source: `crates/cratestack-cli/src/contract.rs`.

```bash
cratestack contract digest --schema s.cstack [--json]        # every op's digest + the client contract digest
cratestack contract print  --schema s.cstack --op <key>      # the canonical JSON one op's digest is taken over
cratestack contract lock   --schema s.cstack --lock s.contracts.lock [--note <text>] [--date YYYY-MM-DD]
cratestack contract check  --schema s.cstack --lock s.contracts.lock [--json]   # the CI gate
cratestack contract prune  --lock s.contracts.lock (--op <key> | --before YYYY-MM-DD | --keep N | --generation <hex>)
```

An op key is an RPC op id (`procedure.ping`) or, on REST, `"<METHOD> <route template>"`
(`GET /widgets/{id}`). `lock` records the current contracts as a new generation (creating the
file; `--date` defaults to today, UTC) and refuses, leaving the file alone, while the current
contract breaks a locked one: `prune --op` that op first to ship the break on purpose.
`check` fails when the current contract is not a locked generation or breaks one; with
`--json` it prints one JSON document on every path, errors included. `prune` takes exactly one
selector (`--generation` needs at least 8 hex digits).

**Exit codes differ from the rest of the CLI:** 0 ok, 1 a failed verdict, **2** a tool error
(an unreadable schema or lock, a bad date or flag value).

## `migrate` and `studio` flags

The behaviour is in `cratestack-migrations` and `cratestack-studio`; the flags, from
`crates/cratestack-cli/src/cli_types.rs`:

| Command | Flags (default) |
| --- | --- |
| `migrate diff` | `--schema` (required), `--out-dir` (`migrations`), `--backend postgres\|sqlite\|both` (`both`), `--name` (`migration`), `--allow-destructive` |
| `migrate baseline` | `--schema`, `--database-url` (both required), `--out-dir` (`migrations`), `--backend postgres` (the only value), `--strict` |
| `studio init` | `--out` (`.`), `--force` |
| `studio run` | `--config` (`studio.toml`), `--bind` |
| `studio eject` | `--out` (required), `--name`, `--force`, `--with-ui` |

## Exit codes

Everything a command reports as a failure is **1**, except `contract`'s tool errors (2,
above) and argument-parsing errors (2, last row). There is no distinct code for "breaking"
versus "error".

| Situation | Code |
| --- | --- |
| success | 0 |
| `check` failure, human or JSON | 1 |
| `diff` with ≥1 breaking change | 1 |
| any `--check` drift | 1 |
| `migrate diff` lossy without `--allow-destructive` | 1 |
| `migrate baseline --strict` with drift, or snapshot already exists | 1 |
| `contract check` not locked or broken; `contract lock` refused | 1 |
| `contract …` tool error (unreadable schema or lock, bad date or flag) | 2 |
| a usage error caught by argument parsing (an unknown flag such as the removed `--no-native-cbor`, a missing required argument) | 2 (clap's usage-error code; `main` calls `Cli::parse()`) |

## CI recipes

**Validate a schema** — a bare `run:` step gates, since `check` exits 1.

**Drift-check generated clients** — the framework does exactly this to itself
with `just regen-examples --check`, which forwards `--check` to both generators.
Keep the drift step without `continue-on-error`, and put `if: ${{ !cancelled() }}`
on the steps behind it so a red drift check does not skip real coverage.

**Gate breaking schema changes** — `cratestack diff` as above.

**There is no shipped recipe for gating migration-snapshot drift.**
`migrate verify` does not exist; `migrate diff` is offline and idempotent, so a
plausible gate is running it and failing if it produces a new directory or dirties
`schema.snapshot.json` — but nothing in the repo does this, so treat it as an
idea, not a documented pattern.

## Build-from-source caveat

The CLI hard-enables `cratestack-migrate/{postgres-introspect, pgvector,
postgis}`. Without them, `migrate diff` on a schema declaring
`extension postgis {}` or `extension pgvector {}` hits a deliberate `unreachable!`
and **panics**.
