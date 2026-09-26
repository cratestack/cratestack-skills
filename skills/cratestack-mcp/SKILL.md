---
name: cratestack-mcp
description: Serving a CrateStack schema to AI agents over the Model Context Protocol. Load when a schema has an mcp { } block, @mcp(tool ...) on a procedure or @@mcp(resource ...) on a model, when enabling the mcp feature on cratestack-pg or cratestack-api, when wiring StdioServer or StreamableHttpServer, when a question mentions MCP tools, MCP resources, cratestack:// URIs, tools/list, resources/read, the MCP Inspector, or an MCP AuthProvider and audience checks.
---

# MCP operator

> **Verified against CrateStack 0.12.0.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

**Everything on this page is *(unreleased)*.** The MCP operator is on `main` and in no
published version. On 0.12.0 an `mcp { }` block is a compile error, and `@mcp` /
`@@mcp` do not exist. Do not generate MCP code for a project pinned to a release.

The design is ADR 0002 (`cratestack-docs/internals/mcp-operator-adr.md`); the working
example is `examples/mcp-operator/` in the framework repo.

## What it is

A schema can expose **procedures as MCP tools** and **models as read-only MCP
resources**, to agents, over stdio or Streamable HTTP, at MCP protocol `2026-07-28`.
Every call goes through the same generated policy code as REST and RPC. An agent can
do exactly what the same caller could do over REST.

It is opt-in twice: the `mcp` Cargo feature, **and** an annotation per declaration.

## Enabling it

```toml
cratestack = { package = "cratestack-pg", version = "…", features = ["mcp"] }
```

- **Tools:** `cratestack-pg` or `cratestack-api`.
- **Resources:** `cratestack-pg` only.
- **`cratestack-sqlite` has no `mcp` feature.** The embedded role enforces no policy.
- **`cratestack-client` has none either.** It serves nothing.

Without the feature, any MCP declaration is a compile error telling you to enable it.

## The schema surface

```cstack
mcp {
  name = "blog"
  expose = [tools, resources]
}

model Post {
  id Int @id
  authorId String
  title String
  published Boolean

  @@allow("read", published || authorId == auth().id)
  @@mcp(resource: "posts")
}

procedure recentPosts(limit: Int): Post[]
  @allow(auth() != null)
  @mcp(tool: "recent_posts", description: "The newest posts you may read.")

mutation procedure publishPost(id: Int): Post
  @allow(auth() != null && auth().role == "editor")
  @mcp(tool: "publish_post", description: "Publish a draft post. Editors only.")
```

(From `examples/mcp-operator/schema.cstack`, trimmed.)

The rules. Every violation is a **compile error**; nothing MCP-shaped is ever silently
ignored.

- **`mcp { }` block.**
  - Entries are `key = value`.
  - `expose = [tools]`, `[resources]` or both.
  - The old line form `expose tools` is an error with a hint.
