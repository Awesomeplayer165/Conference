# Screen Share

A private, one-host, one-viewer screen-sharing service. The host creates a
short session code and sends one native-resolution stream through mediasoup to
one viewer, with no simulcast, transcoding, audio, or data channels. The
end-to-end browser/SFU capability intersection prefers AV1 and falls back to
H.264 packetization mode 1.

## Prerequisites

- Bun 1.3.6 or newer
- OpenSSL for optional local certificates
- Current desktop Chrome, Firefox, and Safari for capture qualification
- macOS is required for real Safari testing; Playwright WebKit is not a Safari
  substitute

The project is screen-video only. Bun runs the workspace, Hono provides HTTP
and WebSocket signaling, and mediasoup forwards RTP. Capture trusts the
selected surface's reported maximum FPS. The visible encoder FPS and bitrate
ceilings are persisted locally; the automatic video recommendation uses
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
MEDIASOUP_MIN_PORT=40000 \
MEDIASOUP_MAX_PORT=40100 \
bun run start:backend
```

Replace the documentation address with the server's reachable address. The
reverse proxy handles HTTP and WebSocket signaling; WebRTC media flows directly
to the announced address on the configured UDP or TCP media range.

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
ports 40000–40100. Bind addresses are configurable in `.env`; apply the
server's normal firewall and access-control policy.

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
the active codec, resolution, FPS, bitrate, latency, and jitter. One-second
samples keep
source, encoded, decoded, and CSS render geometry separate and distinguish
capture, encode, decode, and presentation FPS. They also expose applied encoder
limits, actual bitrate, browser transport/codec diagnostics, SFU statistics,
loss/repair counters, frame cadence/freezes, clock offset, and latency
percentiles. Unsupported values stay visible as `Unavailable`; candidate
addresses are not part of the UI contract.

Each role receives the peer's normalized summary over signaling. Use **Download
telemetry** in Debug settings to retain the local samples and immediate
lifecycle events for a browser-pairing run.

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
automatically when both browser endpoints can send/receive it:

```text
/stage3-harness.html?autorun=1&width=3024&height=1964&fps=60&bitrateMbps=50&sampleSeconds=8&pattern=screen
/stage3-harness.html?autorun=1&width=1280&height=720&fps=60&bitrateMbps=50&sampleSeconds=6&pattern=screen&codec=h264
/stage3-harness.html?autorun=1&width=1280&height=720&fps=60&bitrateMbps=50&sampleSeconds=6&pattern=stress&codec=av1
```

`pattern=screen` is the realistic moving-screen gate. `pattern=stress` is an
intentionally incompressible rate-control stress case and is not expected to
preserve 60 FPS at every encoder target.

The configured bitrate is an encoder ceiling. RTP/UDP/IP overhead and
retransmissions can make total link traffic higher, while WebRTC congestion
control and content complexity can keep actual encoded bitrate below the
ceiling. A 50 Mbps ceiling is not a request to pad a simple screen to 50 Mbps:
full-resolution/full-FPS output with low QP at 7 Mbps is healthy. Compare the
encoder target, QP, encode time, packet-send delay, and available outgoing
bitrate before diagnosing bandwidth. A bounded startup hint reduces slow
ramp-up where the browser honors it, and the applied
sender parameters are read back into the panel rather than assumed.

Current mediasoup `3.24.2` rejects `video/H265` as an unsupported router codec.
The client still reports H.265 send/receive capability when a browser exposes
it, but Stage 3 will not select it or claim it works end to end. The active
preference is therefore AV1, then H.264. H.265 can be inserted between them only
after the SFU can create and route an H.265 producer/consumer.
