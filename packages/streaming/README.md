# `@signalglass/streaming`

Network-free streaming protocol primitives for SignalGlass.

The package implements Spec 016 Slices S3–S4: a strict, incremental,
byte-bounded SSE framing parser plus the provider-neutral deterministic evidence
assembler. It does not open sockets, perform HTTP I/O, import provider adapters,
read clocks/randomness, or persist data. The OpenAI SSE decoder lives in
`@signalglass/providers`; ingress integration remains pending in S5.

## Public API

- `createSseParser(options?)`
- `SSE_MAX_FRAME_BYTES`
- `SseParser`
- `SseParserOptions`
- `FrameResult`
- `SseParserFacts`
- `SseMalformedCode`
- `SseDecoderDisposition`
- `assembleTrace(options)` / `AssemblyResult`
- `DEFAULT_EVIDENCE_BUDGETS` / `validateEvidenceBudgets()`
- `retainText()` / `normalizeRequestMessages()`
- closed failure-classification and terminal-reservation helpers

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

A pre-terminal invalid-UTF-8 frame is a malformed terminal: ordinary frame
emission stops, and any subsequent bytes affect only the bounded post-terminal
structural facts.

The default and maximum frame budget is exactly 16 MiB. A smaller positive
integer budget may be configured for deterministic boundary testing or a more
restrictive observer policy.

The assembler takes every nondeterministic value explicitly: ordinary event and
observation IDs, capture timestamps, and a stable two-slot finalization bundle.
It assigns canonical sequence positions, applies the v1.0.0 collection profile's
detect-then-retain policy and 240-code-point leaf cap, admits raw/canonical
observations atomically through the Spec 014 collapse rules, and reserves the
complete terminal suffix while enforcing the serialized evidence budgets.
`EvidenceRecord` remains authoritative; `trace` is its deterministic derived
view. Post-terminal input is not admitted as a candidate.
