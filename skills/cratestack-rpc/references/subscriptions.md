# Subscription procedures, topics, the WebSocket binding, the clients

> **Verified against CrateStack 0.20.6**. Everything here is *(since 0.18.0)* unless marked:
> cratestack#1268, plus the PRs named inline (#1269, #1270, #1271, #1280, #1282), all
> in the 0.18.0 release; the WebSocket rate limit and refusal-code notes below (0.19.3) and the CBOR item form (0.19.6) are the only changes since. None of it
> exists on 0.17.x or earlier. Source of truth:
> `docs/design/subscriptions-websocket.md` §3.2–3.4, §6, §8, §11 ("S4 status",
> "S5 status", "S6 status, Rust").

## Subscription procedures and topics

```text
type RoomArgs {
  roomId String
}

type ChatMessage {
  roomId String
  body String
}

/// A room's messages, on every replica.
topic RoomMessage(roomId: String): ChatMessage

/// Live messages of one room.
subscription procedure roomMessages(args: RoomArgs): ChatMessage
  @allow(auth() != null)
```

(`crates/cratestack-pg/tests/fixtures/subscription_procedures.cstack`.)

Parser rules:

- **Item type**: a subscription procedure returns one item type. `ChatMessage[]`
  is refused ("must return a single item type").
- **Refused attributes**: `@stream`, `@isolation`, `@no_idempotency`,
  `@status`, `@no_rate_limit` and `@mcp`. Each error names the reason, for
  example "a subscription is already a stream".
- **Kept attributes**: `@allow`, `@deny`, `@authn`, `@authorize` and
  `@api_version`. They work exactly as on a procedure, evaluated once, at open.
- **Names**: a subscription procedure's name is unique among *all* procedures,
  because it shares the op id `procedure.<name>`.
- **Topic keys**: exactly one key, of type `String`, `Int` or `Uuid`.

The handler is a `ProcedureRegistry` method. Its future is setup; an `Err`
from it refuses the subscription before `Ready`. The stream it resolves to *is*
the subscription. The item type is `<procedure>::Output`, not `Item`.

```rust
impl cratestack_schema::procedures::ProcedureRegistry for Rooms {
    async fn room_messages(
        &self,
        db: &cratestack_schema::Cratestack,
        _ctx: &CratestackContext,
        args: room_messages::Args,
        _authorized: room_messages::Authorized,
    ) -> Result<SubscriptionStream<room_messages::Output>, CratestackError> {
        if args.args.roomId == "secret" {
            return Err(CratestackError::Forbidden("not a member of this room".to_owned()));
        }
        db.topics().room_message(&args.args.roomId).subscribe().await
    }
}
```

(`crates/cratestack-pg/tests/subscription_procedures.rs`.) A stream that ends
ends the subscription cleanly: SSE closes and WebTransport/WebSocket send
`end`. Unlike a model feed, this is not an error. A policy refusal of an
anonymous caller is **403**, the same as for a unary procedure.

### Where it is served

| Binding | How |
|---|---|
| RPC SSE | `GET /rpc/subscribe/procedure.roomMessages?args={"roomId":"r1"}`: each argument is a query parameter whose value is that argument's **JSON** (`args=r1` is a 400). Or `POST` the same path with the JSON input as the body. |
| REST SSE | `GET /$procs/roomMessages?args=…` (`@api_version` applied). The op key is `GET <path>`, not `POST`. |
| WebTransport / WebSocket | `Request { op: "procedure.roomMessages", input: {"args": {"roomId": "r1"}} }`. The input is the procedure's `Args` object, as for a unary RPC call. |

`POST /rpc/subscribe/{op_id}` with a JSON body works for model feeds too: the
body is `RpcSubscribeInput`.

**The dispatcher holds the registry** once a schema has a subscription
procedure. Build it with `db.subscriptions(registry)`, which returns a
`SubscriptionDispatch<R>`. A schema without one keeps `db.subscriptions()`.

`db = None` (`cratestack-api`) supports subscription procedures, with the
handler's own stream as the source (`crates/cratestack-api/tests/subscription_procedure_no_database.rs`).

### Topics

`db.topics().room_message(&room_id)` returns a `cratestack::Topic<ChatMessage>`
on the runtime's backplane, channel `cratestack.topic.RoomMessage.<key>`.

- **`publish(&msg).await`** delivers to every current subscriber, on every
  replica.
- **`publish_in_tx(tx, &msg).await`** sends `pg_notify` inside the
  transaction, so the message is delivered only if the transaction commits, in
  commit order:

  ```rust
  db.transaction(async |tx| topics.room_message("r1").publish_in_tx(tx, &msg).await).await?;
  ```

  It returns an `Internal` error with `InProcessBackplane`; with that backplane,
  call `publish` after the commit.
- **`subscribe().await`** resolves once the subscription is live. It ends with
  `unavailable` on lag or resync.
