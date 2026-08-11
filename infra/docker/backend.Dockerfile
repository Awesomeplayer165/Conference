FROM oven/bun:1.3.6

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

COPY apps/sfu apps/sfu
COPY packages/protocol packages/protocol
COPY packages/telemetry packages/telemetry
COPY tsconfig.base.json ./

ENV HOST=0.0.0.0
ENV PORT=4443
EXPOSE 4443/tcp

CMD ["bun", "run", "start:backend"]
