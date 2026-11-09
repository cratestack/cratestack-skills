---
name: cratestack-clients
description: Generating and consuming CrateStack clients — include_client_schema! for Rust, cratestack generate-dart (default, riverpod and fespalier presets; the HTTP transport seam, CratestackHttpAdapter, CratestackDioTransport, CratestackRestException / CratestackTransportException), cratestack generate-typescript (with swr/tanstack/rtk/refine layers), the @cratestack npm family, cratestack_cbor for Dart, the CBOR wire contract and reviveWireFields, WireMock stubs, and client state stores. Load when generating an SDK, wiring a React/Flutter front end to a CrateStack service, upgrading from the removed CratestackDioAdapter classes, or debugging a Decimal or Bytes value that arrived as a string.
---

# Clients

> **Verified against CrateStack 0.19.3.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

Three generated languages, one wire contract.

| Language | Produced by | Ships |
| --- | --- | --- |
| Rust | `include_client_schema!` | typed model + procedure clients over a reqwest runtime |
| Dart / Flutter | `cratestack generate-dart` | models, selection builders, API facades, an HTTP transport seam (*since 0.16.0*), `--preset riverpod` / `fespalier` layers |
| TypeScript | `cratestack generate-typescript` | fetch client, plus `--swr` / `--tanstack` / `--rtk` / `--refine` layers |

## Durable prepared mutations *(since 0.18.1, cratestack#1297)*

The runtime APIs freeze a keyed unary mutation before any send. Persist the snapshot durably **before the first execution**; restore the same bytes after restart with the matching service, codec/format, contract and key tables. The snapshot keeps its original inner bytes, media type, route, query, key and `If-Match`; it contains no authentication headers or reusable COSE envelope, and URL userinfo is rejected. Query strings and bodies are persisted and may contain secrets. Snapshots with invalid version, route, key, codec or table bindings, oversized data, or malformed JSON or CBOR framing are rejected before network I/O. The caller owns storage integrity, authorization and journaling; this is not an automatic queue or server idempotency store.

The CBOR snapshot check validates one complete item, UTF-8 text, simple-value framing and container pairs, with nesting limited to 256. It preserves non-preferred encodings without rewriting stored bytes. It does not validate tag semantics or reject duplicate map keys; the receiving codec determines duplicate handling.

