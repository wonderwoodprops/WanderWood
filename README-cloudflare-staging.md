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

## First staging deployment

Create a new Worker from this Git repository in Cloudflare:

1. Open Workers & Pages > Create application > GitHub.
2. Select `wonderwoodprops/WanderWood`.
3. Select branch `cloudflare-d1-migration`.
4. The Cloudflare dashboard created the staging Worker as `wanderwood`; keep that exact name so Wrangler deploys into the same staging Worker.
5. Leave the build command empty and use `npx wrangler deploy` as the deploy command.

This must create a separate staging Worker. Do not connect the `main` branch or the production domain.

## Required Worker secrets

After the Worker has been created, add these under Settings > Variables and Secrets as encrypted **Secrets**, never as plain variables or source code:

- `ORDERS_SCRIPT_URL`: the existing Google Apps Script Web App URL for order handling.
- `UPLOAD_SIGNING_SECRET`: a random secret of at least 32 bytes used to sign private customer-image links.

The existing Apps Script URL should be copied from the previous configuration; do not change the order spreadsheet or mail script.

## R2 bucket

The account's R2 service is enabled and the `wanderwood-staging-assets` bucket has been created in the EEUR location. The `UPLOADS` binding in `wrangler.jsonc` points to this bucket.

Customer uploads are accepted by the Worker, checked for supported image type and file signature, then stored in R2. The Worker returns a signed media URL for use in the order email. The link currently expires after one year.

The bucket is private; images are served through the Worker after signature validation. No public R2 bucket domain is enabled.

## Local checks

```sh
node --check src/index.js
npx wrangler dev
```

Before deployment, set the two secrets above on the staging Worker. The R2 bucket is already present. Use the staging Worker only; do not bind the production domain until the full acceptance test is complete.
