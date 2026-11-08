# Multi-file schemas: `part`, `part of`, `import`

> **Verified against the CrateStack 0.19.0 implementation (cratestack#910); everything on this page is *(since 0.19.0)*.**
> Checked against the parser and macro tests, the `cratestack check` output, the language server
> tests and the committed `examples/react-vite-swr` split on the implementation branch (design:
> `docs/design/multi-file-schemas.md`; ADR 0023 in `cratestack-docs/internals/`). On 0.18.x or
> earlier a `part` or `import` line is refused and a schema is exactly one file. If a message
> below does not match what `cratestack check` prints, source wins (`crates/cratestack-parser/`).

Back to [cratestack-schema](../SKILL.md).

## Pick the mechanism

| You want | Use |
| --- | --- |
| One service's schema split across several files (models, procedures, ...) | `part` in the root, `part of` in each part |
| A shape several services share (a `type`, an `enum`, a `mixin`) | `import` |
| A shared **model** or table | **Not possible. An import cannot carry a model; do not try.** Keep the model in one schema (split with `part` if it is big), or declare it in each service. |

## The grammar

Three top-level directives. Each is one line: a double-quoted path and **nothing after it**
(no trailing comment).

```cstack
part "models/post.cstack"        // in a root: this file is more of me
part of "../schema.cstack"       // in a part: I belong to that root
import "../shared/money.cstack"  // anywhere: bring in a shared file's types
```

(The `//` comments above are explanatory; do not put a comment after a directive in a real file.)

- Directives may appear anywhere at top level; first is the documented style. A `///` doc
  comment above one is discarded.
- A directive with no quoted path, an unterminated quote, or text after the closing quote is
  refused (M16): ``expected a quoted path after `part`, like `part "models/post.cstack"` ``.
- `part`, `part of` and `import` remain reserved as identifiers (`model part` is still refused).
- The directives are not part of the IR, so `print-ir` output for a schema without them is
  unchanged.

## Where each declaration may go

| Declaration | Root | Part | Imported file (or a part of one) |
| --- | --- | --- | --- |
| `datasource`, `auth`, `transport`, `mcp { }` | yes | **no** (M5) | **no** (M12) |
| `model`, `view`, `procedure`, `mutation procedure`, `subscription procedure`, `topic`, `query` | yes | yes | **no** (M12) |
| `extension <name> { }` | yes | yes (merged by union) | **no** (M12) |
| `type`, `enum`, `mixin` | yes | yes | yes |
| `part "…"` | yes | **no** (M6) | only in an imported root |
| `part of "…"` | no | exactly once (M7) | in a part of an imported root |
| `import "…"` | yes | yes | yes |

Consequences to design around:

- `datasource`, `auth`, `transport` and `mcp` are root-only singletons. Never put one in a part.
- An imported file may declare **only** `type`, `enum` and `mixin` (plus directives). A `model`,
  `view`, any kind of `procedure`, `topic`, `query` or `extension` there is refused with M12.
  A shared type that needs `Vector(n)` needs the **importer** to declare `extension pgvector { }`.
- An imported enum used by a model column is materialized in the **importer's** migrations. A
  mixin from another file is expanded into the importer's models by `@use` after the merge, so
  a model in any file can `@use` a mixin from any other.

## Names are one flat namespace

The root, its parts and everything they import (transitively) share one namespace. There is
**no `import … as`, no `show`, no `hide`** (`import "x" as y` is a parse error). A name declared
in two files is a hard error naming both files (M13); fix it by renaming. Imports are
transitive: if `main` imports `common` and `common` imports `base`, `main` sees `base`'s types.
A file imported by two routes (`../c.cstack`, `./x/../c.cstack`, a symlink) loads once; two
different files with identical contents are two files and collide.

## Paths

- The macro argument stays `CARGO_MANIFEST_DIR`-relative; a CLI `--schema` stays relative to
  the working directory.
- Every `part`, `part of` and `import` path is relative to **the directory of the file that
  contains the directive**: `part of "../schema.cstack"` inside `schema/task.cstack` names
  `schema.cstack`.
- A path must be relative, use `/` as its only separator and end in `.cstack` (M15): no
  absolute paths, no backslashes, no `part "models/post"`.
- `cargo publish` packages only the crate directory, so a published crate must keep its schema
  files inside it (the constraint `include_str!` always had).

## Load order

1. The root file. 2. The root's parts, in `part` line order. 3. For each file loaded in 1-2, in
that order, each `import` line in order: the imported unit (its root, its parts, its imports),
unless already loaded. Declarations merge per kind by appending in load order. Nothing lists a
directory.

Splitting is invisible downstream: a split schema equals the same files concatenated (directive
lines removed), so `SCHEMA_SHA256`, `migrate diff` against an existing snapshot and the
generated clients are unchanged. **Splitting an existing schema needs no migration.**

## Cycles and locking

- Only imports can cycle. A cycle is refused, listing the whole chain (M11).
- A part belongs to exactly one root and is not a schema on its own. A part cannot list parts
  (M6) and cannot be imported (M10). Point the macro or `--schema` at the **root**
  (`cratestack check` is the one command that accepts a part).
- A file that declares `part of` but that no root lists is read by no build. That is by design
  (finding it would need globbing). `cratestack check` on that file reports M3.

## Worked example: the split `examples/react-vite-swr`

Excerpted verbatim from the committed example. The files are
`examples/react-vite-swr/schema.cstack` (root) and `examples/react-vite-swr/schema/task.cstack`,
with `schema/board.cstack` and `schema/procedures.cstack` alongside (the root also opens with a
comment block, omitted here).

`examples/react-vite-swr/schema.cstack`:

```cstack
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

auth Caller {
  id Int
}

part "schema/board.cstack"
part "schema/task.cstack"
part "schema/procedures.cstack"
```

`examples/react-vite-swr/schema/task.cstack` (`Board` lives in `schema/board.cstack` and
resolves here):

```cstack
part of "../schema.cstack"

model Task {
  id Int @id
  title String
  done Boolean
  boardId Int
  board Board @relation(fields:[boardId],references:[id])

  @@allow("read", auth() != null)
  @@allow("create", auth() != null)
  @@allow("update", auth() != null)
  @@allow("delete", auth() != null)
}
```

An import of shared types (the shared file has no `part of`, so it belongs to nobody):

```cstack
// shared/money.cstack
enum Currency {
  EUR
  XAF
}

type Money {
  amount Decimal
  currency Currency
}

mixin Timestamps {
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
}
```

```cstack
// billing/schema.cstack
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

import "../shared/money.cstack"

model Invoice {
  @use(Timestamps)

  id Int @id
  total Decimal
  currency Currency
}

type QuoteResult {
  price Money
}
```

Two services importing `money.cstack` each generate their own `Money`; they are wire-compatible
because the shape is the same.

## Macros and tooling

- `include_*_schema!("schema.cstack", …)` takes the **root**. Every part and import is tracked
  as a rebuild dependency through `SCHEMA_FILES: &[(&str, &str)]`, emitted by all three
  `include_*_schema!` macros only for a schema spanning more than one file (a single-file
  schema's generated output is unchanged). Each entry is `(path relative to CARGO_MANIFEST_DIR,
  include_str!(absolute path))`, in load order, and `SCHEMA_FILES[0] == (SCHEMA_PATH,
  SCHEMA_SOURCE)`. `SCHEMA_SOURCE` stays the **root file's text only**.
- Adding a part is two edits: create the file, and add its `part` line to the root. The root
  edit is what triggers the rebuild.
- Errors: [cratestack-troubleshooting](../../cratestack-troubleshooting/SKILL.md), "Multi-file
  schema errors". CLI (`check --list-files`, `check` on a part, `print-ir --no-spans`):
  [cratestack-cli](../../cratestack-cli/SKILL.md). Editor:
  [cratestack-editor-tooling](../../cratestack-editor-tooling/SKILL.md).
