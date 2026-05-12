import express from "express";
import { L402Server, type Challenge, type VerificationResult } from "l402-server";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { l402 } from "../src/index.js";

function makeClient(stubs: {
  createChallenge?: (args: unknown) => Promise<Challenge>;
  verifyToken?: (args: unknown) => Promise<VerificationResult>;
}): L402Server {
  const c = new L402Server({ apiKey: "test" });
  if (stubs.createChallenge) {
    (c as unknown as { createChallenge: typeof stubs.createChallenge }).createChallenge =
      stubs.createChallenge;
  }
  if (stubs.verifyToken) {
    (c as unknown as { verifyToken: typeof stubs.verifyToken }).verifyToken =
      stubs.verifyToken;
  }
  return c;
}

const sampleChallenge: Challenge = {
  invoice: "lnbc100n1pTEST",
  macaroon: "AgELbWFjYXJvb24=",
  paymentHash: "abc123def456",
  expiresAt: "2026-05-12T01:00:00Z",
  resource: "/api/premium",
  priceSats: 100,
  mppChallenge: undefined,
};

describe("l402() factory — argument validation", () => {
  it("throws when neither apiKey nor client is supplied", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => l402({ priceSats: 100 })).toThrow(/apiKey/);
  });

  it("throws when both apiKey and client are supplied", () => {
    const client = new L402Server({ apiKey: "x" });
    expect(() =>
      l402({ apiKey: "y", client, priceSats: 100 }),
    ).toThrow(/mutually exclusive/);
  });

  it("accepts apiKey only", () => {
    expect(() => l402({ apiKey: "x", priceSats: 100 })).not.toThrow();
  });

  it("accepts client only", () => {
    const client = new L402Server({ apiKey: "x" });
    expect(() => l402({ client, priceSats: 100 })).not.toThrow();
  });
});

describe("l402() middleware — 402 challenge issuance", () => {
  it("returns 402 with WWW-Authenticate + JSON body when no Authorization header", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));
    app.use((_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/api/premium/x");

    expect(res.status).toBe(402);
    expect(res.header["www-authenticate"]).toBe(
      `L402 macaroon="${sampleChallenge.macaroon}", invoice="${sampleChallenge.invoice}"`,
    );
    expect(res.body).toMatchObject({
      error: "Payment Required",
      l402: {
        macaroon: sampleChallenge.macaroon,
        invoice: sampleChallenge.invoice,
        amount_sats: 100,
        payment_hash: "abc123def456",
        resource: "/api/premium",
      },
    });
    expect(createChallenge).toHaveBeenCalledOnce();
  });

  it("uses req.path as default resource", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));

    await request(app).get("/api/premium/weather");
    expect(createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "/api/premium/weather" }),
    );
  });

  it("function-form priceSats resolves per-request", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(
      l402({
        client,
        priceSats: (req) =>
          req.query.premium === "true" ? 500 : 100,
      }),
    );

    await request(app).get("/x?premium=true");
    expect(createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ priceSats: 500 }),
    );

    await request(app).get("/x");
    expect(createChallenge).toHaveBeenLastCalledWith(
      expect.objectContaining({ priceSats: 100 }),
    );
  });

  it("function-form resource resolves per-request", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(
      l402({
        client,
        priceSats: 100,
        resource: (req) => `/canonical${req.path}`,
      }),
    );

    await request(app).get("/foo");
    expect(createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "/canonical/foo" }),
    );
  });

  it("passes description through when supplied", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(
      l402({
        client,
        priceSats: 100,
        description: "Premium weather data",
      }),
    );

    await request(app).get("/x");
    expect(createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Premium weather data" }),
    );
  });

  it("passes idempotencyKey through when derivation function supplied", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(
      l402({
        client,
        priceSats: 100,
        idempotencyKey: (req) => req.header("X-Request-Id"),
      }),
    );

    await request(app).get("/x").set("X-Request-Id", "req-abc-123");
    expect(createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "req-abc-123" }),
    );
  });

  it("returns 402 (not 502) when Authorization header is malformed", async () => {
    const createChallenge = vi.fn().mockResolvedValue(sampleChallenge);
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));

    const res = await request(app).get("/x").set("Authorization", "Bearer not-l402");
    expect(res.status).toBe(402);
    expect(createChallenge).toHaveBeenCalledOnce();
  });
});

describe("l402() middleware — valid credential", () => {
  it("passes through to next handler on valid token", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      valid: true,
      resource: "/api/premium",
      merchantId: 42,
      amountSats: 100,
      paymentHash: "abc123",
    } satisfies VerificationResult);
    const client = makeClient({ verifyToken });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));
    app.use((_req, res) =>
      res.json({ data: "secret", l402: res.locals.l402 }),
    );

    const res = await request(app)
      .get("/api/premium")
      .set("Authorization", "L402 mac:pre");

    expect(res.status).toBe(200);
    expect(res.body.data).toBe("secret");
    expect(res.body.l402).toMatchObject({
      valid: true,
      resource: "/api/premium",
      merchantId: 42,
      amountSats: 100,
    });
    expect(verifyToken).toHaveBeenCalledWith({ macaroon: "mac", preimage: "pre" });
  });
});

describe("l402() middleware — invalid credential", () => {
  it("returns 401 with error message by default", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      valid: false,
      error: "Invalid preimage",
    } satisfies VerificationResult);
    const client = makeClient({ verifyToken });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));
    app.use((_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get("/x")
      .set("Authorization", "L402 mac:pre");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "Unauthorized",
      message: "Invalid preimage",
    });
  });

  it("calls onInvalidToken handler when supplied (skipping default 401 response)", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      valid: false,
      error: "Token bound to different resource",
    } satisfies VerificationResult);
    const onInvalidTokenSpy = vi.fn();
    const client = makeClient({ verifyToken });
    const app = express();
    app.use(
      l402({
        client,
        priceSats: 100,
        // Real use case: send a fresh 402 challenge instead of 401. For
        // the test we send 418 so we can assert the default 401 path was
        // bypassed and the custom handler ran.
        onInvalidToken: (req, res, failure, _next) => {
          onInvalidTokenSpy(req, failure);
          res.status(418).json({ from: "onInvalidToken" });
        },
      }),
    );

    const res = await request(app)
      .get("/x")
      .set("Authorization", "L402 mac:pre");

    expect(onInvalidTokenSpy).toHaveBeenCalledOnce();
    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({ from: "onInvalidToken" });
  });
});

describe("l402() middleware — upstream errors", () => {
  it("returns 502 if createChallenge throws", async () => {
    const createChallenge = vi
      .fn()
      .mockRejectedValue(new Error("Producer API unreachable"));
    const client = makeClient({ createChallenge });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));

    const res = await request(app).get("/x");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      error: "Bad Gateway",
      message: "Producer API unreachable",
    });
  });

  it("returns 502 if verifyToken throws", async () => {
    const verifyToken = vi
      .fn()
      .mockRejectedValue(new Error("Producer API unreachable"));
    const client = makeClient({ verifyToken });
    const app = express();
    app.use(l402({ client, priceSats: 100 }));

    const res = await request(app)
      .get("/x")
      .set("Authorization", "L402 mac:pre");
    expect(res.status).toBe(502);
  });
});
