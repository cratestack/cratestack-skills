---
name: cratestack-rpc
description: CrateStack's RPC transport — transport rpc, POST /rpc/{op_id}, POST /rpc/batch, SSE subscriptions, @stream over application/cbor-seq, client-side batching with @cratestack/link-batch, and the project's transport-parity rule. Load when a schema declares transport rpc, when a question mentions op ids like model.User.list or procedure.foo, /rpc/batch, RpcListInput, cbor-seq streaming, or when changing anything on the request/response surface that must land on both transports.
---

# RPC transport

> **Verified against CrateStack 0.14.2.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

```cstack
transport rpc
```

At most once per schema; omitted means `rest`. `transport grpc` is rejected —
protobuf/gRPC was removed in 0.8.5.

RPC does not try to be a better REST. It exists for three things REST maps
badly: **batching N operations into one roundtrip**, **streaming a sequence from
one logical call**, and **subscribing to model events as a first-class call**. A
schema that needs none of those should stay on `transport rest`, which is the
default and the back-compat choice. The two cannot be switched without migrating
clients.

## The endpoints

| | |
| --- | --- |
| `POST /rpc/{op_id}` | unary |
| `POST /rpc/batch` | batch |
| `GET /rpc/subscribe/{op_id}` | SSE subscription |

Mount with:

```rust
cratestack_schema::axum::rpc_router(
    db, Procedures, (), CodecSet::new(CborCodec, JsonCodec),
    HeaderAuthProvider, cratestack::DEFAULT_BODY_LIMIT_BYTES,
)
```

Six arguments. Docs that show four are stale.

## Op IDs

```
model.<Model>.list | .get | .create | .update | .delete | .subscribe
procedure.<name>
```

Those six verbs are the complete model vocabulary. **There is no case
transformation anywhere** — the model name and the procedure name appear exactly
as declared in the schema, so `procedure flakyTicks` is `procedure.flakyTicks`.
Snake-casing is applied only to derive Rust handler identifiers, never to the op
id. Mutation-ness is not in the id: `procedure foo` and `mutation procedure foo`
both yield `procedure.foo`. Neither is `@api_version`: a versioned procedure is
still `procedure.<name>` on the server and in every client, because procedure
names are unique per schema. The version prefix applies to the REST path only.

A verb suppressed by `@@internal(...)` gets no descriptor and no dispatch arm, so
it resolves as an unknown op — `not_found`, 404.

## Frames

Unary request body is the **unwrapped input payload**, codec-encoded. No
envelope. The success body is the unwrapped output.

Batch frames, and these field names are worth getting right because the design
doc uses different ones:

```jsonc
// request: an array of these
{ "id": 1, "op": "model.User.list", "input": { … }, "idem": "optional" }
// response: an array of these, in request order
{ "id": 1, "output": { … } }
{ "id": 2, "error": { "code": "not_found", "message": "…" } }
```

Error bodies are `{ code, message, details? }` with **lowercase, gRPC-style
codes** — `invalid_argument`, `unauthenticated`, `permission_denied`,
`not_found`, `conflict`, `failed_precondition`, `resource_exhausted`,
`unavailable`, `internal`, and *(since 0.14.1, GHSA-r67q-4qqq-g9gm)* `aborted`. Note
`invalid_argument` covers five error variants spanning four different HTTP
statuses, so a client cannot reconstruct the status from the code alone.

Since 0.14.1 only (0.14.0 has neither the code nor a working `@isolation`),
`aborted` is REST's `409 TRANSACTION_ABORTED`: an `@isolation` procedure ran out
of retries and committed nothing, so resending is expected to succeed. Only that
procedure's own dispatch answers it; a caller that propagated someone else's
abort answers `internal`. Every generated client knows the code (the Rust client
maps a batch frame's `aborted` to 409, and `@cratestack/link-batch` does the
same). `@isolation` makes each **frame** of `/rpc/batch` one transaction at its
level; it does not make the batch atomic.

## Batch semantics

