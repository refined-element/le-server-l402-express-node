import type { NextFunction, Request, RequestHandler, Response } from "express";
import { L402Server, type Challenge, type VerificationResult } from "l402-server";
import { parseAuthHeader } from "./parseAuthHeader.js";
import type { L402MiddlewareOptions, ValueOrFn } from "./types.js";

/**
 * Factory that returns an Express middleware function which gates the
 * mounted routes behind an L402 Lightning payment.
 *
 * Flow on every request:
 * 1. Parse `Authorization: L402 <macaroon>:<preimage>` from the request.
 * 2. If absent or malformed → mint a fresh challenge via the producer API
 *    and respond with `402 Payment Required`. Headers carry the L402
 *    `WWW-Authenticate` challenge; body carries a JSON payload that
 *    matches the existing `l402-requests` consumer client's expectations.
 * 3. If present → verify the credential via the producer API.
 *    - Valid → set `res.locals.l402 = result` and call `next()`.
 *    - Invalid → run {@link L402MiddlewareOptions.onInvalidToken} if
 *      provided, otherwise respond with `401 Unauthorized` and the
 *      verification error.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { l402 } from "l402-express";
 *
 * const app = express();
 * app.use("/api/premium", l402({
 *   apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
 *   priceSats: 100,
 * }));
 *
 * app.get("/api/premium/weather", (_req, res) => {
 *   res.json({ temp: 72 });
 * });
 * ```
 *
 * Function-form pricing for variable per-request charges:
 *
 * ```ts
 * app.use("/api/llm", l402({
 *   apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
 *   priceSats: (req) => (req.query.model === "premium" ? 500 : 100),
 * }));
 * ```
 */
export function l402(options: L402MiddlewareOptions): RequestHandler {
  if (!options.apiKey && !options.client) {
    throw new Error(
      "l402(): supply either `apiKey` (and the middleware will construct its own L402Server client) or `client` (a pre-constructed L402Server instance).",
    );
  }
  if (options.apiKey && options.client) {
    throw new Error(
      "l402(): `apiKey` and `client` are mutually exclusive. Choose one.",
    );
  }

  const client =
    options.client ??
    new L402Server({ apiKey: options.apiKey!, baseUrl: options.baseUrl });

  return async function l402Middleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const parsed = parseAuthHeader(req.header("Authorization"));

    if (!parsed) {
      // No credential — issue a fresh 402 challenge.
      try {
        const challenge = await mintChallenge(client, options, req);
        sendChallengeResponse(res, challenge);
      } catch (err) {
        sendUpstreamError(res, err);
      }
      return;
    }

    // Credential present — verify it.
    let verification: VerificationResult;
    try {
      verification = await client.verifyToken({
        macaroon: parsed.macaroon,
        preimage: parsed.preimage,
      });
    } catch (err) {
      sendUpstreamError(res, err);
      return;
    }

    if (!verification.valid) {
      if (options.onInvalidToken) {
        await options.onInvalidToken(req, res, verification, next);
        return;
      }
      res.status(401).json({
        error: "Unauthorized",
        message: verification.error ?? "Invalid L402 credential.",
      });
      return;
    }

    // Valid — surface metadata to downstream handlers and pass through.
    (res.locals as { l402?: VerificationResult }).l402 = verification;
    next();
  };
}

async function mintChallenge(
  client: L402Server,
  options: L402MiddlewareOptions,
  req: Request,
): Promise<Challenge> {
  const priceSats = await resolve(options.priceSats, req);
  const resource = options.resource
    ? await resolve(options.resource, req)
    : req.path;
  const description = options.description
    ? await resolve(options.description, req)
    : undefined;
  const idempotencyKey = options.idempotencyKey
    ? options.idempotencyKey(req)
    : undefined;

  return client.createChallenge({
    resource,
    priceSats,
    description,
    idempotencyKey,
  });
}

async function resolve<T>(
  v: ValueOrFn<T>,
  req: Request,
): Promise<T> {
  if (typeof v === "function") {
    return await (v as (req: Request) => T | Promise<T>)(req);
  }
  return v;
}

function sendChallengeResponse(res: Response, challenge: Challenge): void {
  // L402 WWW-Authenticate header per the protocol spec.
  // Format: `L402 macaroon="<base64>", invoice="<bolt11>"`
  const wwwAuth = `L402 macaroon="${challenge.macaroon}", invoice="${challenge.invoice}"`;
  res.setHeader("WWW-Authenticate", wwwAuth);

  res.status(402).json({
    error: "Payment Required",
    l402: {
      macaroon: challenge.macaroon,
      invoice: challenge.invoice,
      amount_sats: challenge.priceSats,
      payment_hash: challenge.paymentHash,
      expires_at: challenge.expiresAt,
      resource: challenge.resource,
    },
  });
}

function sendUpstreamError(res: Response, err: unknown): void {
  // Don't leak SDK error class names into the response. Treat any
  // upstream/transport failure as 502 Bad Gateway — the protocol broker
  // is unreachable or rejected our call.
  const message = (err as Error)?.message ?? "Upstream L402 producer failed.";
  res.status(502).json({
    error: "Bad Gateway",
    message,
  });
}
