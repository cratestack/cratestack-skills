# Feature-to-release map

**Why this file exists:** a skill that says "CrateStack does X" is only true for
some range of versions. CrateStack is pre-1.0, every public crate shares one
version, and minor releases break. A fact that is right for 0.14.0 can be wrong
for the 0.9.x a reader is actually on — and, worse, right for an unreleased
`main` and wrong for every published version.

**How to check what you are on:**

```bash
cratestack --version
grep -n 'cratestack' Cargo.toml          # the facade version
```

Everything in these skills is verified against **0.14.2** unless a marker says
otherwise. Read every *(since X.Y.Z)* as "absent before X.Y.Z" and every
**breaking** note as "your call sites change". One exception: *(since 0.14.0)*
also covers the yanked 0.13.1, which shipped the same changes (see
[0.14.0](#0140-2026-09-26)).

## Reading order for an upgrade

The framework's own `CHANGELOG.md` is the authority and is unusually detailed —
entries explain the defect, not just the change. This file is a routing index
into it, not a replacement.

---

## Unreleased on `main`, after 0.15.3

Skills mark these *(unreleased, cratestack#NNN)*, or *(unreleased, GHSA-…)* for a
security fix merged from a private fork with no PR number.

- **`cratestack_cose::RegistryVerifierResolver`** (cratestack#1149, PR #1150).
  Additive: a runtime-mutable `CoseVerifierResolver` (`register` / `revoke` /
  `revoke_key`, optional `with_max_keys` bound) for keys enrolled after the
  server starts. Owner: `cratestack-server` (signed transport), with the 401
  note in `cratestack-troubleshooting`.
- **The facades re-export `CborCodec` and `JsonCodec` at the crate root**
  (cratestack#1147, PR #1148). Additive: `cratestack-api`, `-pg`, `-sqlite` and
  `-client` expose `cratestack::CborCodec` (and `JsonCodec` behind the default
  `codec-json` feature), the same types as `cratestack::client_rust::CborCodec`,
  so a `db = None` server no longer needs `cratestack-codec-cbor` as a direct
  dependency to build `envelope_layer`, `rpc_router` or a client.
- **Dart and Flutter clients can seal and open COSE** (cratestack#1151, #1026).
  Additive: `package:cratestack_cbor/cose.dart` (`ClientEnvelope`, `CallBinding`,
  `HmacSigner`, `Ed25519Signer`, `CoseServerKey`, the `CoseException` family) reaches
  `cratestack-cose` over flutter_rust_bridge and the `cratestack-cbor-wasm` build,
  with no Dart reimplementation. Required mode only, in-memory signers only: no
  keystore or ESP256 signer yet. The generated Dart client still sends unsigned
  requests. Default builds and the npm `@cratestack/cbor-web` stay codec-only; the
  vendored `cratestack_cbor` binaries grow by about 460 KB (Linux x86_64) and
  270 KB (web). Owner: `cratestack-clients`, with the exception mapping in
  `cratestack-troubleshooting`.

## 0.15.3 (2026-10-01)

0.15.3 is a version bump with no `CHANGELOG.md` entries and no code change over
0.15.2 (`v0.15.2..v0.15.3` is the single release-bump commit; its changelog
heading is seeded with "No changes since last release" and is dated 2026-09-30,
the tag 2026-10-01). Nothing is marked *(since 0.15.3)*.

## 0.15.2 (2026-09-30)

0.15.2 is the contract-digest release: the signed transport stops binding the
whole schema and binds the called op instead. Skills mark it *(since 0.15.2)*.

- **Breaking: signed transport binds the called op's contract digest, binding
  version 2** (cratestack#1123, #1030). Before, a signed message bound
  `schema_sha`, the digest of the whole schema IR, so any schema edit (a policy,
  an `@@index`, a view's SQL, a new procedure) refused every signed client built
  before it with an unsigned `401` that looked like a revoked key. Now it binds
  `contract_sha` (`cratestack_core::op_contract_digest`), which moves only when
  that op's wire shape does. A wire-shape edit makes that op, and only that op,
  answer the **unsigned `426 contract_unsupported`** (`CONTRACT_UNSUPPORTED` on
  REST), surfaced by the client as `EnvelopeError::ContractUnsupported { op }`;
  it is unsigned, so a hint and never proof, and any other unsigned `426` (a
  proxy's) stays `EnvelopeError::Unsigned`. **A version 2 verifier refuses
  version 1 with no opt-in: upgrade clients and servers together (the flag day).**
  The client names the digest it used in the unbound `Cratestack-Contract`
  header (`ContractSelector`, first 8 bytes of the digest); without it the layer
  tries the op's accepted digests newest first, at most
  `EnvelopeLayerBuilder::max_contract_trials` (default 4). A signed
  `/rpc/batch` still binds the whole-contract `client_contract_digest`, so any
  client-facing change refuses it. Breaking API: `Binding::schema_sha` is now
  `contract_sha`; `EnvelopeLayer::builder(envelope, audience, contracts)` takes
  `AcceptedContracts` (the generated `ACCEPTED_CONTRACTS`) where it took a
  `[u8; 32]` (the generated `envelope_layer(envelope, policy, audience)` is
  unchanged for callers); `CratestackClient::with_schema_sha_bytes` is replaced
  by `with_contracts(OP_CONTRACTS)` and `with_contract_sha([u8; 32])`, and
  `RuntimeHandle::with_envelope(config, envelope, contracts)` takes
  `OpContracts`. Every `include_*_schema!` module also emits `OP_CONTRACTS`,
  `CLIENT_CONTRACT_SHA256(_BYTES)` and, on the server, `ACCEPTED_CONTRACTS`. The
  whole-IR `SCHEMA_SHA256(_BYTES)` stays, for the warn-only
  `x-cratestack-schema-sha` drift header only. Owner: `cratestack-server`
  (signed transport) and `cratestack-troubleshooting` (envelope answers).
- **Additive: the generated Dart client carries `cratestackOpContracts`**
  (cratestack#1123, #1030; absent at v0.15.1, present at v0.15.2). A
  `Map<String, String>` in the generated `lib/src/constants.dart`, from each op
  key (the RPC op id, or `<METHOD> <route template>` on REST, plus `batch` for
  `transport rpc`) to its lowercase-hex contract digest, with
  `cratestackClientContractSha256` beside it for the whole-contract digest.
  Computed by the same `cratestack_core` function as the Rust client's
  `OP_CONTRACTS`. For a hand-rolled sealer or a server-version check; the
  unsigned Dart runtime does not read it, and **the generated Dart client still
  does not sign**. Owner:
  [cratestack-clients](../../cratestack-clients/SKILL.md).
- **Additive: the compatible-contract lock** (cratestack#1123, #1030). A
  committed JSON lock file next to the schema keeps the server accepting older
  signed clients across edits that change a shape but stay compatible with it
  (an optional field added to a model or an args type).
  `include_server_schema!("s.cstack", db = Postgres, contracts = "s.contracts.lock")`
  reads it at compile time, and an incompatible locked entry is a compile error
  naming the op. `cratestack_core::classify(old, new)` is conservative: anything
  it does not recognise is `Breaking`. CLI: `cratestack contract lock | check |
  prune` (exit 0 ok, 1 a failed verdict, 2 a tool error; `check --json`). See
  [cratestack-cli](../../cratestack-cli/SKILL.md).

## 0.15.1 (2026-09-30)

0.15.1 is the groundwork for 0.15.2's binding: per-op digests, with no change to
what a signed request binds. Skills mark it *(since 0.15.1)*.

- **Additive: per-op contract digests and `cratestack contract digest | print`**
  (cratestack#1123). `cratestack_core::client_contract` computes, per op, a
  digest that moves only when that op's wire shape changes (its transport, key
  and kind, input and output roots and every model, type, enum and view
  reachable from them, with `@server_only` fields removed). A policy, an
  `@@index`, a view's SQL or a new procedure leaves every existing digest alone.
  `cratestack contract digest --schema <file> [--json]` and
  `cratestack contract print --schema <file> --op <key>` print them. Nothing
  bound them yet: a signed request still carried the whole-IR `schema_sha`.
- **No behaviour change: one op list for every surface** (cratestack#1123).
  `cratestack_core::op_list` is the one place a model's verbs, an op's key and
  its REST routes are derived; emitted code, routes, op ids and generated
  clients are byte-identical for existing schemas.
- **Digests change once: six more wire-neutral attributes leave the op contract**
  (cratestack#1123). `@pii`, `@sensitive`, `@db_enforce`, field `@unique`, a view
  field's `@from` and a procedure's `@deprecated` no longer move any op digest.
  Relative to a build of `main` before 0.15.1 only; no published version bound
  a per-op digest before 0.15.2.

## 0.15.0 (2026-09-29)

Skills mark it *(since 0.15.0)*.

- **Behaviour change: a write reads its policies on the connection it runs on**
  (cratestack#1117, PR #1118). A write inside a caller's transaction
  (`db.transaction(..)`, `run_in_tx`, `run_in_isolated_tx`, `batch_*`, or the
  transaction an audited or emitting `.run()` opens) used to evaluate create
  policies, the update/delete `@version` probe, the upsert update-policy gate and
  the `cratestack_audit` bootstrap on the pool. Now it uses its own connection:
  no second connection is needed (so `N` concurrent writers on an `N`-connection
  pool no longer wait on each other); the probe sees the caller's own
  uncommitted writes; under `REPEATABLE READ` and `SERIALIZABLE` it reads the
  caller's snapshot; a stale `If-Match` after the caller's own version bump is
  `412 PRECONDITION_FAILED`, not `403`; and a probe that errors (for example
  `40001`) aborts the caller's transaction as the write would. No public
  signature changes. See
  [cratestack-data-integrity](../../cratestack-data-integrity/SKILL.md).
- **Breaking: the schema digest identifies the schema, not its text**
  (cratestack#1065, PR #1119). `SCHEMA_SHA256(_BYTES)` was the SHA-256 of the raw
  `.cstack` bytes, so a comment, a `///` doc or a re-indent changed it. Both now
  come from `cratestack_core::schema_digest`, a hash of a canonical form of the
  parsed schema (spans, docs and attribute whitespace dropped, top-level
  declarations and fields sorted by name; enum variants, attributes and
  procedure arguments keep declared order). Every existing `SCHEMA_SHA256`
  changes once: regenerate clients and rebuild servers together. Superseded for
  signed transport by 0.15.2's per-op digest.
- **The Rust client seals requests and opens responses** (cratestack#1007,
  PR #1120). Behind the new `cose` feature of `cratestack-client-rust`
  (forwarded by the `cratestack-client`, `-pg` and `-api` facades; off by
  default, no `axum` in the graph),
  `CratestackClient::with_envelope(ClientEnvelope::new(envelope, audience)?)`
  makes the client a `Required` one on REST and RPC, COSE_Sign1 and COSE_Mac0.
  Every response must be a COSE message that verifies against its request
  (`EnvelopeError::Unverified` otherwise); an unsealed answer is
  `EnvelopeError::Unsigned { status }` and its body is never read, so a proxy
  cannot downgrade the client. Streamed entry points and subscriptions fail
  locally with `EnvelopeError::StreamsUnsupported`; redirects are never
  followed; a `JsonCodec` client refuses an envelope (`BadInput`); a sealed
  request carries a fresh `cti`, so a retry layer must send the call again
  through the client, not replay bytes. `ExternalSigner::esp256(public_key_sec1,
  callback)` signs with a key outside the process (Android Keystore, iOS
  `SecKey`), accepting DER or raw `r || s`. `RuntimeHandle::with_envelope`
  seals over the FFI, and `RuntimeEnvelopeConfig` gains `CoseMac0`.
  **Breaking:** `CoseSigner` and `CoseVerifierResolver` are target-split like
  `RequestAuthorizer` (0.14.2): on `wasm32` they carry no `Send + Sync`, so an
  implementation that builds for both targets uses the same
  `#[cfg_attr(..., async_trait)]` pair, and a plain `#[async_trait]` fails with
  `E0053` there; `ClientError` and `RpcClientError` gain an `Envelope` variant.
  **The Dart and TypeScript clients do not sign** (ADR 0006 §11): they use the
  Rust runtime instead of a second implementation. Binding version 1 froze with
  this release (cratestack#1082) and was replaced by version 2 in 0.15.2. See
  [cratestack-server](../../cratestack-server/SKILL.md) and
  [cratestack-clients](../../cratestack-clients/SKILL.md).

## 0.14.2 (2026-09-27)

0.14.2 is 0.14.1 plus one `CHANGELOG.md` entry, finishing #1104 for clients
that authenticate. Skills mark it *(since 0.14.2)*.

- **`RequestAuthorizer` is target-split on wasm32** (cratestack#1108, a #1104
  follow-up). Affected: 0.14.1, which built the client for wasm32 but kept the
  trait `Send + Sync` with a `Send` future, so an authorizer that refreshes its
  token through the client could not be implemented there. Now the trait is
  `#[async_trait(?Send)]` without `Send + Sync` on wasm32 and unchanged
  natively. See [cratestack-clients](../../cratestack-clients/SKILL.md).

## 0.14.1 (2026-09-27)

0.14.1 is 0.14.0 plus these four `CHANGELOG.md` entries: two breaking security
fixes, a companion attribute-parsing hardening change that shipped alongside
the first, and a wasm32 client-build fix. Skills mark them *(since 0.14.1)*.

- **Security, breaking: `@isolation` is enforced** (GHSA-r67q-4qqq-g9gm; advisory
  not yet published). Affected: 0.2.0 through 0.14.0, where the attribute was
  validated and then ignored on REST, RPC, `/rpc/batch` and MCP. A procedure
  declaring it now runs, with its authorization, body, write-policy checks and
  output `@computed` resolvers, in one transaction at the declared level, retried
  on `40001` / `40P01` (3 retries, `with_isolation_max_retries(n)`). Its
  `ProcedureRegistry` method takes `db: &IsolatedCratestack` (no `pool()`,
  `events()`, `views()`, `queries()`); `invoke_with_db` takes
  `FnOnce(IsolatedCratestack, Authorized) -> Fut + Clone`. Exhausted retries are
  `409 TRANSACTION_ABORTED` / RPC `aborted` (new
  `CratestackError::TransactionAborted`), released from `Idempotency-Key`
  recording for the owning dispatch only; any other abort is a recorded 500.
  Refused with `@stream`, under `provider = "none"` and with `db = None`.
  Nested `@isolation` calls from a resolver join the attempt. Also breaking for
  code that never uses `@isolation`: `run_in_isolated_tx` retries only database
  errors, and the framework's own reads report Postgres errors as
  `DatabaseTyped`. See
  [cratestack-data-integrity](../../cratestack-data-integrity/SKILL.md) and the
  framework's `docs/design/procedure-isolation.md`.
- **Security, breaking: policy attributes the generator skipped are refused**
  (GHSA-69g4-xvcm-vm2j; advisory not yet published). Affected: procedure
  `@allow` / `@deny` / `@authorize` and model `@@allow` / `@@deny` from 0.2.0,
  view `@@allow` / `@@deny` from 0.4.2, `query` `@allow` / `@deny` from 0.11.0,
  all through 0.14.0. The generator applied a policy only in its exact spelling
  and silently skipped any other (`@deny (…)`, `@Deny(…)`, `@deyn(…)`,
  `@deny(…) // note`, `@deny(…);`, a second attribute on the line, an unknown
  action, an invisible character), while `check` said `schema OK`: a skipped
  deny or `@authorize` failed open. Now:
  - A trailing `//` comment is stripped, quote-aware, on every attribute line.
  - Procedure, query, model and view attributes are closed lists in one
    spelling.
  - Several attributes on one procedure or query line are each read.
  - A procedure's or query's attributes end at the first blank line and must be
    followed by one.
  - Invisible characters are refused in attribute text, and bidi controls and
    ESC anywhere.
  - The generator refuses (`compile_error!`) a policy it cannot read.
  - Same release, companion entry: `@server_only` is refused on `type` / `auth`
    / relation / relation-key / `@version` fields; `@readonly()`-style argument
    lists and run-on attributes are refused; `@rename` / `@@rename` accept only
    `from = "<old SQL name>"`, once, where the migrator reads them.

  **No error, different behaviour:** an attribute with a trailing comment now
  applies (an `@allow` / `@@allow` that was skipped now grants access), and an
  attribute written inside a field's comment no longer does. See
  [cratestack-schema](../../cratestack-schema/SKILL.md) ("Attribute traps"),
  [its attribute reference](../../cratestack-schema/references/attributes.md),
  [cratestack-policy-auth](../../cratestack-policy-auth/SKILL.md) and
  [cratestack-migrations](../../cratestack-migrations/SKILL.md).
- **`include_client_schema!` builds for `wasm32-unknown-unknown`**
  (cratestack#1104, merged in cratestack#1105). Affected: 0.14.0 and earlier,
  where `cratestack-sqlite` re-exported `client_rust` only off wasm32 and
  `cratestack-client-rust` did not compile there (its `tokio` edge inherited
  `rt-multi-thread`). Now the runtime, the facade's `client_rust` re-export and
  `cratestack-client` build for wasm32, with and without `middleware`, with
  reqwest on the browser's `fetch`. On that target `RuntimeHandle` is not
  available, `rustls` is not in the graph and `ensure_crypto_provider()` is a
  no-op. Native builds are unchanged. See
  [cratestack-embedded](../../cratestack-embedded/SKILL.md).

## 0.14.0 (2026-09-26)

0.14.0 is the release first published as 0.13.1. That version put breaking
changes into a patch release, which Cargo treats as compatible with 0.13.0, so
the 0.13 crates are yanked and 0.14.0 carries the same changes. A reader on
0.13.1 has everything below.

**Partial.** Only these entries have been checked against the 0.14.0 release. Skills
mark them *(since 0.14.0)*.

- **The COSE envelope layer** (cratestack#1006, ADR 0006), **breaking**: `EnvelopeLayer`
  opens signed requests and seals every response of the generated REST and
  RPC routers, behind the new `envelope` / `cose` features of `cratestack-pg`
  and `cratestack-api`, with a generated
  `cratestack_schema::axum::envelope_layer(envelope, policy, audience)`. See
  [cratestack-server](../../cratestack-server/SKILL.md). Also **breaking**: the
  AAD gains `bound_headers` (`Idempotency-Key`, `If-Match`; binding v1 is not
  frozen, cratestack#1082); `IdempotencyLayer`'s default fingerprint checks
  `VerifiedPrincipal` first (`princ:`; `with_legacy_principal_fingerprint()`
  for the deploy, see
  [cratestack-data-integrity](../../cratestack-data-integrity/SKILL.md));
  `cratestack-cose`'s `RequestNonce::random()` is gone
  (`cratestack_cose::random_request_nonce()`). The Rust client does not sign
  yet (cratestack#1007).
- **MCP follow-ups** (epic cratestack#1033; ADR 0002 F1, F2, F5). See
  [cratestack-mcp](../../cratestack-mcp/SKILL.md).
  - **Breaking:** `StdioServer::new` and `McpServer::new` refuse a context that is
    not authenticated with `Err(StdioConfigError::AnonymousContext)`, and return
    `StdioConfigError` instead of `ToolTableError` (cratestack#1084). On 0.13.0 they
    served an anonymous context as nobody.
  - The MCP idempotency namespace and rate-limit bucket hold a SHA-256 of the
    principal id (`mcp:<hex>` / `mcp-system:<hex>`), never the id itself
    (cratestack#1085). A caller's MCP and REST budgets stay separate. After
    upgrading from 0.13.0 with a shared store, MCP idempotency records written by
    0.13.0 no longer replay and MCP rate-limit buckets start fresh.
  - A legacy `initialize` below the HTTP guard fails closed with `-32603`, like
    every other method (cratestack#1087). Through the guard and over stdio it is
    still `-32022` with the supported-version list.
- **Field attributes are matched exactly**, **breaking** (cratestack#1074,
  cratestack#1086). Only a bare `@id` makes a field the primary key: `@identity`,
  `@idx` and `@id_foo` no longer do (a model keyed only by one of them now reports
  a missing `@id`, and `@idx` gets the "did you mean `@id`?" error). `@id(...)` is
  refused ("`@id` takes no arguments"), and a field may carry at most one
  `@relation`: a second one is refused where it used to be silently ignored. See
  [cratestack-schema](../../cratestack-schema/SKILL.md).
- **Fix:** `cratestack-rusqlite` 0.13.0 does not build for `wasm32-unknown-unknown`
  (`unresolved import sqlite_wasm_vfs::sahpool`, after the `sqlite-wasm-vfs` 0.3 bump,
  cratestack#1048). 0.14.0 stays on 0.3 with its `sahpool` feature and an adapter to
  the SQLite rusqlite links. A browser or OPFS build must skip 0.13.0; native builds
  were never affected, and existing OPFS databases keep working.

## 0.13.0 (2026-09-26)

**Partial.** Each entry here has been checked against the 0.13.0 release;
skills mark them *(since 0.13.0)*. The framework's 0.13.0 section lists more.

- **Fix, with a behaviour change:** generated clients honour `@api_version` on
  REST (cratestack/cratestack#1079). The server always mounted a versioned
  procedure at `/<version>/$procs/<name>`. Before 0.13.0 the Rust, TypeScript
  and Dart clients and WireMock stubs called `/$procs/<name>` (a 404), and the
  `ROUTE_TRANSPORTS` descriptor named that path too, so `@no_idempotency` /
  `@no_rate_limit` were ignored on a versioned REST procedure. All of them now
  share `cratestack_core::procedure_route::procedure_rest_route_path`. RPC op
  ids were never versioned and are unchanged. Regenerate clients and stubs
  after upgrading.
- **Security: `@server_only` is never sent by a `@computed` procedure output and
  is never a filter or sort key**
  ([GHSA-ch54-jqw2-vpp5](https://github.com/cratestack/cratestack/security/advisories/GHSA-ch54-jqw2-vpp5)).
  A procedure returning a model with a `@computed` field sent its `@server_only`
  fields (0.8.11–0.12.0). Any request could filter and sort by a `@server_only`
  field, through every operator, `where=`/`or=`, relation paths, RPC `list` and
  `FindMany` (0.2.0–0.12.0). Such keys are now refused as undeclared (400 / 422),
  `includeFields[..]` naming one is refused, and **breaking:** the generated
  `<M>Where` / `<M>SortField` (Rust, and the Dart client) lose the member. Rotate
  any credential such a field held; clear idempotency records stored before the
  upgrade. See [cratestack-server](../../cratestack-server/SKILL.md).
- **Security: relation filters and sorts apply the related model's read policy
  and `@@soft_delete`** (GHSA-p55v-6xv5-93p3; advisory not yet published).
  Affected 0.2.0–0.12.0, Postgres server role. A hidden related row now behaves
  as nonexistent (as in `?include=`), a sort key through it reads `NULL`, and
  self-relations correlate with the outer row — in relation filters and sorts
  and in read policies that traverse one. **Breaking:** a relation path through a
  model with no read `@@allow` matches nothing, and `FilterExpr::relation*`,
  `RelationFilter::new`, `RelationHop::new` and `OrderClause::relation_scalar`
  take a `RelatedReadScope` (`<M>_MODEL.related_read_scope()`, or the explicit
  `RelatedReadScope::Unscoped`). The embedded role is unchanged: its relation
  filters still ignore policy and soft delete. See
  [cratestack-server](../../cratestack-server/SKILL.md) and
  [cratestack-policy-auth](../../cratestack-policy-auth/SKILL.md).
- **Security:** a `@server_only` model field is never read from a request
  (#1051). A procedure argument that names a model, directly or through a
  `type`, used to decode a value the client sent for such a field and hand it to
  the implementation, because the field was `skip_serializing, default` and
  `default` only fills an absent key. It is now serde-`skip`ped: the
  implementation sees the field's default, and a wrong-typed value is ignored,
  not rejected. Create and update inputs never had the field and are unchanged.
- **The MCP operator** (ADR 0002, epic #1033): `mcp { name, expose }`, `@mcp(tool ...)`,
  `@@mcp(resource ...)`, the `mcp` feature on `cratestack-pg` / `cratestack-api`, and
  `cratestack-mcp`'s `StdioServer` / `StreamableHttpServer`. See
  [cratestack-mcp](../../cratestack-mcp/SKILL.md). **Breaking:** on 0.12.0 an
  `mcp { }` block parsed and did nothing; from 0.13.0 it is validated, and the
  embedded macro refuses it.
- **Breaking:** `DeviceKeyResolver` gains the required
  `lookup_device_verifying_keys_by_thumbprint`, and COSE enrolment moves from
  `cratestack_auth` to `cratestack_cose::auth` (behind the `auth` feature)
  (#1005). The new `cratestack-cose` crate (#1005, #1069) implements ADR 0006's
  unary COSE envelope. In 0.13.0 no router or client calls it; 0.14.0's
  `EnvelopeLayer` wires the routers (#1006, above), and the Rust client still
  does not sign (#1007).
- Optional scalars expose `eq` / `ne` / `in` query filters on generated list
  routes (#953). Before it, an optional field such as `verificationId String?`
  accepted `isNull` and string patterns but returned **HTTP 400** for
  `verificationId=value` — even though the typed Rust `Where` path already
  supported it. RPC `list` inherits the fix.
- Rate-limit admission moved into the L3 `OpExecutor` (ADR 0015 slice 2, #877),
  with no wire change. New `RateLimitLayer::with_op_resolver` takes resolvers from
  the `cratestack_axum::idempotency` builders, including `_with_prefix`, so `@no_rate_limit` finally works under
  `Router::nest`. The `build_*_ops_filter` predicates are unchanged and still cannot
  see through a nest.
- **Breaking:** `part` and `import` are **reserved identifiers** in every
  `.cstack` identifier position — declaration names, fields, enum variants,
  procedure and query parameters (#922). A schema using either word as a name
  stops parsing. The reservation is exact and case-sensitive (`of`, `Import`,
  `partOf` are unaffected), and `cratestack-lsp`'s rename now refuses them too.
  Reserved ahead of the multi-file grammar (`part` / `part of` / `import`,
  epic #910) so that landing it is not a migration.

## 0.12.0 (2026-09-06)

- `generate-typescript --rtk` — a generated RTK Query endpoint set, with
  invalidation tags **derived from the schema** by walking each procedure's args
  and return type.
- An **enum-typed field is now a filterable query-filter scalar**, not only
  sortable (#928).
- The Rust client's HTTP transport is **pluggable**, so retries and tracing no
  longer need a fork.
- A `@computed` field may be typed with a `type` block **on a model**, not only
  on a `type`.
- **Breaking:** `SchemaError` carries its own `file` and `source_text`, and
  `render()` **lost both arguments** (#916). Re-exported from `cratestack-pg`,
  `-api` and `-sqlite`, so a consumer calling `error.render(path, source)` gets a
  compile error. Drop both arguments; parse with `parse_schema_named` if you want
  the error to carry a path you know. `ANONYMOUS_SCHEMA` is exported so you can
  recognise the placeholder. `--format json` diagnostics gained a `file` key
  (purely additive).

## 0.11.1 (2026-09-03)

- **`@no_idempotency` works**, and idempotency admission moved into the new L3
  crate `cratestack-exec`. **Breaking.**
- **Breaking (#871):** the rate-limit bucket keyspace is bounded — the
  princ/auth/ip key scheme with the 128 and 8192 caps.
- Procedures and auth providers are documented as plain `async fn` in every
  example and in the trait docs.
- ADR 0015 accepted (amended): the L3 `OpExecutor` is being built in slices.
- Open VSX publishing went live for the VS Code extension.

## 0.11.0 (2026-09-03)

- **A `.cstack` schema can declare a parameterized custom SQL `query`** — the
  whole `query name(args): Type @@sql("…")` surface.
- **Breaking (#846):** rate-limit store failures fail open **only** for transport
  errors; every middleware error body is typed.
- The VS Code extension's display name became `CrateStack Schema`.
- `@cratestack/cbor-node` ships musl (Alpine) platform packages.

## 0.10.0 (2026-08-31)

- **PostGIS spatial columns are declarable** (#842) — `Geography` / `Geometry`
  and `extension postgis { }`.
- **`up.pre.sql` is a real mechanism** (#843) — before this, blocking migrations
  had no backfill hook.
- `@default(dbgenerated())` no longer drops the default it asserts exists (#843).
- `cratestack migrate diff` no longer panics on a `pgvector` schema.
- Generated client version ceilings follow the release line automatically.

## 0.9.1 (2026-08-29)

- **Read policies gained `in` / `not in` against a set of literals** (#666).
- **`Bytes` survives `transport rpc`** (#820, #806) — two independent defects,
  one symptom.
- **Breaking, `--template-dir` only:** TypeScript templates render under
  `UndefinedBehavior::Strict` (#774).
- Linux arm64 for the Dart CBOR codec corrected from "half open" to **blocked
  upstream**, both halves (#823).

## 0.8.15 (2026-08-28)

- **A misspelled field attribute is now a parse error, not a silent no-op**
  (#679). Before this, `@reedonly` reported `schema OK` and enforced nothing.
- **Breaking:** generated TypeScript clients type `Bytes` as `Uint8Array`
  (#783 follow-up), and `Bytes` fields round-trip a JS `Uint8Array` (#783).
- The parser rejects a schema name colliding with the generated client's own
  methods (#784 follow-up) and a procedure colliding with a model's generated
  CRUD handler (#784).
- Every generated dependency constraint is an API floor, not the workspace
  version (#779).
- `--tanstack` rejects a procedure hook colliding with a model hook (#802);
  `--swr` gained the same check in 0.8.14 (#777).

## 0.8.14 (2026-08-27)

- **`@@internal("action")` route suppression** — REST, RPC and every generated
  client (#743).
- **`@@unique` / `@@index` gained `where: "<sql predicate>"`** — partial index
  DDL. **Breaking for `cratestack-core` API consumers** (#742).
- **`ConflictTarget` can target a partial unique index** and the upsert conflict
  probe honours it. **Breaking for exhaustive external matches** (#741).
- **Breaking (#746): `@cratestack/cbor` became the default codec for generated
  TypeScript RPC clients.** This is the one that silently upgrades a regenerated
  package's wire format from JSON to CBOR and makes a JSON-only server answer
  406/415.
- **Breaking (#765):** `--swr` + `transport rpc` honours `native_cbor` too.
- `.upsert(..).run(..)` stopped reporting `Created` for an update it lost a race
  on (#745).
- Schema validation reports **every independent error**, not just the first.
- `.cstack` editor features: rename (F2), semantic tokens, enum/mixin
  go-to-definition, find-all-references, and no longer blinking off on every
  syntax error.
- **Documented:** Studio's `[target.db]` write path enforces no schema-declared
  write constraint (#744).
- Generated Dart builders moved to `package:cratestack_builder` — **breaking for
  build tooling** (#668).
- `CRATESTACK_REQUIRE_DB` now fails when *no* database backend is configured
  (#747).

## 0.8.12 (2026-08-24)

- **RPC `get` gained the selection surface REST already had** — this is where
  `RpcGetInput` came from. Before it, a `fields` key on an RPC get frame was
  **silently dropped by serde** and the server returned the full record, with no
  error and no signal.
- `<Model>ComputedParams` gained the standard builder.
- **The transport-parity convention was written down here** — REST and RPC ship
  together, never REST first — because the `@computed` params surface had shipped
  REST-only and took three follow-up PRs to close.
- A caveat recorded for Rust clients: adding a model's first parameterised
  computed field changes `get(id, headers)` into
  `get(id, computed_params, headers)` and **breaks call sites**.

## 0.8.11 (2026-08-24)

- **`@computed` — resolver-backed response-time fields, replacing `@custom`.**
  `@custom` is now a parse error pointing here.
- flutter_rust_bridge moved to **2.13.0** — breaking for consumers on 2.12.0, and
  the pin is install-blocking because pub treats a bare version as exact.

## Earlier, and worth knowing because removed things linger

- **0.8.5 removed protobuf/gRPC.** `transport grpc` is a parse error with a
  migration message, and `@pb` is rejected at field position. Documentation and
  blog posts describing a third transport are describing something that no longer
  exists — this one stayed documented as shipped for nine releases.
- **0.4.0 split the umbrella crate into facades.** `cratestack-client` (the pure
  HTTP-client SDK facade) was added later, by #490. Before the split there was a
  single `cratestack` crate; today `crates/cratestack` is an **empty
  documentation-only vitrine crate** and `-p cratestack` returns a false green.
- **#505 made the decimal backends additive.** Both `decimal-rust-decimal` and
  `decimal-bigdecimal` may now be selected in one build, and selecting *neither*
  is also fine (#521). Before that, both-selected was a hard `compile_error!` in
  `cratestack-core` — which was itself the defect #505 reports. Backend choice
  moved to a schema-authored `decimal = …` macro argument. Several places in the
  repo still give the old rationale for avoiding `--all-features`.
- **#523 made `unsafe_code = "forbid"` actually enforced** by requiring every
  workspace member to opt in, with `just verify-lints-optin` as the guard. Cargo
  silently ignores `[workspace.lints]` for a member that does not opt in, which
  is exactly the drift that found.

## Things that are declared but inert — check before assuming a version fixed it

As of 0.14.2, each of these parses, validates, and then does nothing:

- An unknown **field** attribute (`@whatever`, and `@Id` / `@ID`, which are not a
  primary key) still parses and does nothing; only near-misses are refused. An
  unknown `@@`, procedure or query attribute did the same through 0.14.0 and is
  refused since 0.14.1 *(GHSA-69g4-xvcm-vm2j)*.
- `@@retain(days: N)` — descriptor metadata; no GC job exists.
- `@from(Model.field)` on a view field — checked by nothing.
- `prefer_for` in `studio.toml` — parsed and never consulted.
- The per-frame `idem` field on `/rpc/batch` — decoded and never read.
- `@@id([a, b])` — parses, emits correct DDL, then every entry macro rejects it
  (issue #136).
- The five `batch_*` ORM primitives — complete, and reachable from no generated
  route.

**No longer inert since 0.14.1.** Three entries left this list in the same
release: `@isolation(level)` is now enforced (see [0.14.1](#0141-2026-09-27)
above, and [cratestack-data-integrity](../../cratestack-data-integrity/SKILL.md));
a policy attribute in any but its exact spelling — `@deny (…)`, `@Deny(…)`,
`@deny(…) // note`, `@@deny("read", …) // note`, a second attribute on the same
procedure line — is now refused by `cratestack check` instead of being skipped
by the generator and leaving the declaration more permissive than written (see
[cratestack-policy-auth](../../cratestack-policy-auth/SKILL.md)); and
`@server_only` on a `type` field, a relation field, a `@version` field or an
`auth` field, and any no-argument attribute written with `()`
(`@readonly()`, `@version()`), are refused rather than silently accepted.

If a future release wires up one of the entries still above, that is a
changelog entry to look for before believing this list.
