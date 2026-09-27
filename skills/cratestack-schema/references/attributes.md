# `.cstack` attribute reference

Exhaustive argument grammars and the rules the validator actually enforces.
When this file and `cratestack check` disagree, the checker is right — report it.

## Field attributes

| Attribute | Grammar | Rules |
| --- | --- | --- |
| `@id` | bare | Exactly one per model. Rejected on `mixin` fields. A model needs `@id` or `@@id([...])`. Matched exactly *(since 0.14.0)*: `@identity` / `@idx` / `@id_foo` are not keys, and `@id(...)` is refused. |
| `@default(expr)` | one expression | Free-form. `dbgenerated()` takes **no argument**. `@default(auth().path)` pulls from the auth context and supports nested paths. Any `@default` makes the field generated-on-create. |
| `@unique` | bare | `cratestack-migrate` emits the constraint. On 0.14.0 `@unique(...)` was accepted and its arguments ignored; it is refused *(unreleased, GHSA-69g4-xvcm-vm2j)*. |
| `@relation(...)` | `fields: [x], references: [y], onDelete: A, onUpdate: A` | See the SKILL. Unknown key → `unsupported @relation key`. Both `fields` and `references` are mandatory. At most one per field *(since 0.14.0)*; a second is refused. |
| `@readonly` | bare | Out of Create + Update inputs; visible in responses and audit snapshots. `@readonly()` parsed on 0.14.0 and left the field writable; it is refused *(unreleased, GHSA-69g4-xvcm-vm2j)*. |
| `@server_only` | bare | Out of inputs, stripped from responses, omitted from audit snapshots. Never read from a request either: a procedure argument that names the model (directly or through a `type`) gets the field's default whatever the client sent *(since 0.13.0, #1051)*. Before that, a client could set it that way. Never a filter or sort key: refused like an undeclared field on REST, RPC, relation paths and `FindMany`, and absent from the generated `<M>Where` / `<M>SortField` *(since 0.13.0, GHSA-ch54-jqw2-vpp5)*. Before 0.13.0 a request could test its value that way, and a procedure output containing a model with a `@computed` field sent it (0.8.11–0.12.0). Only on a model's stored scalar column: see the placement rules below *(unreleased, GHSA-69g4-xvcm-vm2j)*. |
| `@pii` | bare | Audit redaction as `"[redacted-pii]"`. No effect on inputs or outputs. |
| `@sensitive` | bare | Audit redaction as `"[redacted-sensitive]"`. |
| `@version` | bare | Required `Int`. At most one per model. Never the PK, never inside `@@id([...])`. |
| `@computed` | bare or `@computed(params: T?)` | `type` and `model` only. Once per field. **Cannot combine with any other field attribute.** The `?` on `params` is mandatory; `T` must be a declared `type` block. |
| `@from(Model.field)` | opaque | **Completely inert.** Provenance documentation on view fields, checked by nothing. |
| `@db_enforce` | bare | Alongside a validator, promotes it to a real Postgres `CHECK`. The parser checks only its spelling (`@db_enforce()` refused *(unreleased, GHSA-69g4-xvcm-vm2j)*), not that a validator is present. |
| `@rename(from = "<old_column>")` | exactly `from = "…"`, double quotes | Migration marker, read only by `cratestack migrate` — see `cratestack-migrations`. The value is the old SQL column name (a camelCase name is snake-cased first). *(unreleased, GHSA-69g4-xvcm-vm2j)*: any other form (`@rename(from: "x")`, `@rename("x")`, `@rename()`, bare `@rename`, text after its `)`) is refused, and so are a second `@rename` on the field and a `@rename` on a field of a `view`, `type` or `auth` block or on a relation field. On 0.14.0 each of those checked as `schema OK` and the migrator read no marker: the next migration dropped the column and added a new one, losing its data. |
| `@length` `@range` `@regex` `@email` `@uri` `@iso4217` | see below | Validators. |

### Mutual exclusions and position rules