- **`name`.** Required when `resources` is exposed, refused otherwise. It is the host of
  every resource URI, so it is a DNS label:
  - `[a-z0-9-]`, 1–63 characters, no leading or trailing `-`.
  - No `--` as its 3rd and 4th characters (IDNA's reserved form: `xn--blog`, `ab--c`). `a--b` is fine.
  - At least one letter: `127` is refused, `v2` and `3d-shop` are fine.
- **Tools.**
  - `@mcp(tool: "name")`, or a bare `@mcp(tool)` to use the procedure's own name, plus
    an optional `description:`.
  - It must sit on its own line under a procedure.
  - Spelling it `@mcp.tool` (dotted) is an error.
- **Resources.**
  - `@@mcp(resource: "segment")` (`[a-z0-9-]+`), optional `max_page_size:` from 1 to 200.
  - It must sit on its own line in a model.
- **Policy is required.**
  - A tool needs an `@allow` (`@deny` alone is refused).
  - A resource needs a read allow: `@@allow("read", …)`, `@@allow("all", …)`, or both
    `"list"` and `"detail"`.
- **Not a tool.**
  - `@stream` procedures.
  - Procedures whose input or output reaches `Json`, `FindMany`, `Vector`, `Geography`
    or `Geometry`, which have no faithful JSON Schema.
  - A `Decimal` needs the schema's `decimal = RustDecimal | BigDecimal` argument.
- **Not a resource.** `@@mcp` on a model whose `@@internal` hides get or list, or whose
  `@id` isn't `String`, `Cuid`, `Int` or `Uuid`.
- **`db = None` schemas cannot expose resources.**

## Serving over stdio

The macro generates `cratestack_schema::mcp`; `tools(db, registry, resolvers)` is the
tool table. **You must name the caller.** There is no default identity, and an
anonymous context is refused: `StdioServer::new` (and `McpServer::new`) return
`Err(StdioConfigError::AnonymousContext)` for a context that isn't authenticated.
Never pass `CratestackContext::default()` or `::anonymous()`:

```rust
let ctx = cratestack::SystemContext::for_service("support-agent").into_context();
cratestack::mcp::StdioServer::new(cratestack_schema::mcp::tools(db, registry, resolvers), ctx)?
    .serve()
    .await?;
```

Send `tracing` to **stderr**. stdout carries only MCP messages.

## Serving over Streamable HTTP

```rust
let resource = ProtectedResource::new("https://api.example.com/mcp", ["https://auth.example.com"]);
let mcp = StreamableHttpServer::builder(tools, auth_provider, ["https://app.example.com"], resource)
    .build()?;
let app = Router::new()
    .nest_service("/mcp", mcp.service())
    .merge(mcp.metadata_router()); // RFC 9728 metadata
```

- **Required builder arguments.** The `AuthProvider` and a non-empty allowed-origins list.
- **The provider must check the token's audience** against the resource identifier.
  CrateStack ships no generic OAuth provider. The example's `src/token.rs` is example
  code, not an API.
- **Answers before MCP handling:**
  - 403 for a foreign `Origin`;
  - 405 for `GET`/`DELETE`;
  - 400 `invalid_request` for a query-string token or an ambiguous `Authorization`;
  - 401 plus `WWW-Authenticate` for a missing or rejected token;
  - 413 above 4 MiB.
- **What reaches your procedure.** The token is stripped once the provider has run, and
  the call runs under the context the provider built.
- **`with_allowed_hosts`.** The default allowed `Host` is the resource identifier's
  `host[:port]`.

Both servers take `with_executor(OpExecutor)` for L3 admission (rate limiting, then
idempotency) and `with_store_error_policy(StoreErrorPolicy)`. The policy is the same
type `RateLimitLayer` uses. Pass `Deny` to MCP too if you chose it on HTTP. A caller's
MCP calls draw on their own budget, separate from its REST budget.

## Behaviour to rely on

- **Errors.**
  - An unknown tool → JSON-RPC `-32602`.
  - Bad arguments → an `isError` result naming the field.
  - A policy denial or business error → `isError` with REST's error envelope
    (`{"code":"FORBIDDEN",...}`).
- **Idempotency.** A key goes in `_meta["dev.cratestack/idempotencyKey"]`; without one,
  a retried mutation runs again. `idempotentHint` is never `true` on a mutation.
- **Resources.**
  - One record: `cratestack://<name>/<segment>/{id}`.
  - A page: `cratestack://<name>/<segment>{?limit,cursor}`, returning
    `{"items","nextCursor"}` in primary-key order. `limit` defaults to 50 and is clamped
    at 200, or lower if `max_page_size` says so.
  - Shaped exactly like REST's GET: `@server_only` fields are absent and `@computed`
    fields are resolved.
- **Not-found folding.** A row the caller may not read, a missing row, a malformed id,
  and an id with a raw non-`pchar` character are all the same `-32602`
  "resource not found". Percent-encode ids (`a%20b`).
- **URI matching.** The scheme is case-insensitive; the name, segment and id are matched
  exactly.
- **Caller checks.** Every method that answers (`server/discover`,
  `completion/complete`, every list method, `tools/call`, `resources/read`, and a legacy
  `initialize`) fails closed without the HTTP guard's caller.
- **Protocol.** Only `2026-07-28`. A legacy `initialize` gets `-32022`. With the MCP
  Inspector CLI, pass `--protocol-era modern`.

## Known limits

- **No CRUD-derived tools.** Only procedures are tools, and models are read-only resources.
- **`tools/list` is not filtered by the caller's authorization.** Every caller sees the
  whole table, and each call is still policy-checked.
- **No schema-metadata resources and no `subscriptions/listen`.**
- **`StdioServer` has no `with_implementation`,** so a stdio server reports itself as
  `cratestack-mcp`.
