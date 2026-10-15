# S3 and CloudFront

Build the site, upload it to a private bucket, enable Origin Access Control and serve over HTTPS with CloudFront.
Create response policies from the generated JSON using `aws cloudfront create-response-headers-policy
--response-headers-policy-config file://<file>`. Attach app policy to default behaviour, embed policy to
`embed/*.js`, auth policy to `auth.html`. Policies do not configure access control, cache TTLs or authentication.

For `assets/*`, attach the generated assets policy and use immutable S3 metadata/cache behaviour;
HTML minimum TTL is zero and embed code caches for an hour. Do not replace all missing modules with index.html.
Use `--flat` for verification. Frame allowlists apply to all pages; install authentication separately.
See [the guide](../../../docs/SELF-HOSTING.md#s3-and-cloudfront).
