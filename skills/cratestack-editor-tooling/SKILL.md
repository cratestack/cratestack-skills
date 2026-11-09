---
name: cratestack-editor-tooling
description: Editor support for .cstack files — the cratestack-lsp language server and its exact capabilities, the CrateStack Schema VS Code extension, and the tree-sitter-cstack grammar for Neovim, Helix and Zed. Load when setting up .cstack syntax highlighting, diagnostics or go-to-definition in any editor, or when asking why VS Code does not use the tree-sitter grammar.
---

# Editor tooling

> **Verified against CrateStack 0.19.3.** CrateStack is pre-1.0 and its crates version
> together, so a minor release can break any of this. Check what you are actually on —
> `cratestack --version`, and the `cratestack-*` version in `Cargo.toml` — before relying
> on a fact here. Anything that arrived in a specific release is marked *(since X.Y.Z)*;
> the full feature-to-release map is in
> [cratestack/references/version-history.md](../cratestack/references/version-history.md).

Two independent pieces, for different editors, with a deliberate split.

## `cratestack-lsp`

A standalone binary speaking **LSP over stdio**, no arguments and no config file.
Install with `cargo install cratestack-lsp`.

Advertised capabilities — this list is the authority:

| | |
| --- | --- |
| Text sync | **Full** (not incremental) |
| Hover | yes |
| Completion | yes |
| Go to definition | yes |
| **Find references** | yes |
| **Document highlight** | yes |
| Document symbols | yes |
| **Rename** | yes, with prepare-rename |
| Semantic tokens | yes, full document, **no token modifiers** |
| Code actions, formatting, signature help, folding, inlay hints, workspace symbols | **no** |

`cratestack-lsp`'s own README says find-references, rename and code actions are
all unimplemented. **That is wrong for two of the three** — only code actions are
genuinely absent. The README also pins an install version of `0.7`, several
releases behind.

Diagnostics are published on `didOpen` and `didChange`.

Completion items are plain labels, no snippets. Inside a `model`, `view`, `mixin`, `type` or
`auth` block the field attributes offered are exactly that kind's closed list, read from
`cratestack_parser::field_attribute_names` *(since 0.15.4)*, so completion and `check` cannot
disagree; elsewhere every list's names are offered once. `@authn` *(since 0.17.1)* and the MCP
attributes *(since 0.13.0)* complete with their argument shapes in the detail
(`crates/cratestack-lsp/src/attribute_completion.rs`, `authn_completion.rs`, `mcp_completion.rs`).

**Last-known-good behaviour:** while a file has a syntax error the server keeps
serving the last version that parsed, so navigation, symbols and colouring stay
put. The live error is still reported, and hover says the schema is stale. A file
that has never parsed stays quiet.

Semantic token legend, nine types: `type`, `struct`, `enum`, `interface`,
`enumMember`, `property`, `function`, `parameter`, `decorator`. Models map to
`struct`, mixins to `interface`, builtin scalars to `type`, fields and
`@relation` columns to `property`, procedures to `function`, procedure arguments
to `parameter`. Only an attribute's `@name` head is a `decorator`.

Go-to-definition resolves field types to their `model` / `type` / `enum` /
`mixin`, procedure argument and return types **including inside `Page<T>`**,
`@use(Mixin)`, and both halves of `@relation(fields: […], references: […])`.
Find-references works from either end of a relation and qualifies fields by
owning declaration, so `User.id` and `Post.id` are distinct symbols.

Rename refuses rather than guesses: builtins are unrenameable, the new name must
be a non-keyword non-builtin identifier, collisions are rejected, and it refuses
entirely while the file has a syntax error. The keyword list it checks includes
the reserved multi-file words `part` and `import` *(since 0.13.0)*, queried from
`cratestack_parser::reserved_multi_file_keywords()` rather than copied — so a
rename *to* `part` or `import` is refused with a message instead of rewriting the
buffer into a file that no longer parses. (Those words are now the directives
`part`, `part of` and `import` *(since 0.19.0)*, still reserved as
identifiers.)

### Schemas split across files *(since 0.19.0)*

When the document is a file on disk, the server loads the whole schema that contains it
(`part` / `part of` / `import`), using every open editor buffer in preference to disk, so
unsaved edits in any open file are what is checked.

- Diagnostics are published **per file**, for every file in the graph including files that
  are not open; a file that had errors and now has none gets an empty publish. An error that
  involves two files carries `relatedInformation`.
- A part opened alone is analysed through its root, so you see the whole schema's real
  diagnostics. If the root cannot be loaded the one diagnostic says why (the root does not
  list the part, or the root cannot be read).
- Editing any file re-analyses every root whose graph contains it (editing a shared
  `money.cstack` refreshes every open importer).
- Go to definition crosses files. Completion offers the whole graph's models, mixins, types, procedures, `query` blocks and fields (no enum names, in any schema).
- Hover, document symbols, semantic tokens, **references and highlights** answer only with
  spans inside the requesting file, so references and highlights are file-local.
