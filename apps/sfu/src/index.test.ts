import { describe, expect, it } from "bun:test";
import { app } from "./index.js";

describe("Hono signaling server", () => {
  it("reports backend health and its Bun/Hono runtime", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      runtime: "bun",
      server: "hono",
      mediasoup: "initializing",
    });
  });

  it("returns 404 for unknown HTTP routes", async () => {
    expect((await app.request("/unknown")).status).toBe(404);
  });
});
