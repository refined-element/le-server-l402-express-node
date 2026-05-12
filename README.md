# l402-express

[![npm](https://img.shields.io/npm/v/l402-express.svg)](https://www.npmjs.com/package/l402-express)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Express middleware for L402.** Drop one line into any Express API to charge per-request Lightning payments. Built on [`l402-server`](https://www.npmjs.com/package/l402-server) — Lightning Enable handles invoices, macaroons, and payment verification; your API stays where it is.

## Install

```bash
npm install l402-express l402-server
```

Node 18+. Express 4 or 5. ESM + CJS dual exports.

## 30-second example

```ts
import express from "express";
import { l402 } from "l402-express";

const app = express();

// Gate everything under /api/premium behind a 100 sat L402 payment.
app.use("/api/premium", l402({
  apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
  priceSats: 100,
}));

app.get("/api/premium/weather", (_req, res) => {
  res.json({ temp: 72 });
});

app.listen(3000);
```

That's it. Three lines of integration code. The middleware handles:
- Issuing a `402 Payment Required` with a Lightning invoice on unauthenticated requests
- Verifying the `Authorization: L402 <macaroon>:<preimage>` header on retries
- Passing the verified credential metadata to downstream handlers via `res.locals.l402`

## Variable per-request pricing

Pass a function to `priceSats` to derive the price from the request:

```ts
app.use("/api/llm", l402({
  apiKey: process.env.LIGHTNING_ENABLE_API_KEY!,
  priceSats: (req) => req.query.model === "premium" ? 500 : 100,
}));
```

Functions can return `number` or `Promise<number>`. Same applies to `resource` and `description`.

## Configuration

| Option | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | (one of `apiKey` or `client` is required) | Your Lightning Enable merchant API key |
| `client` | `L402Server` | — | Pre-constructed SDK client (use to share across mounts, inject custom fetch, etc.) |
| `priceSats` | `number \| (req) => number \| Promise<number>` | **required** | Price in satoshis, ≥ 1 |
| `resource` | `string \| (req) => string \| Promise<string>` | `req.path` | Bound as a macaroon caveat |
| `description` | `string \| (req) => string \| undefined` | none | Shown to the payer in their wallet |
| `idempotencyKey` | `(req) => string \| undefined` | client IP | Send `X-Idempotency-Key` to dedup challenges within the invoice expiry window |
| `baseUrl` | `string` | `https://api.lightningenable.com` | Override producer API URL (testing) |
| `onInvalidToken` | `(req, failure) => void \| Promise<void>` | sends `401` | Custom handler for verification failures — useful for sending a fresh 402 instead of 401 |

## Verified credential on downstream handlers

After a successful verification the middleware sets `res.locals.l402` so downstream handlers can inspect what was paid for:

```ts
app.get("/api/premium/weather", (_req, res) => {
  const { resource, amountSats, paymentHash } = res.locals.l402;
  console.log(`Served ${resource} for ${amountSats} sats (${paymentHash})`);
  res.json({ temp: 72 });
});
```

## How the protocol works under the hood

Every paid request takes one round-trip to the Lightning Enable hosted API. The middleware never holds key material, never signs macaroons, never verifies preimages locally. All of that is in the hosted backend so:

- The L402 root key stays in Lightning Enable's infrastructure
- Consumed preimages are tracked centrally — replay protection works across all your endpoints automatically
- Protocol upgrades happen server-side without client updates

What you're paying for with your Lightning Enable subscription: the protocol broker that lets this be one line of middleware. The middleware itself is ~150 lines of HTTP glue.

## Two integration modes

Lightning Enable supports two integration shapes:

- **Proxy mode** — point Lightning Enable at your API URL; we forward authenticated requests on your behalf. Best for public APIs or quick experiments.
- **Native mode** — install this middleware in your existing API. Lightning Enable handles payment; your API handles everything else. Best for commercial APIs with their own auth, observability, or sensitive infrastructure. **This middleware is the Native mode for Express.**

[Documentation site →](https://docs.lightningenable.com/products/l402-microtransactions/proxy-setup-walkthrough)

## Sibling packages

- [`l402-server`](https://www.npmjs.com/package/l402-server) — the SDK this middleware is built on. Use it directly if you're not on Express, or to share a single client across multiple middleware mounts.
- [`l402-requests`](https://www.npmjs.com/package/l402-requests) — consumer-side HTTP client. Auto-pays L402 challenges. Use this to call APIs gated by `l402-express`.

## Contributing

Open source under MIT. Issues and pull requests welcome.

## License

MIT © Refined Element, LLC
