---
name: cratestack-server
description: Building a CrateStack HTTP server — include_server_schema! with db = Postgres or db = None, the generated Cratestack runtime and Axum routers, AuthProvider wiring, the REST query-parameter contract, error envelope, codecs, events and the transactional outbox, idempotency and rate-limit layers, and the signed-transport EnvelopeLayer (envelope / cose features, COSE-signed requests, envelope_layer). Load when working in a crate that depends on package = "cratestack-pg" or "cratestack-api", or when a question concerns generated routes, 403/404/422 behaviour, list filters, or router() arguments.
---

# Server (`include_server_schema!`)

> **Verified against CrateStack 0.12.0.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

```toml
# owns a Postgres database
cratestack = { package = "cratestack-pg", version = "0.12" }
# procedures only, no database at all
cratestack = { package = "cratestack-api", version = "0.12" }
```

```rust
include_server_schema!("schema.cstack", db = Postgres);
include_server_schema!("schema.cstack", db = None);
```

Third, optional argument: `decimal = RustDecimal | BigDecimal`, **required** if the
schema declares a `Decimal` anywhere. Those three are the only accepted
arguments.

The macro checks that `db = …` and the schema's own
`datasource { provider = … }` agree (`Postgres` ↔ `"postgresql"`, `None` ↔
`"none"`), and that the facade you depend on can actually satisfy it — asking for
`db = Postgres` under `cratestack-api` is one clear error rather than a wall of
missing-`sqlx` errors.

## The minimal server

```rust
use cratestack::axum::Router;
use cratestack::include_server_schema;
use cratestack::sqlx::PgPool;
use cratestack::{AuthProvider, CratestackContext, CratestackError, RequestContext, Value};
use cratestack_codec_json::JsonCodec;

include_server_schema!("examples/server_basic.cstack", db = Postgres);

#[derive(Clone)]
struct HeaderAuthProvider;

impl AuthProvider for HeaderAuthProvider {
    type Error = CratestackError;

    async fn authenticate(&self, request: &RequestContext<'_>)
        -> Result<CratestackContext, Self::Error>
    {
        let mut fields = Vec::new();
        if let Some(id) = request.headers.get("x-auth-id").and_then(|v| v.to_str().ok()) {
            fields.push(("id".to_owned(), Value::Int(id.parse().map_err(
                |e: std::num::ParseIntError| CratestackError::BadRequest(e.to_string()))?)));
        }
        Ok(if fields.is_empty() {
            CratestackContext::anonymous()
        } else {
            CratestackContext::authenticated(fields)
        })
    }
}

#[derive(Clone)]
struct Procedures;
impl cratestack_schema::procedures::ProcedureRegistry for Procedures {}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pool = PgPool::connect(&std::env::var("DATABASE_URL")?).await?;
    let db = cratestack_schema::Cratestack::builder(pool).build();

    let app: Router = cratestack_schema::axum::router(
        db,
        Procedures,
        (),                                  // computed-field resolver
        JsonCodec,
        HeaderAuthProvider,
        cratestack::DEFAULT_BODY_LIMIT_BYTES,
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
    cratestack::axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}
```

`async fn authenticate` satisfies the trait directly. The `()` in third position
is the computed-field resolver — the macro emits `impl ComputedFieldResolver for ()`
only when the schema declares zero `@computed` fields.

Under `db = None` the builder takes **no arguments**:
`cratestack_schema::Cratestack::builder().build()`.

## What you get, by name

Everything lands in `pub mod cratestack_schema`. For a `model Article`:

| Name | What it is |
| --- | --- |
| `Article`, `ArticleBuilder` | the row struct (field names verbatim from the schema) |
| `CreateArticleInput`, `UpdateArticleInput` | inputs, with `validate()` |
| `ArticleWhere`, `ArticleSortField`, `ArticleOrderByClause`, `ArticleFindManyInput` | typed query surface |
| `models::ARTICLE_MODEL` | the `ModelDescriptor` |
| `article::<field>()` | `FieldRef` accessors and relation paths |
| `events::ArticleCreatedEvent` … | under `db = Postgres` with `@@emit` |

Runtime, under `db = Postgres`: `Cratestack::builder(pool)` →
`.with_audit_sink(…)` → `.build()`. Then `db.pool()`, `db.transaction(|tx| …)`,
`db.events()`, `db.views()`, `db.queries()`, `db.bind_context(ctx)`,
`db.bind_auth(principal)`, and one delegate accessor per model.

