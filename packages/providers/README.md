# `@signalglass/providers`

Provider configuration and provider-boundary adapters for SignalGlass.

Spec 016 Slice S4 adds the OpenAI-compatible SSE L3 decoder:

- `createOpenAiSseDecoder()` maintains only per-choice chunk ordinals;
- `decodeSseFrame()` provides one-frame convenience decoding;
- `DecodableSseFrameResult` admits only ordinary/pre-terminal malformed L2
  results; observer failures and post-terminal accounting stay outside L3;
- `FrameDecodeResult` separates normalized events, `[DONE]`, malformed
  provider protocol, unrecognized valid JSON, and internal decode failure;
- `StreamDecodedEvent` exposes only provider-neutral chunks, usage, and a
  leak-free provider-error classification;
- unmapped delta data is reduced to closed categories. Raw provider property
  names, payloads, exception text, and provider error bodies never cross the
  decoder boundary.

The decoder consumes the deliberately narrowed decodable subset of the
network-free `FrameResult` produced by `@signalglass/streaming`. HTTP forwarding
and persistence remain outside this package; live ingress wiring is Spec 016 S5.
