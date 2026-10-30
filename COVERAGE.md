# Coverage

The feature-to-skill map. **This table is the parity contract**: when the
framework ships something user-facing, the change lands in the skill named here,
and a new feature that fits nowhere gets a row before it gets prose.

`scripts/validate-skills.mjs` checks this file both ways — every skill directory
must appear here, and every skill path mentioned here must exist.

Verified against **CrateStack 0.14.2**. Feature-to-release history lives in
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
| [skills/cratestack-clients/](skills/cratestack-clients/) | `include_client_schema!`, `generate-dart` (presets `default` / `riverpod` / `fespalier`, the HTTP transport seam and its adapters, typed errors, call options, upgrading from the removed `*DioAdapter` classes) and `generate-typescript` with their layer flags, the npm and pub.dev packages, the wire contract and revival, WireMock stubs, client state stores, drift checking. |
| [skills/cratestack-rpc/](skills/cratestack-rpc/) | `transport rpc`, the three endpoints, op IDs, frames, batch semantics, SSE subscriptions, `@stream` and cbor-seq, client batching links, and the transport-parity rule. |
| [skills/cratestack-mcp/](skills/cratestack-mcp/) | The MCP operator *(since 0.13.0)*: the `mcp { }` block, `@mcp(tool ...)` and `@@mcp(resource ...)`, the `mcp` facade feature, `StdioServer` and `StreamableHttpServer`, the HTTP guard and audience checks, `cratestack://` resource URIs, errors and fail-closed behaviour. |
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
| `CoseAuthProvider` *(since 0.16.0, cratestack#1077)*: `cratestack_cose::auth`, `authenticate_devices`, `with_service_keys`, the `cose:<thumbprint>` principal and its `kind` / `thumbprint` / `alg` fields | `cratestack-server` (wiring, the device gate) + `cratestack-policy-auth` (`auth()` semantics) + `cratestack-troubleshooting` (anonymous device) |
| `cratestack-auth` (Ed25519, SD-JWT, JWKS) | `cratestack-policy-auth` |
| REST routes and query parameters | `cratestack-server` |
| `transport rpc`, `/rpc/batch`, subscriptions, `@stream` | `cratestack-rpc` |
| MCP: `mcp { }`, `@mcp`, `@@mcp`, `cratestack-mcp`, `StdioServer`, `StreamableHttpServer` | `cratestack-mcp` |
| Codecs, content negotiation | `cratestack-server` (server) + `cratestack-clients` (client) |
| Idempotency, rate limiting, `cratestack-exec`, `cratestack-redis` | `cratestack-data-integrity` |
| COSE envelope layer *(since 0.14.0, cratestack#1006)*: `envelope` / `cose` facade features, `EnvelopeLayer`, generated `envelope_layer(..)`, `ServerEnvelope`, `EnvelopePolicy`, `BindingResolver`, `PrincipalMapper`, `ResponseSealPolicy` | `cratestack-server` (wiring, modes, traps) + `cratestack-data-integrity` (idempotency principal, bound `Idempotency-Key` / `If-Match`, rate-limit key) + `cratestack-troubleshooting` (500 / 401 / 415 / 406) + `cratestack-clients` (the Dart client: see the row below) |
| Claim objects *(since 0.17.0, cratestack#1231)*: `cratestack_cose::claims`, `sign_claims` / `open_claims`, `CwtClaims`, `OpenedClaims`, `ClaimsError`, no freshness or replay check, domain separation from the envelope | `cratestack-server` (API, wire shape) + `cratestack-troubleshooting` (`ClaimsError`, "verified is not fresh") + `cratestack-clients` (not in Dart) |
| `RegistryVerifierResolver` *(since 0.15.4, cratestack#1149)*: runtime `register` / `revoke` / `revoke_key` / `with_max_keys` for COSE verification keys | `cratestack-server` (signed transport) + `cratestack-troubleshooting` (envelope 401) |
| Dart COSE client *(since 0.15.4, cratestack#1151)*: `package:cratestack_cbor/cose.dart` (`ClientEnvelope`, `CallBinding`, `HmacSigner`, `Ed25519Signer`, `CoseServerKey`, the `CoseException` family), over flutter_rust_bridge natively and `cratestack-cbor-wasm` on the web | `cratestack-clients` (setup, binding, signers) + `cratestack-troubleshooting` (exception mapping); the server half is the COSE envelope layer row above, owned by `cratestack-server` |
| Negotiated payload types under an envelope *(since 0.15.4, cratestack#1168)*: `Cratestack-Payload-Type` / `Cratestack-Payload-Accept`, `EnvelopeLayerBuilder::payload_media_types`, `415`/`406` refusals, `EnvelopeError::UnexpectedPayloadType`, `ClientEnvelope::seal_call` / `PendingResponse::open`, `ExternalSigner::ed25519` | `cratestack-server` (layer, negotiation) + `cratestack-clients` (codec, `seal_call`) + `cratestack-troubleshooting` (415/406) |
| Dart HTTP transport seam *(since 0.16.0, cratestack#1204)*: `CratestackHttpTransport`, `CratestackHttpAdapter` / `CratestackRpcHttpAdapter` (`baseUri`, `format`), `CratestackDioTransport`, the removed `*DioAdapter` classes and the migration, `CratestackRestException` / `CratestackRpcException` / sealed `CratestackTransportException`, `abort` and `idempotencyKey` call options, streaming `stream()`, canonical query encoding (`null` omitted) | `cratestack-clients` (`references/dart-transport.md`) + `cratestack-troubleshooting` (exception and upgrade rows) + `cratestack-rpc` (RPC client note) |
| `generate-dart --preset fespalier` / `--fespalier-ref` *(since 0.16.0, cratestack#1204)*: `CratestackFespalierTransport`, `<prefix>TransportProvider` / `<prefix>BaseUriProvider`, preset selection (`default` / `riverpod` / `fespalier`), fespalier's `examples/cratestack` | `cratestack-clients` (selection, wiring) + `cratestack-cli` (flags) + `cratestack-troubleshooting` |
| Dart client known gaps *(open)*: call options cannot carry transport attributes (cratestack#1207); an `AuthProvider` refusal cannot shape its body on 0.17.0 and earlier (cratestack#1208) | `cratestack-clients` (#1207, workaround) + `cratestack-policy-auth` (#1208, workaround) |
| `AuthRefusal` *(unreleased, cratestack#1208)*: `unauthenticated` / `forbidden`, `with_member`, `with_details`, `with_challenge` (`WWW-Authenticate`), `RESERVED_ENVELOPE_MEMBERS`, `CratestackError::AuthRefused`, the envelopes' `extra` map, `ClientError::Remote` boxing | `cratestack-policy-auth` (provider side) + `cratestack-clients` (what clients receive) |
| MCP `CredentialPresence` *(unreleased, cratestack#1243)*: `bearer` / `provider_decides` / `when`, `with_credential_headers`, `with_credential_presence`, refusals on MCP | `cratestack-mcp` |
| The principal contract *(unreleased, cratestack#1243)*: reserved claims (`RESERVED_CLAIMS`), `CratestackContext::builder`, typed readers (`subject()`, `roles()`, `cnf_jkt()`, `key_role()`, …), `hasRole` over `roles`, the `auth`-block type check, `cratestack-auth`'s `PrincipalMapper` | `cratestack-policy-auth` (+ `cratestack-mcp` for the MCP namespace) |
| Offline sync *(unreleased prototype, `publish = false`; ADR 0020 proposed)*: `cratestack-sync`, `examples/sync-notes`. Owned as a **limit** ("no supported sync engine; do not depend on the prototype") until the ADR is accepted and `@@sync` exists | `cratestack-embedded` |
| `@version`, `@@audit`, `@@soft_delete`, upsert, `@@paged`, `@isolation` | `cratestack-data-integrity` |
| `@isolation` enforcement *(since 0.14.1, GHSA-r67q-4qqq-g9gm)*: `IsolatedCratestack`, `with_isolation_max_retries`, `409 TRANSACTION_ABORTED` / RPC `aborted` | `cratestack-data-integrity` (semantics, idempotency) + `cratestack-server` (handle, error table) + `cratestack-rpc` / `cratestack-mcp` (per-transport answer) + `cratestack-troubleshooting` |
| Relation filter and sort read scope *(since 0.13.0, GHSA-p55v-6xv5-93p3)*: `RelatedReadScope`, `related_read_scope()`, self-relations | `cratestack-server` (query contract, hand-built constructors) + `cratestack-policy-auth` (policy semantics) |
| `@server_only` refused as a filter or sort key, and never sent by a `@computed` procedure output *(since 0.13.0, GHSA-ch54-jqw2-vpp5)* | `cratestack-schema` (attribute) + `cratestack-server` (query contract) + `cratestack-clients` (`<M>Where` / `<M>SortField`) |
| Strict attribute parsing *(since 0.14.1, GHSA-69g4-xvcm-vm2j)*: trailing `//` comments stripped, closed procedure / query / model / view attribute lists, attribute runs and blank lines, invisible characters, the generator's policy re-check, `@server_only` placement, `@rename` / `@@rename` form | `cratestack-schema` (rules, `references/attributes.md`) + `cratestack-policy-auth` (exact policy forms, the fail-open history, upgrade greps) + `cratestack-migrations` (rename markers) + `cratestack-mcp` (`@mcp` sharing a line) + `cratestack-cli` (`diff` baseline) + `cratestack-troubleshooting` (the refusal messages) |
| Closed field-attribute lists per declaration kind *(since 0.15.4, ADR 0019 D5, cratestack#679)*: the `model` / `view` / `mixin` / `type` / `auth` lists, shape checks, `@db_enforce` and `@from` checks, `cratestack_parser::field_attribute_names`, LSP completion lists | `cratestack-schema` (lists, `references/attributes.md`) + `cratestack-troubleshooting` (``unsupported attribute `@x` on a model field``) |
| Validators on `type` fields enforced on procedure arguments *(since 0.15.4, ADR 0019 D5)*: `cratestack::ValidateFields`, `FieldPath`, `ProcedureArgs::validate_fields`, `?computedParams=` validation, `422` / `invalid_argument` with the body path | `cratestack-schema` (where validators run) + `cratestack-troubleshooting` (the new `422`) |
| `BigInt` scalar *(since 0.15.4, ADR 0019 D2, D3)*: canonical-string wire form, `cratestack::BigInt`, TypeScript `bigint` + strict revival + `BigIntFilter`, Dart `BigInt` + `cratestackDecodeBigInt`, `--rtk` floor `^2.2.7`, `SqlValue::BigInt`, three-valued policy comparisons | `cratestack-schema` (the type) + `cratestack-clients` (wire contract) + `cratestack-policy-auth` (wrong-typed claim denies) + `cratestack-troubleshooting` (`TypeError`) |
| `@default(autoincrement())` refused, `dbgenerated()` must be the whole default *(since 0.16.0, cratestack#1128)* | `cratestack-schema` (`@default`) + `cratestack-migrations` |
| `@default` functions *(since 0.17.0, cratestack#1209)*: builtin `now()` / `uuid()` / `cuid()` generated on create, datasource `functions = [...]` registration, per-dialect DDL, `auth()` never in DDL | `cratestack-schema` (`@default`, `references/attributes.md`) + `cratestack-migrations` |
| Literal `@default` type checks and single-quoted DDL strings; embedded defaults (runtime-bound literals, `create_table_sql` `DEFAULT`s, `auth()` required / `dbgenerated()` optional inputs, `RusqliteError::UnfilledDefault`) *(since 0.17.0, cratestack#1234)* | `cratestack-schema` (`references/attributes.md`) + `cratestack-embedded` + `cratestack-migrations` |
| `@computed` authoring rules | `cratestack-schema` |
| `@computed` runtime and wire surface | `cratestack-data-integrity` |
| Events, `@@emit`, `cratestack-outbox` | `cratestack-server` |
| `cratestack-service` (config, health, run) | `cratestack-server` |
| Views, `@@materialized`, `query` blocks | `cratestack-schema` |
| Enum storage and wire form (`TEXT` + `CHECK`, variant name on both codecs), `DateTime` / `Uuid` wire size; explicit enum ordinals *(since 0.17.0)*: `Pending = 1`, `@@reserved`, the parse-time rules, storage and wire form | `cratestack-schema` |
| Ordinal enums in migrations *(since 0.17.0)*: `SMALLINT` + numeric `CHECK`, the append-only refusals, the string ↔ ordinal data conversion | `cratestack-migrations` |
| Ordinal enums in the generated clients and WireMock *(since 0.17.0)*: number on the wire, Rust `#[repr(i16)]`, TypeScript revival to names, Dart `wireValue` | `cratestack-clients` |
| `cratestack diff` on enums *(since 0.17.0)*: removed and added enums and variants, the response-reachability rule for an added variant, reorders, ordinal-enum renames and encoding switches | `cratestack-cli` |
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
