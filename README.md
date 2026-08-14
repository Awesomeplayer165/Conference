# Screen Share

A private, one-host, one-viewer screen-sharing service. The host creates a
short session code and sends one screen stream through mediasoup to one viewer,
with no simulcast, transcoding, or data channels. Optional display/system audio
is sent as a separate Opus stream on the same WebRTC transport. Capture starts
at the selected surface's native geometry; encoded resolution can decrease to
protect cadence under pressure. The end-to-end browser/SFU capability
intersection prefers AV1 and falls back to H.264 packetization mode 1.

## Prerequisites

- Bun 1.3.6 or newer
- OpenSSL for optional local certificates
- Current desktop Chrome, Firefox, and Safari for capture qualification
- macOS is required for real Safari testing; Playwright WebKit is not a Safari
  substitute

The project is one-way screen media only. Bun runs the workspace, Hono provides
HTTP and WebSocket signaling, and mediasoup forwards RTP. Capture and sender
constraints both retain the configured FPS ceiling even when the browser
reports a conservative capability maximum. The FPS and bitrate ceilings are
persisted locally; the automatic video recommendation uses
`width × height × FPS × 0.1`, rounded to 250 kbps and capped at 100 Mbps.

## Local development

```sh
bun install
bun run dev
```

The combined command starts the backend on port 4443 and Vite on port 5173.
The Vite server exists only for local development and proxies `/ws` and
`/health` to the backend. Run the processes separately when preferred:

```sh
bun run dev:backend
bun run dev:web
```

Without certificates, open `http://localhost:5173`; localhost is a secure
browser context. Optional local certificates are available with:

```sh
bun run certs
bun run dev
```

`VITE_SIGNALING_URL` remains available as a build-time override. A normal
deployment should preserve the same origin and reverse-proxy `/ws` instead.

## Production deployment

The application does not ship or start a production web server. Build the
frontend into static assets and serve them through the server's existing
reverse proxy:

```sh
bun run build:web
bun run start:backend
```

The static site is written to `apps/web/dist`. The reverse proxy must:

- Serve that directory as the site root.
- Fall back to `index.html` for unknown frontend routes.
- Reverse-proxy `/ws` to the backend with WebSocket support.
- Optionally reverse-proxy `/health` for backend health checks.
- Terminate HTTPS before the browser; remote screen capture requires a secure
  context.

Set mediasoup's bind address and the address reachable by both browsers before
starting the backend:

```sh
MEDIASOUP_LISTEN_IP=0.0.0.0 \
MEDIASOUP_ANNOUNCED_ADDRESS=192.0.2.10 \
MEDIASOUP_PORT=40000 \
MEDIASOUP_SOCKET_BUFFER_BYTES=4194304 \
bun run start:backend
```

Replace the documentation address with the server's reachable address. The
reverse proxy handles HTTP and WebSocket signaling; WebRTC media flows directly
to the announced address on `MEDIASOUP_PORT`. All peer transports share one
mediasoup WebRTC server socket, so a host, viewer, and subsequent reconnects do
not consume separate listening ports. Publish and permit both UDP and TCP for
that port; UDP is preferred and TCP is the fallback.

### Caddy

[Caddyfile.example](infra/caddy/Caddyfile.example) is the preferred reference
configuration. Merge its site block into the existing Caddyfile, then replace:

- `screen-share.example.com` with the actual site address.
- `/srv/screen-share/web` with the absolute static build directory.
- `127.0.0.1:4443` if the backend is reached through a different interface or
  container network.

Validate the merged configuration before reloading the existing server:

```sh
caddy validate --config /etc/caddy/Caddyfile
```

Caddy's `reverse_proxy` handles the WebSocket upgrade automatically. The
fallback `handle` serves static files and rewrites missing application routes
to `index.html`.

## Docker Compose

Compose contains a persistent `backend` service and a one-shot `web`
artifact exporter. There is no bundled web-server container.

```sh
cp .env.compose.example .env
# Replace MEDIASOUP_ANNOUNCED_ADDRESS and adjust ports/output as needed.
docker compose build
docker compose run --rm web
docker compose up -d backend
docker compose ps
```