- `@readonly` + `@server_only` together → rejected; use `@server_only` alone.
- Either of them on the primary key → rejected.
- `@default(dbgenerated(anything))` → rejected; the marker takes no argument.
- `@server_only` is refused *(unreleased, GHSA-69g4-xvcm-vm2j)* wherever it had no effect: on a field of a
  `type` block or the `auth` block, on a relation field (mark the related model's
  fields instead), on a relation key (a scalar in any `@relation`'s `fields:` or
  a `references:` that targets its model), and on a `@version` field. On a
  relation key it did keep the key out of create and update inputs, so replace
  it with `@readonly` rather than deleting it, or clients can set the key.

### Spelling rules for field attributes *(unreleased, GHSA-69g4-xvcm-vm2j)*

- **A no-argument attribute is written bare.** `@server_only`, `@readonly`,
  `@version`, `@pii`, `@sensitive`, `@db_enforce`, `@email`, `@uri`,
  `@iso4217`, `@unique` and `@id` followed by an argument list or punctuation
  (`@readonly()`, `@server_only(true)`, `@version,`) are refused. Most readers
  compare the text whole, so on 0.14.0 these parsed and did nothing. A longer
  name (`@unique_per_tenant`) is a different, unknown attribute.
- **Separate attributes with a space.** `@server_only@unique` is refused. An `@`
  inside a string (`@default("a@b.c")`) is not affected.
- **Unknown field attributes are still inert.** Only a near-miss of a known name
  (`@reedonly`, `@renam`, `@Readonly`) is refused. A name too short for the
  near-miss check stays inert: `@Id` and `@ID` report `schema OK` and are **not**
  a primary key (measured with `cratestack check` built from `main`).

### Rejected at field position

| Written | Why |
| --- | --- |
| `@custom` | Renamed to `@computed`. |
| `@pb` | protobuf/gRPC removed in 0.8.5. |
| `@allow` / `@deny` | Field-level access policy never existed and enforced nothing. Use model-level `@@allow`, or `@readonly` / `@server_only`. |

The single-`@` forms **are** valid on `procedure` and `query` declarations. Only
field position rejects them.

## Validators

| Attribute | Arguments | Valid on | Notes |
| --- | --- | --- | --- |
| `@length(min: N, max: N)` | both optional, non-negative | `String`, `Bytes` | `min <= max` enforced. |
| `@range(min: N, max: N)` | both optional, signed | `Int`, `Decimal` | `min <= max` enforced. |
| `@regex("pattern")` | one quoted string | `String` | **Compiled at parse time** — an invalid regex fails `cratestack check`. |
| `@email` | bare | `String` | |
| `@uri` | bare | `String` | |
| `@iso4217` | bare | `String` | |

**Validator type-checking runs only on `model` fields.** A validator on a `type`,
`mixin`, `view` or `auth` field is not type-checked (it still passes the
near-miss and removed-attribute checks). Runtime enforcement lives in generated
`validate()` impls on the Create/Update inputs — and on the **embedded** backend
nothing calls them automatically.

## Model attributes