| | |
| --- | --- |
| Ordering | Response frames in **request order**; correlate by `id`, not position, if you can |
| Partial failure | Per frame. The envelope stays **200** once it parsed |
| Transactional | **No.** Each frame runs in its own transaction |
| In-batch dependencies | **No.** `[create A, update B referencing A.id]` is not supported — use two roundtrips or one procedure |
| Size cap | `BATCH_MAX_ITEMS` = 1000, checked **before** any frame runs; over it is a **422**, not 400 |
| Auth | The envelope is authenticated **exactly once** and the context is reused for every frame |
| `Idempotency-Key` header | Rejected with **400** — the per-frame `idem` field is the intended mechanism |
| Parallelism | Sequential today; the design permits fan-out |

**Known gap worth knowing:** the per-frame `idem` field is decoded and then never
read by the batch handler. The header is rejected in its favour, but nothing
consumes it. Do not rely on per-frame idempotency until that changes.

Batch success outputs must be representable as JSON — a future op returning
CBOR-only types (raw byte strings with no JSON representation) would surface as
an `internal` frame.

## Subscriptions

`@@subscribe` on a model requires `transport rpc` **and** requires `@@emit(...)`.

`GET /rpc/subscribe/{op_id}` with `Accept: text/event-stream`. One
`event: message` per item carrying `{"id": <n>, "next": <item>}` where `id` is a
server-assigned counter starting at 1, and exactly one terminal `event: error`
carrying `{"id": <n>, "err": {…}}`. Payloads are **always JSON** regardless of
the negotiated codec.

On overflow the terminal error is `unavailable` / `"subscription lagged"`. The
buffer is 64 items and the first overflow closes the channel permanently. The
only other ways a stream ends are a read policy it could not decide for one
event (below) and a client disconnect.

**Each event passes the subscriber's read policy** *(unreleased,
cratestack#1253)*: the model's `detail`/`read` `@@allow`/`@@deny` rules, the
ones `get` applies, decided against the event's record with the context
captured when the subscription opened. An event the subscriber may not read is
dropped, so an anonymous subscriber to an `auth()`-gated model holds an open,
empty stream. A read policy that reads a `@server_only` column cannot be decided
on an event (the payload skips it), so that subscription is refused at open with
a 500 and the columns named in the server log — keep `@@subscribe` models'
read policies off `@server_only` fields. A policy that cannot be decided for
one event (a relation probe fails) ends the stream with a terminal error. Since
cratestack#1255 *(unreleased)* that error is the probe's own; with cratestack#1253
alone it was the same `unavailable` / `"subscription lagged"` as overflow.
**0.17.0 and earlier applied no row-level policy at all**: every admitted caller,
anonymous included, received every event. Source:
`crates/cratestack-macros/src/transport/subscription_module/model_feed.rs`, test
`crates/cratestack-pg/tests/rpc_subscribe_read_policy.rs`.

### One dispatcher, every binding *(unreleased, cratestack#1255)*

The schema macro generates a `subscriptions` module for a `db = Postgres`
server schema with a `@@subscribe` model: `SubscriptionDispatch` implements
`cratestack::SubscriptionDispatcher`, and `db.subscriptions()` returns one. The
SSE endpoint above opens through it, on the same wire as before. A binding gets
the subscription by calling `open(SubscriptionOpen { op_id, input, ctx })` with
`op_id = "model.<Model>.subscribe"`, and the read policy comes with it. A model
feed takes **no input yet**: anything but `null` or `{}` is refused with
`invalid_argument`. Test: `crates/cratestack-pg/tests/subscription_dispatcher.rs`.

### Serving subscriptions over WebTransport *(unreleased, cratestack#1255)*

Three layers, like `extension pgvector`:

```text
transport rpc

extension webtransport {
}
```

```toml
cratestack = { package = "cratestack-pg", version = "…", features = ["webtransport"] }
```

```rust
use cratestack::webtransport::{OriginPolicy, WebTransportConfig};

let config = WebTransportConfig::new(addr, certificate_chain, private_key)
    .origins(OriginPolicy::Allow(vec!["https://app.example.com".into()]));
let server = db.subscriptions().webtransport(config, auth_provider.clone())?;
tokio::spawn(server.serve_with_shutdown(shutdown));
```

It is a second listener, on **UDP**, at `CONNECT /rpc/wt`. Each `@@subscribe`
model is served as `model.<Model>.subscribe` with the same per-event read
policy as SSE. Pass the router's own `AuthProvider`: the session authenticates
from an `Init` frame's headers. These are compile errors:

