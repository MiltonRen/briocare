// The suite is keyless BY DESIGN: no network, no secrets. The developer shell
// may export real keys (convex/_generated/server's `env` is process.env), so
// scrub them here — code under test must take its no-key fallback paths.
delete process.env.OPENAI_API_KEY;
delete process.env.LIVEKIT_URL;
delete process.env.LIVEKIT_API_KEY;
delete process.env.LIVEKIT_API_SECRET;
