FROM oven/bun:1.3.6 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/sfu/package.json apps/sfu/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/adaptation/package.json packages/adaptation/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY packages/test-fixtures/package.json packages/test-fixtures/package.json
COPY tests/scenarios/package.json tests/scenarios/package.json
RUN bun install --frozen-lockfile

COPY apps/web apps/web
COPY packages/protocol packages/protocol
COPY packages/telemetry packages/telemetry
COPY tsconfig.base.json ./
RUN bun run build:web

FROM alpine:3.22
COPY --from=builder /app/apps/web/dist /site
VOLUME ["/output"]
CMD ["cp", "-a", "/site/.", "/output/"]
