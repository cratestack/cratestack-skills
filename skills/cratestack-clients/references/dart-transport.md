# The generated Dart client's HTTP transport

*(since 0.16.0, cratestack#1204, PR #1206.)* Everything here shipped in 0.16.0.
If `cratestack --version` is older, the generated `runtime.dart` still has the four
`*DioAdapter` classes and none of this exists: regenerate with a 0.16.0 or newer CLI,
or do not use this page.

Source of truth, in the framework repo: `crates/cratestack-client-dart/templates/`
(`http_runtime/seam.dart.j2`, `rest_runtime/http_adapter.dart.j2`,
`rpc_runtime/http_adapter.dart.j2`, `rpc_runtime/types.dart.j2`,
`dio-transport.dart.j2`, `fespalier-transport.dart.j2`), the `## 0.16.0`
entries for #1204 in `CHANGELOG.md`, and `crates/cratestack-client-dart/README.md`.
Every name below was read from those templates.

## The layers

Every generated `lib/src/runtime.dart` (all presets, REST and RPC) declares the
same pure-Dart seam. The adapters are written once over it; the HTTP stack is a
transport you pick.

```mermaid
sequenceDiagram
  participant App as App code
  participant Api as Generated XApi / ProceduresApi
  participant Ad as CratestackHttpAdapter / CratestackRpcHttpAdapter
  participant Tr as CratestackHttpTransport (Dio, fespalier, yours)
  participant Srv as Server
  App->>Api: call(args, options: abort, idempotencyKey, headers)
  Api->>Ad: execute(request) / call(opId, input)
  Note over Ad: codec (CBOR or JSON), headers, canonical query, absolute URI
  Ad->>Tr: send(CratestackHttpRequest: method, uri, headers, body bytes, abort, extra)
  Tr->>Srv: the exact bytes
  Srv-->>Tr: any status
  Tr-->>Ad: CratestackHttpResponse (status, lower-cased headers, body stream)
  alt 2xx
    Ad-->>App: decoded by the answer's Content-Type
  else non-2xx
    Ad-->>App: throws CratestackRestException (REST) / CratestackRpcException (RPC)
  end
  Note over Tr,Ad: no answer at all: the transport throws CratestackTransportException
```

| Layer | Name | Owns |
| --- | --- | --- |
| Interface the generated APIs call | `CratestackClientAdapter` (REST), `CratestackRpcAdapter` (RPC) | nothing; they are the contract |
| The one adapter per protocol | `CratestackHttpAdapter`, `CratestackRpcHttpAdapter` | headers, CBOR/JSON, `Content-Type` dispatch, the query string, error mapping |
| The seam | `CratestackHttpTransport` (`send(CratestackHttpRequest) -> CratestackHttpResponse`) | the connection, retries, deadlines, interception |
| A transport | `CratestackDioTransport(dio)`, `CratestackFespalierTransport(httpTransport)`, or your own | one HTTP stack |

The seam, the request and response types and the exceptions have no dependency.
Only `lib/src/dio_transport.dart` names Dio. Under `--preset fespalier`,
`fespalier_transport` is imported by `lib/src/fespalier_transport.dart` and by the
provider file `lib/src/client.dart` (its providers are `Provider<HttpTransport>`).

## Constructing an adapter

```dart
// REST. format defaults to CratestackWireFormat.cbor.
final adapter = CratestackHttpAdapter(
  CratestackDioTransport(dio),
  baseUri: Uri.parse('https://api.example.com'),
  // format: CratestackWireFormat.json,
  // useRustTransport: true,   // REST only; see below
);
final client = MyClient(adapter, basePath: '/api');   // MyClient is `client_class_name`

// RPC. No basePath: the adapter joins `/rpc/...` onto baseUri.
final rpcAdapter = CratestackRpcHttpAdapter(
  CratestackDioTransport(dio),
  baseUri: Uri.parse('https://api.example.com'),
);
final rpcClient = MyClient(rpcAdapter);
```

- `baseUri` replaces `dio.options.baseUrl`, which `CratestackDioTransport` **no
  longer reads**: the adapter sends an absolute URI. A path prefix on `baseUri`
  (`https://example.com/v1`) is kept. Do not set both and expect them to add up.
- `format` is the request-body format and the `Accept` preference. The answer is
  always decoded by its own `Content-Type`, so a JSON adapter still reads a CBOR
  answer. CBOR is the default, as it was for the `Cbor*` adapters.
- Interceptors, base headers, certificate pinning and retry configured on the
  `Dio` keep working under `CratestackDioTransport`. An interceptor that reads
  `options.path` now sees an absolute URI.
- `useRustTransport` (REST only) puts `cratestackUseRustTransportExtraKey` in
  `CratestackHttpRequest.extra`; `CratestackDioTransport` copies `extra` into
  `Options.extra` for a host interceptor. It is never a header.
- A response of an unsupported `Content-Type` is a `FormatException` on the JSON
  REST adapter too (it used to return the raw string).

## Never write these: the four removed adapters

`CratestackDioAdapter`, `CratestackCborDioAdapter`, `CratestackRpcDioAdapter` and
`CratestackRpcCborDioAdapter` are **deleted, with no aliases** (breaking). Code
that names one does not compile against a regenerated package. Do not write one
from memory, from an older doc page, or from the docs site (which may still show
them). The replacement is one line each:

| Before | After |
| --- | --- |
| `CratestackCborDioAdapter(dio: dio)` | `CratestackHttpAdapter(CratestackDioTransport(dio), baseUri: Uri.parse(baseUrl))` |
| `CratestackDioAdapter(dio: dio, useRustTransport: r)` | `CratestackHttpAdapter(CratestackDioTransport(dio), baseUri: Uri.parse(baseUrl), format: CratestackWireFormat.json, useRustTransport: r)` |
| `CratestackRpcCborDioAdapter(dio: dio)` | `CratestackRpcHttpAdapter(CratestackDioTransport(dio), baseUri: Uri.parse(baseUrl))` |
| `CratestackRpcDioAdapter(dio: dio)` | `CratestackRpcHttpAdapter(CratestackDioTransport(dio), baseUri: Uri.parse(baseUrl), format: CratestackWireFormat.json)` |

The **JSON** adapters become `format: CratestackWireFormat.json`; the CBOR ones
take the default. `baseUrl` is whatever was in `dio.options.baseUrl`.

## Upgrading an app: the checklist

1. Regenerate the package with a CLI that has the change, then
   `dart run build_runner build --delete-conflicting-outputs`
   (or `--run-build-runner`).
2. Grep the app and its tests for the four removed names and rewrite each with the
   table above. Typical sites: a provider override
   (`<prefix>AdapterProvider.overrideWithValue(...)`), a test double, a DI module.
3. Move `dio.options.baseUrl` into `baseUri`. If the old URL had a path (`/v1`),
   put it in `baseUri`; it is kept.
4. Replace every `on DioException` around a generated call:
   - an HTTP error answer is `CratestackRestException` (REST) or
     `CratestackRpcException` (RPC);
   - no answer is `CratestackTransportException` (see below).
   The `DioException` is usually still reachable as `.cause` of the transport
   exception.
5. Check query values. A `null` in a query map is now **omitted**; Dio used to send
   a bare `key`. The generated query builders never emit `null`, so this bites only
   hand-built `queryParameters`. If the server read a bare `key` as "present",
   send an explicit value instead.
6. Check anything that read `options.path` in a Dio interceptor: it is absolute.
7. Run the app against a server and confirm the wire did not change. It should not:
   method, URI with query, headers and body bytes are pinned against the retired
   adapters by the framework's `wire_parity_*` tests.

## Errors

```mermaid
stateDiagram-v2
  [*] --> Sent: transport.send
  Sent --> Unsent: refused, DNS, connect timeout, TLS before any byte
  Sent --> Aborted: options.abort completed
  Sent --> TimedOut: a deadline expired after the request may have left
  Sent --> Broken: dropped mid-request or mid-body, malformed response
  Sent --> Answered: any HTTP status
  Answered --> Ok: 2xx
  Answered --> RestOrRpcException: non-2xx
  Unsent --> [*]: CratestackTransportUnsent (safe to resend)
  Aborted --> [*]: CratestackTransportAborted
  TimedOut --> [*]: CratestackTransportTimedOut (server may have acted)
  Broken --> [*]: CratestackTransportBroken (server may have acted)
  Ok --> [*]
  RestOrRpcException --> [*]: CratestackRestException / CratestackRpcException
```

| Exception | When | Carries |
| --- | --- | --- |
| `CratestackRestException` | REST, non-2xx answer | `status`, `body` (the decoded CBOR/JSON error body, the text of any other `Content-Type`, or `null` if absent or undecodable). *(Since 0.17.1, cratestack#1243)*: `headers`, and getters `code`, `message` (both `null` when `body` is not an envelope), `details`, `extra` (every member but those three) and `challenges` (the raw `WWW-Authenticate` value) |
| `CratestackRpcException` | RPC, non-2xx answer | `status`, `body` (`RpcErrorBody`), and getters `code`, `message`, `details`; *(since 0.17.1, cratestack#1243)* `headers`, `extra` (`RpcErrorBody.extra`, every member but `code`, `message` and `details`; 0.17.0 and earlier drop them) and `challenges`. A body that did not decode becomes `code: internal`, `message: 'HTTP <status>'`. Codes are `CratestackRpcErrorCodes.*` |
| `CratestackTransportUnsent` | the request provably never left the device | `cause`, `message`. **Always safe to resend, even a non-idempotent call.** |
| `CratestackTransportAborted` | `options.abort` completed | `cause`, `message` |
| `CratestackTransportTimedOut` | a deadline expired after the request may have left | `cause`. The server may have acted: retry only with an idempotency key |
| `CratestackTransportBroken` | anything else without an answer | `cause`. The server may have acted |

- `CratestackTransportException` is `sealed`, so a `switch` over the four is
  exhaustive and needs no default.
- `on CratestackRestException` / `on CratestackRpcException` means "the server
  said no" and nothing else. Network failure is never one of these.
- `challenges` is a list of the raw header value, unparsed. The seam's
  `CratestackHttpResponse` joins a repeated header with `, `, so two
  `WWW-Authenticate` lines arrive as **one** entry holding both. An error inside a
  batch frame or a stream's final item has no headers: `challenges` is empty
  *(since 0.17.1, cratestack#1243; tests: `crates/cratestack-client-dart/tests/fixtures/auth_refusal_{rest,rpc}_test.dart`)*.
- `CratestackRestException` is **new**: REST used to leak a raw `DioException`
  from `execute`. Any "REST has no typed remote error" statement is out of date.
- A transport must resolve for **every** status and throw only for no answer. A
  hand-written transport that throws on 404 turns an answer into a
  `CratestackTransportException`.

### Reading a validation refusal over RPC

A rejected field over RPC is `422` with code `invalid_argument` (REST: `422
VALIDATION_ERROR`). `fespalier_cratestack` reads both as `FieldErrors` (RPC since
fespalier#277, in the `v0.21.1` tag and on `main`; the `v0.21.0` tag does not have
it, checked by grep of its `lib/`). With plain `catch` the app sees
`CratestackRpcException(status: 422, code: 'invalid_argument')`; there is no
generated field-error type. Do not branch on the message text.

## Call options

| Field | `CratestackCallOptions` (REST) | `CratestackRpcCallOptions` (RPC) |
| --- | --- | --- |
| `headers` | yes; win over the adapter's own | yes |
| `idempotencyKey` | yes, sent as `Idempotency-Key` | yes, sent as `Idempotency-Key` (unary `call` only) |
| `abort` | yes | yes |
| `extra` | yes; merged into `CratestackHttpRequest.extra` after adapter entries (never on wire; not kept by `prepare`) | yes; merged into `CratestackHttpRequest.extra` (never on wire; not kept by `prepareCall`) |

`abort` is a `Future<void>?`. Completing it cancels the send at any stage,
including while the response body is streaming, and the call throws
`CratestackTransportAborted`.

```dart
final cancel = Completer<void>();
final future = client.procedures.someCall(
  args,
  options: CratestackRpcCallOptions(abort: cancel.future, idempotencyKey: 'order-42'),
);
cancel.complete();   // the call throws CratestackTransportAborted
```

`idempotencyKey` on REST is new; RPC already had it. RPC sends it on the unary
`call` only, not on `batch` or `stream` (a batch carries `idem` per frame in
`RpcRequest`). The framework mints nothing: the app generates the key once per
logical operation and reuses it on retry. See `cratestack-data-integrity`.

**Per-call transport attributes (`extra`, cratestack#1207).**
`CratestackCallOptions.extra` and `CratestackRpcCallOptions.extra` (`Map<String, Object?>`,
default `const {}`) merge into `CratestackHttpRequest.extra` after the adapter's own
entries (so `options.extra` wins on key collision, and `CratestackFespalierTransport`
forwards it as `TransportRequest.attributes`). It is never sent on the wire and is not
persisted by `prepare` / `prepareCall`. On `0.19.5` and earlier, neither options type
had `extra`, so a call had to set a header (`x-fespalier-confirm: <caption>`) that a
decorator **above** the session turned into attributes and stripped before the wire.

## Streaming

`CratestackRpcHttpAdapter.stream()` no longer buffers the response. It reads an
`application/cbor-seq` answer as it arrives (`CborSeqStreamTransformer`), so items
are yielded before the body ends. A final `Tag(48900, RpcErrorBody)` item is turned
into a `CratestackRpcException`. The boundary scanner defaults to the pure-Dart
`CratestackCborSeqScanner`; pass `cborSeqDecoder:` (a `CborSeqDecoderHandle
Function()`) to use another, such as an FFI-backed one. A single-array
`application/cbor` or JSON answer is still read whole and then yielded item by
item. The server side is `@stream`, see `cratestack-rpc`.

`stream()` is an `async*` generator: nothing is sent until the stream is listened
to, and every failure (a transport exception, a non-2xx answer, the in-band error
item) arrives as the **stream's error**, not as an exception from the call. Consume
it with `await for` inside `try`.

## Query encoding

A canonical encoder (`cratestackCanonicalizeQuery`) builds the query string and the
REST adapter appends it, so no HTTP client's list or null rule applies:

- pairs in map order; keys and values through `Uri.encodeQueryComponent`;
- a list repeats its key: `tag=a&tag=b`;
- a nested map nests with literal brackets: `filter[kind]=x`;
- **a `null` value is omitted**, never a bare `key`;
- anything else is its `toString()`.

For every value the generated query builders emit, the bytes equal what Dio sent.

## Choosing a preset

| Preset | Pick it when | You get | HTTP stack |
| --- | --- | --- | --- |
| `default` | a Flutter package with no code-generated state layer, or you will wrap the client yourself (every preset's package depends on the Flutter SDK; *since 0.18.0* also on the Flutter plugin `cratestack_cbor`, so no plain-Dart program can use one) | `lib/src/models.dart` + `apis.dart`, the transport seam, `<prefix>AdapterProvider` / `ClientProvider` | Dio via `CratestackDioTransport`, or any transport you write |
| `riverpod` | a Riverpod app that wants one file per model and a provider per operation (reads are providers, writes are controllers) and already has, or is happy to have, a Dio | per-model files, `@riverpod` providers, `dart_mappable` models | Dio via `CratestackDioTransport`, or any transport you write |
| `fespalier` | the app is built on fespalier, or its HTTP stack is a `fespalier_transport` chain (a signing or session decorator, a portal check, spans) and you do not want a second HTTP client under it | the `riverpod` output, sending through fespalier's `HttpTransport` | `fespalier_transport` by git; **no `dio`** |

Rules of thumb:

- Choose by the **HTTP stack the app already owns**, not by taste. If requests must
  pass through fespalier decorators, `fespalier` is the only preset that does it
  with no Dio in front. If the app has a Dio with interceptors, keep `riverpod`
  or `default`.
- `fespalier` is `riverpod` plus a different transport. It is not a fourth layout.
  An existing `riverpod` app moves to it by changing the preset and the overrides,
  not the call sites.
- A custom stack that is neither Dio nor fespalier does not need a preset: implement
  `CratestackHttpTransport` and use `default` or `riverpod`. Both still list `dio`
  in the pubspec; that is a dependency of the generated package, not a requirement
  to pass one.

## `--preset fespalier`

```bash
cratestack generate-dart --schema schema.cstack --out ./client \
  --library-name orders_client --preset fespalier --run-build-runner
# pin fespalier at another tag, branch or commit:
#   --fespalier-ref v0.21.1
```

- `--fespalier-ref <REF>` is accepted **only** with `--preset fespalier` (any other
  preset is an error: `--fespalier-ref only applies to --preset fespalier`), and
  must be non-empty with no whitespace. Default `v0.21.0`, a generator constant.
  fespalier has tags `v0.21.0` and `v0.21.1`; both have the transport types the
  generated file uses, and only `v0.21.1` has the RPC validation reading in
  `fespalier_cratestack` (see above). `--fespalier-ref` pins only the generated
  package's `fespalier_transport`; it must match the ref of the app's other fespalier
  packages, or pub reports a git-source conflict. An RPC app that wants field errors
  depends on `fespalier_cratestack` at `v0.21.1` or later and passes that same ref.
- The pubspec depends on `fespalier_transport` by **git**
  (`url: https://github.com/fespalier/fespalier`, `path: packages/fespalier_transport`,
  `ref: <fespalier-ref>`). It is not on pub.dev, and `dio` is not a dependency.
  Resolution needs the ref to be reachable. In a monorepo that holds fespalier,
  override it with `pubspec_overrides.yaml` pointing at the checkout.
- The preset emits `lib/src/fespalier_transport.dart` (`CratestackFespalierTransport`)
  and **no** `lib/src/dio_transport.dart`.
- Providers, with `<prefix>` the camel-cased `--library-name` (`orders_client` ->
  `ordersClient`):
  - `<prefix>TransportProvider` (`Provider<HttpTransport>`) and
    `<prefix>BaseUriProvider` (`Provider<Uri>`) **throw `UnimplementedError` until
    the app overrides them**;
  - `<prefix>AdapterProvider` defaults to `CratestackHttpAdapter` /
    `CratestackRpcHttpAdapter` over `CratestackFespalierTransport(ref.watch(<prefix>TransportProvider))`
    and `ref.watch(<prefix>BaseUriProvider)`, so an app does **not** override it
    unless it changes the format;
  - `<prefix>BasePathProvider` (REST only) is the request path prefix, unchanged;
    the base URI is the server's origin, so keep them apart.

```dart
ProviderScope(
  overrides: [
    ordersClientTransportProvider.overrideWith(
      (ref) => SessionTransport(
        WriteGuardTransport(HttpClientTransport(client)),
        ref.watch(credentialsProvider),
      ),
    ),
    ordersClientBaseUriProvider.overrideWithValue(Uri.parse('https://api.example.com')),
  ],
  child: const MyApp(),
)
```

What `CratestackFespalierTransport` does:

- Sends the exact body bytes and the headers; `CratestackHttpRequest.extra` goes
  out as `TransportRequest.attributes` and never on the wire. A signer above it sees
  the same bytes the adapter encoded.
- **Abort is merged**: the call option's `abort` and the current `TransportZone`'s
  trigger (`TransportZone.merge`). Either aborts, so `ref.cancellable` in
  `fespalier_cratestack` aborts a page's loads with no wiring, even for a call that
  carries its own `abort`.
- Every status is an answer. A `TransportStatusError` thrown by a decorator is
  treated as the answer it carries, so it becomes `CratestackRestException` /
  `CratestackRpcException`.
- `TransportAborted`, `TransportUnsent`, `TransportTimedOut`, `TransportBroken` map
  one to one onto the `CratestackTransport*` kinds. `TransportPortal` and
  `TransportUntrusted` become `CratestackTransportBroken` (the seam has no kind for
  them); the original is `cause`, so tell them apart with
  `error.cause is TransportPortal`.
- **Any other error a decorator throws (for example `AuthRejected`) reaches the
  caller unchanged.** Do not assume every failure is a `CratestackException` type.

### Device ceremonies (`@device_auth`)

*(since 0.19.7, unreleased on main, cratestack#1303)* Only `--preset fespalier` reads the marker; `default`, `riverpod`, TypeScript, WireMock, the Rust
client and the macros ignore it (output is byte-identical with and without it). A schema with markers gets
`lib/src/device_auth_server.dart`, exported from the library: `<Prefix>DeviceAuthServer implements
DeviceAuthServer` (`package:fespalier_sign_keypair`). **Do not hand-write that class when the schema can
carry the marker.** Reference schema: `crates/cratestack-parser/tests/fixtures/device_auth.cstack`; generated
output: `crates/cratestack-client-dart/tests/snapshots/fespalier_device_auth_{rest,rpc}/lib/src/device_auth_server.dart`.

| `role` | interface method | required | policy |
| --- | --- | --- | --- |
| `beginEnrolment` | `beginEnrolment(EnrolmentStart)` | yes | exactly `@allow(true)` |
| `confirmEnrolment` | `confirmEnrolment(challenge, signatures, proof)` | yes | exactly `@allow(true)` |
| `beginRenewal` | `beginRenewal(deviceId, role)` | yes | exactly `@allow(true)` |
| `confirmRenewal` | `confirmRenewal(challenge, signature)` | yes | exactly `@allow(true)` |
| `revoke` | `revoke(credential, signer)` | yes | must **not** admit a caller with no session (`@allow(true)` is a parse error; `@allow(auth() != null)` is fine) |
| `sendEnrolmentCode` | extra method on the class, not in the interface | no | exactly `@allow(true)` |

Shapes (matched by field name; each leg takes one `type` and returns one `type`):

- `beginEnrolment`: input `ambient` (JWK `type`: `kty`, `crv`, `x`, `y`, all `String`), optional `userPresent`
  (`Jwk?`); every other field is `String` / `String?`, read from `EnrolmentStart.fields[name]`. Return:
  `ambient` (`String`), `userPresent` (`String?`, iff the input has it), other `String` fields go to
  `EnrolmentChallenge.data`.
- `confirmEnrolment`: input `ambient`, `userPresent` (`String?`, iff above), optional `proof:` field, and
  only fields `beginEnrolment` returned (same name and type). Return `deviceId`, `userId`, `ambient`,
  `userPresent`, optional `name` / `email`; other `String` fields go to `AuthUser.claims`.
- `beginRenewal`: input exactly `deviceId`, `role` (`String`); return `challenge` (+ extra `String` fields to
  `RoleChallenge.data`). `confirmRenewal`: `signature` + fields echoing that return; return `attestation`.
  `revoke`: input exactly `deviceId`; any return.

Behaviour of the generated class:

- Constructor `(transport, {required baseUri, basePath = '/api' (REST only), fieldErrors, userOf})`.
  `transport` is `AuthConfig.transport` (no session). `fieldErrors` (`Object? Function(Object)?`, pass
  `errors.fieldErrorsOf`) keeps the package free of `fespalier` and `fespalier_cratestack`. `userOf` replaces
  the default user (`userId` is the id, `name` / `email`, the rest in `claims`).
- `static unsignedPaths(baseUri[, basePath])` lists the unsigned legs' paths for
  `DeviceAuthBackend(unsignedPaths:)`: the four required legs, plus `sendEnrolmentCode` when marked. REST
  `<basePath>/$procs/<name>`, RPC `/rpc/procedure.<name>`.
- `403` is an `AuthRejected` on `beginRenewal`, `confirmRenewal` and `confirmEnrolment` (not on
  `beginEnrolment`, not on `revoke`); other failures are thrown as is. `revoke` is signed by the device through
  a private signing transport using the `DeviceSigner` it is handed.
- **Caveat:** every leg runs in a `TransportZone` with an abort trigger that never fires, a workaround for a
  *suspected, unconfirmed* `fespalier_auth` issue (a page leaving might abort a renewal shared by every
  waiting request). Do not describe it as a confirmed bug.
- **One-time code, two placements.** With leg one: an ordinary `String` field of the `beginEnrolment`
  argument (`fields['otp']`), plus an optional `sendEnrolmentCode` procedure that asks the server to send the
  code first (what Authkestra does). With leg two: `@device_auth(role: "confirmEnrolment", proof: "otp")`
  names the field that receives it, which must be `String` / `String?` (the parser refuses any other type); without `proof:` the proof is ignored.
- Pubspec: also depends on `fespalier_auth`, `fespalier_keypair`, `fespalier_sign_keypair` by git at the same
  `--fespalier-ref` (default `v0.21.0`; the interface is byte-identical v0.21.0 to v0.26.0); floor Dart
  `>=3.12`, Flutter `>=3.44`. `--fespalier-ref` therefore pins four packages when markers are used, and with markers it must be a release tag `vMAJOR.MINOR.PATCH`: a branch or commit fails generation with `FespalierRefNotATag` ("is not a release tag"). Without markers any ref is accepted.
- The generated file imports every fespalier library under a prefix (`fsign`, `fauth`, `fkey`, `ftransport`; `dart:async` as `async`), so `userOf` is typed `fauth.AuthUser Function(<Answer>)` and a schema `type` may be named `RoleChallenge`, `AuthUser`, `Attestation`.

### The reference example

fespalier's `examples/cratestack`
(<https://github.com/fespalier/fespalier/tree/main/examples/cratestack>, from
fespalier#277) is the worked version: a Rust CrateStack server (`server/`,
`cratestack-api` 0.15.4, no database), a client **generated** with `--preset
fespalier` (`client/`, committed, regenerated and compared in CI), and device-signed
sessions (`fespalier_sign_keypair`: no password, no token, no `Authorization`
header). It is RPC, uses `--no-native-cbor` so the client needs no native library (that flag is
*(removed in 0.18.0, cratestack#1281)*: regenerating with 0.18.0 makes it depend on `cratestack_cbor`),
and pins the CLI by commit. Read it for the wiring (`lib/src/wiring.dart`) before
inventing one. It also demonstrates the two limits below.

### Known gaps, with their workarounds

- **cratestack#1207, call options carry transport attributes** *(fixed: `options.extra`;
  workaround below is only for `0.19.5` and earlier)*.
  Workaround on older releases: a header that a decorator above the session turns into
  attributes and strips.
- **cratestack#1208, an `AuthProvider` refusal cannot shape its status or body** *(fixed
  since 0.17.1: `AuthRefusal`, see `cratestack-policy-auth`; the workaround below is for 0.17.0
  and earlier)*.
  `AuthProvider::authenticate` returns an error that becomes the standard
  `{code, message}` envelope, so a provider cannot add a member such as
  `{"error": "attestation_expired"}` that a client-side session classifier reads.
  Workaround in the example: the verification runs in a **layer in front of the
  router** that writes its own 401/403, and the `AuthProvider` only converts what the
  layer recorded into a `CratestackContext`. Do not move that check into the
  `AuthProvider` and expect the client to tell "renew" from "wipe". See
  `cratestack-policy-auth`.

#1207 is fixed (`options.extra`; keep the header-and-strip workaround only on `0.19.5` and earlier). #1208 shipped in 0.17.1 (its issue may still read open): on 0.17.1 use `AuthRefusal`, and keep the layer only on 0.17.0 and earlier.

## Prepared retries *(since 0.18.1, cratestack#1297)*

REST `prepare(request, options: ...)` and RPC `prepareCall(opId, input, options: ...)` encode without sending. Persist `CratestackPreparedCall.toJson()` before the first `executePrepared`; restore with `fromJson` under the original service, format, contract and tables. The snapshot excludes authentication headers and rejects URL userinfo; query strings and bodies are persisted and can contain secrets. If the REST client's `basePath` is overridden, set the adapter's `preparedBasePath` to match. Execution derives `useRustTransport` from the current adapter and sends `x-cratestack-schema-sha` as an ordinary call does. Pass per-attempt headers (a tenant, a trace id) as `executePrepared(call, headers: {...})` and a fresh credential as `authorization:`; a header naming `Idempotency-Key`, `If-Match`, `Accept`, `Content-Type` or `Cratestack-Contract` is a `FormatException`. CBOR validation checks one well-formed item and UTF-8 with nesting limited to 256; it does not enforce tag semantics or reject duplicate map keys. A sealing transport must create a fresh envelope and corresponding `PendingResponse` for each execution; do not persist and resend an outer seal. Validate access to and integrity of the caller-owned journal. Source: `crates/cratestack-client-dart/tests/fixtures/compact_hooks_rest_test.dart` and `compact_hooks_rpc_test.dart`.

## A transport of your own

Implement one method. Resolve for every HTTP status; throw a
`CratestackTransportException` only when there is no answer. Send
`request.body` byte for byte and add no header the request does not carry.

```dart
class MyTransport implements CratestackHttpTransport {
  @override
  Future<CratestackHttpResponse> send(CratestackHttpRequest request) async {
    // request.method, request.uri (absolute, query included), request.headers,
    // request.body (the exact bytes, or null), request.abort (completes when the
    // caller gives up), request.extra (never sent).
    // Return CratestackHttpResponse(status:, headers:, body: Stream<Uint8List>);
    // CratestackHttpResponse.buffered(...) is handy in tests.
    throw UnimplementedError();
  }
}
```

Response header names are lower-cased by the type. `body` is single-subscription.
Retries, deadlines and interception are the transport's job, not the adapter's.
`CratestackHttpResponse.buffered` is the test double: a fake transport that returns
canned answers replaces the old practice of mocking Dio.

## What is unchanged

The wire: methods, URIs, headers, body bytes, and the `x-cratestack-schema-sha`
header. The `cratestack_cbor` codec cache (one copy now, shared by both adapters).
`--no-native-cbor` (itself *(removed in 0.18.0, cratestack#1281)*). The `Accept` preference per format. Model and procedure API
names.