- Rust: `CratestackClient::prepare_call`, `PreparedCall::to_bytes` / `from_bytes`, `execute_prepared` or `execute_prepared_typed`. Compact key tables are required even for a named payload. For ordinary compact-capable calls with a body pass the key in per-call headers (they win over the authorizer's); an authorizer-only key is rejected before send, while bodiless calls are not checked. Without preparing, each client instance pins a key's first encoding in memory (1024 keys; the oldest is evicted when full). Duplicate `Idempotency-Key` or `If-Match` headers are rejected before encoding. The same checks apply to ordinary compact streams, not prepared streams. Custom HTTP defaults or middleware must preserve identity headers and their absence. Configured sealing reauthorizes and reseals each attempt.
- TypeScript REST: `prepare(method, path, options)`; RPC: `prepare(op, input, options)`; both use `executePrepared`. RPC refuses custom unary links, including sealing links.
- Dart: REST `CratestackHttpAdapter.prepare`; RPC `CratestackRpcHttpAdapter.prepareCall`; `CratestackPreparedCall.toJson` / `fromJson` and `executePrepared`. Set the adapter's `preparedBasePath` to the generated REST client's overridden `basePath`; prepared execution uses the current adapter's `useRustTransport`, sends `x-cratestack-schema-sha`, and takes per-attempt headers in `executePrepared(call, headers: {...})` beside `authorization:`; they cannot replace the frozen identity or media headers. TypeScript and Dart pin up to 512 keys in memory, evicting the oldest. For transport sealing use a fresh seal and matching `PendingResponse` for every attempt; see [the transport reference](references/dart-transport.md).

They shipped in 0.18.1 ([cratestack#1297](https://github.com/cratestack/cratestack/pull/1297), `docs/design/prepared-idempotent-calls.md`); a 0.18.0 or older runtime has none of them. They do not cover batch or streaming calls. Source: `crates/cratestack-client-rust/src/client/prepared_client.rs`, generated `runtime.ts` snapshots and Dart `compact_hooks_rest_test.dart` / `compact_hooks_rpc_test.dart`.

## Rust — `include_client_schema!`

```toml
cratestack = { package = "cratestack-client", version = "0.19" }
# the generated structs derive through bare `serde::` paths
serde = { version = "1", features = ["derive"] }
```

Arguments: a path literal, plus an optional `decimal = RustDecimal | BigDecimal`.
The path is the schema's **root** file; parts and imports *(since 0.19.0)* are
tracked as rebuild dependencies through the generated `SCHEMA_FILES`, and `SCHEMA_SOURCE`
stays the root's text. Generated clients are identical for a split schema.
That facade re-exports **only** `include_client_schema!` — not the other two
entry macros — and `cratestack-axum`, and therefore `axum`, is structurally
absent from its graph under default features. `tower`, `hyper` and `tower-http`
*are* in it, through `reqwest`; CI's `facade-disjointness` job asserts only that
`axum` / `cratestack-axum` are absent.

Emitted into `cratestack_schema`: `models`, `types`, `inputs`
(`Create<M>Input`, `Update<M>Input`, `<M>Where`, `<M>OrderByClause`,
`<M>FindManyInput`; *since 0.13.0* `<M>Where` and `<M>SortField` have no member
for a `@server_only` field, here and in the Dart client — the server refuses
such keys; the generated Dart model class still declares the field, so a value
a pre-0.13.0 server leaked through a `@computed` procedure output may sit in
client state or logs), per-model field/selection modules, `procedures` (one
submodule per procedure with `Args` and `Output`), and `client` with `Client`,
per-model `<M>Client` and `ProceduresClient`.

Deliberately **absent** compared with the server macro: no policy constants, no
`validate()` on inputs, no `*_MODEL` descriptors. And a verb suppressed with
`@@internal(...)` emits **no client method at all** — a compile error for the SDK
consumer rather than a runtime 403.

```rust
let runtime = CratestackClient::cbor(ClientConfig::new(url))
    .with_request_authorizer(Arc::new(MyAuth));
let client = cratestack_schema::client::Client::new(runtime);

let posts = client.posts().list(query, headers).await?;
let one   = client.posts().get(&id, headers).await?;
let out   = client.procedures().my_procedure(&args, headers).await?;
```

Build the config with `ClientConfig::new(url)`. *(Since 0.18.0)* `ClientConfig` also
carries `subscription_transport` (and, under the `webtransport` feature, `webtransport`),
so the struct literal `ClientConfig { base_url: url }` that compiled through 0.17.2 no
longer does (`crates/cratestack-client-rust/src/config.rs`).

The model accessor is the **pluralised snake_case model name**. REST routes are
`/<plural>` and `/$procs/<ProcedureName>`, or `/<version>/$procs/<ProcedureName>`
for a procedure declared `@api_version("<version>")`: the path the server
mounts. The generated Rust, TypeScript and Dart clients call that versioned
path *(since 0.13.0)*; all three and the server derive it from
`cratestack_core::procedure_route::procedure_rest_route_path`. **Before 0.13.0
every generated client ignored `@api_version`**: it called the unversioned
path, which the server never registers, so the call was a 404. After upgrading,
regenerate TypeScript/Dart clients and rebuild `include_client_schema!` crates.

Under `transport rpc` the outer shape (`Client`, `<M>Client`,
`ProceduresClient`) is the same, but the methods are not: `get`/`update`/`delete`
build their envelopes (`RpcPkInput`, `RpcUpdateInput`) inside so the surface
stays `get(&id)`, while `list` takes an `&RpcListInput` directly; model methods
return a `BatchableCall` (`.await` it, or `.queue(&mut batch)`);
list-returning procedures use `call_streaming` and return `RpcStream<Item>`;
errors are `RpcClientError`, not `ClientError`; and **per-call headers are
dropped from the RPC surface entirely** — auth flows through
`with_request_authorizer`. The RPC `Client` gains `rpc()` and `batch()` (both
have `runtime()`).

**Auth is an async trait** so an OAuth2 client-credentials provider can refresh
on a cache miss:

```rust
#[async_trait::async_trait]
pub trait RequestAuthorizer: Send + Sync {
    async fn authorize(&self, request: &AuthorizationRequest)
        -> Result<Vec<(String, String)>, ClientError>;
}
```

That is the native shape, and through 0.14.1 the only one. On
`wasm32-unknown-unknown` *(since 0.14.2, cratestack#1108)* the trait is declared
with `#[async_trait(?Send)]` and without `Send + Sync`, because a browser
`fetch` future is never `Send` and an authorizer that refreshes its token
through the client has to await one. An impl that builds for both targets
splits the attribute:
`#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]` and
`#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]`. On
0.14.1 such an authorizer does not compile for wasm32 ("future cannot be sent
between threads safely"); a non-refreshing one (a static header) does.

Header injection order: schema SHA, `Accept`, `Content-Type`, authorizer headers,
then **per-call extras last so they override**.

**`ensure_crypto_provider()`** installs a ring-backed rustls provider if none is
present. `CratestackClient::new` calls it for you; **`with_http_client` does
not** — call it yourself first or you get a rustls panic in your own code.

## Dart

```bash
cratestack generate-dart --schema schema.cstack --out ./client \
  --library-name my_client --preset riverpod --run-build-runner
```

Three presets (`--preset default|riverpod|fespalier`, default `default`). `riverpod`
replaces the default layout's monolithic models/APIs with one file per model plus a
provider per operation (reads are providers, writes are controllers); the runtime
and constants are shared with the default preset. `fespalier` is `riverpod` sending
through fespalier's `HttpTransport` with no Dio. Which to pick:

| Pick | When |
| --- | --- |
| `default` | a plain package, or you wrap the client yourself; Dio or your own transport |
| `riverpod` | a Riverpod app; Dio or your own transport |
| `fespalier` *(since 0.16.0, cratestack#1204)* | the app's HTTP stack is a `fespalier_transport` chain (session, signing, portal check, spans), so a second client under it is wrong |

Choose by the HTTP stack the app already owns. `fespalier` changes the transport
and its providers, not the call sites.

### Sending: one seam, Dio is one transport *(since 0.16.0, cratestack#1204)*

> **Never write `CratestackDioAdapter`, `CratestackCborDioAdapter`,
> `CratestackRpcDioAdapter` or `CratestackRpcCborDioAdapter`.** They are deleted,
> with no aliases. Older docs, blog posts and the docs site may still show them.

Every generated `runtime.dart` declares `CratestackHttpTransport` (one method,
`send`). There is one adapter per protocol, written over it, and the HTTP stack is
a transport:

| | REST | RPC (`transport rpc`) |
| --- | --- | --- |
| Adapter | `CratestackHttpAdapter(transport, baseUri:, format:, useRustTransport:, compact:, preparedBasePath:)` | `CratestackRpcHttpAdapter(transport, baseUri:, format:, cborSeqDecoder:, compact:)` |
| Dio | `CratestackDioTransport(dio)` | `CratestackDioTransport(dio)` |
| HTTP error answer | `CratestackRestException` (`status`, `body`; *(since 0.17.1)* `code`, `message`, `details`, `extra`, `challenges`, `headers`) | `CratestackRpcException` (`status`, `code`, `message`, `details`; *(since 0.17.1)* `extra`, `challenges`, `headers`) |
| Call options | `CratestackCallOptions(headers, idempotencyKey, abort)` | `CratestackRpcCallOptions(headers, idempotencyKey, abort)` |

`format` is `CratestackWireFormat.cbor` (the default) or `.json`; the answer is
decoded by its own `Content-Type` either way. `baseUri` replaces
`dio.options.baseUrl`, which the transport no longer reads. `compact:` *(since 0.18.0)*
is the compact-keys hook (below) and `preparedBasePath:` *(since 0.18.1)* the prefix
prepared calls validate against (above); both are optional.

```dart
final adapter = CratestackHttpAdapter(        // CratestackRpcHttpAdapter under transport rpc
  CratestackDioTransport(dio),
  baseUri: Uri.parse('https://api.example.com'),
);
```

In Flutter, override `<libraryName>AdapterProvider` (the prefix is the camel-cased
`--library-name`). The default and `riverpod` presets have no default adapter and
throw until you do:

```dart
ProviderScope(overrides: [
  myClientAdapterProvider.overrideWithValue(CratestackHttpAdapter(
    CratestackDioTransport(dio),
    baseUri: Uri.parse('https://api.example.com'),
  )),
])
```

Under `--preset fespalier` you override the transport and the origin instead, and
`<prefix>AdapterProvider` is built for you:

```dart
ProviderScope(overrides: [
  myClientTransportProvider.overrideWith((ref) =>
      SessionTransport(WriteGuardTransport(HttpClientTransport(client)), credentials)),
  myClientBaseUriProvider.overrideWithValue(Uri.parse('https://api.example.com')),
])
```

- **Errors.** A non-2xx answer is `CratestackRestException` / `CratestackRpcException`.
  No answer at all is the sealed `CratestackTransportException`, with four kinds:
  `Unsent` (provably never left, always safe to resend), `Aborted`, `TimedOut` and
  `Broken` (the server may have acted). Nothing is a `DioException` any more; it is
  at most the `cause`. Catch these, not Dio's.
- **`abort`** on both option types: complete the future to cancel the call, which
  throws `CratestackTransportAborted`. **`idempotencyKey`** is now on both.
- **`stream()` streams** *(RPC)*: items are yielded as the `cbor-seq` body arrives.
- **A `null` in a query map is omitted**, not sent as a bare `key`. The generated
  query builders never emit one, so this only affects hand-built `queryParameters`.
- **Known gaps:** call options cannot carry transport attributes (cratestack#1207,
  open), and, on 0.17.0 and earlier, an `AuthProvider` refusal cannot shape its body
  (cratestack#1208, shipped in 0.17.1 as `AuthRefusal`: extra top-level members such as
  `error`). Both have workarounds in
  [references/dart-transport.md](references/dart-transport.md).
- **Reading a refusal** *(since 0.17.1, cratestack#1243)*. Every generated client types what an
  `AuthRefusal` adds, on REST and RPC alike: the fixed `code`, `message`, `details`, every other
  member as `extra` (never dropped) and the raw `WWW-Authenticate` value(s) as `challenges`.
  Branch on `code` plus an `extra` member, never on the message:

  | Client | REST | RPC |
  | --- | --- | --- |
  | Dart | `CratestackRestException.code` / `.message` / `.details` / `.extra` / `.challenges` | `CratestackRpcException.code` / `.details` / `.extra` / `.challenges`; `RpcErrorBody.extra` |
  | TypeScript | `CratestackHttpError.body` (`CratestackErrorResponse`) / `.code` / `.details` / `.extra` / `.challenges` | `CratestackRpcError.code` / `.details` / `.extra` / `.headers` / `.challenges` |
  | Rust | `ClientError::remote_error()` (`.extra`), `ClientError::challenges()` | `RpcRemoteError.body.extra`, `.challenges`; `RpcClientError::challenges()` |

  Dart's seam and the browser's `Headers` join two `WWW-Authenticate` lines into one entry;
  Rust keeps one entry per line. A batch frame's or a stream item's error has no headers, so no
  challenges. On 0.17.0 and earlier the Dart RPC `RpcErrorBody` drops the members (only the raw
  REST `body` keeps them) and no client exposes the challenges. Rust patterns that list every
  field of `ClientError::Remote` or `RpcRemoteError` without `..` need one.
- **A step-up refusal** *(since 0.17.1, cratestack#1244, ADR 0022)*. An operation that needs a
  fresher or stronger authentication (a procedure's `@authn`, see `cratestack-policy-auth`) is
  refused with 401 / RPC `unauthenticated` plus the `extra` member
  `error: "insufficient_user_authentication"` and `details` `{max_age?, acr_values?, amr?,
  unmet}`. Do not compare those by hand; every client types it as `StepUpRequired` (absent
  unless status/code **and** the `error` member match; a mistyped field reads as absent, never a
  throw) and ships a retry-at-most-once helper:

  | Client | Read it | Retry once after a re-proof |
  | --- | --- | --- |
  | Dart (every preset) | `CratestackRestException.stepUp` / `CratestackRpcException.stepUp` (`maxAge`, `acrValues`, `amr`, `unmet`; `null` otherwise) | `retryAfterStepUp(() => call(), (stepUp) async => reproved)` |
  | TypeScript | `CratestackHttpError.stepUp` / `CratestackRpcError.stepUp`; `stepUpOf(error)` (RPC: also a batch frame's `error` body); `RtkRestQueryError.stepUp` | `retryAfterStepUp(() => call(), async (stepUp) => reproved)` |
  | Rust | `ClientError::step_up()`, `RpcClientError::step_up()`, `RpcRemoteError::step_up()` (batch frame), trait `StepUpError` | `retry_after_step_up(\|\| call, \|step_up\| async move { reproved })` |

  `reprove` returns a boolean: `true` sends the call once more and returns whatever that gives,
  a second refusal included (it never loops); `false` returns (Rust) or rethrows (Dart, TS) the
  first refusal. Any other error never asks for a re-proof. Tests:
  `crates/cratestack-client-rust/src/step_up/tests.rs`,
  `crates/cratestack-client-dart/tests/fixtures/step_up_{rest,rpc}_test.dart`,
  `crates/cratestack-client-typescript/tests/step_up.rs`. None of this exists on 0.17.0.
  A call retried under the **same idempotency key** gets the recorded 401 back on 0.17.1; *(since 0.17.2, cratestack#1261)*
  the server releases the key for a refusal produced before the body, so that retry runs once.

  **Known issue on 0.17.1** (cratestack#1261, fixed in 0.17.2): the idempotency layer records the step-up
  `401` like any other answer, so a call retried under the **same** `Idempotency-Key`
  (`idempotencyKey` call option, `_meta` key on MCP) gets the stored refusal replayed and never
  runs. The same goes for a retry after renewing an expired credential. Do not write code that
  relies on the retry going through under a reused key; a call sent without a key is not
  affected.

**Upgrading an app** from the `*DioAdapter` classes (grep for the four names, move
`dio.options.baseUrl` into `baseUri`, replace `on DioException`, check `null` query
values), the full contract of the seam, how to write a transport, the exception
table, and `--preset fespalier` (`--fespalier-ref`, default `v0.21.0`; the
`examples/cratestack` reference in fespalier): all in
[references/dart-transport.md](references/dart-transport.md). The change shipped in
0.16.0. On a 0.15.x or older CLI the generated package still has the four adapters and
none of the above exists.

Generated data classes carry hand-rolled `fromWire` / `toWire`, both routing every
field through JSON-plain values (ISO-8601 for `DateTime`, `List<int>` for `Bytes`,
decimal string text), which is why bridging `cratestack_cbor`'s JSON-text boundary
is safe.

`cratestack_cbor` on pub.dev is the native codec, auto-selecting
flutter_rust_bridge natively and wasm-bindgen on web, byte-identical to the
server's `CborCodec`. `createCborCodec()` is idempotent. *(Since 0.18.0,
cratestack#1281)* it is the **only** codec of a generated Dart package: every
generated `pubspec.yaml` depends on it, the pure-Dart `package:cbor` fallback
(`--no-native-cbor`) is gone, and because it is a Flutter FFI plugin a generated
client needs the Flutter SDK. A plain Dart program (a CLI or server on the
standalone Dart SDK) cannot use one; the generated pubspec also declares
`flutter: sdk: flutter` on every preset.

**Hard constraint before `pub add`:** it pins `flutter_rust_bridge: 2.13.0`, and
in pub's grammar a bare version is an **exact** pin. If anything in your graph
wants a different flutter_rust_bridge, `pub get` fails during version solving and
you cannot add the package at all. That is upstream's requirement, not a
CrateStack choice. Vendored platforms cover Linux x86_64, Android, Windows x64,
macOS and iOS xcframeworks, and web — **Linux arm64 is the one gap**, and since
0.18.0 that makes it a gap of every generated Dart client.

### A JSON or custom codec under an envelope, and sealing over your own HTTP *(Rust client, since 0.15.4, cratestack#1168)*

`CratestackClient::with_envelope(ClientEnvelope::new(envelope, audience)?)` (feature `cose` of
`cratestack-client-rust`, forwarded by the `cratestack-client` / `-pg` / `-api` facades, off by
default; *since 0.15.0, cratestack#1007*) makes a client `Required`: every request is sealed,
every response must be a COSE message verifying against the request it answers
(`EnvelopeError::Unverified`), and an unsealed answer is `EnvelopeError::Unsigned { status }`
with its body never read. Streamed entry points (`*_streamed`, `call_streaming`) and
subscriptions fail locally with `EnvelopeError::StreamsUnsupported`, and redirects are never
followed. Reseal, never replay: a retry layer must send the call again through the client.

On 0.15.0 to 0.15.3, `with_envelope` refused every codec but CBOR. It takes
any codec whose types can be sealed now: the codec's `CONTENT_TYPE` is the type of each sealed
request, and `HttpClientCodec::payload_accept` (a **provided** method; default: the same type) is the
`Cratestack-Payload-Accept` value, so a `JsonCodec` client works as is, and an asymmetric codec (a
form in, JSON out) overrides `payload_accept` to `"application/json"`. CBOR sends no extra header, so
its wire is unchanged; any other type travels in `Cratestack-Payload-Type` /
`Cratestack-Payload-Accept`, is bound in the seal, and needs a server layer that opted in with
`.payload_media_types(..)` (see `cratestack-server`). A response sealed under a type the call did not
list is `EnvelopeError::UnexpectedPayloadType { got }` and is never decoded. A sealed `/rpc/batch`
over a non-CBOR codec is `BadInput` and is not sent. `with_envelope` is `BadInput` for a codec whose
type can never be sealed (`application/cose*`, a stream, a multipart body, or outside the lowercase
`type/subtype` grammar).

To do your own HTTP (a Node SDK, an adapter), seal with `ClientEnvelope::seal_call` and open with
`PendingResponse::open`; the generated clients run on the same pair:

```rust
let route = RouteRef::new("/v1/charges", &[]);
let sealed = envelope
    .seal_call(SealCall::new("POST", route, contract_sha)
        .payload(b"amount=1500", "application/x-www-form-urlencoded")
        .accept("application/json"))
    .await?;
// send `sealed.body` with every header in `sealed.headers`, then:
let opened = sealed.pending.open(status, &response_headers, response_body).await?;
// opened.payload_type, opened.body
```

`SealedCall::headers` is every header the seal depends on (`Content-Type`, `Accept`,
`Cratestack-Contract`, the payload-type selectors when not CBOR, the bound `Idempotency-Key` /
`If-Match`); add any others yourself. An Ed25519 key behind a callback (a Node `KeyObject`, a KMS)
signs through `ExternalSigner::ed25519(&public_key, sign)`, beside `esp256`; the callback returns the
64-byte pure Ed25519 signature over the to-be-signed bytes. Source:
`crates/cratestack-client-rust/src/envelope/` and
`crates/cratestack-client-rust/tests/cose_payload_types.rs`, `cose_seal_call.rs`.

### Signing requests from Dart *(since 0.15.4, cratestack#1151)*

The generated Dart client sends **unsigned** requests. A server behind the COSE
envelope layer (`cratestack-server`) accepts only sealed ones, and a Dart or
Flutter app seals through `package:cratestack_cbor/cose.dart`. That library does
not reimplement COSE: it reaches `cratestack-cose`, the one Rust implementation,
over the bridge the codec already uses (flutter_rust_bridge natively,
`cratestack-cbor-wasm` on the web), and `lib/` holds no crypto. Never write a
Dart signer, canonical query or AAD by hand. Source:
`dart-packages/cratestack_cbor/lib/cose.dart` and `lib/src/cose/`.

```dart
import 'package:cratestack_cbor/cose.dart';

final envelope = await ClientEnvelope.create(
  signer: Ed25519Signer.fromSeed(seed),
  serverKeys: [CoseServerKey.ed25519(serverPublicKey)], // pinned at enrolment
  audience: 'payments', // the server's configured name, never its host
);
final binding = CallBinding(
  method: 'POST',
  route: 'procedure.echo', // RPC op id, or the REST route template
  contractSha: opContractDigest, // 32 bytes
);
final sealed = await envelope.sealRequest(cborPayload, binding);
// POST `sealed` with Content-Type and Accept: envelope.mediaType and
// Cratestack-Contract: ClientEnvelope.contractHeaderValue(opContractDigest)
final opened = await envelope.openResponse(
  responseBody, binding: binding, sealedRequest: sealed, status: 200,
);
// opened.payload is CBOR; decode it with the codec.
```

- **You make the HTTP call.** `sealRequest` returns bytes to POST and
  `openResponse` takes the body, the exact sealed bytes you sent and the HTTP
  status. The generated client does not call either.
- **Where `contractSha` comes from.** The generated `cratestackOpContracts`
  (`lib/src/constants.dart`, *since 0.15.2*, #1123) maps the RPC op id (`batch`
  for `transport rpc`) or `<METHOD> <route template>` on REST to the digest as
  lowercase hex; pass the 32 decoded bytes. Anything else in the constructor is
  an `ArgumentError`.
- **Mount parameter values come first in `pathParams`**, then the route's own,
  as in the Rust client's `with_mount_params`. `query` may be in any spelling.
- **A bound `Idempotency-Key` or `If-Match` goes into `CallBinding` and onto the
  request, byte for byte**, or the server answers 401.
- **Reseal on every retry.** A resent sealed body is a replayed `cti`.
- **Signers in this release are in memory only:** `HmacSigner(alg, secret)`
  (`COSE_Mac0`, secret of at least 32 random bytes; pin with
  `CoseServerKey.hmac`) for services, and `Ed25519Signer.fromSeed(seed)`
  (`COSE_Sign1`). **Neither is for a user's device.** There is no Android
  Keystore or Secure Enclave signer yet; it is a later release (a Dart callback
  into `ExternalSigner::esp256`), with no date. `CoseServerKey.p256Sec1`
  verifies an ESP256 server, but nothing in Dart signs ESP256. Do not invent a
  keystore signer in app code.
- **Required only,** like the Rust client: every request is sealed and only a
  response to a sealed request opens. There is no `Optional` mode.
- **Errors:** `CoseRejected` (no message, the same for every failed check),
  `CoseMisuse`, and the signer errors reserved for the keystore signer; see
  `cratestack-troubleshooting`.
- **Codec-only builds.** `@cratestack/cbor-web` on npm is built without the
  `cose` feature and stays codec-only, as do the default Rust builds. The
  vendored wasm of `cratestack_cbor` carries it, and every app pays about
  460 KB (Linux x86_64) or 270 KB (web `.wasm`) for it whether it signs or not.
- **`cose_testing.dart`** pins `iat` and `cti` for the shared vectors. Never use
  it outside tests: a pinned `cti` is a replayed request.
- **No claim objects in Dart.** *(since 0.17.0, cratestack#1231)* The standalone signed payload
  that outlives a request (`sign_claims` / `open_claims`, see `cratestack-server`) is Rust
  only; `cratestack_cbor` has no binding for it.

## TypeScript

```bash
cratestack generate-typescript --schema schema.cstack --out ./client \
  --package-name my-client --swr
```

The layer flags are additive; the default `src/` layout is always emitted. `--swr`
adds `src/swr/` reachable as `<package>/swr`, `--tanstack` adds
`src/react-query.ts`, `--rtk` adds `src/rtk-api.ts`, `--refine` adds
`src/refine.ts`.

Subscriptions *(since 0.18.0, cratestack PR #1269)*: a schema with a subscription op
also gets `src/subscriptions.ts` (WebTransport → WebSocket → SSE with `"auto"`),
`useSubscription` under `--swr` and `useSubscriptionQuery` under `--tanstack`; Dart
gets SSE `Stream`s and, under `riverpod`/`fespalier`, a stream provider per op. See
[cratestack-rpc's subscriptions reference](../cratestack-rpc/references/subscriptions.md).
*(Since 0.19.3)* The Rust client (fixed in 0.19.3) surfaces a subscription `err` frame with the server's real code (a throttled
open is `resource_exhausted`, status 429, not `internal` as before), and no binding falls back after it.
Dart and TypeScript never had the bug: their templates (`subscriptions.dart.j2`, `subscriptions.ts.j2`, `subscription-sockets.ts.j2`) pass `err.code` through verbatim. The Dart builder's `cratestack_annotations`
ceiling is `<0.20.0` since 0.19.3 (it was `<0.10.0`, resolving stale 0.9.x).

`--rtk` *(since 0.12.0)*: its interesting part is that a **procedure's
invalidation tags are derived from the schema** — the generator walks the procedure's own args and return type
(recursing through `Page<T>` and `FindMany<T>`) and turns the models it finds
into that procedure's tag list. The two transports dispatch differently on
purpose: RPC endpoints call the resolved base query from inside `queryFn` so the
wire response still goes through revival, and REST endpoints use
`fakeBaseQuery()` and call this same package's REST client methods.

### CBOR nesting depth limit *(since 0.19.4, cratestack#1315)*

Every client-side CBOR decode refuses input nested deeper than **128** levels (array, map or tag;
exactly 128 decode, 129 fail), instead of overflowing the stack as it did before. Rust client:
`CratestackError::Codec` containing "nesting too deep (maximum depth is N)" (the default via
`CodecSet`; use `CborCodec::with_max_depth(n)` or `decode_with_max_depth` in your own code). JS
(`@cratestack/cbor-node`, `-web`, `@cratestack/cbor`): a `RangeError` with a `cause`; configure with
`createCborCodec({ maxDepth })`, synchronous on `cbor-node`, **async** on `cbor-web` and the umbrella;
a `maxDepth` that is not a non-negative integer throws `RangeError`; raw `decode(bytes, maxDepth?)`.
The codec stays usable after a failed decode. Dart (`cratestack_cbor`, native and web): the default
only, **not configurable**. The cbor-seq decoders and the outbox always use the default.

## The wire contract

**Default codecs differ by target, and this catches people:**

| Client | Default |
| --- | --- |
| Rust | `CborCodec` |
| TypeScript, `transport rpc` | native CBOR via `@cratestack/cbor` |
| **TypeScript, `transport rest`** | **JSON, hardcoded — there is no codec seam at all** |
| Dart REST | CBOR: `CratestackHttpAdapter(format:)` defaults to `CratestackWireFormat.cbor` *(since 0.16.0; before it, the consumer picked a `Dio` adapter)* |

**Regeneration hazard:** native CBOR became the default for generated TypeScript
RPC clients *in 0.8.14* (#746). Re-running `generate-typescript` on an RPC package
generated before that silently upgrades its wire codec from JSON to CBOR. A JSON-only server `CodecSet` then answers 406/415. Either mount
`CodecSet::new(CborCodec, JsonCodec)`, or construct the client with `codec: jsonRpcCodec`.
On 0.17.2 `--no-native-cbor` also works; it is *(removed in 0.18.0, cratestack#1281)*, so prefer `codec:`.

### Always revive

Every generated TypeScript call site pipes through the helper unconditionally:

```ts
.then((value) => reviveWireFields(value, 'Board') as Board[])
```

The return is an **`as` cast**. So a hand-rolled call that skips revival
**compiles cleanly, and the types say `Decimal` and `Uint8Array` while the
runtime value is still a `string` and a `number[]`**. That exact regression
shipped once: a procedure declared `quote(): Decimal` decoded as an untouched
string.

The registry is keyed by **structural path, not a flat field-name set** — and
that was confirmed empirically, not theorised. With `Order.total: Decimal` plus a
related `Account.total: String` and the relation included, a flat set threw
`[DecimalError] Invalid argument` on a perfectly valid response, and silently
corrupted a numeric-looking `"00123"` into `Decimal("123")`.

Use `revivePagedWireFields` for `@@paged` responses.

### Cursor pagination in generated clients *(since 0.19.4, cratestack#1304)*

- Rust: the `("cursor", "")` query pair on `list`, and `PageInfo::next_cursor`.
- Dart (default and riverpod): `CratestackListQuery(cursor: ...)` and `toListQuery(cursor: ...)`,
  `PageInfo.nextCursor`, and the procedure types `CursorPageInput` and `CursorPage<T>`. For RPC list pass
  `{'cursor': ''}` in the input map.
- TypeScript (default, `--swr`, tanstack/rtk): `cursor?: string` on `CratestackFetchQuery` and
  `CratestackRpcListQuery`, `PageInfo.nextCursor?`, `CursorPageInput`, `CursorPage<T>`.
- `""` starts at the first page; loop until `nextCursor` is absent. `cursor` and `offset` together are a 400.
  `cratestack-mock-wiremock` stubs `CursorPage<T>`. Regenerate committed clients after upgrading.

### `BigInt` is a string on the wire *(since 0.15.4, ADR 0019 D2, D3)*

A schema `BigInt` field never travels as a number: it is a canonical decimal string (`0`, or
an optional `-`, a non-zero digit and at most 18 more digits, inside `i64`) on JSON and CBOR
alike, because a JSON number past 2^53 is rounded by JavaScript and dart2js without an error.
The server refuses a number, a CBOR integer or bignum, `+5`, `007`, `-0` and anything
outside `i64`, on a body, a query filter and `?computedParams=`.

| Client | Type | Notes |
| --- | --- | --- |
| Rust | `cratestack::BigInt` | `Copy` newtype over `i64`, `checked_*` only, no operator impls |
| TypeScript | `bigint`, filter `BigIntFilter` | **Strict revival**: a number or non-canonical string at a `BigInt` key throws `TypeError` naming the field. Every `bigint` is stringified before the codec; a custom `options.codec` is not wrapped, so call `encodeWireFields` first. Query keys store a `bigint` as its string. |
| Dart | `dart:core`'s `BigInt`, filter `BigIntFilter` | Decoded by a generated `cratestackDecodeBigInt(value, 'Owner.field')` (a `FormatException` names the field); RPC `get` / `update` / `delete` send the key as `id.toString()` |

Regenerate every client and rebuild every server together: a client from before 0.15.4 has
no `bigint`. `--rtk` clients need `@reduxjs/toolkit` `^2.2.7` *(floor raised from `^2.0.0`
in 0.15.4)*, and RTK's development-only serializability check does not know `bigint` (the
generated README shows the `serializableCheck` option). `Int` is unchanged: still `i64`
and still a JSON number until a later cutover.

### Ordinal enums are numbers on the wire *(since 0.17.0)*

An enum whose variants are numbered (`Pending = 1`, see
[cratestack-schema](../cratestack-schema/SKILL.md)) travels as that number in every body, REST and
RPC. Servers decode the number **or** the name, so mixed client versions keep working; query
strings and filters still use names.

| Client | Type | Notes |
| --- | --- | --- |
| Rust | the same enum, `#[repr(i16)]`; `ordinal()`, `TryFrom<i16>` | `Serialize` writes the number, `Deserialize` takes either; `<Model>Where` filters send the name |
| TypeScript | unchanged: `'Pending' \| 'Approved'` | responses are revived from numbers to names (`ordinalEnumNames`/`ordinalEnumFields` in `models.ts`); an unknown number throws `TypeError` naming the field. Requests still send names |
| Dart | the same constants, plus `int wireValue` beside `wireName` | `toWire()` returns the number; `fromWire` takes the number or the name, else `ArgumentError` |

A client generated before the enum was numbered cannot read the numbers: regenerate and ship
clients with the server.

### Compact field keys *(since 0.18.0)*

Opt-in, off by default: a client that enables it gets integer field keys negotiated per op
contract (`docs/design/compact-wire-keys.md`, CHANGELOG `## 0.18.0`). The server side is
automatic in the generated router, and needs no schema change and no flag.

- **Rust:** `Client::with_compact_keys(runtime)` on the generated client, or
  `CratestackClient::with_compact_keys(KeyTables)` / `with_compact_key_bytes(KEY_TABLES,
  OP_CONTRACTS)` on the runtime. With `with_envelope` too, sealed calls negotiate the same way:
  the compact types go first in `Cratestack-Payload-Accept`, the request is sealed under
  `application/vnd.cratestack.compact+cbor` only after that op answered compact, and an unsigned
  `415` (`EnvelopeError::Unsigned { status: 415 }`) turns the op back to named for the next call;
  that call is not retried (`crates/cratestack-api/tests/compact_client_sealed_rest.rs`).
- **TypeScript:** `compactKeys: true` in the RPC or REST client options. It feature-detects
  `createCompactKeys` on `@cratestack/cbor` and stays named on a version without it. A REST
  package lists `@cratestack/cbor` as an optional peer dependency.
- **Dart:** pass `compact: CratestackCompactHooks(toCompact: keys.toCompact, fromCompact:
  keys.fromCompact, selector: keys.selector)` to the HTTP adapter, with `keys = await
  createCompactKeys(cratestackKeyTables)` from `cratestack_cbor`. Compact is CBOR format only.
  Generated Dart code never calls the binding itself.
- **Sealing your own Dart call** (`ClientEnvelope` from `cratestack_cbor`): `CallBinding` takes
  `payloadType` (`'application/vnd.cratestack.compact+cbor'`) and `payloadAccept`; send
  `envelope.selectorHeaders(binding)` with the sealed body; pass the response's
  `Cratestack-Payload-Type` as `openResponse(..., responsePayloadType:)` and check
  `opened.payloadType` before `keys.fromCompact`. Omitting both fields is plain CBOR, unchanged.
  The web build's binding object takes `payloadType` / `payloadAccept` the same way. Not
  exercised by a Dart test run in this repo yet (`dart-packages/cratestack_cbor/test/cose/misuse_test.dart`).
- **Do not hand-roll it.** Never write integer keys or the `application/vnd.cratestack.compact+*`
  media types yourself. A compact request body is only sent after the server answered compact
  for that op; a body with an unknown `Cratestack-Contract` selector is a `415`.

### The schema-SHA header

Every generated client stamps its schema's hex SHA-256 as
`x-cratestack-schema-sha` on every request. The server **warns on mismatch and
never rejects**. An absent SHA simply omits the header. It is a drift signal, not
integrity. *(Since 0.15.0, cratestack#1065)* the digest is the schema's identity
(`cratestack_core::schema_digest`: a SHA-256 over a canonical form of the parsed
schema), not of its text, so a comment, a `///` doc or a re-indent no longer changes
it, while any IR change, server-only ones included, still does. Every value changed
once in 0.15.0: regenerate clients and rebuild servers together. A schema split across
files *(since 0.19.0)* has the same digest as its single-file equivalent.

## The npm family

| Package | What it is |
| --- | --- |
| `@cratestack/cli` | downloads the prebuilt CLI binary at postinstall |
| `@cratestack/ts-types` | the pinned wire/link contract every generated RPC project mirrors |
| `@cratestack/runtime-fetch` | `typeof fetch` transport adding a per-call timeout |
| `@cratestack/runtime-axios` | the same shape, backed by axios |
| `@cratestack/adapter-tanstack-query` | `rpcQueryOptions` / `rpcMutationOptions` over a generated RPC client |
| `@cratestack/adapter-rtk` | `createRpcBaseQuery`, an RTK Query `BaseQueryFn` |
| `@cratestack/refine` | refine.dev `DataProvider` (REST and RPC) — the *safe* admin-UI surface, since it goes through the generated API and therefore through policy, validation, `@version` and audit, unlike Studio's direct database access |
| `@cratestack/validator-zod` / `-yup` | an `RpcLink` validating input against per-op schemas |
| `@cratestack/link-batch` | automatic batch scheduling as an `RpcLink` |
| `@cratestack/link-logger` | reference logging link; never touches `response.body` |
| `@cratestack/cbor` | umbrella codec; conditional exports pick node or web |
| `@cratestack/cbor-node` | N-API codec wrapping the framework's own Rust CBOR crate |
| `@cratestack/cbor-web` | wasm-bindgen codec for browsers |

`@cratestack/api` is a compat umbrella: its root re-exports only `ts-types`,
`link-batch` and `link-logger`; the `runtime-*`, `validator-*` and `adapter-*`
packages are subpath imports (`@cratestack/api/runtime-fetch`,
`@cratestack/api/adapter-rtk`, …), so none becomes a peer requirement of the root
import. It does not cover `cbor*`, `refine` or `cli`.

Links are **RPC-only** — the REST binding has no link chain. Streaming runs
through a separate `RpcStreamLink` chain. See `cratestack-rpc`.

## WireMock stubs

`cratestack generate-wiremock` emits one stub per procedure and five per model,
for contract tests without a live server. A REST stub for an `@api_version`
procedure matches `/<version>/$procs/<name>` *(since 0.13.0)*. Before 0.13.0 it
matched the unversioned path, the same wrong path the clients called.

*(Since 0.17.0)* An ordinal enum's example is its first variant's **number**, and a model field of
one is a fixed example, never echoed from the request body.

*(Since 0.19.3)* A REST procedure stub answers the procedure's declared `@status(<code>)`
(`200` when absent; `transport rpc` procedures stay `200`, as `@status` is rejected there). Before
0.19.3 every procedure stub answered `200`, so regenerate committed stubs.

**Scope limit, by design:** `transport rpc` model CRUD and every procedure have
**no per-record statefulness** — they always answer the same synthesised example
regardless of what was previously created, updated or deleted through them.
`transport rest` model CRUD stubs *are* stateful and need more than a plain
WireMock to serve.

## Client state stores

`ClientStateStore` lives in `cratestack-core` (not the HTTP client — that fixed a
layering back-edge):

```rust
pub trait ClientStateStore: Send + Sync {
    fn load(&self) -> Result<PersistedClientState, CratestackError>;
    fn save(&self, state: &PersistedClientState) -> Result<(), CratestackError>;
    fn append_request_journal(&self, entry: &RequestJournalEntry) -> Result<(), CratestackError> { … }
}
```

Only `load` and `save` are required. Adapters: `cratestack-client-store-sqlite`
and `cratestack-client-store-redis`, plus `InMemoryStateStore` and
`JsonFileStateStore` in the runtime. Wire one in with `.with_state_store(...)`.

**`cratestack-client-store-sqlite` is an offline request journal, not the
embedded ORM.** For on-device data see `cratestack-embedded`.

## Keeping committed clients honest

The framework commits two generated clients and regenerates them with
`just regen-examples`, which CI runs as `just regen-examples --check`. The recipe
*is* the check, so the local command and the CI gate cannot copy-paste diverge.
Adopt the same shape: one command, `--check` in CI, review `git diff` locally
after touching a template.

Remember `--check` honours `.gitignore` for its "unexpected file" arm, so run it
inside a real checkout.