| Attribute | Grammar | Rules |
| --- | --- | --- |
| `@@allow("action", expr)` | quoted action (either quote) + expression | Actions: `list`, `detail`, `read`, `create`, `update`, `delete`, `all`. `read` groups `list` + `detail`. The expression is parsed at macro time. On 0.14.0 the form and the action were checked by nothing, and any other spelling was **silently skipped**. *(unreleased, GHSA-69g4-xvcm-vm2j)*: `cratestack check` requires exactly `@@allow(` + a quoted action from this list + `,` + a non-empty expression + `)`, ending the line (a trailing `//` comment is fine). |
| `@@deny("action", expr)` | same | Same rules and actions: `all` covers every slot. A skipped `@@deny` made the model more permissive than written. |
| `@@id([a, b])` | ≥2 fields | Real scalar fields, no repeats. Mutually exclusive with field-level `@id`. Listed fields must not carry `@readonly` / `@server_only` / `@version`. **Parses, then hard-rejected by every entry macro.** |
| `@@unique([a, b], where: "…")` | ≥1 field; ≥2 unless `where:` present | Only key accepted is `where`, at most once, value must be a quoted string. Duplicate field lists rejected. |
| `@@index([a], using: gist, opclass: "…", where: "…")` | ≥1 field | `using:` is a **bare identifier**; `opclass:` is a **quoted string**; `where:` is quoted SQL passed through verbatim. Duplicate `(fields, using)` pairs rejected — same fields with a different `using` is legal. |
| `@@paged` | **bare only** | Changes the list return type to `Page<Model>`. |
| `@@audit` | **bare only** | |
| `@@soft_delete` | **bare only** | |
| `@@retain(days: N)` | `days:` + non-negative integer | |
| `@@emit(created, updated, deleted)` | ≥1 of exactly those three | At most one per model; duplicates deduped. |
| `@@subscribe` | **bare only** | Requires `transport rpc` **and** requires `@@emit(...)`. |
| `@@rename(from = "<old_table>")` | exactly `from = "…"`, double quotes | Migration marker, read only by `cratestack migrate`. The value is the **old SQL table name** (`"old_models"`), not the old model name. *(unreleased, GHSA-69g4-xvcm-vm2j)*: any other argument form, and a second `@@rename`, are refused; on 0.14.0 they checked as `schema OK` and the next migration dropped and re-created the table. A well-formed marker naming a table that does not exist is still accepted by `check` and silently ignored by the migrator. |
| `@@internal("action")` | **exactly one quoted action per declaration** | Vocabulary: `list`, `detail`, `read`, `create`, `update`, `delete`, `all`. Suppresses the REST route, the RPC dispatch arm and the client stub. Does **not** suppress policy evaluation, and does not exempt handler-name collisions. |
| `@use(MixinA, MixinB)` | comma list | Written inside the model body. Expanded at parse time; the model's own field wins on a name clash. |
| `@@mcp(resource: "segment", max_page_size: N)` | see `cratestack-mcp` | *(since 0.13.0)* Exposes the model as a read-only MCP resource. Needs an `mcp { }` block exposing `resources`, and a read `@@allow`. Must sit on its own line. |

`@@map` does not exist. Table names are always `pluralize(snake_case(Name))`.

**On 0.14.0 and earlier, an unrecognised `@@` attribute is silently inert.** The
near-miss typo check runs on field attributes only, so `@@sofT_delete` or
`@@map("docs")` enforces nothing and reports `schema OK`.

**On `main` the table above is a closed list** *(unreleased,
GHSA-69g4-xvcm-vm2j)*, plus `@@mcp`, which the parser moves out before
validation. Any other `@@` name, a view-only attribute on a model, a case variant
or a typo is refused. So are whitespace before `(`, text after the closing `)`, an
empty `()`, an argument list on `@@paged` / `@@audit` / `@@soft_delete` /
`@@subscribe`, and two `@@` attributes on one line.

## `view` attributes

| Attribute | Notes |
| --- | --- |
| `@@server_sql("…")` | Postgres body. |
| `@@embedded_sql("…")` | SQLite body. |
| `@@sql("…")` | Both — used as the fallback for each. |
| `@@materialized` | Bare. Requires a server body. Cannot combine with `@@no_unique`. `@@materialized(...)` was accepted and ignored on 0.14.0; refused *(unreleased)*. |
| `@@no_unique` | Bare. Opts out of the "exactly one `@id` field" rule. Same `(...)` change. |
| `@@allow("read", expr)` | **Only `read`** is supported on a view. Single quotes (`'read'`) were refused on a view on 0.14.0 and are accepted *(unreleased)*. |
| `@@deny("read" \| "all", expr)` | A view generates only the `read` slot. On 0.14.0 a view `@@deny` naming any other action was silently skipped; it is refused *(unreleased)*. |

These seven are the whole list for a view *(unreleased, GHSA-69g4-xvcm-vm2j)*,
with the same spelling rules as a model's.

## `query` attributes

Only three are recognised: `@@sql`, `@allow`, `@deny`. `@@server_sql` and
`@@embedded_sql` are specifically rejected — a query has no per-backend split.
Exactly one `@@sql` body is required.

On 0.14.0 and earlier the name was everything before the first `(`, trimmed, so `@deny (…)`, `@Deny(…)` and `@deny(…) banned` passed `check` while the
generator dropped the rule. *(unreleased, GHSA-69g4-xvcm-vm2j)* each must be
spelled exactly: `@@sql(`, `@allow(`, `@deny(` with no space before `(`, a
non-empty argument list, and nothing after the closing `)`. `@@sql ("…")` is
refused. The layout rules below apply.

## Procedure attributes