- **Rename is refused** in a schema that spans more than one file: `prepareRename` returns
  nothing and `rename` fails with `rename is not available yet in a schema split across files`.
  The same applies to any file whose text contains a `part` / `part of` / `import` line.
  *(since 0.19.1)* Rename is also refused in a file that another `.cstack` in the workspace
  folders imports or lists as a `part`, even when the file has no directive of its own and is
  opened alone (a shared `common.cstack` holding only `type` / `enum` / `mixin`). The server walks
  the workspace folders the client sent at `initialize` (skipping hidden directories, `target` and
  `node_modules`; it gives up past 10,000 files and refuses), reads open unsaved buffers before
  disk, and compares canonical paths. Remaining limit: an importer outside the workspace folders,
  or a client that sent no workspace folders, cannot be seen, and rename behaves as before. On
  0.19.0 a shared import opened alone could be renamed, breaking its importers.
- **Closing a file without saving** reverts analysis to its disk text. An open part removed from
  its root's `part` list shows M3 rather than going silent.
- A buffer with no file path (untitled) keeps single-text analysis.
- `part`, `part of` and `import` complete as keywords; the detail reads "reserved multi-file
  schema directive: `part "…"` lists a part, `part of "…"` names this part's root, `import "…"`
  brings in shared types; never valid as a name".
- Every keystroke re-parses the whole graph.

### Pointing an editor at it

**Neovim:**

```lua
require('lspconfig.configs').cratestack = {
  default_config = {
    cmd = { 'cratestack-lsp' },
    filetypes = { 'cstack' },
    root_dir = require('lspconfig.util').root_pattern('.git', '*.cstack'),
  },
}
require('lspconfig').cratestack.setup{}
```

**Emacs (lsp-mode):** `(lsp-stdio-connection '("cratestack-lsp"))` with
`:major-modes '(cstack-mode)`, `:server-id 'cratestack`, plus an
`lsp-language-id-configuration` entry mapping `cstack-mode → "cstack"`.

**Anything else:** spawn `cratestack-lsp` on stdio with language id `cstack` for
`*.cstack`.

## VS Code

Extension id **`cratestack.cratestack-vscode-plugin`**, display name
**CrateStack Schema**.

```bash
code --install-extension cratestack.cratestack-vscode-plugin
codium --install-extension cratestack.cratestack-vscode-plugin   # Open VSX
```

It registers the `cstack` language and a TextMate grammar
(`scopeName: source.cstack`), and **launches the standalone `cratestack-lsp`
binary** — it contains no language logic of its own.

Server resolution order: an explicitly configured `cratestack.lsp.path` that
differs from the default wins; otherwise a staged binary at
`<extensionPath>/server/<platform>/cratestack-lsp`; otherwise `cratestack-lsp`
on `PATH`. Settings: `cratestack.lsp.path` (default `"cratestack-lsp"`) and
`cratestack.lsp.args` (default `[]`).

Published to both the VS Code Marketplace and Open VSX, so VSCodium, Cursor and
Windsurf work. An air-gapped `.vsix` from a GitHub Release also works but **does
not auto-update**.

## `tree-sitter-cstack`

A separate repo, `cratestack/tree-sitter-cstack`, published to crates.io. It
exists for **Neovim, Helix and Zed** — editors that consume tree-sitter grammars
by repository URL.

**VS Code deliberately does not use it.** VS Code has no tree-sitter API for
third-party languages (microsoft/vscode#50140, open since 2018), and the
workaround — compile to wasm and drive the Semantic Token API from the extension
— buys nothing, because `cratestack-lsp` already has a real parse in-process and
emits semantic tokens directly.

**It is not the authoritative parser and is deliberately more permissive.**
`cratestack-parser` decides what a `.cstack` file *means*; the grammar describes
only its shape. Unknown attributes, unknown mixins, invalid provider values and
duplicate names all parse fine — those are semantic errors, and an editor that
stops highlighting because a relation target does not exist yet is an editor that
stops highlighting constantly.

Its anti-drift guard is `test/conformance.sh`, which parses **every `.cstack`
file the framework repo ships** and fails on any unexpected `ERROR` node. It runs
against `cratestack@main` on every push **and weekly**, so upstream syntax
changes surface even when nothing lands in the grammar repo. Exactly one expected
failure is listed by explicit path — a fixture with an unbalanced paren.
`semantic_error_*` fixtures must **parse**; rejecting them would mean the grammar
had started doing semantic analysis.

Neovim setup: register the parser with
`nvim-treesitter.parsers.get_parser_configs()`, add
`vim.filetype.add({ extension = { cstack = "cstack" } })`, `:TSInstall cstack`,
and copy `queries/highlights.scm` into `queries/cstack/`.

Rust consumers get `tree_sitter_cstack::LANGUAGE`, `HIGHLIGHTS_QUERY` and
`TAGS_QUERY`. Generated `src/parser.c` is committed so consumers do not need the
CLI.

**`.cstack` has no call sites, permanently.** It is declarative — a `procedure`
is declared in the schema and implemented in Rust — so `tags.scm` emits no
`@reference.call` and never should. A tool reporting 0% call resolution for these
files is misreporting "there was nothing to try".