The `web` command copies the production build into `./build/web` by default
and exits successfully. Point the existing reverse proxy's static root there.
The backend publishes signaling on port 4443 and mediasoup media on UDP and TCP
port 40000 by default. Bind addresses and the media port are configurable in
`.env`; apply the server's normal firewall and access-control policy. Caddy only
proxies HTTP and WebSocket signaling—it does not proxy the WebRTC media port.

Stop the application backend with:

```sh
docker compose down
```

Native mediasoup startup can discover local candidates, but an explicit
`MEDIASOUP_LISTEN_IP` and `MEDIASOUP_ANNOUNCED_ADDRESS` is recommended for
repeatable cross-computer deployments. A wildcard listen IP requires an
announced address.

mediasoup officially supports Node.js rather than Bun. The worker, AV1/H.264
router, and UDP/TCP transport startup are verified under Bun 1.3.6, but a
production deployment still needs worker restart and soak qualification. A
Node 22+ mediasoup sidecar remains the fallback if Bun child-process IPC proves
unstable.

## Quality gate

```sh
bun run lint
bun run typecheck
bun test
bun run build
```

Debug settings are available to both roles. A configurable video overlay shows
the active codec, resolution, FPS, bitrate, latency, jitter, encoder path, and
current optimization decision. One-second
samples keep
source, encoded, decoded, and CSS render geometry separate and distinguish
capture, encode, decode, and presentation FPS. They also expose applied encoder
limits, actual bitrate, browser transport/codec diagnostics, SFU statistics,
loss/repair counters, frame cadence/freezes, clock offset, and latency
percentiles. Unsupported values stay visible as `Unavailable`; candidate
addresses are not part of the UI contract.

Each role receives the peer's normalized summary and telemetry envelope over
signaling. Use **Download telemetry** in Debug settings to retain both endpoints'
samples and lifecycle events in one browser-pairing artifact.

The host can switch the maximum bitrate between automatic and manual while a
share is active. Automatic recomputes a quality-oriented source ceiling while
WebRTC congestion control adapts actual transmission beneath it. Manual applies
the selected maximum to the active sender immediately; neither mode pads simple
content merely to reach the ceiling.

For a permission-free local media-path check, open
`http://localhost:5173/stage3-harness.html` while `bun run dev` is running and
select **Run codec telemetry probe**. It sends a deterministic 1280×720 canvas
through the same producer, SFU, consumer, and statistics normalizer used by the
application.

The harness accepts query parameters for repeatable checks. It selects AV1
automatically when both browser endpoints can send/receive it. `cycles` repeats
producer/consumer replacement, `warmupSeconds` lets the balanced controller
settle, and `minBitrateMbps` sets an optional sustained-throughput gate:

```text
/stage3-harness.html?autorun=1&width=3024&height=1964&fps=60&bitrateMbps=50&minBitrateMbps=8&warmupSeconds=8&sampleSeconds=6&cycles=3&pattern=game
/stage3-harness.html?autorun=1&width=3024&height=1964&fps=60&bitrateMbps=50&minBitrateMbps=8&warmupSeconds=8&sampleSeconds=6&cycles=2&pattern=game&codec=h264
/stage3-harness.html?autorun=1&width=1280&height=720&fps=60&bitrateMbps=50&sampleSeconds=6&pattern=stress&codec=av1
```

`pattern=screen` is a moving-workspace check, `pattern=game` is the sustained
high-motion/high-bitrate gate, and `pattern=stress` is intentionally
incompressible. The stress pattern is a rate-control limit test and is not
expected to preserve 60 FPS at every encoder target. Add `adaptive=0` to measure
the raw requested sender policy without controller changes. Chromium uses a
`MediaStreamTrackGenerator` clock for the harness when available so a background
tab's animation scheduler does not masquerade as an encoder FPS limit.
Add `audio=1` to create and verify a synthetic Opus producer/consumer alongside
the video without opening a capture picker.

The configured bitrate is an encoder ceiling. RTP/UDP/IP overhead and
retransmissions can make total link traffic higher, while WebRTC congestion
control and content complexity can keep actual encoded bitrate below the
ceiling. A 50 Mbps ceiling is not a request to pad a simple screen to 50 Mbps:
full-resolution/full-FPS output with low QP at 7 Mbps is healthy. Compare the
encoder target, QP, encode time, packet-send delay, and available outgoing
bitrate before diagnosing bandwidth. A bounded startup hint reduces slow
ramp-up where the browser honors it, and the applied
sender parameters are read back into the panel rather than assumed.

