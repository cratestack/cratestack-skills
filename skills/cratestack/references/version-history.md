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

The latest release is **0.17.0** (tag `v0.17.0`, 2026-10-28). Its changes, 0.16.0's and
0.15.4's, are recorded below and marked *(since 0.17.0)* / *(since 0.16.0)* /
*(since 0.15.4)* where they are taught; the banners stay at 0.14.2 until every skill has been re-checked against the
latest release, as AGENTS.md requires.

## Reading order for an upgrade

The framework's own `CHANGELOG.md` is the authority and is unusually detailed —
entries explain the defect, not just the change. This file is a routing index
into it, not a replacement.

Going from 0.14.x or earlier to the latest release, read in this order, because
each step's breaking changes assume the one before:

1. [0.14.1](#0141-2026-09-27): the closed attribute lists and `@isolation`
   enforcement. A schema that was `schema OK` on 0.14.0 can fail `check`.
2. [0.15.0](#0150-2026-09-29) and [0.15.2](#0152-2026-09-30): the schema digest,
   and the signed transport's contract digest (a flag day for signed clients).
3. [0.15.4](#0154-2026-10-11): field attributes become a closed list too, validators
   on `type` fields start running, and `BigInt` exists. Re-run `cratestack check`
   first; every error it adds is an attribute that did nothing before.
4. [0.16.0](#0160-2026-10-23): `@default(autoincrement())` is refused, and the
   generated Dart client loses its four `*DioAdapter` classes (regenerate, then move
   to `CratestackHttpAdapter` / `CratestackRpcHttpAdapter`). A CBOR body with
   trailing bytes becomes a `400`.
5. [0.17.0](#0170-2026-10-28): `cratestack check` refuses a `@default(...)` function that is
   neither `now()`/`uuid()`/`cuid()` nor registered on the datasource, and a literal that does
   not fit its field (quote string defaults). On the embedded runtime the `Create*Input` gains
   `auth()` fields (required) and `dbgenerated()`/registered-function fields (`Option`).
6. [Unreleased on `main`](#unreleased-on-main-after-0170) only if you build `main`.

0.15.3 changed nothing over 0.15.2.

---

## Unreleased on `main`, after 0.17.0

Skills mark these *(unreleased, cratestack#NNN)*, or *(unreleased, GHSA-…)* for a
security fix merged from a private fork with no PR number. When 0.17.0 was recorded
here, framework `main` was the `v0.17.0` commit and its `## Unreleased` was empty; the
sync-engine entry below is in the tag's source but in no published crate.

- **Offline sync engine: prototype only** (cratestack PR #1205) *(unreleased, unpublished)*. The
  framework adds `cratestack-sync` with `publish = false`, and `examples/sync-notes`, behind
  ADR 0020, which is *Proposed*. The source is in the tags since `v0.16.0` and the 0.16.0 changelog
  lists it as a prototype, but `publish = false` keeps it off crates.io, so no release ships
  it: nothing installable exists. There is no `@@sync` attribute, and the crate's API is
  expected to change. Owner: `cratestack-embedded` (the "no supported sync engine" note). Agents
  must not depend on it.
- **`AuthRefusal`: an `AuthProvider` refusal shapes its response** (cratestack#1208)
  *(unreleased, cratestack#1208)*. A 401 or 403 with extra top-level envelope members (never
  `code`, `message` or `details`), `details`, and `WWW-Authenticate` challenges, sent the same way
  on REST, RPC unary and RPC batch. `CratestackErrorResponse` and `RpcErrorBody` gain a public
  `extra` map, and their struct literals need `extra: Default::default()`.
  `cratestack-client-rust`'s `ClientError::Remote { error }` becomes `Option<Box<_>>`. MCP and
  sync still render refusals their own way. Closes the #1208 known gap listed under 0.16.0.
  Owners: `cratestack-policy-auth`, `cratestack-clients`.
- **MCP credential presence is pluggable; MCP and sync render an `AuthRefusal`** (cratestack#1243)
  *(unreleased, cratestack#1243)*. `CredentialPresence` (`bearer` default, `provider_decides`,
  `when`, `with_credential_headers`) on `StreamableHttpServer::with_credential_presence`. The
  prototype sync endpoints gain a `forbidden` code and refusal members, and stop sending an error's
  internal detail. Owners: `cratestack-mcp`, `cratestack-policy-auth`.
- **`first_success` provider chain, `AuthProvider::credential`, `ask_provider`; the canonical
  request** (cratestack#1243) *(unreleased, cratestack#1243)*. `first_success(a).or(b)` composes
  providers (an absent credential skips a member, a refusal is never rescued); `AuthProvider` gains
  a defaulted `credential()` returning `Credential` (`Unknown` default, `Absent`, `Present
  { redact }`, `Malformed`); MCP gains `CredentialPresence::ask_provider()`. `RequestContext`
  documents the canonical request (no mount prefix), and sync passes its declared route as `path`.
  Owners: `cratestack-policy-auth`, `cratestack-mcp`.
- **The principal contract** (cratestack#1243, ADR 0021 §2) *(unreleased, cratestack#1243)*.
  Reserved claims with fixed types (`sub`, `roles`, `role`, `tenant.id`, `auth_time`, `amr`,
  `acr`, `cnf`, `key_role`, `exp`; not `id`), `CratestackContext::builder(sub)`, typed readers
  (`subject()`, `roles()`, …), `hasRole` over `roles` with `role` and `actor.role` read
  independently, `subject()` as the audit / MCP / sync "who", a checker error for a reserved name
  of another type in an `auth` block, and `cratestack-auth`'s `PrincipalMapper` (product shape
  plus `sub` / `roles` / `cnf` by default). Breaking: `principal_actor_id()` returns
  `Option<Cow<str>>`; `UserPrincipal` gains `bound_key_jkt`. Owners: `cratestack-policy-auth`,
  `cratestack-mcp`.
- **Every generated client types a refusal's members, `details` and challenges** (cratestack#1243)
  *(unreleased, cratestack#1243)*. On REST and RPC: Dart `RpcErrorBody.extra` (0.17.0 and earlier
  drop the members) and, on both exceptions, `headers`, `extra`, `challenges` (plus typed `code`,
  `message`, `details` on `CratestackRestException`); TypeScript `CratestackHttpError.body` /
  `code` / `details` / `extra` / `challenges` and `CratestackRpcError.extra` / `headers` /
  `challenges`; Rust `challenges: Challenges` on `ClientError::Remote` and `RpcRemoteError`, with
  `remote_error()`, `remote()` and `challenges()` accessors (a pattern listing every field without
  `..` needs one). Owner: `cratestack-clients`.
- **Every generated client types a step-up refusal as `StepUpRequired`** (cratestack#1244)
  *(unreleased, cratestack#1244)*. A 401 / RPC `unauthenticated` whose `error` member is
  `insufficient_user_authentication` reads as `StepUpRequired` (`max_age`, `acr_values`, `amr`,
  `unmet` from `details`): Rust `ClientError::step_up()` / `RpcClientError::step_up()` /
  `RpcRemoteError::step_up()` and `retry_after_step_up`; Dart `stepUp` on both exceptions and
  `retryAfterStepUp`; TypeScript `stepUp`, `stepUpOf` and `retryAfterStepUp`. Client side only:
  the server side that emits the refusal is a separate #1244 change. Owner: `cratestack-clients`.
- **`AuthProvider` conformance kit; `CoseSignerProvider`; the auth-library independence guard**
  (cratestack#1243) *(unreleased, cratestack#1243)*. New dev-dependency crate
  `cratestack-auth-conformance` (`auth_conformance(p).accepts(..).refuses(..).run()`) drives a
  provider through REST, RPC unary/batch and MCP. `CoseAuthProvider` is a first-success chain over
  the now-public `CoseSignerProvider`; it and `SignedRequestAuthProvider` pass the kit. A CI job
  keeps `authkestra*` out of the workspace graph.
  Owners: `cratestack-policy-auth`, `cratestack-server`.
- **Security: `@@subscribe` events pass the subscriber's read policy** (cratestack#1253)
  *(unreleased, cratestack#1253)*. `GET /rpc/subscribe/{op_id}` used to send every event of the
  model to any caller the `AuthProvider` admitted, anonymous included. Each event is now checked
  against the model's `detail`/`read` policies and dropped if the subscriber may not read it; a
  read policy over a `@server_only` column refuses the subscription at open (500); a policy that
  cannot be decided for one event ends the stream with `unavailable`. No schema change. Owners:
  `cratestack-rpc`, `cratestack-server`, `cratestack-policy-auth`.
- **Subscriptions open through one generated dispatcher; `extension webtransport`**
  (cratestack#1255) *(unreleased, cratestack#1255)*. A `@@subscribe` schema gets
  `db.subscriptions()`, a `SubscriptionDispatcher`. The SSE endpoint opens through it on the
  same wire, and `extension webtransport { }` plus the `webtransport` feature on `cratestack-pg`
  adds `db.subscriptions().webtransport(config, auth)`. `ExtensionKind` gains `Webtransport`.
  Owners: `cratestack-rpc`, `cratestack-server`, `cratestack-schema`.

- **`@authn` on procedures; RFC 9470 step-up** (cratestack#1244, ADR 0022) *(unreleased,
  cratestack#1244)*. `@authn(maxAge, amr, acr)` checked after `@allow` on every path; unmet is a
  401 with `error: "insufficient_user_authentication"`, `details` and a `Bearer` challenge.
  `cratestack-auth`'s id token and mappers carry `auth_time` and `amr` (plus `pop`); breaking:
  `IdTokenClaims` and `UserPrincipal` gain those fields. Owners: `cratestack-policy-auth`,
  `cratestack-schema`.

- **Examples: three auth providers through one suite; MCP with a non-bearer credential**
  (cratestack#1245) *(unreleased)*. `examples/auth-pluggable` (standalone workspace): in-house,
  Authkestra device signatures and Authkestra OIDC with DPoP, each one provider file, run through
  the conformance kit and the example's own policies; CI job `auth-pluggable` checks no framework
  crate reaches Authkestra. `examples/mcp-operator` uses `CredentialPresence::ask_provider()` and
  accepts `X-Agent-Token`. Owners: `cratestack-policy-auth`, `cratestack-mcp`.

## 0.17.0 (2026-10-28)

0.17.0 carries two breaking changes, both to `@default(...)`: function defaults must be
cratestack's own or registered (cratestack#1209), and literal defaults are typed, with every
default working on the embedded runtime (cratestack#1234). It also ships ordinal enums with
enum-aware `cratestack diff` and `migrate diff`, and standalone COSE claim objects
(`v0.16.0..v0.17.0`). Skills mark these *(since 0.17.0)*.

- **Breaking: literal `@default`s are typed, and every default works on embedded**
  (cratestack#1234) *(since 0.17.0)*. On the embedded runtime every `@default` but
  `now()`/`uuid()`/`cuid()` used to be written as NULL, failing the create. Now literals are
  bound by the runtime (and written as `DEFAULT` by `create_table_sql`); an `auth()` field stays
  in the embedded `Create*Input` as required, a `dbgenerated()` or registered-function field as
  an `Option`, and a required one left NULL is refused with `RusqliteError::UnfilledDefault`.
  `check` refuses a literal that does not fit its field (an unquoted word on a `String`,
  `CURRENT_TIMESTAMP`, `null`, literals on `Json`/`Bytes`/lists), and migrations write strings
  single-quoted where `@default("x")` used to become `DEFAULT "x"`. Owners: `cratestack-schema`,
  `cratestack-embedded`, `cratestack-migrations`.
- **Standalone signed claim objects in `cratestack-cose`** (cratestack#1231) *(since 0.17.0)*.
  Additive: `cratestack_cose::claims` (re-exported at the crate root) has `sign_claims` /
  `open_claims`, `CwtClaims`, `OpenedClaims`, `ClaimsError` and `MAX_AUD_LEN` / `MAX_TYP_LEN` /
  `MAX_CTI_LEN`. A tag-18 `COSE_Sign1` with a mandatory `typ` and optional CWT claims
  (`aud`, `exp`, `iat`, `cti`), for a payload signed offline and delivered later. **No
  freshness window and no nonce store**: the caller enforces `exp`, `aud` and `cti`. It is
  domain-separated from the transport envelope, which is unchanged. Ed25519 and ESP256 only.
  Owners: `cratestack-server` (the API), with a row in `cratestack-troubleshooting` and a
  limit in `cratestack-clients`.
- **Breaking: `@default` function calls must be `now()`, `uuid()`, `cuid()` or registered**
  (cratestack#1209, PR #1211) *(since 0.17.0)*. `migrate diff` wrote any `@default(fn())` into `DEFAULT`
  verbatim: `uuid()` and `cuid()` do not exist in Postgres, SQLite rejected every unparenthesised
  function default (`now()` included), and `@default(auth().id)` became `DEFAULT auth().id`.
  On the embedded runtime any `@default` column was written as NULL. Now `now()`, `uuid()` and
  `cuid()` are cratestack's own, generated in Rust on create by both runtimes, with the matching
  database default emitted where one exists (`now()`, `gen_random_uuid()`; none for `cuid()`);
  a database function is registered with `datasource db { functions = ["my_fn"] }` and written
  verbatim; `check` refuses anything else. Migrate: `gen_random_uuid()` → `uuid()`,
  `cs_cuid()` → `cuid()`, other functions → register them. Owners: `cratestack-schema`,
  `cratestack-migrations`.
- **`migrate diff`: removing an enum value is Blocking** (enum ordinals slice 3) *(since 0.17.0)*.
  An enum `CHECK` rebuilt without a value it had (a variant removed, an ordinal retired) used to be
  classified Safe and failed at apply time on rows holding it; now `up.sql` warns and `up.pre.sql`
  is scaffolded with the `UPDATE … WHERE col IN (…)` backfill. String enums too. Owner:
  `cratestack-migrations`.
- **Ordinal enums ship: `Pending = 1` is stored and sent as its number** (enum ordinals slices
  3–6) *(since 0.17.0)*. Postgres `SMALLINT` + numeric `CHECK`, `@default(V)` → `DEFAULT n`; SQLite
  the integer; CBOR/JSON bodies the number on REST and RPC, the server accepting the name too;
  names stay in query strings (`?status=2` is a 400), policy literals and `@default`. Clients:
  Rust `#[repr(i16)]`, TypeScript keeps its name union (responses revived, requests send names),
  Dart adds `int wireValue`; WireMock, Studio, JSON Schema/MCP and LSP hover follow. New refusals:
  an `auth` field of an ordinal enum type (`check`); renumbering, unreserved removal, dropping or
  reusing a `@@reserved` number (`migrate diff`). Converting an existing enum emits the data
  migration (Postgres `USING (CASE …)`, lossy; SQLite `UPDATE`). Owners: `cratestack-schema`,
  `cratestack-migrations`, `cratestack-clients`.
- **`cratestack diff` reports enum changes** (enum ordinals slice 2) *(since 0.17.0)*. It ignored
  enums entirely, so removing or renaming a variant reported "no structural changes" and exited
  0. Now: an enum or variant removed is breaking; a variant added is breaking if a response can
  carry the enum (models, views, procedure and query results, transitively), additive if only
  requests do; a reorder is internal; categories `enum_removed`, `enum_added`,
  `enum_variant_removed`, `enum_variant_added`, `enum_variants_reordered`, plus
  `enum_variant_renamed` and `enum_encoding_changed` for ordinal enums. Owner: `cratestack-cli`.
- **Enum bodies parse explicit ordinals** (cratestack#1229) *(since 0.17.0)*. Slice 1 of
  `docs/design/enum-ordinals.md`: `Pending = 1` and one `@@reserved(n, …)` line are read and
  checked (all-or-none, 0 to 32767, unique, a reserved number unused). Slice 1 alone refused a
  well-formed ordinal enum; the entry above lifts that, so 0.17.0 generates them. Also: a trailing
  `//` comment on a variant line is now a comment, and a line starting with `@` other than
  `@@reserved(..)` is refused rather than read as a variant name. Owner: `cratestack-schema`.
## 0.16.0 (2026-10-23)

0.16.0 carries two breaking changes (the Dart transport seam, the `autoincrement()`
refusal) and the fixes merged after 0.15.4 (`v0.15.4..v0.16.0`). It is **not** the rest
of ADR 0019: the 32-bit `Int` cutover, the
`cratestack upgrade int-to-bigint` codemod and snapshot format 3 are not in the tag
(`SNAPSHOT_FORMAT_VERSION` is still `2`), so `Int` is still an `i64`. Skills mark these
*(since 0.16.0)*.

- **Breaking: the generated Dart client sends through an HTTP transport seam; the four
  `*DioAdapter` classes are removed** (cratestack#1204, PR #1206) *(since 0.16.0)*. Every
  generated `runtime.dart` (all presets, REST and RPC) declares `CratestackHttpTransport`; one
  adapter per protocol, `CratestackHttpAdapter` (REST) and `CratestackRpcHttpAdapter` (RPC),
  takes `baseUri` and `format` (`CratestackWireFormat.cbor` default, `.json`). Dio is
  `CratestackDioTransport(dio)`. `CratestackDioAdapter`, `CratestackCborDioAdapter`,
  `CratestackRpcDioAdapter` and `CratestackRpcCborDioAdapter` are deleted with no aliases;
  `dio.options.baseUrl` is replaced by `baseUri`. Errors: new `CratestackRestException`
  (REST used to leak a `DioException`), `CratestackRpcException` unchanged, and a sealed
  `CratestackTransportException` (`Aborted`, `Unsent`, `TimedOut`, `Broken`) for a call with no
  answer. Call options gain `abort` (both) and `idempotencyKey` (REST). RPC `stream()` no
  longer buffers. A canonical query encoder replaces Dio's: a `null` query value is omitted
  instead of sent as a bare key. The wire is otherwise unchanged. Owner: `cratestack-clients`
  (`references/dart-transport.md`), with the exception rows in `cratestack-troubleshooting`
  and the Dart client note in `cratestack-rpc`.
- **`generate-dart --preset fespalier`, `--fespalier-ref`** (cratestack#1204, PR #1206)
  *(since 0.16.0)*. The `riverpod` preset sending through fespalier's `HttpTransport`
  (`package:fespalier_transport`, a git dependency) with no `dio`: `CratestackFespalierTransport`,
  `<prefix>TransportProvider` and `<prefix>BaseUriProvider` the app overrides, abort merged with
  fespalier's `TransportZone`. `--fespalier-ref` (default `v0.21.0`) is an error with any other
  preset. Known gaps, both open: call options cannot carry transport attributes
  (cratestack#1207) and an `AuthProvider` refusal cannot shape its body (cratestack#1208).
  Owners: `cratestack-clients`, `cratestack-cli`, with the #1208 limit in
  `cratestack-policy-auth`.
- **Breaking: `@default(autoincrement())` is refused, pointing at `@default(dbgenerated())`**
  (cratestack#1128, PR #1167) *(since 0.16.0)*. The parser accepted it and `migrate diff` wrote
  `DEFAULT autoincrement()` into `up.sql`, DDL neither Postgres nor SQLite has, labelled
  `(safe)`; it failed at apply time, one step after `schema OK`. `cratestack check` now
  refuses the spelling (any case, any spacing, any argument form, and the bare word) at the
  field. `@default(dbgenerated())` is the marker for a value the database generates (a
  sequence, an identity column, a trigger, hand-written migration SQL), and cratestack emits
  none of those itself: create the sequence or identity in hand-authored migration SQL.
  `dbgenerated()` must also be the whole default expression, so
  `@default(dbgenerated() || 'x')`, `@default(dbgenerated()::text)` and an unclosed
  `dbgenerated(` are refused where they used to drop the rest of the expression from the
  migration, and a spaced `dbgenerated ("x")`, which used to slip past the argument check
  and emit a broken `DEFAULT dbgenerated (...)` clause, is refused too. A pre-existing snapshot holding
  `Function("autoincrement()")` is read as `DbGenerated`. Owner: `cratestack-migrations`,
  `cratestack-schema`.
- **A COSE-verified signer authenticates through the service and device registries**
  (cratestack#1077, PR #1188) *(since 0.16.0)*. `cratestack_cose::auth::CoseAuthProvider` wraps
  the header `AuthProvider`, so a signed client with no `Authorization` header can satisfy
  `auth() != null`. It matches the verified signer by full thumbprint against the service
  registry (`with_service_keys`) and, only after `.authenticate_devices(true)` (off by default),
  the device registry. The principal is `cose:<thumbprint>` with `kind` `service` or `device`.
  Turning devices on makes any enrolled device key an authenticated caller, with no user.
  `with_service_keys` must hold service keys only (a device key there authenticates as a
  service whatever the gate), and a failing service registry is a `500`, not a miss.
  Owners: `cratestack-server` (wiring, the gate), with the anonymous-device row in
  `cratestack-troubleshooting` and the `auth()` note in `cratestack-policy-auth`.
- **A validator CHECK on a table the same migration creates is Safe** (cratestack#1129,
  PR #1188) *(since 0.16.0)*. `migrate diff` classed it Blocking, so the first migration of any
  `@db_enforce` schema printed "blocks on existing data", wrote a comment-only
  `up.pre.sql`, and put a WARNING in `up.sql`, though the table has no rows to reject.
  Now it is `safe`, with no scaffold and no WARNING. A CHECK added to an existing table
  is still Blocking. `migrate baseline`'s drift report follows the same rule. No change to
  the generated DDL. Owner: `cratestack-migrations`.
- **The Redis nonce store keeps one managed connection, and recovers without a restart**
  (cratestack#1070, PR #1188) *(since 0.16.0)*. It used to open a connection per claim. Now a claim shares
  one connection, and any failure other than a server reply (I/O error, timeout, dropped
  connection, failed re-authentication after a password change) discards it, so the next
  claim reconnects. A `SET` that times out answers `NonceStoreUnavailable`, never
  `NonceReused`. The known limitation recorded with #1005 (a connection per claim) no
  longer applies. Owner: `cratestack-policy-auth`.
- **Generated procedure and route spans no longer leak across `.await`** (cratestack#1081,
  PR #1188) *(since 0.16.0)*. The generated `invoke`, `invoke_with_db`, and the procedure and model list
  route handlers held a span guard across every `.await`, so an unrelated task polled on
  the same thread could see that span as its own. The body is now attached with
  `Instrument::instrument`. Bug fix only: span names, fields and events are unchanged, and
  no public API moves. Owner: `cratestack-server`.
- **`cratestack check` locates an error after non-ASCII text** (cratestack#1157,
  PR #1187) *(since 0.16.0)*. A schema error's byte offset was handed to a code frame that counts
  characters, so a multi-byte character before the error dropped the location and
  snippet, or pointed up to dozens of lines away. The renderer now converts the span
  once, in `SchemaError::render`; ASCII-only schemas and the JSON output are unchanged.
  Owner: `cratestack-cli`, with the macro-error path in `cratestack-troubleshooting`.
- **CBOR bodies with bytes after the first item are refused with 400** (cratestack#1153,
  PR #1187) *(since 0.16.0)*. `CborCodec::decode` now errors unless the value consumes the whole body, as
  `JsonCodec` already did for trailing characters, so a request that relied on prefix
  decoding gets `CODEC_ERROR` (REST) or `invalid_argument` (RPC) where it got a 200.
  `application/cbor-seq` is unaffected. Owners: `cratestack-server`, `cratestack-clients`,
  with the row in `cratestack-troubleshooting`.
- **`generate-typescript --swr` hooks import `<Model>ComputedParams`** (cratestack#1154,
  PR #1187) *(since 0.16.0)*. A model with a parameterized `@computed` field failed `tsc` with TS2304 in
  `<model>.hooks.ts`; the hooks file now imports the type on REST and RPC, only when a
  hook uses it. Owner: `cratestack-clients`.
- **A generated TypeScript client revives each element of a `Decimal[]` field**
  (cratestack#1155, PR #1187) *(since 0.16.0)*. A `Decimal[]` on a model or `type` came back as strings
  while its type said `Decimal[]`, so `.plus()` threw; a bare `Decimal[]` procedure
  return was already revived. Generated code only, no wire change. Owner:
  `cratestack-clients`.
- **CI: every example pnpm lockfile root pins `packageManager`** (cratestack#1060, PR #1188)
  *(since 0.16.0)*. `just verify-pnpm-pins` now requires a pin in every tracked
  `pnpm-lock.yaml` root. Framework-repository CI only; no user-facing surface.

## 0.15.4 (2026-10-11)

0.15.4 is the first half of ADR 0019: the closed field-attribute lists and the `BigInt`
scalar. The changelog and ADR 0019 say the ADR "ships as 0.16.0", but these entries are
in the 0.15.4 tag (`v0.15.3..v0.15.4`, tagged 2026-10-11), and the released 0.16.0 did not
bring the rest: the 32-bit `Int` cutover, the `cratestack upgrade int-to-bigint` codemod
and snapshot format 3 are in **neither** tag, so `Int` is still an `i64`, still `BIGINT`,
still a JSON number. Skills mark it *(since 0.15.4)*.

- **Breaking: a field accepts only the attributes its declaration kind lists** (ADR 0019 D5,
  cratestack#679) *(since 0.15.4)*. Field attributes were the last open position: through
  0.15.3 an unknown name (`@immutable`, `@string`, `@wire(string)`, `@Id`) parsed, reported
  `schema OK` and did nothing, and only a near-miss typo of a known name was refused. Now any
  other name, case or typo is an error naming the attribute, the kind and the accepted list
  (with "did you mean"). The lists: `model` takes `@id`, `@unique`, `@default(…)`,
  `@relation(…)`, `@computed`, `@readonly`, `@server_only`, `@version`, `@pii`, `@sensitive`,
  `@db_enforce`, `@email`, `@uri`, `@iso4217`, `@length(…)`, `@range(…)`, `@regex(…)`,
  `@rename(from = "…")`; `view` takes `@id`, `@server_only`, `@from(Model.field)`; `mixin`
  takes a model's list minus `@id` and `@computed`; `type` takes `@computed`, `@length`,
  `@range`, `@regex`, `@email`, `@uri`, `@iso4217`; `auth` takes **none**. Each name is
  shape-checked too: no-argument names refuse an argument list, `@default` / `@relation` /
  `@length` / `@range` / `@regex` / `@rename` refuse a missing or empty one, and text after
  an attribute or a run-on second attribute is refused. Names that were inert on a kind are
  now refused there: on a `view` field every validator, `@unique`, `@default`, `@relation`,
  `@readonly`, `@version`, `@pii`, `@sensitive`, `@db_enforce`; on a `type` field `@id`,
  `@unique`, `@relation`, `@readonly`, `@version`, `@pii`, `@sensitive`, `@db_enforce`,
  `@default`, `@from`, and any validator on a **list** field (`tags String[] @length(max: 3)`;
  declare a `type` whose field carries it and take `Tag[]`); on an `auth` field every
  attribute; on a `model` or `mixin` field `@from`. A bare `@default` / `@default()` and a
  bare `@relation` on a scalar are refused (both were inert). `@allow`, `@deny`, `@pb` and
  `@custom` keep their own messages. `@db_enforce` with none of `@range` / `@length` /
  `@iso4217` on the same field is refused (it emitted no `CHECK`), and `@from(Model.field)`
  on a view field must name a real model and field (still read by no generator). Do not
  swap a newly refused attribute for the nearest accepted name unless you want that
  behaviour (`@immutable` meant `@readonly`). `cratestack-lsp` completions read the same
  lists. Owners: `cratestack-schema`, `cratestack-troubleshooting`.
- **Breaking: validators on a `type` or `model` field run on everything a client sends**
  (ADR 0019 D5) *(since 0.15.4)*. `@length` on a `type` field used to validate nothing, and
  now `type` fields take the whole family (`@length`, `@range`, `@regex`, `@email`, `@uri`,
  `@iso4217`). The generated `validate` runs as the first statement of every procedure's
  `authorize`, `authorize_with_db`, `invoke` and `invoke_with_db`, before `@allow`, on every
  argument that is or holds such a `type` or a `model` (direct, in a list, optional, nested):
  REST, RPC unary and batch, MCP and a worker agree. A `model` passed as an argument runs its
  stored fields' validators as `POST` does; `?computedParams=` is validated before any
  database read. A request that used to pass with an invalid argument now answers `422`
  `VALIDATION_ERROR` (REST) / `invalid_argument` (RPC), the message naming the path in the
  body (`args.owner.tags[1].label`) and never the value. New public `cratestack::ValidateFields`
  and `FieldPath`; `ProcedureArgs::validate_fields()`. A validator on a `type` that no client
  input reaches (one only returned) is refused by `check`. Return values are not validated,
  and generated clients do not validate before sending. Owners: `cratestack-schema`,
  `cratestack-troubleshooting` (a `422` on a procedure that used to accept the call).
- **`BigInt`: an exact 64-bit integer on every codec and client** (ADR 0019 D2, D3)
  *(since 0.15.4)*. A built-in scalar beside `Int`, valid wherever `Int` is. The reason: a JSON
  number past 2^53 is rounded by every JavaScript and dart2js consumer without an error. On
  the wire it is a **canonical decimal string** on JSON and CBOR alike (never a number, never
  a CBOR integer or bignum); a JSON number, a CBOR integer, `+5`, `007`, `-0`, `" 1"` or a
  value outside `i64` is refused on a body, a query filter and `?computedParams=`. Rust
  `cratestack::BigInt` is a `Copy` newtype over `i64` with `checked_*` methods and no
  operator impls. SQL `BIGINT`. TypeScript `bigint` with strict revival (a number or
  non-canonical string at a `BigInt` key throws `TypeError`); Dart `dart:core`'s `BigInt`
  (RPC `get`/`update`/`delete` send the key as a string). A user type named `BigInt` is now a
  duplicate-name error. Codec decode errors now name the field in `detail()` for every type.
  Policies fail closed: `!=` / `not in` pass only on a **decided** difference, so
  `auth().tenantId != 7` with a `"7"` claim now denies instead of passing, and a string claim in
  a numeric comparison denies (a pushed-down string claim renders as `$N::text`). Other
  changes for a schema with no `BigInt`: the RTK floor for `--rtk` is `^2.2.7`; `SqlValue`
  gains `BigInt` / `NullBigInt` and `CreateDefaultType` gains `BigInt`, so an exhaustive
  `match` outside the repo needs an arm; a generated TypeScript REST body no longer turns a
  `Decimal` into an object. Regenerate every client and rebuild every server together. Known
  and not fixed here: `Int` -> `BigInt` in `migrate diff` emits a no-op `ALTER COLUMN ... TYPE
  BIGINT` classed `Lossy`. Owners: `cratestack-schema` (the type), `cratestack-clients`
  (wire form, revival), `cratestack-policy-auth` (the three-valued comparison),
  `cratestack-troubleshooting`.
- **Negotiated payload types inside a seal; `seal_call`; `ExternalSigner::ed25519`**
  (cratestack#1168, PR #1169) *(since 0.15.4)*. Additive: the payload inside a COSE envelope may be
  JSON or form-urlencoded as well as CBOR, selected by the unbound
  `Cratestack-Payload-Type` / `Cratestack-Payload-Accept` headers and bound in the
  AAD; absent means CBOR, byte-identical to 0.15.3. New layer refusals `415
  payload_type_unsupported` / `406 payload_type_not_acceptable`; new client
  `EnvelopeError::UnexpectedPayloadType`; public `ClientEnvelope::seal_call` /
  `PendingResponse::open`; `ExternalSigner::ed25519`. Owners: `cratestack-server`,
  `cratestack-clients`, with the 415/406 rows in `cratestack-troubleshooting`.
- **`cratestack_cose::RegistryVerifierResolver`** (cratestack#1149, PR #1150)
  *(since 0.15.4)*. Additive: a runtime-mutable `CoseVerifierResolver` (`register` / `revoke` /
  `revoke_key`, optional `with_max_keys` bound) for keys enrolled after the
  server starts. Owner: `cratestack-server` (signed transport), with the 401
  note in `cratestack-troubleshooting`.
- **The facades re-export `CborCodec` and `JsonCodec` at the crate root**
  (cratestack#1147, PR #1148)
  *(since 0.15.4)*. Additive: `cratestack-api`, `-pg`, `-sqlite` and
  `-client` expose `cratestack::CborCodec` (and `JsonCodec` behind the default
  `codec-json` feature), the same types as `cratestack::client_rust::CborCodec`,
  so a `db = None` server no longer needs `cratestack-codec-cbor` as a direct
  dependency to build `envelope_layer`, `rpc_router` or a client.
- **Dart and Flutter clients can seal and open COSE** (cratestack#1151, #1026)
  *(since 0.15.4)*. Additive: `package:cratestack_cbor/cose.dart` (`ClientEnvelope`, `CallBinding`,
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

As of 0.14.2, each of these parses, validates, and then does nothing (re-checked for 0.15.4's field-attribute change, and against the `v0.15.4..v0.16.0` diff, which touches none of them):

- `@from(Model.field)` on a view field: since 0.15.4 its shape and target are
  checked (a real model and field), but no generator reads it, so it still changes
  nothing. (An unknown **field** attribute stopped being inert in 0.15.4; see below.)
- `@@retain(days: N)` — descriptor metadata; no GC job exists.
- `prefer_for` in `studio.toml` — parsed and never consulted.
- The per-frame `idem` field on `/rpc/batch` — decoded and never read.
- `@@id([a, b])` — parses, emits correct DDL, then every entry macro rejects it
  (issue #136).
- The five `batch_*` ORM primitives — complete, and reachable from no generated
  route.

**No longer inert since 0.15.4.** An unknown or wrong-kind **field** attribute
(`@whatever`, `@Id` / `@ID`, `@immutable`, `@string`, `@unique` on a `view` field,
anything on an `auth` field, a validator on a list field) is refused by `check`
against the closed list for its declaration kind. A validator on a `type` field is now enforced on procedure
arguments, and `@default`, `@db_enforce` and a bare `@default` / `@relation` on the
kinds that ignored them are refused. See [0.15.4](#0154-2026-10-11).

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
