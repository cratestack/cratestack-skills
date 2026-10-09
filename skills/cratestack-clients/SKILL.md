---
name: cratestack-clients
description: Generating and consuming CrateStack clients — include_client_schema! for Rust, cratestack generate-dart (with the riverpod preset), cratestack generate-typescript (with swr/tanstack/rtk/refine layers), the @cratestack npm family, cratestack_cbor for Dart, the CBOR wire contract and reviveWireFields, WireMock stubs, and client state stores. Load when generating an SDK, wiring a React/Flutter front end to a CrateStack service, or debugging a Decimal or Bytes value that arrived as a string.
---

# Clients

> **Verified against CrateStack 0.14.2.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

Three generated languages, one wire contract.

| Language | Produced by | Ships |
| --- | --- | --- |
| Rust | `include_client_schema!` | typed model + procedure clients over a reqwest runtime |
| Dart / Flutter | `cratestack generate-dart` | models, selection builders, API facades, `--preset riverpod` layer |
| TypeScript | `cratestack generate-typescript` | fetch client, plus `--swr` / `--tanstack` / `--rtk` / `--refine` layers |

## Rust — `include_client_schema!`

```toml
cratestack = { package = "cratestack-client", version = "0.14" }
# the generated structs derive through bare `serde::` paths
serde = { version = "1", features = ["derive"] }
```

Arguments: a path literal, plus an optional `decimal = RustDecimal | BigDecimal`.
That facade re-exports **only** `include_client_schema!` — not the other two
entry macros — and `cratestack-axum` (and therefore `axum`, `tower`, `hyper`,
`tower-http`) is structurally absent from its graph under default features.

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
let runtime = CratestackClient::cbor(ClientConfig { base_url: url })
    .with_request_authorizer(Arc::new(MyAuth));
let client = cratestack_schema::client::Client::new(runtime);

let posts = client.posts().list(query, headers).await?;
let one   = client.posts().get(&id, headers).await?;
let out   = client.procedures().my_procedure(&args, headers).await?;
```

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

`--preset riverpod` replaces the default layout's monolithic models/APIs with one
file per model plus a provider per operation (reads are providers, writes are
controllers); the runtime and constants are shared with the default preset.
Consumption in Flutter is one override of `<libraryName>AdapterProvider` — the
prefix is the camel-cased `--library-name`:

```dart
ProviderScope(overrides: [
  myClientAdapterProvider.overrideWithValue(CratestackDioAdapter(dio: dio)),
])
```

Two REST adapters ship — `CratestackDioAdapter` (JSON) and
`CratestackCborDioAdapter` (CBOR) — and the consumer picks. Generated data
classes carry hand-rolled `fromWire` / `toWire`, both routing every field through
JSON-plain values (ISO-8601 for `DateTime`, `List<int>` for `Bytes`, decimal
string text), which is why bridging `cratestack_cbor`'s JSON-text boundary is
safe.

`cratestack_cbor` on pub.dev is the native codec, auto-selecting
flutter_rust_bridge natively and wasm-bindgen on web, byte-identical to the
server's `CborCodec`. `createCborCodec()` is idempotent.

**Hard constraint before `pub add`:** it pins `flutter_rust_bridge: 2.13.0`, and
in pub's grammar a bare version is an **exact** pin. If anything in your graph
wants a different flutter_rust_bridge, `pub get` fails during version solving and
you cannot add the package at all. That is upstream's requirement, not a
CrateStack choice. Vendored platforms cover Linux x86_64, Android, Windows x64,
macOS and iOS xcframeworks, and web — **Linux arm64 is the one gap**.

### Signing requests from Dart *(unreleased, cratestack#1151)*

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

## TypeScript

```bash
cratestack generate-typescript --schema schema.cstack --out ./client \
  --package-name my-client --swr
```

The layer flags are additive; the default `src/` layout is always emitted. `--swr`
adds `src/swr/` reachable as `<package>/swr`, `--tanstack` adds
`src/react-query.ts`, `--rtk` adds `src/rtk-api.ts`, `--refine` adds
`src/refine.ts`.

`--rtk` *(since 0.12.0)*: its interesting part is that a **procedure's
invalidation tags are derived from the schema** — the generator walks the procedure's own args and return type
(recursing through `Page<T>` and `FindMany<T>`) and turns the models it finds
into that procedure's tag list. The two transports dispatch differently on
purpose: RPC endpoints call the resolved base query from inside `queryFn` so the
wire response still goes through revival, and REST endpoints use
`fakeBaseQuery()` and call this same package's REST client methods.

## The wire contract

**Default codecs differ by target, and this catches people:**

| Client | Default |
| --- | --- |
| Rust | `CborCodec` |
| TypeScript, `transport rpc` | native CBOR via `@cratestack/cbor` |
| **TypeScript, `transport rest`** | **JSON, hardcoded — there is no codec seam at all** |
| Dart REST | consumer picks the adapter |

**Regeneration hazard:** native CBOR became the default for generated TypeScript
RPC clients *in 0.8.14* (#746). Re-running `generate-typescript` on an RPC package
generated before that silently upgrades its wire codec from JSON to CBOR. A JSON-only server `CodecSet` then answers 406/415. Either mount
`CodecSet::new(CborCodec, JsonCodec)` or generate with `--no-native-cbor`.

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

### The schema-SHA header

Every generated client stamps its schema's hex SHA-256 as
`x-cratestack-schema-sha` on every request. The server **warns on mismatch and
never rejects**. An absent SHA simply omits the header. It is a drift signal, not
integrity.

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
