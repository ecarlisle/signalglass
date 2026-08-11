# `@signalglass/streaming`

Network-free streaming protocol primitives for SignalGlass.

The current package implements Spec 016 Slice S3: a strict, incremental,
byte-bounded SSE framing parser. It does not open sockets, perform HTTP I/O,
decode provider JSON, assemble evidence, or persist data. Provider decoding and
trace assembly remain pending in S4; ingress integration remains pending in S5.

## Public API

- `createSseParser(options?)`
- `SseParserOptions`
- `FrameResult`

The parser accepts `Uint8Array` chunks through `push()` and signals transport
EOF through `finish()`. `facts()` exposes only closed facts and counters; raw
`event:`, `id:`, and `retry:` values are never returned.

After the exact assembled data value `[DONE]`, the parser releases its ordinary
frame buffer and switches to constant-space structural accounting. It retains
no trailing payload bytes, decodes no trailing frame into a string, and emits
`post-terminal-content` at most once: when the closed post-terminal fact first
changes from `none-observed` to `observed-not-retained`. Later content creates
no additional result objects; a later malformed frame or observation failure
moves the fact to `unknown` without exposing trailing values.

The default and maximum frame budget is exactly 16 MiB. A smaller positive
integer budget may be configured for deterministic boundary testing or a more
restrictive observer policy.