**Under `db = None`, most of that does not exist** — no `pool()`, no
`transaction()`, no `events()`, no `views()`, no `queries()`, no
`with_audit_sink()`. They are omitted entirely rather than stubbed, which is the
right call but does mean "method not found" is the expected error, not a bug.

Routers: `router(db, registry, resolvers, codec, auth_provider, body_limit_bytes)`,
plus `model_router(db, resolvers, codec, auth_provider)` (Postgres only),
`procedure_router(db, registry, resolvers, codec, auth_provider)`, and
`rpc_router(…)` under `transport rpc`. `body_limit_bytes` is applied as the
outermost `DefaultBodyLimit` and **cannot be overridden by re-layering**.
`DEFAULT_BODY_LIMIT_BYTES` is 2 MiB.

## Routes

`<plural>` = `pluralize(snake_case(ModelName))`, so `Article` → `/articles`.

| Method | Path | Success |
| --- | --- | --- |
| GET | `/<plural>` | 200 |
| POST | `/<plural>` | **201** |
| GET | `/<plural>/{id}` | 200 |
| PATCH | `/<plural>/{id}` | 200 |
| DELETE | `/<plural>/{id}` | 200 |

Procedures: `POST /$procs/<procedureName>` — the procedure name **verbatim**, not
snake-cased — or `POST /<version>/$procs/<name>` with `@api_version`. The request
body is `{"args": {…}}`. Before 0.13.0 the generated `ROUTE_TRANSPORTS`
descriptor for a versioned procedure named `/$procs/<name>`. The REST op
resolvers match `MatchedPath` against it, so for that procedure every lookup
missed, `@no_idempotency` and `@no_rate_limit` silently did nothing, and the
generated clients 404'd. All of this is fixed *(since 0.13.0)*: the router, the
descriptor and every client share
`cratestack_core::procedure_route::procedure_rest_route_path`.

A verb suppressed with `@@internal("create")` is never registered, so it is a
plain axum 404 with no fallback.

## The list-route query contract

```
?limit=50&offset=100
&fields=id,title
&include=author,author.org
&includeFields[author]=id,email
&sort=-createdAt,title            (or orderBy=, but never both)
&where=(a=1,b=2)|not(c=3)         ( , = AND   | = OR   () groups )
&or=a=1|b=2                       (legacy)
&computedParams={"field":{…}}
&<field>__<op>=<value>            (everything else)
```

Filter operators, by field shape:

- always: `eq`, `ne`, `in` (comma-separated). No `__` suffix means `eq`.
- comparable fields: `lt`, `lte`, `gt`, `gte`
- `String` / `Cuid`: `contains`, `startsWith`
- optional fields: `isNull` (value parsed as a bool; `false` means `IS NOT NULL`)

Relation filters use the path: `?author.email__eq=x@y.z` for to-one, and a
**mandatory quantifier** for to-many — `?comments.some.body__contains=foo`, or
`.every.`, or `.none.`. Omitting the quantifier is a 400 that names the three.

Two things that surprise people: **an omitted `limit` is coerced to
`MAX_LIST_LIMIT` (1000)**, not to "unbounded"; and the fetch route
(`GET /<plural>/{id}`) accepts **only** `fields`, `include`, `includeFields[…]`
and `computedParams` — anything else is a 400.

A `@@paged` model returns
`{ items, totalCount, pageInfo { limit, offset, hasNextPage, hasPreviousPage } }`,
where `totalCount` is a real `COUNT(*)` reusing the page query's exact WHERE and
policy scope.

## Errors

```json
{ "code": "VALIDATION_ERROR", "message": "…", "details": null }
```

Encoded with the same negotiated codec as a success body.

| Variant | code | status |
| --- | --- | --- |
| `BadRequest`, `Codec` | `BAD_REQUEST`, `CODEC_ERROR` | 400 |
| `Unauthorized` | `UNAUTHORIZED` | 401 |
| `Forbidden` | `FORBIDDEN` | 403 |
| `NotFound` | `NOT_FOUND` | 404 |
| `NotAcceptable` | `NOT_ACCEPTABLE` | 406 |
| `Conflict` | `CONFLICT` | 409 |
| `PreconditionFailed` | `PRECONDITION_FAILED` | 412 |
| `UnsupportedMediaType` | `UNSUPPORTED_MEDIA_TYPE` | 415 |
| `Validation` | `VALIDATION_ERROR` | **422** |
| `TooManyRequests` | `TOO_MANY_REQUESTS` | 429 |
| `Database`, `Internal` | `DATABASE_ERROR`, `INTERNAL_ERROR` | 500 |
| `Unavailable` | `UNAVAILABLE` | 503 |