| Attribute | Grammar | Rules |
| --- | --- | --- |
| `@allow(expr)` / `@deny(expr)` | single `@` | Evaluated in Rust against the decoded args and the auth context. |
| `@stream` | bare only | Requires a list (`T[]`) return type. `@stream(...)` is silently inert on 0.14.0 and refused *(unreleased)*. Rejected when the item type contains `@computed` fields. |
| `@no_idempotency` | bare only | `@no_idempotency(false)` is rejected — it would read as re-enabling while doing the opposite. No extension gate. `@no_idempotency ()` was ignored on 0.14.0 and is refused *(unreleased)*. |
| `@no_rate_limit` | bare only | Requires `extension rate_limit { }`. Any argument list is refused *(unreleased)*. |
| `@isolation("serializable")` | quoted | At most one. Levels `read_committed`, `repeatable_read`, `serializable`. **Validated and then ignored by every published release**, 0.14.0 included. Enforced on `main` *(unreleased, GHSA-r67q-4qqq-g9gm)*, where it is also refused together with `@stream` ("declares both @isolation and @stream"), under `provider = "none"`, and with `include_server_schema!(.., db = None)`. |
| `@api_version("v1")` | quoted, `[A-Za-z0-9._-]` | Mounts at `/<version>/$procs/<name>` on REST. Under `transport rpc` the op id is still `procedure.<name>`, so to version an RPC operation give it a new procedure name. Before 0.13.0 the generated clients and WireMock stubs called the unversioned path (404), and `@no_idempotency`/`@no_rate_limit` were ignored on a versioned REST procedure; both fixed *(since 0.13.0)*. |
| `@deprecated` / `@deprecated("msg")` | bare or one quoted string | Adds `Deprecation: true` and `X-Deprecation: <msg>` response headers. |
| `@status(202)` | bare integer, 200..=299 | **Rejected under `transport rpc`.** `@status(204)` is accepted but the encoder still attaches a body — do not use it. |
| `@authorize(Model, action, args.path)` | three parts | Actions `detail`/`read`, `update`, `delete` only. The path's type must match the model's PK type. Parsed at macro time; on 0.14.0 a malformed one was skipped there, so `authorize_with_db` returned `Ok` without consulting the database. *(unreleased)*: `cratestack check` also requires three non-empty arguments and one of those actions. |
| `@mcp(tool)` / `@mcp(tool: "name", description: "…")` | see `cratestack-mcp` | *(since 0.13.0)* Exposes the procedure as an MCP tool; moved into the procedure's MCP exposure while parsing. Needs an `mcp { }` block exposing `tools`, and an `@allow`. Must sit on its own line. |

**This table is the whole list** *(unreleased, GHSA-69g4-xvcm-vm2j)*. Any other
procedure attribute, a case variant (`@Deny`), a typo (`@deyn`, `@authorise`),
whitespace before `(` (`@deny (…)`), `@deny` with no argument list, `()` on a
bare attribute, or text after the closing `)` (`;`, `,`, a word) is refused, with
a suggestion when a name is close. On 0.14.0 and earlier these checked as
`schema OK` and the generator silently skipped them. For `@allow` that means
closed by default. For `@deny` and `@authorize` it means **more permissive than
written**.

## Parametric types

`Vector(n)` — requires `extension pgvector { }`, exactly one integer dimension
greater than zero, never list-valued, field position only.

`Geography` / `Geometry` — require `extension postgis { }`, never list-valued, at
most one integer SRID and at most one bareword subtype, field position only. An
SRID without a subtype is rejected because PostGIS's modifier is positional:
write `Geography(Point, 4326)`, not `Geography(4326)`. Subtype matching is
case-insensitive; the vocabulary is the 16 geometry bases each optionally
suffixed `Z`, `M`, or `ZM`.

## Multi-line SQL

Only `@@server_sql`, `@@embedded_sql` and `@@sql` may span physical lines, and
only via `"""…"""`. The body ends at the first following line containing `""")`.

Escaping is asymmetric: `"""…"""` is verbatim; `"…"` unescapes `\"` and `\\`.
Prefer triple quotes.

