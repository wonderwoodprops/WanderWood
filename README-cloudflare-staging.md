# WanderWood Cloudflare staging

This branch contains the isolated Cloudflare migration. The existing `main` branch and the active website are not modified.

## Architecture

- Astro/SSR is not introduced in this first compatibility pass; the existing HTML/CSS/JS storefront is preserved and rendered by a Cloudflare Worker.
- D1 stores the product catalog and testimonials.
- R2 is intended for private customer reference uploads. The account must first have R2 enabled and the bucket `wanderwood-staging-assets` created.
- Order submission remains connected to the existing Google Apps Script. No change is made to its spreadsheet or email templates.

## Database

- `migrations/0001_initial_catalog.sql`: products, testimonials, and site settings.
- `migrations/0002_seed_initial_catalog.sql`: initial catalog and testimonial records supplied for migration.
- Staging D1 database: `wanderwood-staging`.

The D1 database was created separately from production and seeded with 8 products and 3 testimonials. No live site data is read or modified.

## Required Worker secrets

Set these as Worker secrets, never in source code:

- `ORDERS_SCRIPT_URL`: existing Google Apps Script Web App URL for order handling.
- `UPLOAD_SIGNING_SECRET`: a random secret of at least 32 bytes used to sign private customer-image links.

## R2 activation

R2 is not yet enabled for this Cloudflare account. Enable R2 in the Cloudflare dashboard, then create the `wanderwood-staging-assets` bucket in the same account and keep the `UPLOADS` binding in `wrangler.jsonc`.

Until R2 is enabled and the bucket exists, the customer-upload endpoint intentionally returns a clear 503 response; it does not fall back to the exposed legacy image-hosting key.

## Local checks

```sh
node --check src/index.js
npx wrangler dev
```

Before deployment, set the two secrets above and ensure the R2 bucket exists. Use the staging Worker only; do not bind the production domain until the full acceptance test is complete.