4xx messages are the caller-supplied string; **5xx messages are canned** and the
real detail goes to tracing only. `details` is always `null` on the wire.

**A denied model read is not a 403.** Read policy compiles into the `WHERE`
clause, so a denied `find_unique` returns `Ok(None)` and the handler turns that
into a **404**; a denied list read simply returns fewer rows and no error at all.
Only mutations produce `Forbidden`. Design your clients accordingly — and see
`cratestack-policy-auth`.

## Codecs

`JsonCodec` is `application/json`, `CborCodec` is `application/cbor`. Pass one,
or pass `CodecSet::new(CborCodec, JsonCodec)` — the set holds **exactly two**;
there is no N-codec variant.

Content negotiation is real: request decode is driven by `Content-Type` against
the route's declared request types (415 on a mismatch), and the response type is
negotiated from `Accept` with proper `q=`/specificity scoring, **intersected with
what the codec you actually passed can encode** (406 if nothing matches). All of
it runs as a preflight *before* any handler side effect, so a `create` cannot
write a row and then fail to encode.

`application/cbor-seq` is response-only and procedures-only, and requires a CBOR
codec.

**The practical trap:** generated `transport rpc` TypeScript clients default to
native CBOR. A router mounted with `JsonCodec` alone answers those 406/415. Mount
`CodecSet::new(CborCodec, JsonCodec)`, or generate with `--no-native-cbor`.

## Events and the outbox

`@@emit(created, updated, deleted)` generates, inside `cratestack_schema::events`:
type aliases `ArticleCreatedEvent` and friends, and a `Subscriptions` handle:

```rust
db.events().on_article_created(|event| async move { /* … */ Ok(()) });
db.events().drain().await?;
```

Writes enqueue an outbox row **inside the mutation's transaction**; `drain()`
flushes undelivered rows — which is also the required opt-in after a
caller-managed `run_in_tx` commit.

`@@subscribe` (RPC only) adds an SSE endpoint. **Row-level `@@allow` policy is
not replayed against streamed events** — header auth applies, per-row filtering
does not. Deliberate and documented; do not stream a model whose rows are
per-caller sensitive.

**`cratestack-outbox` is a different thing.** It is a separate, hand-written
transactional outbox for *application* domain events; it deliberately does not go
through `include_server_schema!`. Copy `OUTBOX_EVENTS_DDL` into your own
migration, then use `OutboxClient::{persist, persist_in_tx, drain, gc_older_than}`
and mount `axum_handler::{drain_handler, gc_handler}` behind your own auth — the
crate has no auth opinion.

## Idempotency and rate limiting

```rust
let store = Arc::new(SqlxIdempotencyStore::new(pool.clone()));
let router = generated.layer(IdempotencyLayer::new(store, Duration::from_secs(24 * 3600)));

let store = Arc::new(InMemoryRateLimitStore::default());
let router = router.layer(RateLimitLayer::new(store, RateLimitConfig::new(100, 1.0)));
```

Three things bite:

1. **The default principal fingerprint hashes `Authorization`, falling back to
   `ConnectInfo<SocketAddr>`. With neither, the request is refused with 412.**
   Cookie or mTLS deployments must supply `.with_principal_fingerprint(…)`, or
   serve via `into_make_service_with_connect_info::<SocketAddr>()`.
   *(since 0.13.1, cratestack#1006)* A `VerifiedPrincipal` extension now comes
   first (`princ:<sha256>`), which is what the envelope layer below inserts; see
   `cratestack-data-integrity` for the upgrade note.
2. **A nested router needs the `_with_prefix` resolver variants**
   (`build_rest_op_resolver_with_prefix`, `build_rpc_op_resolver_with_prefix`), or
   every descriptor lookup misses and `@no_idempotency` silently no-ops. Give
   `RateLimitLayer::with_op_resolver` its own instance from the same builder
   *(unreleased, #877)* so `@no_rate_limit` survives the nest too — the
   resolver is not `Clone`, so call the builder once per layer.
3. **Rate-limit store failure is nuanced by design**: a transport-class failure
   (Redis connection dropped) fails **open** with a warning; a store that is
   reachable and refusing (OOM) fails **closed** under every policy.

Replay semantics: same key and same body hash replays the stored response; same
key with a different body is a **422** with code `idempotency_key_conflict`.

Redis-backed stores live in `cratestack-redis`; the Postgres idempotency store is
in `cratestack-sqlx`. `cratestack-exec`'s `OpExecutor` is the transport-neutral
layer underneath — you rarely name it directly.

## Signed transport (envelope layer)

*(since 0.13.1, cratestack#1006)* `EnvelopeLayer` opens signed requests (COSE_Sign1 /
COSE_Mac0 bodies) and seals every response of a generated REST or RPC router (ADR 0006).
It is off unless you enable a facade feature:

- `envelope` — `cratestack::envelope_layer` (the layer, its traits) and a
  generated `cratestack_schema::axum::envelope_layer(envelope, policy, audience)`.
  No crypto crate; bring your own `ServerEnvelope`.
- `cose` — `envelope` plus `cratestack::cose` (a re-export of `cratestack-cose`),
  whose `CoseEnvelope` is the default envelope.

Both are on `cratestack-pg` and `cratestack-api`. The generated function exists
only for schemas compiled through a facade with `envelope` on. The Rust client
does **not** sign yet (cratestack#1007).

```rust
use std::sync::Arc;
use cratestack::cose::{CoseEnvelope, CoseMode, StaticVerifierResolver};
use cratestack::envelope_layer::EnvelopeMode;
use cratestack::InMemoryNonceStore;

let envelope = CoseEnvelope::server(
    CoseMode::Sign1,
    Arc::new(server_signer),                                   // any CoseSigner
    Arc::new(StaticVerifierResolver::new().with_key(client_key)),
    Arc::new(InMemoryNonceStore::new()),                       // per-process replay cache
)
.build()?;

let envelope_layer =
    cratestack_schema::axum::envelope_layer(envelope, EnvelopeMode::Required, "payments")
        .mount_prefix("/api")            // only if the router is nested under /api
        .build()?;

let router = generated_router
    .layer(idempotency_layer)
    .layer(rate_limit_layer)
    .layer(envelope_layer);             // LAST .layer(), so it runs first
let app = axum::Router::new().nest("/api", router);
```

The generated function picks the schema's transport, `ROUTE_TRANSPORTS` and
`SCHEMA_SHA256_BYTES`, and returns the builder: `.mount_prefix(..)`,
`.allow_unresolved([..])`, `.unresolved_mode(..)`, `.principal_mapper(..)`,
`.response_seal_policy(..)`, `.max_body_bytes(..)`, then `.build()?`. The calls
commute. The hand-rolled form is `EnvelopeLayer::builder(envelope, audience,
cratestack_schema::SCHEMA_SHA256_BYTES).policy(..).rest(prefix, ROUTE_TRANSPORTS)`
(or `.rpc(prefix)`); there is no default policy and no default transport.
Source: `crates/cratestack-axum/src/envelope_layer/` and
`crates/cratestack-api/tests/cose_envelope_*.rs`.

**Placement.** Last `.layer(..)` on the generated router, applied **before**
`nest` / `merge` (through `Router::layer`, so `MatchedPath` is set; wrapped
around the whole app with a `ServiceBuilder` it sees no route, so plain traffic
passes **unprotected** and every COSE body is a 415). It inserts
`VerifiedPrincipal("cose:<hex thumbprint>")`, which the rate limiter and the
idempotency layer key on. Verification (key and nonce lookups) now runs before
rate limiting, so put an IP-level limiter **outside** the envelope layer.

**Modes** (`EnvelopePolicy`, per op; `EnvelopeMode` itself, or a closure over
`&PolicyRequest<'_>`, which sees the op and no header):

- `Required` — every request signed, `GET`/`HEAD`/`DELETE` included (empty
  payload); unsigned is the unsigned `401`; every response sealed, errors
  included (a handler's `404`, the `429`, `412`, `422`; a plain request to an
  unmatched path still gets the router's plain `404`). Prefer `GET` over `HEAD`: a signed
  `HEAD`'s body may be dropped by an intermediary.
- `Optional` — a signed request is opened and **always** answered sealed (its
  `Accept` forced to CBOR); an unsigned one runs, sealed only with a valid
  `Cratestack-Nonce` and an `Accept` naming `application/cose`. That seal binds
  the nonce and payload, **not the caller**.
- `Off` — plain traffic untouched.
- In every mode an `application/cose` body is opened or refused (`415`), never
  forwarded. A bodiless `OPTIONS` passes. `/rpc/batch` runs under the strictest
  mode of `batch` and every frame's op.

**Bound by the signature:** audience, method, route (REST template or RPC op
id), path parameters (a parameterised mount's too), the canonical query,
the schema digest, the payload type, and `Idempotency-Key` / `If-Match` exactly
as sent. **Response headers (`ETag`, `Retry-After`) are not bound.**

`Required` is opt-in on purpose: the schema digest hashes the raw `.cstack`
text, so a comment-only edit breaks every signed client (cratestack#1065).

Traps:

1. **A wrong or missing `.mount_prefix(..)` is a `500`, not a pass-through.**
   Under a `Required` `unresolved_mode` (the default for `EnvelopeMode::Required`
   and for every closure policy), a route the router matched but the layer
   cannot bind is an unsigned `500`; the log says `envelope misconfigured`.
   Hand-written routes on the same router (`/health`) go in
   `.allow_unresolved(["/health"])`, relative to the mount prefix.
   `.unresolved_mode(EnvelopeMode::Optional)` is the explicit, looser opt-out.
   Another method on a generated path is the layer's own `405`.
2. **Closure plug-ins need a typed parameter**:
   `|r: &PolicyRequest<'_>| …`, `|v: &VerifiedRequest<'_>| Ok(…)`,
   `|r: &UnsignedRequest<'_>| …`. The builder methods take `impl EnvelopePolicy`
   (etc.), not an `Fn` bound, so nothing tells the compiler the argument type.
   (Every example in the crate annotates it; not separately compile-tested.)
3. **Wrapping `CoseEnvelope` in your own `ServerEnvelope`**: delegate with
   `ServerEnvelope::open_request(&self.inner, body, bind).await` (same for
   `seal_response` / `media_type`). `self.inner.open_request(..)` picks
   `CoseEnvelope`'s inherent typed method and does not type-check (E0308).
4. **Streams cannot be sealed yet** (ADR 0006 P1). A signed RPC subscription is
   a **sealed `406`** before its handler runs, in `Required` and `Optional` alike;
   give subscriptions `Optional` or `Off` in the policy
   (`request.is_subscription()`). A signed `@stream` call is answered as **one
   sealed CBOR array**, not a stream.
5. **The envelope does not authenticate.** The `AuthProvider` sees the opened
   CBOR payload (plus a `VerifiedSigner` in the request extensions), and
   generated handlers record the `VerifiedSigner` on the context
   (`ctx.verified_signer()`). It is a recorded fact, not an identity; mapping a
   signer to an identity is cratestack#1077. Keep authenticating in your
   `AuthProvider`.
6. **Responses are re-buffered** to be sealed, up to
   `MAX_RESPONSE_REBUFFER_BYTES` (8 MiB); longer is a sealed `500`. A
   `Router::fallback` handler is **not** protected (no `MatchedPath`).

## Service scaffolding and observability

`cratestack-service` gives you `telemetry::init(prefix)`,
`ServiceConfig::from_env(prefix, name, default_port)` (reading
`{prefix}_SERVICE_HOST`, `_SERVICE_PORT`, `_PUBLIC_BASE_URL`, `_DATABASE_URL`,
`_REDIS_URL`, `_ENV`, `_LOG_FORMAT`), `health::router()` mounting `/healthz` and
`/healthz/ready`, and `run(router, &config)`.

**`cratestack-service::run` has no graceful shutdown.** It serves until the
process is killed. If you need it, call
`axum::serve(listener, app).with_graceful_shutdown(signal)` yourself.

Generated routes carry `info_span!`s — but **only the list route and the
procedure routes**. GET/POST/PATCH/DELETE model handlers emit events, not spans.
Every failure branch logs at `WARN` with `cratestack_error` and
`cratestack_detail`. Nothing installs a subscriber for you.

## `db = None` in one paragraph

Procedures, types, enums, `auth` blocks, procedure policies, both transports,
codecs, idempotency and rate limiting, tracing. **No `model` blocks** — rejected
at parse time, not at codegen — and no `query` blocks. Prefer the
`cratestack-api` facade, which has no `cratestack-sqlx` dependency under any
feature, so the mistake is a clear error rather than a link failure.