- the extension without the `webtransport` feature;
- the extension in a schema with no `@@subscribe` model ("no subscription op to
  serve");
- the extension under `include_embedded_schema!`.

`cratestack-client`'s `webtransport` feature only lets a client compile from
such a schema. **No generated client speaks WebTransport yet.** Test:
`crates/cratestack-pg/tests/webtransport_model_feed.rs`. Wire protocol, close
codes, limits and deployment notes: `crates/cratestack-webtransport/README.md`
and `docs/design/subscriptions-websocket.md` §6a.

## Streaming (`@stream`)

`@stream` is a bare attribute on a procedure that **returns a list**. It changes
the `ProcedureRegistry` method's return type from
`Future<Output = Result<Vec<T>, _>>` to `Stream<Item = Result<T, _>>`. It does
**not** change the op descriptor's kind — that is decided purely by the return
arity, so every `T[]`-returning procedure is `OpKind::Sequence` with or without
`@stream`.

Same route, chosen by content negotiation: `POST /rpc/{op_id}` with
`Accept: application/cbor-seq`. Each chunk is one unwrapped payload — no frame
wrapper, no id; end of stream is end of body. An empty sequence is zero chunks
and a clean end of body.

Two consequences of HTTP having exactly one status line and one `Content-Type`:

- The status is committed **before any body byte**, so a mid-stream failure
  cannot change it.
- A mid-stream error arrives as **CBOR tag 48900** wrapping an error body, in
  place of what would have been the next item. Nothing follows it. Detection is
  structural — major type 6 plus the tag number — so a client need not fully
  decode to notice.

A non-`cbor-seq` `Accept` on a `@stream` op falls back to draining into a `Vec`;
the incremental guarantee is scoped to `application/cbor-seq`.

`@stream` is rejected on a `query` block, and rejected when the item type carries
`@computed` fields.

## Client-side batching — `@cratestack/link-batch`

`createBatchLink(options)` returns an `RpcLink`, so it composes with logger and
validator links rather than overriding `fetch`.

| Option | Default | Notes |
| --- | --- | --- |
| `windowMs` | omitted → `queueMicrotask` (same-tick coalescing) | supplied → `setTimeout` |
| `maxBatchSize` | `Infinity` (floored at 1) | applied **per partition**, splitting into concurrent requests |
| `dedupe` | explicit idempotency keys only | returns `null` to opt a call out |
| `headers`, `fetchFn`, `codec` | inherit from the call | link-level headers win |

Calls are partitioned by `fetchFn` identity, `codec` identity, batch URL and a
sorted header signature; `idempotency-key` is excluded from that signature
because it rides per-frame and including it would defeat batching entirely.
Correlation is by frame `id`. **Cancellation is best-effort: an `AbortSignal`
removes a queued entry, and is a no-op once flushed.** An explicit
`runtime.batch()` call passes straight through and is never re-queued.

`createBatchLink` is also re-exported from the `@cratestack/api` umbrella.

There is **no Dart/Flutter port** of the batch link. The transport-agnostic model
is written down so a port needs no redesign, and it records the trap: Dio's
`QueuedInterceptor` is the wrong base class — it serialises and replays requests
individually and never merges them. A plain `Interceptor.onRequest` that holds
the handler is the right primitive.

**The generated Dart RPC client** *(since 0.16.0, cratestack#1204)* sends through one adapter,
`CratestackRpcHttpAdapter(transport, baseUri:, format:)`, over a `CratestackHttpTransport`
seam; Dio is `CratestackDioTransport(dio)`, one transport among several, and the four
`*DioAdapter` classes are gone. An error answer is `CratestackRpcException` (`status` plus
the `RpcErrorBody` `code`), no answer is the sealed `CratestackTransportException`.
`CratestackRpcCallOptions` has `headers`, `idempotencyKey` (unary `call` only) and `abort`.
`stream()` yields `application/cbor-seq` items as they arrive instead of buffering, and a
trailing `Tag(48900, RpcErrorBody)` item becomes a `CratestackRpcException`; because it is an
`async*` generator, every failure is the stream's error. A rejected field is `422
invalid_argument`. Detail and the upgrade steps: `cratestack-clients`,
`references/dart-transport.md`. There is still no Dart port of the automatic batch link
(the trap above stands); `batch()` on the adapter sends an explicit batch.

Client middleware links are **RPC-only**; the REST binding has no link chain yet.
Streaming runs through a **separate** `RpcStreamLink` chain, deliberately not a
variant of `RpcLink` — a stream has no batch URL, and folding it in would break
exhaustive switches in wire types Dart and Rust also consume. The stream chain
never throws: a mid-stream failure is a `{kind: "error"}` value, and only
`stream()` above the chain converts it to a thrown error.

## The parity rule

**REST and RPC ship together, never REST first.** Any feature touching the
request/response surface — query parameters, projections, per-request arguments,
new response shapes, client call surfaces — lands on **both** transports in the
same PR. A genuinely excluded transport is a design-doc'd, changelog'd decision,
not an omission. The rule exists because the `@computed` params surface shipped
REST-only once and closing the gap took three follow-up PRs.

**The mechanism that makes this cheap:** RPC dispatch does not reimplement
parsing. `RpcListInput` / `RpcGetInput` are turned back into a real urlencoded
query string by `synthesize_list_query` / `synthesize_get_query`, and handed to
the **same** `parse_model_list_query` / `parse_model_fetch_query` REST uses. One
validator, one error vocabulary, identical statuses on both bindings.

The same holds for what the parser **refuses**: a relation filter or sort in an
RPC `list` frame applies the related model's read policy and `@@soft_delete`, and
a `@server_only` field is refused as a filter or sort key, exactly as on REST
*(since 0.13.0)* — see `cratestack-server`.

So the server half of a parity change is usually:

1. one `#[serde(default)]` field on `RpcListInput` or `RpcGetInput`
2. one `pairs.push((...))` in `synthesize.rs`

Every added slot being `#[serde(default)]` is why no addition needs a wire-format
version bump: an old frame decodes unchanged, and a new client that sets nothing
emits byte-identical bytes.

The expensive half is the clients. A real parity change touches, at minimum:

- core wire types, macro dispatch (`transport/rpc.rs`), and the axum synthesizer
- the Rust client codegen, both REST and RPC paths
- the TypeScript templates: `rest-client`, `rpc-client`, `rest-queries`,
  `rpc-queries`, **and** the `swr/` template family
- the Dart templates: `models`, `rest-apis`, `rpc-apis`, **and** the `riverpod/`
  family
- the WireMock stub generator
- snapshot fixtures for every one of those
- cross-language wire-format tests, and a live-Postgres parity proof

`RpcListInput` carries the full REST selection surface — and `RpcGetInput` gained
its half *in 0.8.12*, before which a `fields` key on an RPC get frame was
**silently dropped by serde** and the server returned the full record: `limit`, `offset`,
`fields`, `include`, `include_fields`, `sort`, `where` (renamed from
`where_expr`), `or`, `filters`, and `computedParams`. `computedParams` is a
**raw JSON string, not a nested value** — three reasons, all real: a nested value
corrupts CBOR `Option::None` on round trip, `/rpc/batch` re-encodes `input`
through a JSON value and a string survives that verbatim, and carrying the same
bytes REST puts on the query string means the same validator runs unmodified.

## REST-only and RPC-only

- `@status(...)` is **REST-only** and hard-rejected under `transport rpc`.
- `@@subscribe` is **RPC-only**.
- The `RpcLink` middleware chain is RPC-only.
- WireMock stubs for RPC model CRUD have **no per-record statefulness** by
  design — they always answer the same synthesised example.

## Not built, deliberately or yet

Resumable subscriptions (no cursors, no replay), in-batch transactional mode,
in-batch dependencies, per-frame signing in WebSocket sessions, HTTP/2 push, and
cross-schema dispatch are all explicit v1 non-features. The **WebSocket binding
is pending**, gated on a real bidirectional case. Batch parallelisation is
deferred. The `StreamItem` / `StreamEnd` / `Cancel` frame variants that appear in
the design doc are wired nowhere (`cratestack_core::codec::StreamEnd` is an
unrelated envelope-sealing type, and streams cannot be sealed in 0.14.0).
