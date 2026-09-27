---
name: cratestack-data-integrity
description: CrateStack's data-integrity surface — idempotency keys, rate limiting, optimistic locking with @version and If-Match, @@audit logging and redaction, @@soft_delete, upsert and conflict targets, batch operations, @isolation, trusted-proxy client IP, @@paged, composite keys, computed fields and multi-tenancy. Load for money-path or compliance-shaped work, or when a question mentions Idempotency-Key, 412, ETag, tombstones, DO UPDATE, audit redaction, X-RateLimit headers, tenant scoping, serializable transactions, IsolatedCratestack, or 409 TRANSACTION_ABORTED.
---

# Data integrity

> **Verified against CrateStack 0.14.1.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

CrateStack calls this "banking readiness". Most of it is real and test-backed.
Some of it is declared-but-inert, and the difference is the single most important
thing on this page.

## Three tiers — know which one a feature is in

**Wired and enforced.** Idempotency, rate limiting, optimistic locking, audit,
soft delete, pagination, size bounds, trusted proxy, computed fields.

**Shipped but not wired to any route.** The five `batch_*` ORM primitives
(`batch_get`, `batch_create`, `batch_update`, `batch_delete`, `batch_upsert`) are
complete — per-item expected version, per-item policy, savepoint isolation, a
designed response envelope — and are referenced **nowhere** in the codegen. They
are callable only from hand-written Rust inside a procedure. The only batch
*endpoint* that exists is `POST /rpc/batch`. Composite `@@id([...])` similarly
parses and emits correct DDL, then is rejected by every entry macro.

**Validated and then discarded.** `@@retain(days: N)` lands on the descriptor and
**nothing ever reads it** — there is no GC job. `@isolation("serializable")` was
in this tier on **every release through 0.14.0**: every procedure
ran at the server default, so call `run_in_isolated_tx` by hand. It is enforced
since 0.14.1 *(GHSA-r67q-4qqq-g9gm)*, with a different handle type; see
"Transaction isolation" below.

## Idempotency

`@no_idempotency` *(actually enforced since 0.11.1, when admission moved into the
L3 `cratestack-exec` crate)* is a bare procedure attribute (`@no_idempotency(false)` is
rejected — it would read as re-enabling while doing the opposite). A `procedure`
(query kind) is idempotent by default; a `mutation procedure` is not. Model
reads are idempotent, model writes are not.

Wire behaviour, with `IdempotencyLayer` installed:

| Situation | Response |
| --- | --- |
| Replay (same key, same body hash) | Original status and every original header except `Date`, `Content-Length`, `Connection` and `Transfer-Encoding`, plus `Idempotency-Replayed: true` |
| Same key, different body | **422**, code `VALIDATION_ERROR`, message starting `idempotency_key_conflict` |
| Reservation still in flight | **409** (`CONFLICT`) plus `Retry-After: 1` |
| Body over 2 MiB with a key | **400** (not 413 — two source comments say 413 and are wrong) |
| No `VerifiedPrincipal`, no `Authorization` and no `ConnectInfo` | **412** |
| An `@isolation` procedure's own `409 TRANSACTION_ABORTED` *(since 0.14.1)* | **not recorded**: the key is released, so the same key runs the call again |

The fingerprint is SHA-256 over `method \0 path_and_query \0 content_type \0 body`.
**The query string is included on purpose** — `POST /transfer?dry_run=true` must
not collide with `?dry_run=false`.

Only `POST`, `PATCH`, `PUT`, `DELETE` reach the logic. Keys must be ASCII,
non-empty, and at most 255 characters.

Three traps:

1. **The default principal fingerprint fails closed.** It hashes `Authorization`,
   falls back to the `ConnectInfo` peer IP, and **412s if it has neither**. No
   example in the repo serves via `into_make_service_with_connect_info`, so a
   cookie- or mTLS-authenticated deployment 412s every request until you supply
   `.with_principal_fingerprint(...)`.
   *(since 0.14.0, cratestack#1006)* A `VerifiedPrincipal` request extension now
   comes **first**, keyed `princ:<sha256 hex>` (the rate limiter already did
   this); the COSE envelope layer inserts one for every signed request, so a
   COSE-only client is no longer 412'd. See "Upgrading past cratestack#1006"
   below.
2. **A nested router needs `build_rest_op_resolver_with_prefix` /
   `build_rpc_op_resolver_with_prefix`.** Otherwise every lookup misses and
   `@no_idempotency` silently does nothing.
3. **The exemption is wider than the attribute.** Installing a resolver exempts
   everything flagged idempotent-by-default, which includes every read op. Under
   `transport rpc` reads arrive as `POST /rpc/{op_id}` and really do reach the
   layer. Nothing stops a query `procedure` from writing — if one does, the
   resolver has just removed its protection.

Store contract worth knowing if you implement one: `reserve_or_fetch` must be
concurrent-safe (two simultaneous callers see exactly one `Reserved`), and
reclaiming an expired row **must rotate the reservation token**. `complete`
freezes the outcome — a 5xx replays as the same 5xx until a fresh key is used.

### Upgrading past cratestack#1006 *(since 0.14.0)*

The default order is now `VerifiedPrincipal` → `Authorization` → `ConnectInfo`
→ 412. **Breaking** for an app that already inserts `VerifiedPrincipal` in
front of `IdempotencyLayer` (its own middleware, or the envelope layer): it
moves to the `princ:` namespace, so a key whose first attempt landed before the
deploy and whose retry lands after it **runs again**. Keep the old namespace
for the deploy, and drop the call once the idempotency TTL has passed:

```rust
let idempotency = IdempotencyLayer::new(store, ttl).with_legacy_principal_fingerprint();
// or, inside your own fingerprint fn (returns Result<String, CratestackError>):
// cratestack::idempotency::legacy_principal_fingerprint(&request)
```

Custom `.with_principal_fingerprint(..)` functions are unaffected.

### Idempotency under the envelope layer *(since 0.14.0, cratestack#1006)*

With `EnvelopeLayer` as the router's last `.layer(..)` (see `cratestack-server`),
this layer sees the **opened** request, so the body hash covers the CBOR
payload, not the COSE bytes. A client that re-seals a retry (fresh `cti`, same
payload, same `Idempotency-Key`) gets the stored response, sealed afresh for
the new request. The signature binds `Idempotency-Key` **exactly as sent**
(untrimmed), so:

- the client must include the key in what it signs, or the call is the
  envelope's unsigned **401**;
- a proxy that strips or alters the key breaks the signature (**401**), instead
  of turning a replay into a second execution;
- sending `Idempotency-Key` (or `If-Match`) **twice** is an unsigned **400**
  before anything is verified.

## Rate limiting

`@no_rate_limit` is bare and **requires `extension rate_limit { }`** in the
schema. Token bucket: `RateLimitConfig::new(burst, refill_per_second)`.

Allowed responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`. A 429
carries `Retry-After` and **no budget headers**. There is **no
`X-RateLimit-Reset`** anywhere.

Store-failure policy is deliberately asymmetric: a **transport-class** failure
(Redis connection dropped) fails **open** with a warning, because nobody caused
it and it self-heals. A store that is **reachable and refusing** (Redis `OOM`,
which any unauthenticated caller can induce) fails **closed under every policy**.
`with_store_error_policy(StoreErrorPolicy::Deny)` makes even transport failures
refuse.

Bucket cardinality is bounded atomically in the store, not in the layer
*(since 0.11.1, breaking — #871)*:

| Request carries | Bucket key | Scope | Cap | Fallback |
| --- | --- | --- | --- | --- |
| `VerifiedPrincipal` extension | `princ:<sha>` | — | none | — |
| `Authorization` + `ConnectInfo` | `auth:<sha>` | `peer:<addr>` | 128 | `ip:<addr>` |
| `Authorization` only | `auth:<sha>` | `global` | 8192 | `overflow` |
| `ConnectInfo` only | `ip:<addr>` | — | none | — |
| neither | **refused, 412** | | | |

*(since 0.14.0, cratestack#1006)* The COSE envelope layer is what produces a
`VerifiedPrincipal` for signed traffic (`cose:<hex thumbprint>` by default,
`ThumbprintPrincipal::with_prefix(..)` or a custom `PrincipalMapper` to change
it), so a signed client lands in its own `princ:` bucket. That requires the
envelope **outside** `RateLimitLayer` (its last `.layer(..)`), which means
signature verification, with its key and nonce lookups, runs before the rate
limit: put an IP-level limiter outside the envelope layer. A `429` answered to
a signed request is sealed.

Past the cap it **collapses into the fallback bucket, never refuses** — refusing
would hand an attacker a deterministic global outage. IPv6 is aggregated to /64;
IPv4 is not. Redis Cluster is not a supported deployment for this store (three
un-hash-tagged keys give `CROSSSLOT`).

Honouring `@no_rate_limit` is opt-in: `RateLimitLayer` rate-limits everything
until told which op a request is. Either install a predicate,
`.with_should_rate_limit_fn(build_rpc_ops_filter(OPS))` (REST:
`build_rest_ops_filter(ROUTE_TRANSPORTS)`), or, *(since 0.13.0, cratestack#877)*,
a resolver from the same builders idempotency uses:
`.with_op_resolver(cratestack_axum::idempotency::build_rpc_op_resolver(OPS))`.
Prefer the resolver: it has a `_with_prefix` variant. The builders live in
`idempotency`, not `ratelimit`, and return a non-`Clone` value — call the
builder once per layer. `with_op_resolver` and `with_should_rate_limit_fn`
replace each other.

Two gaps: **`/rpc/batch` is always rate-limited wholesale**, regardless of the
ops inside — the lookup runs before the body is decoded, and that is an accepted
tradeoff, not a bug. And the **filters have no `_with_prefix` variant**, so a
nested `/api/rpc/...` mount wired through a filter fails closed and silently makes
`@no_rate_limit` inert. Use
`with_op_resolver(cratestack_axum::idempotency::build_rpc_op_resolver_with_prefix("/api", OPS))`
there *(since 0.13.0)*.

The admission decision itself lives in `cratestack-exec`
(`OpExecutor::admit_rate_limit`, *since 0.13.0*). An op nobody could identify is
**charged** — the same "apply the protection" answer idempotency gives by
reserving. Key
derivation, the store-error policy, the lookup timeout and the `429` stay in
`cratestack-axum`.

## Optimistic locking

`@version` on a required `Int` field, at most one per model, never the PK. Zero
is fine and normal — "exactly one per model" is a docs-site error.

Flow: read, capture the `ETag` (a strong validator, `"7"`), send it back as
`If-Match` on `PATCH` or `DELETE`, retry on 412. **Omitting `If-Match` on a
versioned model is itself a 412.** `If-Match: *` is a 400.

Under the COSE envelope layer *(since 0.14.0, cratestack#1006)*, `If-Match` is
**signature-bound** exactly as sent: a client must sign it, a proxy that strips
or alters it gets the unsigned 401, and sending it twice is a 400. The
response's **`ETag` is not bound** (no response header is): don't treat it as
authenticated.

On a version mismatch the runtime re-reads the row **through the read policy**
before answering. If you can see it and the version differs, you get 412 with
`"version mismatch: expected N, found M"`. If you cannot see it, you get
`Forbidden` — so **policy denials stay indistinguishable from missing rows**.

`update_many` has no `if_match` slot at all and bumps every matched row
unconditionally; bulk update is not an optimistic-locking idiom. `upsert` bumps
the version but **does not honour `if_match`** — for "update only if version = N"
use an explicit transaction with `find_unique` then `update.if_match(N)`.
`batch_update` does carry a per-item expected version.

## Audit

`@@audit` is bare. **There is no duplicate check**, so a second `@@audit` is a
silent no-op.

Rows go to `cratestack_audit`, inserted **inside the mutation's transaction** —
you can never see a committed row whose audit entry did not also commit.
Columns: `event_id, schema_name, model, operation, primary_key, actor, tenant,
before, after, request_id, occurred_at, delivered_at, attempts, last_error`.

Redaction markers, exactly:

| Attribute | Marker |
| --- | --- |
| `@pii` | `[redacted-pii]` |
| `@sensitive` | `[redacted-sensitive]` |
| `@server_only` | omitted entirely (serde skips the field) |

**The docs site says `<redacted: pii>` and `<redacted: sensitive>`. Both are
wrong.** Match on the bracket forms. Redaction happens before the row is written,
so the value is unrecoverable from the audit table. Both the snake_case column
name and its camelCase transposition are redacted.

`AuditSink` fan-out happens **after** the owning transaction commits, never
inside it. A caller-managed `run_in_tx` cannot dispatch for you — it returns the
`AuditEvent`s and you call `dispatch_audit_sink` after your own commit. The
database table is canonical; the sink is a best-effort projection.

## Soft delete

`@@soft_delete` is bare, no duplicate check. The column is **hardcoded
`deleted_at`** — you cannot name a different one. The model needs no field for
it, but on Postgres the table needs a nullable `deleted_at TIMESTAMPTZ` column,
and `cratestack migrate` does **not** emit one (its IR is built from declared
fields only; every PG test fixture adds the column by hand).

`DELETE` becomes `UPDATE … SET deleted_at = NOW()` (plus a `version` bump if the
model has one). Every read injects `deleted_at IS NULL` as the first `WHERE`
clause — but **a view's own SQL body must filter tombstones itself**; views
report no soft-delete column.

Relation filters and sorts **through** a soft-deleted model skip its tombstones
too *(since 0.13.0, GHSA-p55v-6xv5-93p3)*: `?author.name=…`, `where=`,
`sort=author.name` and the RPC `list` slots treat a tombstoned related row as
absent, like `?include=` does (a sort key through it reads `NULL`). **Before
0.13.0 they did not**: the correlated subquery saw tombstones. The embedded
backend still does — its relation filters and sorts ignore `@@soft_delete`
although its `find_*` hides tombstones.

Re-deleting a tombstone matches zero rows and surfaces as `Forbidden` (403,
`delete policy denied this operation`) — the same answer as a missing row or a
policy denial, and `deleted_at` does not move. There is no
`undelete` helper; reviving deliberately means an explicit
`UPDATE … SET deleted_at = NULL`.

**The one to remember: plain `.upsert().run()` on a `@@soft_delete` model
overwrites a tombstone.** The pre-flight probe deliberately treats tombstones as
"no row", so the `DO UPDATE` statement then writes over the tombstoned row and
the runtime classifies it as an insert, emitting a `Created` event and an
`AuditOperation::Create` with `before = None` — and **the update-policy gate does
not run**. `deleted_at` is not in the `SET` list (unless the model declares it
as a field), so the row stays tombstoned and hidden; the source comment calls
this "revives", but `upsert_do_update_sql.rs` never touches the column.
`.do_nothing()` does not share the defect; it returns `CratestackError::Conflict`.
This is a known, documented defect, not a misunderstanding.

`@@retain(days: N)` parses, validates, lands on the descriptor, and **is never
acted on**. Run your own scheduled job.

## Upsert

`.upsert(CreateXInput)` is generated only for models whose `@id` is
client-supplied. A server-generated PK makes it a **compile error**.

`.on_conflict(ConflictTarget::columns(&["owner_id", "provider"]))` targets a real
`UNIQUE` constraint; the input must carry a value for every column in the tuple.
`ON CONFLICT ON CONSTRAINT <name>` is not exposed. Partial unique indexes work
via `ConflictTarget::columns(&[..]).where_index("status = 'active'")`
(`predicate()` is only the getter).

The **create** policy is checked on every call, before the probe. The **update**
policy is checked only when the locked probe finds a live row, against that row.
A source comment says "both must allow" up front; the code does not: a caller
with create but not update permission inserts a new key and gets 403 on an
existing one.

`upsert_update_columns` is: scalar columns, minus the PK, minus `@version`, minus
`@readonly`, minus `@server_only`, minus anything with `@default(...)`.
Auth-derived defaults are excluded specifically so upsert cannot become "take
ownership of any row I name" — which also means the framework does **not** verify
on the update branch that the existing row belongs to the caller. That is the
update policy's job.

`.do_nothing()` is server-only and returns
`UpsertOutcome::{Inserted, Existing}`. It still evaluates the update policy
against an existing row it will never mutate, so a caller without update
permission gets 403 rather than the row's contents (the 403 still tells a
create-authorized caller the key exists).

## Batches

Three unrelated things share the word.

1. **`POST /rpc/batch`** — a transport aggregator. Not atomic, each frame its own
   transaction, envelope always 200, per-frame status in the frames. It passes
   one cloned header map to every frame, so it **structurally cannot express N
   different `If-Match` values** — batching versioned updates through it would be
   silently wrong. Cap 1000 frames, checked before any frame runs, over it is a
   422.
2. **`update_many` / `delete_many`** — one filter, one shared patch. Policy
   compiles once into the `WHERE`, so **"denied by policy" and "did not match the
   filter" are indistinguishable**. Takes no expected version: it bumps
   `@version` on every matched row.
3. **`batch_get` / `batch_create` / `batch_update` / `batch_delete` /
   `batch_upsert`** — item-addressed, per-item version, per-item policy, one
   outer transaction with a savepoint per item so a failing item rolls back only
   itself. **Not reachable from any generated route.**

The `BatchResponse { results, summary }` / `BatchItemStatus { Ok, Error }`
envelope in `cratestack-core` documents `POST /<model>/batch-*` routes that **do
not exist**.

## Transaction isolation

`@isolation("read_committed" | "repeatable_read" | "serializable")`,
case-insensitive, `_` or a space as the separator. No `READ UNCOMMITTED`.

**On every release from 0.2.0 through 0.14.0 it was inert.** The
level was validated and then ignored: the procedure ran on the pool at the
server default, normally `READ COMMITTED`, on REST, RPC, `/rpc/batch` and MCP.
Measured upstream: two concurrent declared-serializable withdrawals of 100 from
a balance of 100 both succeeded. On those versions, run the transaction
yourself:

```rust
run_in_isolated_tx_with_retries(pool, TransactionIsolation::Serializable, 3, |tx| async { … })
```

Retries on SQLSTATE `40001` (serialization failure) and `40P01` (deadlock),
**including errors raised from `commit()` itself** — SSI defers write-skew to
commit time. Composing write-builder `run_in_tx` calls inside does not get
automatic audit-sink fan-out or `@@emit` delivery; dispatch after `Ok` returns.
*(since 0.14.1, GHSA-r67q-4qqq-g9gm)* It retries **only database errors**: a
typed one by its SQLSTATE alone, an untyped `Database(String)` by its text. An
error the body builds itself whose message contains `40001` (echoed request
data) is returned on the first attempt; every release through 0.14.0 retried
it. Out of retries it still returns the last error (a `40001` is
`DatabaseTyped`, 500), never `TRANSACTION_ABORTED`.

### Enforced since 0.14.1 *(GHSA-r67q-4qqq-g9gm)*

A procedure declaring `@isolation(level)` runs inside one transaction begun with
`BEGIN ISOLATION LEVEL <level>`, on every path that can execute it: REST, RPC,
each `/rpc/batch` frame, MCP `tools/call`, and `<procedure>::invoke_with_db`.
Its `@allow`/`@deny` and `@authorize` checks, its body, the policy checks of its
writes (create policies, the `@version` probe, upsert update-policy checks) and
the `@computed` fields of its output all run in that transaction. Design:
framework `docs/design/procedure-isolation.md`.

**The handle changes type — breaking.** The `ProcedureRegistry` method takes
`db: &IsolatedCratestack` (generated in `cratestack_schema`, only for a
`db = Postgres` schema that declares an `@isolation` procedure). It has the
model accessors, `bind_context` / `bind_auth`, `transaction(..)` (a savepoint
inside the procedure's transaction) and `dispatch_audit_sink` (queued until
commit). It has **no `pool()`, `events()`, `views()` or `queries()`** —
`db.pool()` is `E0599`. Raw SQL goes through the savepoint:

```rust
// crates/cratestack-pg/tests/procedure_isolation_support/mod.rs (trimmed)
async fn withdraw(
    &self,
    db: &IsolatedCratestack,
    ctx: &CratestackContext,
    args: p::withdraw::Args,
    _authorized: p::withdraw::Authorized,
) -> Result<p::withdraw::Output, CratestackError> {
    let account = db.iso_account().find_unique(args.args.accountId).run(ctx).await?
        .ok_or_else(|| CratestackError::NotFound("no account".into()))?;
    // … check, then db.iso_account().update(id).set(..).run(ctx).await?
}

let level = db
    .transaction(async |tx| {
        sqlx::query_scalar::<_, String>("SELECT current_setting('transaction_isolation')")
            .fetch_one(&mut ***tx)
            .await
            .map_err(cratestack::cratestack_error_from_sqlx)
    })
    .await?;
```

`<procedure>::invoke_with_db` of such a procedure takes
`FnOnce(IsolatedCratestack, Authorized) -> Fut + Clone`, called once per attempt.

What bites:

- **The body must be re-runnable.** On `40001` / `40P01`, from a statement or
  from `COMMIT`, the attempt rolls back and authorization, body and resolvers run
  again: 3 retries by default, jittered backoff,
  `Cratestack::builder(pool).with_isolation_max_retries(n)` to change it (`0`
  means none). An attempt that saw a retriable error is retried even if the body
  swallowed it. Work through the handle is rolled back with the attempt;
  anything else (HTTP calls, e-mail, state in `self`) is **repeated** — make it
  idempotent or move it behind `@@emit`. `AuditSink` fan-out and the outbox drain
  happen once, after the committing attempt.
- **One operation at a time.** Concurrent (`tokio::join!`) or re-entrant
  (`.run(ctx)` inside `db.transaction(..)`) use of the handle is an
  `INTERNAL_ERROR`, not a deadlock. Inside `transaction`, use `run_in_tx(tx, ctx)`.
- **Never send `COMMIT`, `ROLLBACK` or `END` through `tx`.** A savepoint that
  cannot be closed (raw SQL failed and the error was not returned, or the
  transaction was ended), or a `transaction(..)` cancelled or panicking half-way,
  fails the attempt with `INTERNAL_ERROR` even if the body returns `Ok`. Work
  before a raw `COMMIT` is already durable and cannot be undone.
- **`@computed` resolvers of the output run inside the attempt**, after the body,
  before `COMMIT`: their `&Cratestack` is attempt-bound for model accessors and
  `transaction(..)`, a resolver error rolls the attempt back, and they re-run with
  it. Its `pool()`, `views()`, `queries()` and `events()` still run on the pool.
- **Nested calls join.** A resolver that calls another `@isolation` procedure's
  `invoke_with_db` with that `&Cratestack` runs it once as a savepoint of the same
  attempt (the outermost attempt owns retries). A stricter declared level than the
  attempt's is refused, and so is a second joined call while one is running.
  A procedure called through a pool you hold yourself gets its own transaction.
- **Refused:** with `@stream`, and under `provider = "none"` (both parse errors),
  and with `include_server_schema!(.., db = None)` (`compile_error!`). The
  embedded and client roles have nothing to enforce.
- **Size the pool:** each in-flight call holds one connection for its whole
  transaction. `@isolation` does not make `/rpc/batch` atomic.

**Retries exhausted: `409 TRANSACTION_ABORTED`** (RPC `aborted`), the new
`CratestackError::TransactionAborted`, with the fixed message `transaction could
not be completed because of concurrent updates; retry the request`. Nothing was
committed: resend it, under the same `Idempotency-Key` if you like —
`IdempotencyLayer` and MCP admission release the key for this outcome instead of
recording it. It is not `CONFLICT`, which a retry repeats.

**Only the owner says so.** Only the generated REST, RPC or MCP dispatch of the
`@isolation` procedure whose own retries ran out answers `TRANSACTION_ABORTED`.
Any other abort that reaches a response — a procedure (with or without
`@isolation`) propagating another's with `?`, a resolver's, or a hand-written
handler returning `invoke_with_db`'s result — is `500 INTERNAL_ERROR` (RPC
`internal`), recorded and replayed under the key, because that caller may have
committed work of its own. Do not retry it under a new key. Application code
builds a `TransactionAbort` only with `exhausted(..)` or `propagated(..)`.

Upgrading: `grep -rn '@isolation'` your schemas; for each procedure change
`db: &Cratestack` to `db: &IsolatedCratestack`, replace `db.pool()` with
`db.transaction(..)`, delete any hand-written `run_in_isolated_tx(db.pool(), ..)`
wrapper, and check the body and its output's resolvers can run twice. Also
since 0.14.1, and not tied to `@isolation`: the framework's own reads
(`find_unique`, `find_many`, projections, aggregates), the `@authorize` probe,
create-policy lookups and `@@audit` writes now fail with `DatabaseTyped` rather
than `Database` (same `DATABASE_ERROR`, 500) — a `match` on `Database(_)` must
also match `DatabaseTyped(_)`, or use `code()` / `db_sqlstate()`.

## Trusted proxy and client IP

```rust
router.layer(Extension(
    TrustedProxyConfig::trusting([net])
        .max_hops(2)
        .forwarded_header(ForwardedHeader::XForwardedFor)
))
```

The default, with nothing configured, is `client_ip: None`. **Headers are never
trusted by default and nothing is guessed.**

Four hazards, all found by adversarial review and all fixed — worth knowing
because they are the shape of the mistake if you reimplement any of this:

1. **Exactly one header is ever honoured**, selected by `ForwardedHeader`,
   defaulting to `X-Forwarded-For`, never falling through. The first
   implementation checked RFC 7239 `Forwarded` first — and since real proxies set
   `X-Forwarded-For` and never touch `Forwarded`, a `Forwarded` header at the
   origin is entirely attacker-authored and was never hop-counted.
2. **Hop values are validated as IPs.** Otherwise `666.666.666.666` lands in the
   audit trail verbatim.
3. **Duplicate headers are concatenated in wire order.** `HeaderMap::get` returns
   only the first, so a proxy appending its hop as a second header line was
   silently dropped in favour of whatever the attacker sent first.
4. **Hops are counted right-to-left**, from the end nearest the trusted proxy.
   The left end is exactly what an untrusted client controls.

The likely operator mistake: applying `TrustedProxyConfig` **without**
`into_make_service_with_connect_info` silently degrades `client_ip` to `None`
forever. A once-per-process warning now fires for that.

Forwarded headers are never a substitute for `ConnectInfo` in the rate limiter or
the idempotency fingerprint.

## Pagination

`@@paged` is bare, and **duplicates are rejected** (unlike `@@audit` and
`@@soft_delete`). It changes only the list route.

```json
{ "items": [], "totalCount": 0,
  "pageInfo": { "limit": 50, "offset": 0, "hasNextPage": false, "hasPreviousPage": false } }
```

`MAX_LIST_LIMIT` is **1000**, applies to every list route paged or not, on both
transports, and has **no per-model override**. Omitting `limit` defaults it to
the cap, not to unbounded.

`totalCount` costs a second `COUNT(*)` that reuses the page query's exact filters
and policy scope — a divergence there would let a caller learn the size of a
result set policy does not let them read.

**Cursor pagination is not implemented.** No cursor type, no `after`/`before`.

## Size bounds

2 MiB request body (matching axum's own implicit `Bytes` default, so the explicit
limit was provably a no-op on upgrade), 8 MiB in-process response rebuffer, 1000
batch frames.

**Change it only through the `body_limit_bytes` parameter of `router()` /
`rpc_router()`.** Re-layering `DefaultBodyLimit` on the returned router does
nothing in *either* direction — loosening is ignored and tightening is ignored —
because axum applies layers bottom-to-top and the innermost restriction wins,
which is structurally always CrateStack's own.

## Multi-tenancy

**`@@unique_per_tenant` is not a real attribute.** Its only appearance in the
entire codebase is a test asserting its absence. Use a composite unique:
`@@unique([tenantId, name])`.

`@default(auth().tenantId)` — dotted paths work — fills a column on create.
**It does not enforce tenant isolation.** Reads, updates and deletes are scoped
only by `@@allow` / `@@deny` predicates. A model with an auth-defaulted tenant
column and no tenant predicate in its read policy is fully cross-tenant readable.

Resolution order matters and is deliberate: an **anonymous** caller with a
missing auth field gets `Forbidden` (403) *before* the required-ness check runs,
so the error cannot leak which auth claim the schema expects. An authenticated
caller missing a required auth field gets a `Validation` error regardless of
whether the model field is nullable — a required auth field silently resolving to
NULL was a real policy bypass, because SQL's `NULL != X` is NULL, not true.

## Computed fields

`@computed` and `@computed(params: T?)` — see `cratestack-schema` for the
authoring rules. Runtime facts that matter here:

- **Params now have full REST/RPC parity.** REST uses
  `?computedParams=<URL-encoded JSON object>`; RPC carries
  `computedParams: Option<String>` on `RpcListInput` and on a dedicated
  `RpcGetInput`. It is a raw JSON *string*, not a nested value, for three real
  reasons — CBOR `Option::None` corruption on round trip, surviving the batch
  re-encode, and reusing the REST validator byte-for-byte.
- Malformed JSON, unknown top-level keys, keys naming a param-less field, or
  params for a field excluded by `?fields=` are all **422** on both transports.
- **Only top-level keys are validated before the database is touched.** Decoding
  a key's value happens at response-serialisation time, after rows are fetched.
- **Unknown keys *inside* a params object are silently ignored** — plain serde,
  not `deny_unknown_fields`.
- **Create/update/delete commit the write before resolvers run.** A resolver
  error always describes a failed *response* for a write that already happened.
- The Rust client's `computed_params` is **positional** — adding a model's first
  parameterised computed field changes `get(id, headers)` into
  `get(id, computed_params, headers)` and breaks call sites. Dart and TypeScript
  are additive.
- Computed fields never appear in event payloads, are a parse error on `@stream`
  items, and are a compile error under `include_embedded_schema!`.
- **A procedure output sent `@server_only` fields on 0.8.11–0.12.0**
  (GHSA-ch54-jqw2-vpp5, fixed *since 0.13.0*). When a procedure returned a model
  with a `@computed` field — directly, as `T?`, `T[]`, `Page<T>`, or inside a
  `type` — the generated `compose_<owner>_value` built the response field by
  field, bypassing serde's skip, and included every `@server_only` field. Model
  get/list, `?fields=`, `?include=` and events were never affected. After
  upgrading, a response `IdempotencyLayer` stored before the upgrade still
  carries the value until its TTL expires: clear the idempotency store. Treat
  the values as disclosed and rotate credentials among them.
- For an `@isolation` procedure *(since 0.14.1)*, the output's resolvers run inside
  its transaction and re-run on retry — see "Transaction isolation".

## Composite primary keys

`@@id([a, b])` requires at least two distinct scalar fields, is mutually
exclusive with any field-level `@id`, and rejects `@readonly`, `@server_only`,
`@version` and `@computed` members.

**It then fails at macro expansion** with a clear error pointing at issue #136 —
all three entry macros reject it. What works today is the migration half: the
DDL emitters already collect every flagged column into one
`PRIMARY KEY (a, b)` clause, so you can adopt it for real composite constraints
while the rest catches up.

Do not confuse this with composite **conflict targets** for upsert, which work
today on both backends.