- **Size**: a message must encode under Postgres' 8000-byte `NOTIFY` limit.
- **`db = None`** *(since 0.18.0, cratestack PR #1280)*: topics work, on the
  `cratestack-api` facade (or `cratestack-pg` with `postgres` off). Same
  `db.topics().<topic>(key)` with `publish`, `subscribe`, `channel`; no
  `publish_in_tx` (no transaction, so publish after the work). The default
  backplane is one `InProcessBackplane` per schema, shared by every
  `Cratestack::builder().build()` in the process: single replica. For several
  replicas pass your own with `.with_backplane(Arc::new(..))` (the builder takes
  no pool). With a topic, the `db = None` `Cratestack` is `Clone`, not `Copy`.
- **`@isolation` procedures** *(since 0.18.0, cratestack PR #1280)*: use
  `tx_db.topics()` on the `IsolatedCratestack` handle. Its `publish` is delivered only if the attempt commits, never for an
  attempt that errors or is retried, on either backplane (`PgNotifyBackplane`
  notifies inside the transaction; `InProcessBackplane` queues until the
  commit). Don't publish "after the commit" by hand. Inside
  `tx_db.transaction(async |tx| ..)` call `publish_in_tx(tx, &msg)` (plain
  `publish` is refused there); a `transaction(..)` that rolls back drops its
  messages even when the attempt commits. Topics from a plain `Cratestack`
  publish immediately, including in `@authorize` and `@computed` hooks.

### Byte payloads on the backplane *(since 0.20.6, cratestack#1419)*

The backplane carries your own binary rows, not only text. `SubscriptionBackplane::publish_bytes(channel, &[u8])` publishes bytes; a subscriber of that channel receives `BackplaneMessage::Bytes(Arc<[u8]>)`, exactly as published, in order with any text on the same channel (`BackplaneMessage::Payload`). `InProcessBackplane` and `PgNotifyBackplane` implement it. Before 0.20.6 there is no `publish_bytes` and no `Bytes`: do not write this against an older version.

```rust
use cratestack::{BackplaneMessage, CborCodec, CratestackCodec};  // facade re-exports (cratestack-pg)
use futures_util::StreamExt;

let bytes = CborCodec.encode(&row)?;                       // CrateStack CBOR (cratestack-codec-cbor)
backplane.publish_bytes("rows.invoice", &bytes).await?;     // Err(BadRequest) when too large

let mut rx = backplane.subscribe("rows.invoice").await?;
while let Some(message) = rx.next().await {
    match message {
        BackplaneMessage::Bytes(bytes) => { /* decode with the same codec */ }
        BackplaneMessage::Payload(text) => { /* text on this channel */ }
        _ => {} // required: Resync, Lagged, and any future variant
    }
}
```

- **Encode with the framework's CBOR codec; never hand-roll base64 (or CBOR) in app code.** `publish_bytes` takes raw bytes and the envelope handles the transport encoding. Encode with `CborCodec` (`CratestackCodec::encode`, from `cratestack-codec-cbor`, re-exported by the facade) and decode with the same codec, so the bytes are what the clients and servers already speak.
- **Keep a wildcard arm.** `BackplaneMessage` is `#[non_exhaustive]` *(since 0.20.6)*, and gained `Bytes`: a `match` outside `cratestack-core` that lists every variant stops compiling on 0.20.6 and breaks again on the next variant. On `Resync` or `Lagged` a real consumer ends its stream (messages may have been lost), as the framework's own do; do not swallow them in `_ => {}` in production code.
- **Respect the size limit.** The 8000-byte Postgres `NOTIFY` limit applies to the final notification text (`cbor:` plus base64 of a CBOR map), 7,900 bytes in the backplane. The largest byte payload is **about 5.8 KB**, a little less for a long channel name. An oversized `publish_bytes` returns `CratestackError::BadRequest` naming the sizes; it never truncates, and there is **no outbox fallback** (a text *model event* over the limit still goes as a reference to its outbox row; bytes have no row). For bigger rows, publish a key and fetch the row, or split it. Check the size before publishing if you cannot tolerate the error.
- **Plain text got smaller under CBOR.** A plain-text `publish` or topic message must now fit in about **5,900 bytes** with a one-character channel, less the channel's length (5,866 for a 35-character topic channel), against about 7,870 (7,840) under JSON. A text payload between those sizes used to be sent and now errors `BadRequest`, unless `use_json_envelope()` is on, which keeps the JSON figure. If even the outbox *reference* for a model event does not fit (a model name of about 5,880 characters under CBOR, about 7,860 under JSON), the write fails with `CratestackError::Internal` instead of committing an unannounced event.
- **A hand-written `SubscriptionBackplane` refuses bytes** until it overrides `publish_bytes`: the default returns `Internal("this backplane does not carry byte payloads")`.
- **The framework's text channels skip a stray `Bytes`** (model feed, topics, the revocation follower): a `warn!`, the message dropped, the stream or follower keeps running. Do not publish bytes on `cratestack.model.*`, `cratestack.topic.*` or `cratestack.revocation`; use your own channel names.
- **The `NOTIFY` envelope is CBOR now** *(since 0.20.6)*: `cbor:` + base64 of a map `{"v": 1, "c": channel, "t" | "b" | "r": text | bytes | outbox id, "n": nonce}`. The reader reads it and the legacy JSON `{"c","p","r","n"}` (plus `b`), tolerating whitespace before the `{`, and ignores the nonce. **The readers are strict:** a duplicate key, a second payload key or trailing bytes after the CBOR map, or more than one of `p`/`r`/`b` in JSON, is logged (`warn!`) and skipped, as is anything else unreadable. If you issue a raw `pg_notify('cratestack_events', ..)` from SQL, send exactly one payload key; the JSON form is still accepted.
- **Mixed 0.20.5 / 0.20.6 rollout: call `PgNotifyBackplane::use_json_envelope()` once at startup, before the first write.** A 0.20.5 replica cannot read the CBOR envelope and skips it, so it would miss model events and topic messages written by a 0.20.6 replica. Step 1: deploy 0.20.6 with the call on every replica (they write JSON, read both). Step 2, once no 0.20.5 replica remains: remove it and redeploy. **It is a process-wide switch, not a setting of one backplane:** it covers every `PgNotifyBackplane` in the process, built before or after the call, and the writers with no backplane (a model event's outbox write, a topic's `publish_in_tx`). `with_json_envelope()` is a thin builder wrapper around it and is just as process-wide. Writes before the call went out as CBOR, and it cannot be undone in-process (redeploy without it). In JSON mode a byte payload is base64 in a field (`b`) that 0.20.5 replicas ignore, so bytes reach 0.20.6 replicas only, and the limit is that of the base64 text. Skip it on a fleet that is all 0.20.6, or on a fresh deployment.

## The WebSocket binding

```text
transport rpc

extension websocket {
}
```

```toml
cratestack = { package = "cratestack-pg", version = "…", features = ["websocket"] }
```

```rust
let app = cratestack_schema::axum::rpc_router(db.clone(), registry.clone(), (), CborCodec, auth.clone(), limit)
    .merge(db.subscriptions(registry).websocket(
        // optional (since 0.19.3); without `.rate_limit(..)` WS opens are unlimited
        WebSocketConfig::new().rate_limit(rate_limit_layer.for_subscriptions()),
        auth,
    ));
```

(`crates/cratestack-pg/tests/websocket_subscriptions.rs`; without
subscription procedures it is `db.subscriptions().websocket(..)`.)

- **Route**: `GET /rpc/ws`, or `/$ws` on REST, unless `WebSocketConfig::path`
  names another. `cratestack-api` has the same feature.
- **Compile errors**: the extension without the feature; the extension with no
  subscription op; the extension under `include_embedded_schema!`.
- **Subprotocol**: `cratestack.rpc.v1+cbor` (binary messages) or
  `cratestack.rpc.v1+json` (text messages). Without a subprotocol, the `codec`
  query parameter decides, else CBOR. A message of the wrong kind closes with
  4400.
- **Frames**: the same as WebTransport, plus cancel. A frame's `input` and `next` are
  `RpcFrameValue`s in the socket's codec form: on the CBOR subprotocol a `Uuid` is a 16-byte
  string and bytes in a `Json` field a byte string; on JSON, text and an integer array
  *(CBOR form since 0.19.6, cratestack#1360)*.
  - `Init { id: 0, init: { headers } }` must be the first frame, within 10 s.
    It is **always** required. A native client sends its headers on the upgrade
    and an empty `Init`; a browser puts its headers in `Init`.
  - Then `Request { id, op, input }`. Each gets `Ready { id }`, then items
    `{ id, next }`, then one `{ id, end: {} }` or `{ id, err }`.
  - `{ id, cancel: {} }` ends subscription `id`; the server answers with `end`.
  - An `id` already in use, or id 0, gets `err` with `invalid_argument`.
- **Refusal**: `{id: 0, err}` comes first, then the close: 4401
  unauthenticated, 4403 forbidden, 4400 bad frame, 4500 when the provider could
  not decide (retry, do not sign out). A later `Init` refreshes the credentials
  and must name the same principal (else 4403). The socket closes with 4401 when
  the credential's `exp` passes.
- **Origin**: same-origin only by default (`OriginPolicy`). Over plain HTTP,
  the authority's `http://` origin also counts. A refused origin gets 403 on the
  upgrade.
- **Limits** (`WebSocketLimits`):

  | Limit | Default | When exceeded |
  |---|---|---|
  | Subscriptions per socket | 64 | `resource_exhausted`, the socket stays up |
  | Sockets per principal | 8 | close 4429 |
  | Message size | body limit | 1009 |
  | Outbound queue | 1024 frames | close 1013 |
  | Ping | every 15 s | close 1001 after 30 s with no pong |

- **Rate limit** *(since 0.19.3, opt-in)*: `WebSocketConfig::rate_limit(layer.for_subscriptions())`
  (`WebTransportConfig::rate_limit` is the same). One token per `Request` frame
  (per stream on WebTransport), after the per-socket cap and before policy;
  unknown ops are charged; upgrade and `Init` are free. Bucket `princ:<sha256>`
  else `ip:<peer>`, shared by WS and WT. A throttle is `{id, err: {code:
  "resource_exhausted", details: {retry_after_secs}}}` before `Ready`; the socket
  stays up, there is no close code, and `Auto` does not fall back. The per-socket
  cap above is also `resource_exhausted` but carries no `details`. An anonymous
  socket without `into_make_service_with_connect_info::<SocketAddr>()` gets
  `failed_precondition`. **SSE** needs nothing extra: `RateLimitLayer` over the
  generated router charges the open. Subscription ops cannot be `@no_rate_limit`.
  See `cratestack-data-integrity`.
- **Unary calls over WebSocket**: gated (decision O5). Any op other than a
  subscription is `not_found`.

The frames, admission, `OriginPolicy` and the session registry live in
`cratestack_core::subscription_wire`. `cratestack-webtransport` re-exports them
unchanged.

## The `application/cbor-seq` binding *(since 0.20.3, cratestack#1001)*

Source of truth: `docs/design/subscriptions-websocket.md` §7.3 and the framework `CHANGELOG.md` (`## 0.20.3`). Before this, HTTP subscriptions were SSE only.

- **Server**: the same four subscribe routes answer `Accept: application/cbor-seq` (RPC `GET` and `POST
  /rpc/subscribe/{op_id}`, REST `GET /$procs/<name>` and `GET /<plural>/$subscribe`). REST has no `POST`
  subscribe form. `Content-Type: application/cbor-seq`.
- **Negotiation**: `application/cbor-seq` selects it; `text/event-stream` and `*/*` stay SSE. Entries are
  matched literally (no q-values) and **the first entry the server speaks wins**, so `application/cbor-seq, text/event-stream`
  is cbor-seq and the reverse is SSE. A missing or unacceptable `Accept` is `406` (`not_acceptable`) before
  authentication; its message now reads `subscription endpoint requires Accept: text/event-stream or
  application/cbor-seq`, so match on the status or code. The deprecated `validate_subscribe_accept_header` is
  still SSE-only.
- **Framing**: SSE's frames, CBOR-encoded, as a CBOR sequence in which each item is one `ServerFrame`:
  `{id: 1, ready: {}}`, then `{id: n, next: <item>}` (ids count up per frame, `n` from 2; WebTransport instead
  uses one subscription id throughout, so ids are not shared between the bindings), then exactly one terminal `{id, err}` or `{id, end: {}}`. Unlike SSE, a source
  that ends sends `end`. A bare CBOR `null` (`0xf6`) every 15 s is a keep-alive, not a frame. Items are
  CBOR-encoded, so a `Uuid` is a byte string. A refusal before the stream is the same JSON error body as SSE.
- **`Vary: Accept`**: every response the generated subscribe handler makes carries `Vary: Accept`, set once by the handler (a compact answer, `application/vnd.cratestack.compact+…`, adds a second `Vary` line naming `Cratestack-Contract`, which caches combine): success on both bindings (SSE and cbor-seq) and every refusal the handler itself makes (the 406, auth refusals, the RPC POST body 400 and an unknown op). A refusal from a layer in front of the handler does not carry it: the 413 body limit, a 405, a path rejection, the rate-limit 429, an envelope-layer error.
- **`POST /rpc/subscribe/{op_id}`** reads its open body by `Content-Type`: `application/cbor` is CBOR, anything
  else (or none) is JSON.
- **Bounds**: the credential-expiry cut-off and the open rate limit apply (shared with SSE).
  `SessionRegistry::admit` (the per-principal cap) is WebSocket and WebTransport only; SSE and cbor-seq do not use it.
- **Server types** in `cratestack::rpc`: `SubscribeBinding::CborSeq`, `SubscribeBinding::codec()` ->
  `SubscribeCodec`, `encode_subscription_cbor_seq_response`,
  `decode_subscribe_open_body`; the media type is the existing `cratestack::CBOR_SEQUENCE_CONTENT_TYPE`, at the crate root (not under `rpc`) on both the `cratestack-pg` and `cratestack-api` facades (no new constant). Generated handlers pass `binding.codec()` where they passed `SseCodec`
  (which stays).
- **Clients opt in; `Auto` / `"auto"` / `auto` never picks it:**
  - Rust: `ClientConfig::with_subscription_transport(SubscriptionTransport::CborSeq)`; cap one frame with
    `with_max_subscription_frame_bytes(n)` (an alias of `with_max_sse_event_bytes`, same 1 MiB field).
  - TypeScript: `subscriptions: { transport: "cbor-seq" }`; needs `@cratestack/cbor` (a dependency of an RPC
    package, an optional peer of a REST one; without it, a cbor-seq subscription fails with `CratestackSubscriptionError` code `codec_unavailable` before any request is sent); cap is `maxEventBytes`. A REST package with a subscription now
    also emits `src/cbor-item.ts` and `src/cbor-argument.ts`.
  - Dart: `CratestackSubscriptionOptions(transport: CratestackSubscriptionTransport.cborSeq)`; cap is `maxEventBytes`.
- **Errors, every client**: a frame over the cap is `EventTooLarge` (`CratestackEventTooLargeError` /
  `CratestackEventTooLargeException`). Invalid responses are `ClientError::InvalidResponse` (Rust),
  `CratestackSubscriptionError` with code `invalid_response` (TypeScript) and `CratestackSubscriptionException`
  with code `invalid_response` (Dart): a `Content-Type` that is not `application/cbor-seq` (parameters ignored,
  case-insensitive); a first frame that is `end` or `next` instead of `ready`; a non-map item; a body that
  ends inside a frame, or between frames without `end` or `err`, never a quiet end. An `err` as the first
  frame is the server's refusal and carries the server's code.
- **Model event ids**: a model event's `event_id` is a 16-byte CBOR byte string on cbor-seq. TypeScript
  (`ModelEvent.event_id`) and Dart (`CratestackModelEvent.eventId`) revive it to the canonical hyphenated UUID
  string; Rust's `ModelEvent.event_id` is a `Uuid`.
- **Breaking for exhaustive matches** on `SubscriptionTransport` (Rust, not `#[non_exhaustive]`) and
  `CratestackSubscriptionTransport` (Dart): add an arm.
- Not in it: `Auto` selection, compression, resumption, MCP (exempt, ADR 0002 D5).

## Ending a principal's streams *(since 0.20.5, cratestack#1381)*

A stream authenticates **once, at open**. Before this, only its credential's `exp` (and, signed, the stream lifetime) ended it: a device revoked a minute later kept receiving events. Now the app calls `revoke` and every stream and socket session of that principal ends, on SSE, cbor-seq, WebSocket and WebTransport, REST and RPC alike. Nothing happens until the app calls it: the default registry never revokes. Source: `crates/cratestack-core/src/subscription_revocation/`, `crates/cratestack-axum/src/rpc/principal_bound.rs`, tests `crates/cratestack-api/tests/subscription_revocation_{rpc,rest}.rs`, `crates/cratestack-pg/tests/stream_revocation_replicas.rs`.

Call it from the logout, suspend and device-revoke handlers. The registry is `db.stream_revocations()` (a `&StreamRevocations`; generated for `db = Postgres`, and for `db = None` only when the schema declares a `topic` or a `subscription procedure`):

```rust
use std::time::{Duration, SystemTime};
use cratestack::{RevocationKey, StreamEndReason};

// Longest `exp` a still-cached credential of this principal could carry.
let until = SystemTime::now() + Duration::from_secs(15 * 60);
let ended: usize = db.stream_revocations().revoke(
    RevocationKey::Session(sid),            // logout
    StreamEndReason::SessionEnded,
    Some(until),
);
```

- **`revoke(key, reason, until) -> usize`** ends every live stream and socket session holding `key` with a typed reason and returns how many it ended. A stream already ended keeps its first reason.
- **The key kinds** (`RevocationKey`): `Subject(String)` (every session of one user: a suspension), `Session(String)` (the `sid` claim: one login, a logout), `Signer([u8; 32])` (the RFC 9679 thumbprint of the key that signed the open: one enrolled device), `Custom(String)` (whatever else the app keys by). Match the reason to the key: `SessionEnded` / `Session`, `PrincipalSuspended` / `Subject`, `DeviceRevoked` / `Signer`.
- **`default_revocation_keys`** is what a stream is held under unless you replace it: the context's `subject()`, its `sid` claim **only when that is a string**, and the signer thumbprint when the open was signed. `sid` is not a reserved claim, so an app that carries a session id under another name supplies its own `fn(&CratestackContext) -> Vec<RevocationKey>` with `StreamRevocations::with_keys(..)` (one place: streams and sockets cannot disagree). A principal with none of the three keys cannot be revoked by key.
- **`until` is the credential's longest `exp`.** `Some(until)` also keeps a *tombstone*: a later open (or socket `Init`) under that key is refused until then, so a cached context cannot simply reopen. Give the longest `exp` a context of that principal could still carry (the credential's maximum lifetime from now). `None` ends live streams only and tombstones nothing, so the client may reopen at once. **Never tombstone with a resubscribe reason** (`stream_lifetime`, `revocation_resync`): `revoke` / `publish` end the live streams but keep NO tombstone (with a `warn!`), because clients retry those reasons without a cap and would reconnect until it lapsed. Tombstones belong with `session_ended`, `principal_suspended`, `device_revoked` (or `credential_expired`) *(since 0.20.5)*. Tombstones are capped (`DEFAULT_MAX_TOMBSTONES` = 100 000, `with_max_tombstones(n)`; soonest-lapsing dropped first, with a `warn!`). A tombstoned open fails with the same typed end, before `Ready`.
- **Wiring a custom registry**: `Cratestack::builder()...with_stream_revocations(StreamRevocations::default().with_max_tombstones(n).with_keys(f))`, then `db.stream_revocations()` returns it.

### Several replicas

`revoke` reaches only this process. With more than one replica, `publish` instead and run a follower on every replica:

```rust
// Keep the backplane Arc you give the builder (`.with_backplane(backplane.clone())`);
// the generated `Cratestack` has no accessor for it.
let backplane: Arc<dyn SubscriptionBackplane> = Arc::new(PgNotifyBackplane::new(pool.clone()));
let revocations = db.stream_revocations().clone();
tokio::spawn(revocations.follow(backplane.clone()));   // once per replica

db.stream_revocations()
    .publish(&*backplane, RevocationKey::Subject(user), StreamEndReason::PrincipalSuspended, Some(until))
    .await?;
```

- **`publish(&backplane, key, reason, until)`** revokes locally (returns how many this replica ended) **and** sends on the channel `REVOCATION_CHANNEL` (`"cratestack.revocation"`). A replica that is not running `follow` never hears it. The local revoke is not undone: if the backplane send fails, `publish` returns `Err` with this replica's streams already ended (count lost); only other replicas missed it, so retry.
- **`follow(backplane)`** applies what other replicas send and resubscribes after a gap; spawn it once per replica. Use the same backplane the runtime was built with (`PgNotifyBackplane` is the Postgres default; it and `SubscriptionBackplane` are re-exported by the facade; on `db = None`, an `InProcessBackplane` reaches this process only). It returns only when subscribing fails: log it and respawn with a pause.
- **`ResyncPolicy::EndAll` is the default and fails closed.** When the backplane may have lost messages (`Resync`, `Lagged`, a dropped `LISTEN`), every watched stream ends with `revocation_resync` (503), because a revocation may have been lost. Clients reopen with a jittered backoff. `follow_with(backplane, ResyncPolicy::Ignore)` keeps the streams instead; choose it only where a flapping listener costs more than a lost revoke going unnoticed until `exp`. Delivery is at-most-once. **A payload cannot end the follower:** the revoke always applies, and only an `until` no `SystemTime` can hold is clamped to now + 24 h; a negative, NaN or non-numeric `until` revokes with no tombstone and a `warn!`; a malformed payload is skipped with a `warn!`; a `reason` this version does not know (a newer replica) revokes as `session_ended` with a warning. However the follower ends, it applies its `ResyncPolicy` last (`EndAll` ends every watched stream with `revocation_resync`).
- `publish_in_tx` does not exist for revocations; with `PgNotifyBackplane` you may issue the same `NOTIFY` inside the transaction that records the change. The payload is JSON `{"kind","key","reason","until"}`; **`until` is integer seconds since the epoch.** When you NOTIFY from SQL, send integer seconds (`extract(epoch from expires_at)::bigint`) or rely on the follower rounding a fraction or numeric string up; do not send a negative or non-numeric value, which revokes but keeps no tombstone. Never put a resubscribe reason (`stream_lifetime`, `revocation_resync`) in a payload that expects a tombstone *(since 0.20.5)*.

### What a tombstone does NOT do

- **It does not refuse unary calls.** A revoked device or suspended user can still call `POST /rpc/...` / REST routes until the `AuthProvider` refuses them. Tombstones refuse new **stream opens** and socket `Init`s only. Make the provider check the revocation list too (see `cratestack-policy-auth`).
- It does not re-check policy on a stream that is open: only `revoke` (or `exp` / the signed lifetime) ends it. There is no periodic re-check (not in this change).
- A hand-written `SubscriptionDispatcher` gets **none** of this (as with expiry): only the generated opens are bound. Its `revocations()` defaults to `None`.
- MCP is exempt (ADR 0002 D5).

### What the client is told

The terminal `err` frame carries `details: {"reason": "<snake_case>"}`; a closed WebSocket / WebTransport session sends `{id: 0, err}` and closes 4401 / 4403 / 4500 (4500 = retry, not sign out). On a revocation or expiry each open subscription first gets its own `err` frame with the reason (WebSocket: in id order; WebTransport: one per stream). WebTransport also now closes with 4401 at the credential's `exp` (WebSocket already did).

| `details.reason` | code / status | client should |
|---|---|---|
| `credential_expired` | `unauthenticated` 401 (message `credential expired`, as before) | refresh the credential, then resubscribe (your app's job) |
| `stream_lifetime` | `unavailable` 503 (message `stream lifetime`, as before) | resubscribe with jittered backoff |
| `session_ended` | `unauthenticated` 401 | **never auto-retry**: sign in again |
| `principal_suspended` | `permission_denied` 403 | **never retry** |
| `device_revoked` | `permission_denied` 403 | **never auto-retry**: re-enrol |
| `revocation_resync` | `unavailable` 503 | resubscribe with jittered backoff |

`StreamEndReason` is `#[non_exhaustive]` (match with a wildcard); a new Rust variant `CratestackError::StreamEnded(StreamEndNotice)` is the source-breaking edge for a hand-written mapping of every `CratestackError` variant. The client readers, below and in `cratestack-clients`, give the reason typed.

**Do not:** poll your own table to notice a revocation (that is what `revoke` is for); treat a reason you do not know as fatal (a newer server may send more: fall back to the `code`); expect a hand-written `SubscriptionDispatcher` to be revoked.

## Signed services: `@frames(unsigned)` *(since 0.20.4, cratestack#1378 parts B1 and B2)*

Source of truth: `docs/design/subscriptions-websocket.md` §7.4, `crates/cratestack-axum/src/envelope_layer/signed_subscription.rs` and the tests `crates/cratestack-api/tests/signed_subscription_{rpc,rest}.rs`. The generated Rust, TypeScript and Dart clients open a marked subscription signed (part B2; see below). A client that holds an envelope never sends a subscription in plain: it seals the open or refuses it locally, with nothing sent.

Under a `Required` envelope a signed open of a subscription was a sealed `406`. A `subscription procedure` marked `@frames(unsigned)` now may be opened signed:

```text
subscription procedure roomMessages(args: RoomArgs): ChatMessage
  @frames(unsigned)
```

- **The open is verified like a unary call** (signature, `kid`, audience, replay, nonce, op contract); `@allow` runs against the principal the signature names. **The frames that answer are plain and unauthenticated.** Treat them only as hints (an id), then re-read through a sealed call. Never take a value from a frame; `@@subscribe` model feeds carry rows and are not eligible.
- **Routes**: RPC `POST /rpc/subscribe/{op_id}` (sealed message as the body; the one browsers can send), or `GET` with the input as a query; REST `GET /$procs/<name>` with the sealed message as the body, which browsers cannot send (cratestack#1407). A sealed `HEAD` is a sealed `406`. The envelope layer's resolver now binds `POST` on the subscribe route, so an *unsigned* `POST` there under `Required` is the coarse `401`.
- **`Accept` must name the stream, literally**: `application/cbor-seq` or `text/event-stream` (first one listed wins). `*/*`, no `Accept` or two `Accept` headers is a sealed `406`.
- **The answer**: a `2xx` stream in that type, unsealed, with `Cratestack-Frames: unsigned` and `Cache-Control: no-store`, no `Cratestack-Payload-Type`. Everything else (`403` from `@allow`, `400`, a stream of another type) is **sealed**, so a refusal is never frames. This is the one exception to "a signed request is always answered sealed", and it holds in every mode that accepts a signed request (`Required`, `Optional`, `UnsignedRequestSealedReply`). Tamper, replay, wrong audience, or a signer the principal mapper refuses is the coarse unsigned `401`; an old op contract the unsigned `426`.
- **Lifetime**: `EnvelopeLayerBuilder::max_signed_stream_life(Duration)` (default `DEFAULT_MAX_SIGNED_STREAM_LIFE`, one hour; `build` refuses zero and anything above `MAX_SIGNED_STREAM_LIFE`, 24 hours, with a `Validation` error naming the cap). At the deadline the stream ends with `err` `unavailable` / `"stream lifetime"`; resubscribe with a **fresh signed open** (nonces are single-use) and jittered backoff, since a relay can forge that frame. The credential's `exp` applies too; the earlier wins. Handlers call `serve_subscription_with(binding, &extensions, open)`; `serve_subscription` delegates to it.
- **Limits**: refusal detail is lost once sealed; no per-principal cap on concurrent signed streams (use `RateLimitLayer::for_subscriptions`); signed frames are #1020, chained frames #1008 (`@frames(sealed)` / `@frames(chain)` are refused).
- **Clients** *(part B2)*. **Rust**: `subscribe()` on a client with an envelope seals the open (`POST` of the input's CBOR on RPC, `GET` with the sealed message as its body on REST; `Auto` picks cbor-seq, never a socket); an unmarked subscription, a socket pin, REST on `wasm32` or `@stream` is `EnvelopeError::StreamsUnsupported`; an answer without `Cratestack-Frames: unsigned` exactly once and the requested `Content-Type` is `EnvelopeError::UnsignedFramesRefused`; every `subscribe()` seals anew. **TypeScript**: `subscriptions: { seal: createSealedSubscriptions({ cose, contracts: OP_CONTRACTS }) }` on the **RPC** runtime only (REST is a `CoseFailure` `misuse`); an unmarked subscription or a socket pin is `streams_unsupported`; the same marker check throws `UnsignedFramesRefused`. **Dart**: the generated client never seals, and signs nothing unless the app opts in with `CratestackSubscriptionOptions(sealsSubscriptions: true)` (default `false`: a plain open, no `extra`, no marker check). On, it hands the app's transport `cratestack.frames`, `cratestack.route` and `cratestack.contract` in `request.extra`, refuses a bad answer with `unsigned_frames_refused`, throws `streams_unsupported` (nothing sent or connected) for an unmarked subscription or a socket pin, and reads a non-2xx the transport did not mark `CratestackHttpResponse(opened: true)` as `unsigned_refusal`. TypeScript's sealed `fetch` uses `redirect: "error"` and reports an unsigned refusal as `unsigned_refusal` too; a cross-origin browser needs `Access-Control-Expose-Headers: Cratestack-Frames` from the server's CORS layer. A forged `unavailable` can loop a resubscribe: back off with jitter.
- MCP is exempt (ADR 0002 D5).

## The Rust client

`include_server_schema!` and `include_client_schema!` both generate the client
methods, on REST and RPC clients:

```rust
let config = ClientConfig::new(base).with_subscription_transport(SubscriptionTransport::Auto);
let client = cratestack_schema::client::Client::new(CratestackClient::cbor(config));
let mut notes = client.ws_notes().subscribe(&Default::default()).await?; // ModelEvent<WsNote>
let mut lines = client.procedures().lines(&args).await?;                  // Line
while let Some(item) = lines.recv().await { let line = item?; }
```

- **Refusal codes** *(since 0.19.3)*: an `err` frame surfaces with the code the
  server sent. A throttled open is `resource_exhausted` with status 429 and
  `details` intact (before 0.19.3 the Rust client reported `internal`). Only the
  Rust client had the bug; the Dart and TypeScript clients pass `err.code`
  through verbatim and always reported it correctly.
- **The call** resolves at `Ready` to a `ClientSubscription<Item>`, a bounded
  `mpsc::Receiver<Result<Item, ClientError>>`. A refusal is the call's `Err`,
  never an item. Dropping the receiver cancels the subscription.
- **Model feed items** are `ModelEvent<Model>`. `event.matches == false` on an
  `Updated` event means the row left this subscriber's filter or read policy;
  `data` is the pre-image *(since 0.18.0, cratestack PR #1282)*. TypeScript: test
  `event.matches === false` (absent from older servers). Dart:
  `event.matches`. With `fields` the records are
  partial: read them into a struct of `Option<_>` fields, or over SSE as
  `runtime().subscribe::<ModelEvent<serde_json::Value>>(target)`. Over a WebSocket or
  WebTransport a `serde_json::Value` item fails on any `Uuid` field, which is a byte string
  there *(since 0.19.6, cratestack#1360)*; the Rust client decodes a
  socket item as a unary CBOR call does and falls back to an older server's text `Uuid`.
- **`SubscriptionTransport::Auto`** (the default) tries, in order, each binding
  the build has, moving on only when one cannot be opened, never on a refusal:
  1. **WebTransport**, when the client has the `webtransport` feature and
     `ClientConfig::with_webtransport(url, trust)` names the listener *(since 0.18.0,
     cratestack PR #1270)*. A session not open within 3 s counts as unreachable,
     and that is remembered for 10 minutes.
  2. **A WebSocket**, with the `ws` feature.
  3. **SSE**, always.

  Features, native targets only: `client-ws` / `client-webtransport` on
  `cratestack-pg`/`cratestack-api`; `ws` / `webtransport` on `cratestack-client`.
  `SubscriptionTransport::WebTransport` / `WebSocket` / `Sse` pin one binding, and `CborSeq` *(since 0.20.3, cratestack#1001)* pins `application/cbor-seq`, which `Auto` never picks.
- **SSE** is always a `GET` with the input as the query string, signed by the
  request authorizer like any call. The socket's upgrade carries the
  authorizer's headers for `GET /rpc/ws`.
- **WebTransport trust**: `ServerTrust::NativeRoots` in production, or
  `ServerTrust::CertificateHashes(vec![dev_certificate.sha256])` for a
  `DevCertificate`. The URL is the listener's own UDP address, e.g.
  `https://api.example.com:4433/rpc/wt` (`/$wt` on a REST schema).

```rust
let config = ClientConfig::new(base)
    .with_webtransport(wt_url, ServerTrust::CertificateHashes(vec![cert.sha256]));
```

- **Without a generated client**, `cratestack-webtransport`'s `client` feature
  offers `WebTransportClient::connect(url, trust, headers)` and
  `subscribe(op, input)`; dropping a `Subscription` cancels it. `input` is anything
  `Into<RpcFrameValue>` and `Subscription::next` yields `RpcFrameValue` *(since 0.19.6, cratestack#1360; through 0.19.5 both were `serde_json::Value`)*.
- **One SSE event is capped** *(since 0.20.2, cratestack#1379)*: 1 MiB by default, counted as the
  raw bytes received (line endings and the blank line included), counting partial `data:` lines and the pending line. Set it with
  `ClientConfig::with_max_sse_event_bytes(n)`. An event over the cap ends the stream with
  `ClientError::EventTooLarge { limit }` (on the RPC client `RpcClientError::EventTooLarge { limit }`, not
  `InvalidResponse`), drops the connection and delivers nothing after it. Applies to the SSE binding, and *(since 0.20.3)* to one `CborSeq` frame, where `with_max_subscription_frame_bytes(n)` sets the same field.

## The TypeScript client

*(since 0.18.0, cratestack PR #1269)*. A package generated from a schema with an
`@@subscribe` model or a `subscription procedure` gains `src/subscriptions.ts`
and `src/subscription-sockets.ts`; any other schema generates exactly as before.

```ts
const client = new Client(origin, {
  subscriptions: {
    transport: "auto", // "webtransport" | "websocket" | "sse" | "cbor-seq" (since 0.20.3, never picked by "auto")
    webTransport: { url: "https://api.example.com:4433/rpc/wt" }, // its own UDP address
  },
});
for await (const event of client.notes.subscribe({ operations: ["created"] }, { signal })) {
  event.data; // a revived Note; event.operation is "Created" | "Updated" | "Deleted"
}
for await (const line of client.procedures.lines({ args: { roomId: "r1" } })) { /* ... */ }
```

- The first `next()` resolves after `Ready` (and calls `onReady`). A refusal or a
  terminal error is a thrown `CratestackSubscriptionError { code, message, details, status }`.
  Breaking out of the loop, or aborting `signal`, cancels.
- **`"auto"`** tries WebTransport (only with `webTransport.url` and a platform
  `WebTransport`), then one shared WebSocket, then SSE over `fetch`. A binding that
  never opens falls back; a refusal is thrown, never a fallback. A WebTransport
  attempt not `Ready` within 3 s is remembered in `localStorage` for 10 minutes per
  origin. Node has no `WebTransport`, so there it starts at the WebSocket.
- **Event cap** *(since 0.20.2, cratestack#1379)*: `subscriptions: { maxEventBytes: n }`,
  default 1 MiB (UTF-8 bytes after `\r\n` -> `\n`, so up to one more byte per line than Rust counts). Over it, the SSE reader throws
  `CratestackEventTooLargeError` (a `CratestackSubscriptionError`, code `event_too_large`, `.limit`)
  and cancels the `fetch` body.
- A self-signed dev certificate is pinned with
  `webTransport.serverCertificateHashes: [{ algorithm: "sha-256", value }]`.
- **Hooks**: `--swr` adds `useSubscription(key, open)` (`<package>/swr`);
  `--tanstack` adds `useSubscriptionQuery(key, open, { onItem, queryOptions })` and
  `subscriptionQueryOptions(queryClient, key, open)`: the query's `data` is the
  latest item, and its last observer leaving aborts the subscription. Invalidate a
  list's key in `onItem` to keep it fresh.

## The Dart client

*(since 0.18.0, cratestack PR #1269; sockets cratestack PR #1271)*. SSE goes through
the same `CratestackHttpTransport` every call uses (Dio, fespalier, the Rust
transport). A WebSocket (native and web) and WebTransport (Flutter web only, the
browser's own) are opened by the client itself. It needs the generated
`CratestackHttpAdapter` / `CratestackRpcHttpAdapter`; any other adapter gets an
`UnsupportedError` stream.

```dart
final client = MyCratestackClient(
  CratestackRpcHttpAdapter(CratestackDioTransport(dio), baseUri: base),
  subscriptions: CratestackSubscriptionOptions(
    // A socket does not go through the HTTP transport: give it what your
    // transport adds. Until this is set, `auto` stays on SSE.
    credentials: () => {'authorization': 'Bearer $token'},
    webTransportUrl: Uri.parse('https://api.example.com:4433/rpc/wt'), // web only
  ),
);
```

```dart
client.notes
    .subscribe(input: const CratestackSubscribeInput(operations: ['created']))
    .listen((event) => event.data); // CratestackModelEvent<Note>
client.procedures.lines(const LinesArgs(args: Room(roomId: 'r1'))).listen(print);
```

- Nothing before `Ready` (`onReady:`); a refusal or terminal error is a
  `CratestackSubscriptionException`; cancelling the listen aborts the request.
- **`--preset riverpod`** (and `fespalier`) adds a `@riverpod` stream provider per
  op: `noteEventsProvider(input: ...)` and `linesProvider(args)`.
  `CratestackSubscribeInput` compares by its query string, so an equal input
  reuses the subscription.
- **`auto`** (the default) tries WebTransport (on the web, with
  `webTransportUrl`), then the WebSocket, then SSE, moving on only when a binding
  cannot be opened, never on a refusal. 3 s WebTransport bound, a failure
  remembered 10 minutes. **Without `credentials`, `auto` is SSE**: do not expect
  a socket until you set it (return `{}` for a server allowing anonymous
  subscriptions).
- `transport: CratestackSubscriptionTransport.webSocket` / `.webTransport` /
  `.sse` pins one (`.cborSeq` *(since 0.20.3, cratestack#1001)* too; `auto` never picks it). `serverCertificateHashes` pins a self-signed dev
  certificate; `webSocketUrl` overrides the derived `ws(s)://<base>/rpc/ws`.
- In the riverpod preset, override `<prefix>SubscriptionOptionsProvider`.
- Native Dart has no WebTransport: there `auto` starts at the WebSocket.
- **Event cap** *(since 0.20.2, cratestack#1379)*:
  `CratestackSubscriptionOptions(maxEventBytes: n)`, default 1 MiB (UTF-8 bytes after `\r\n` -> `\n`, so up to
  one more byte per line than Rust counts). Over it, the SSE stream throws `CratestackEventTooLargeException` (a
  `CratestackSubscriptionException`, code `event_too_large`, `.limit`) and cancels the request. In `--preset riverpod` the generated subscription stream providers pass
  `retry: cratestackSubscriptionRetry` (it defers to `ProviderContainer.defaultRetry`, except for the oversize error): Riverpod 3 would otherwise retry a failed provider (up to 10 times, with
  backoff, unless the error is an `Error` or `ProviderException`), reconnecting after an oversized event. The
  function skips `CratestackEventTooLargeException` (it reaches the provider as an `AsyncError` at once;
  `ref.invalidate` retries by hand) and keeps the default for other errors.

### Reading why a stream ended *(since 0.20.5, cratestack#1381)*

Every generated client reads `details.reason` of the terminal `err` frame (also the `{id: 0, err}` of a closed socket session), on every binding:

- **Rust**: `ClientError::stream_end_reason() -> Option<StreamEndReason>`; `None` for a refusal, an end without a reason, or a reason this client does not know (fall back to the code). Match with a wildcard arm.
- **TypeScript**: `CratestackSubscriptionError.endReason` (a `StreamEndReason` union; `undefined` when absent or unknown), plus the exported `isTerminalEndReason`, `shouldResubscribe` and `resubscribeDelayMs` (`src/subscription-end.ts`).
- **Dart**: `CratestackSubscriptionException.endReason`, a `CratestackStreamEndReason` (`unknown` for a reason a newer server sent, `null` for none) with `isTerminal` and `resubscribes`.

**Never auto-retry `session_ended`, `principal_suspended` or `device_revoked`**; resubscribe with jittered backoff on `stream_lifetime` and `revocation_resync`; `credential_expired` needs a refreshed credential only your app has. The generated helpers already do exactly this: Riverpod `cratestackSubscriptionRetry` (returns `null` for the three terminal reasons, jitters the other two), `--tanstack` `useSubscriptionQuery` (retries those two, jittered, with NO cap on the count, nothing else; it used to be `retry: false`) and Riverpod never gives up on those two either (its backoff count is clamped to 5) and `--swr` `useSubscription` (reopens those two after a jittered backoff, surfaces every other end as `error`; it used to never retry). Hand-written loops should use the same rule.

## A worked example

`examples/realtime-chat` (cratestack PR #1269) puts it together: a model feed, a
topic behind a subscription procedure, all three bindings with a `DevCertificate`
for local WebTransport, and `just test-realtime-chat` proving in Chromium that
`"auto"` uses WebTransport with UDP open and the WebSocket with UDP blocked.