Keep each attribute on its own line. On 0.14.0 and earlier the extractor read
everything up to the **last** `)` on the line as the SQL argument, so a second
attribute on the same physical line broke the body (a `query` refused it as "not a
quoted string"). *(unreleased, GHSA-69g4-xvcm-vm2j)*: on a `query` line the
attributes are split and each is read. On a `view` line two `@@` attributes are
refused.

## Attribute text: comments, layout, invisible characters *(unreleased, GHSA-69g4-xvcm-vm2j)*

These rules come from `cratestack-core/src/schema/attribute_text*.rs` and
`cratestack-parser/src/parse/attribute_run.rs` on `main`.

**Trailing comments.** A `//` outside a string literal starts a comment on every
attribute line: field, `@@`, procedure and query. The comment is dropped before
anything reads the attribute. `"…"`, `'…'` and `"""…"""` are strings, so
`"http://…"` and a `//` inside a SQL string are kept. The upgrade consequences are
in the SKILL ("A trailing `//` comment is a comment on every attribute line").

**Procedure and query attribute runs.** A run is the lines under the signature
up to the first blank line. `//` and `///` lines inside it are skipped. A blank
line inside the run, or an attribute group standing alone, is refused (`is not
directly under a signature`). A run followed directly by another declaration,
with nothing or only comment lines between them, is refused (`is the last
attribute of …`); add a blank line. A `@@` line outside any model or view body
is refused with its own message.

**Several attributes on one procedure or query line** are cut at each `@name`
preceded by whitespace and outside strings and `(…)` / `[…]`. So
`@no_idempotency @deny(x)` is two attributes, and `@deny(x)@allow(y)` is refused
with the separated form in the message. `@mcp(tool) @allow(…)` on a procedure
line is two attributes. On 0.13.0 and 0.14.0 that was refused. `@@mcp` sharing
a model line is still refused.

**Invisible characters** are refused anywhere in attribute text, strings and SQL
bodies included, and the error names the code point, line and column:

- every Unicode 16.0 `Default_Ignorable_Code_Point`: zero-width space, joiner
  and non-joiner (U+200B–U+200D), word joiner U+2060, BOM U+FEFF, soft hyphen
  U+00AD, U+034F, the Hangul fillers, direction marks, tag characters, …;
- U+2800 (Braille blank), U+1D159, and the format controls U+FFF9–U+FFFB and
  U+13430–U+1343F;
- control characters that are not whitespace (U+0000–U+001F, U+007F–U+009F,
  except tab, LF, VT, FF, CR and NEL);
- a variation selector (U+FE00–U+FE0F, U+E0100–U+E01EF) **anywhere** in `@allow`,
  `@deny`, `@authorize`, `@@allow`, `@@deny`. Outside a policy attribute one is
  allowed only right after a visible non-ASCII character (`@default("❤️")`).

Bidi controls (U+202A–U+202E, U+2066–U+2069), ESC and U+009B are refused
**anywhere in the file**, comments included. A lone CR, VT, FF, NEL, U+2028 or
U+2029 with text after it on the line is refused too. `\r\n` endings are fine.
Visible non-ASCII (`é`, CJK, Arabic, emoji) is fine. But an emoji built with a
zero-width joiner (family, profession), a tag-sequence flag, a keycap emoji
(`1️⃣`), or a word that needs ZWNJ/ZWJ (Persian, some Indic scripts) is refused,
even inside a string.

**The generator re-checks policies.** Every `include_*_schema!` re-reads each
attribute whose name looks like `allow`, `deny` or `authorize` in any case or
spacing. It fails with a `compile_error!` when the exact reader did not turn that
attribute into a rule, when the count of such names differs from the rules
generated, or when a policy attribute carries an invisible character
(`cratestack-macros/src/policy/attribute_audit.rs`). This check does not rely on
the parser having refused the spelling first. Read from source; not exercised
through a compiled schema for this skill.

## Doc comments

`///` is a doc comment; `//` is an ordinary comment and **clears** pending docs,
as does a blank line. That holds for a line that *starts* with `//`. A trailing
`// …` after an attribute is not stripped in 0.14.0: it silently drops a
procedure, `query` or `@@` policy attribute (see above), and on a field line an
attribute named inside it is applied (`@unique // not @readonly` makes the field
read-only). Fixed on `main` *(unreleased, GHSA-69g4-xvcm-vm2j)*.

Per-argument procedure docs use `/// @param <name> <description>`.
