import type { NextFunction, Request, Response } from "express";
import type { L402Server, VerificationResult } from "l402-server";

/**
 * Either a static value or a function that derives the value from the
 * current request. Functions can return either a value or a Promise.
 */
export type ValueOrFn<T> = T | ((req: Request) => T | Promise<T>);

/**
 * Configuration for the {@link l402} middleware factory.
 */
export interface L402MiddlewareOptions {
  /**
   * Your Lightning Enable merchant API key. Required.
   *
   * Mutually exclusive with {@link client}: supply one or the other.
   */
  apiKey?: string;

  /**
   * Pre-constructed {@link L402Server} instance. Use this if you want to
   * share a single SDK client across multiple middleware mounts, or if you
   * need to inject a custom `fetch` / `baseUrl` / `timeoutMs`.
   *
   * Mutually exclusive with {@link apiKey}.
   */
  client?: L402Server;

  /**
   * Override the L402 producer API base URL. Only honored when
   * {@link apiKey} is used (i.e. when this middleware constructs its own
   * client). Ignored when {@link client} is supplied.
   *
   * @default "https://api.lightningenable.com"
   */
  baseUrl?: string;

  /**
   * Price in satoshis for accessing the protected route. May be a static
   * number or a function that derives the price from the incoming request
   * (e.g., "premium tier costs more").
   *
   * Must resolve to an integer ≥ 1.
   */
  priceSats: ValueOrFn<number>;

  /**
   * The resource identifier bound into the macaroon as a caveat. Defaults
   * to `req.path` if not provided. Override when you want a different
   * canonical resource (e.g., normalize trailing slashes or query strings
   * out of the bound resource).
   */
  resource?: ValueOrFn<string>;

  /**
   * Optional description embedded in the Lightning invoice. Shown to the
   * payer in their wallet UI.
   */
  description?: ValueOrFn<string | undefined>;

  /**
   * Optional idempotency key derivation. If supplied, the value is sent as
   * `X-Idempotency-Key` so retries within the invoice expiry window return
   * the same challenge. If omitted, the producer API falls back to the
   * client IP (which is usually fine for middleware use).
   */
  idempotencyKey?: (req: Request) => string | undefined;

  /**
   * Custom handler for cases where verification of a presented L402 token
   * fails. Default behavior: respond with 401 and a JSON body containing
   * the error message. Provide a function here to send a fresh 402
   * challenge instead, log the failure, etc.
   *
   * The handler IS responsible for either sending a response on `res` or
   * calling `next` — the middleware will not do so on your behalf when
   * this option is supplied.
   */
  onInvalidToken?: (
    req: Request,
    res: Response,
    failure: VerificationResult,
    next: NextFunction,
  ) => void | Promise<void>;
}

/**
 * After successful verification, the verified credential metadata is set
 * on `res.locals.l402`. Downstream handlers can inspect it to know which
 * resource the token was bound to, how much was paid, etc.
 */
export interface L402Locals {
  l402: VerificationResult;
}
