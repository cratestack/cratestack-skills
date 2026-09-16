# Coverage

The feature-to-skill map. **This table is the parity contract**: when the
framework ships something user-facing, the change lands in the skill named here,
and a new feature that fits nowhere gets a row before it gets prose.

`scripts/validate-skills.mjs` checks this file both ways — every skill directory
must appear here, and every skill path mentioned here must exist.

Verified against **CrateStack 0.12.0**. Feature-to-release history lives in
[skills/cratestack/references/version-history.md](skills/cratestack/references/version-history.md).

## Skills

| Skill | Owns |
| --- | --- |
| [skills/cratestack/](skills/cratestack/) | Entry point and router. The role model, the four facades, the three entry macros, known limits, and the version-history reference. |
| [skills/cratestack-schema/](skills/cratestack-schema/) | The `.cstack` language: declarations, scalars, field and model attributes, relations, enums, types, mixins, validators, `@computed`, views, `query` blocks, procedures, collision rules. |
| [skills/cratestack-server/](skills/cratestack-server/) | `include_server_schema!` for `db = Postgres` and `db = None`; the emitted runtime and routers; `AuthProvider` wiring; the REST query contract; error envelope and status codes; codecs; events and the outbox; idempotency and rate-limit layers; `cratestack-service`; tracing. |
| [skills/cratestack-policy-auth/](skills/cratestack-policy-auth/) | `@@allow` / `@@deny` and the procedure policy dialect; the predicate language; deny-by-default; why a denied read is a 404; `AuthProvider` and `CratestackContext`; `cratestack-auth`. |
| [skills/cratestack-data-integrity/](skills/cratestack-data-integrity/) | Idempotency, rate limiting, `@version`, `@@audit` and redaction, `@@soft_delete`, upsert and conflict targets, batches, `@isolation`, trusted proxy, `@@paged`, size bounds, composite keys, computed-field runtime, multi-tenancy. |
| [skills/cratestack-embedded/](skills/cratestack-embedded/) | `include_embedded_schema!`, `RusqliteRuntime`, `ModelDelegate`, transactions, wasm32 + OPFS, and the Flutter / Expo / Tauri / async-host integrations. |
| [skills/cratestack-clients/](skills/cratestack-clients/) | `include_client_schema!`, `generate-dart`, `generate-typescript` and their layer flags, the npm and pub.dev packages, the wire contract and revival, WireMock stubs, client state stores, drift checking. |
| [skills/cratestack-rpc/](skills/cratestack-rpc/) | `transport rpc`, the three endpoints, op IDs, frames, batch semantics, SSE subscriptions, `@stream` and cbor-seq, client batching links, and the transport-parity rule. |
| [skills/cratestack-migrations/](skills/cratestack-migrations/) | `migrate diff` and `migrate baseline`, the snapshot model, destructive classification, `up.pre.sql`, rename markers, the Postgres-only applier, SQLite differences. |
| [skills/cratestack-cli/](skills/cratestack-cli/) | Every subcommand and flag, installation, exit codes, `--check` drift mode, JSON diagnostics, `diff` severities, CI recipes. |
| [skills/cratestack-studio/](skills/cratestack-studio/) | `studio.toml`, `init` / `run` / `eject`, the read and write API, the tools, UI bundling, and the security posture of `rw` database targets. |
| [skills/cratestack-editor-tooling/](skills/cratestack-editor-tooling/) | `cratestack-lsp` capabilities and editor wiring, the VS Code extension, the tree-sitter grammar and why VS Code does not use it. |
| [skills/cratestack-troubleshooting/](skills/cratestack-troubleshooting/) | False greens, build failures, macro and `check` errors with what each means, and runtime behaviour that looks like a bug. |
| [skills/cratestack-contributing/](skills/cratestack-contributing/) | Working on the framework repo: `just` gates, the file ceiling, layering, changelog rules, lint opt-in, MSRV and deny policy, the release pipeline, issue and PR governance. |

## Framework surface → skill

| Surface | Skill |
| --- | --- |
| `.cstack` syntax, any attribute | `cratestack-schema` |
| `include_server_schema!` (either `db`) | `cratestack-server` |
| `include_embedded_schema!` | `cratestack-embedded` |
| `include_client_schema!` | `cratestack-clients` |
| Facade selection, `package =` rename | `cratestack` |
| `@@allow` / `@@deny` / `@allow` / `auth()` | `cratestack-policy-auth` |
| `AuthProvider`, `CratestackContext` | `cratestack-policy-auth` (trait) + `cratestack-server` (wiring) |
| `cratestack-auth` (Ed25519, SD-JWT, JWKS) | `cratestack-policy-auth` |
| REST routes and query parameters | `cratestack-server` |
| `transport rpc`, `/rpc/batch`, subscriptions, `@stream` | `cratestack-rpc` |
| Codecs, content negotiation | `cratestack-server` (server) + `cratestack-clients` (client) |
| Idempotency, rate limiting, `cratestack-exec`, `cratestack-redis` | `cratestack-data-integrity` |
| `@version`, `@@audit`, `@@soft_delete`, upsert, `@@paged`, `@isolation` | `cratestack-data-integrity` |
| `@computed` authoring rules | `cratestack-schema` |
| `@computed` runtime and wire surface | `cratestack-data-integrity` |
| Events, `@@emit`, `cratestack-outbox` | `cratestack-server` |
| `cratestack-service` (config, health, run) | `cratestack-server` |
| Views, `@@materialized`, `query` blocks | `cratestack-schema` |
| Migrations, snapshots, baselines | `cratestack-migrations` |
| The `cratestack` binary, any subcommand | `cratestack-cli` |
| `cratestack diff` severities | `cratestack-cli` |
| Studio and `studio.toml` | `cratestack-studio` |
| `cratestack-lsp`, VS Code, tree-sitter | `cratestack-editor-tooling` |
| npm and pub.dev packages | `cratestack-clients` |
| WireMock stubs | `cratestack-clients` |
| Client state stores | `cratestack-clients` |
| wasm32 / OPFS, Flutter, Expo, Tauri | `cratestack-embedded` |
| Build and test failures, macro errors | `cratestack-troubleshooting` |
| `just` recipes, CI, layering, release | `cratestack-contributing` |
| Which release shipped what | `cratestack` → `references/version-history.md` |

## Known gaps

Recorded honestly, because a missing row is a finding:

- **`cratestack-outbox`** has one paragraph inside `cratestack-server`. If its
  surface grows it wants its own skill.
- **Spatial (PostGIS) and vector (pgvector)** are covered as type and attribute
  rules in `cratestack-schema`, not as query-authoring guides. Distance filters
  panic on the embedded backend and that is noted, but there is no worked
  similarity-search example.
- **Deployment and operations** — container images, connection pooling, running
  migrations on boot — are not covered anywhere, on purpose: the framework has no
  opinion there and inventing one would be the wrong kind of confidence.
