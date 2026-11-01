# Subscription procedures, topics, the WebSocket binding, the Rust client

> **Verified against CrateStack `main` after 0.17.2** — everything here is
> *(unreleased, cratestack#1268)*. None of it exists in a published crate yet.
> Source of truth: `docs/design/subscriptions-websocket.md` §3.2–3.4, §6, §8,
> §11 ("S4 status", "S5 status", "S6 status, Rust").

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
- **`db = None`**: a topic is a compile error ("needs a subscription
  backplane").
- **`@isolation` procedures**: `IsolatedCratestack` has no `topics()`. Publish
  after the commit.

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
    .merge(db.subscriptions(registry).websocket(WebSocketConfig::new(), auth));
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
- **Frames**: the same as WebTransport, plus cancel.
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

- **Unary calls over WebSocket**: gated (decision O5). Any op other than a
  subscription is `not_found`.

The frames, admission, `OriginPolicy` and the session registry live in
`cratestack_core::subscription_wire`. `cratestack-webtransport` re-exports them
unchanged.

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

- **The call** resolves at `Ready` to a `ClientSubscription<Item>`, a bounded
  `mpsc::Receiver<Result<Item, ClientError>>`. A refusal is the call's `Err`,
  never an item. Dropping the receiver cancels the subscription.
- **Model feed items** are `ModelEvent<Model>`. With `fields` the records are
  partial: use `runtime().subscribe::<ModelEvent<serde_json::Value>>(target)`.
- **`SubscriptionTransport::Auto`** (the default) opens a WebSocket when the
  client has the `ws` feature: `client-ws` on `cratestack-pg`/`cratestack-api`,
  `ws` on `cratestack-client`, native targets only. It falls back to SSE only
  when no socket opens, never on a refusal. Without the feature, `Auto` is SSE.
- **SSE** is always a `GET` with the input as the query string, signed by the
  request authorizer like any call. The socket's upgrade carries the
  authorizer's headers for `GET /rpc/ws`.
- **Not built**: no Rust WebTransport client yet; TypeScript and Dart clients
  are the next slices.