The single **Balanced** mode sets the track's motion hint and always asks the
sender to maintain frame rate under pressure. It does not reduce the configured
FPS. Sustained cadence pressure reduces resolution across fine 100%, 90.9%,
83.3%, 75.2%, 66.7%, 59.9%, and 50% steps before considering a codec fallback;
severe encoder pressure can skip directly to the scale needed to recover
cadence. Stable samples restore one detail step at a time. Low-motion samples
with a low QP or very low bitrate also count as healthy, so standing still
cannot strand the stream at a reduced resolution. The automatic bitrate
controller uses the narrowest
reported host/SFU/viewer path estimate, keeps a pacing margin, and moves its
ceiling in both directions up to 100 Mbps. A connected but stalled sender is
recreated, and a viewer that receives RTP without complete frames keeps its
consumer and requests one clean keyframe. Startup leaves receive buffering
under browser control so large keyframes can complete. A 40 ms target is
applied only after decoded frames are stable. If a compatible Chromium pair
continues receiving undecodable AV1, the viewer asks the active host producer
to switch atomically to H.264. A host-side
compute fallback is also temporary: after a stable recovery window it probes the
preferred codec again with bounded retry backoff. High-priority RTP allocation,
a motion-oriented bitrate floor hint, and a bounded startup hint are applied
where Chromium supports them without overriding congestion control. Standard
WebRTC exposes a maximum bitrate, not a true constant-bitrate switch, so the app
does not fabricate traffic for static frames or claim CBR when the browser does
not provide it.

**HDR if supported** inspects color-transfer metadata exposed by capture, carries
it to the viewer, and verifies decoded `VideoFrame` metadata where available.
The UI says `HDR preserved` only after that verification. Otherwise it reports
that preservation is unverified or that the browser/display is tone-mapping to
SDR. The CSS HDR output hint is feature-dependent; browsers and operating
systems retain final control of capture, codec profile, display mode, and tone
mapping.

Current mediasoup `3.24.2` rejects `video/H265` as an unsupported router codec.
The client still reports H.265 send/receive capability when a browser exposes
it, but the service will not select it or claim it works end to end. The active
preference is therefore AV1, then H.264. At the requested geometry and FPS, the
startup planner probes AV1 and H.264 across resolution scales. It keeps the
requested cadence even when Media Capabilities cannot verify a higher rate and
exhausts smooth modes for AV1 before selecting H.264. If runtime telemetry finds
software AV1 unable to hold cadence, resolution reaches 50% before the host
switches atomically to the compatible fallback codec. A confirmed hardware AV1
path is not replaced with software H.264 merely because capture cadence is low.
H.265 can be inserted between them only after the SFU can create and route an
H.265 producer/consumer.

### Chromium hardware encoding

The SFU advertises H.264 Baseline (`42001f`) before Constrained Baseline
(`42e01f`) because desktop Chromium's platform encoder commonly exposes the
former while OpenH264 supplies the software fallback. Both profiles remain
available for cross-browser compatibility. The app requests one encoding with
no explicit SVC mode, which avoids disqualifying an accelerator that does not
advertise the requested scalability mode.

The browser retains final control over encoder selection. The host UI and
telemetry report the actual `encoderImplementation`: `libaom` and `OpenH264`
are software paths, while Chromium's external/platform encoder indicates the
accelerated path. A Media Capabilities `powerEfficient` result is shown as
supporting evidence, not substituted for the actual runtime implementation.

Current Chromium enables WebRTC AV1 hardware encoding by default on non-Windows
platforms when the platform accelerator exposes it, but its upstream Windows
feature remains disabled by default. A Windows GPU advertising AV1 elsewhere
therefore does not guarantee that a normal Chrome WebRTC session will use it;
the application cannot override that browser feature from JavaScript. H.264
Baseline is the dependable accelerated fallback for that case.

### Display audio

The host can request display audio before opening the browser picker. The app
asks for system/window audio without echo cancellation, noise suppression, or
automatic gain control, then forwards an available stereo 48 kHz track as Opus
with DTX disabled. Audio remains optional because browsers may return video only
and the user must explicitly allow audio in the picker. The viewer combines the
audio and video tracks for synchronized playback; if autoplay policy blocks
sound, clicking the video resumes it.
