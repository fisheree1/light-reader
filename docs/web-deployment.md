# Web deployment

LightReader can be published as a static HTTPS web application. The server only
delivers versioned frontend assets. Imported EPUB/PDF files, notes, highlights,
settings, and indexes stay in each visitor's browser; the server does not receive
or persist reading data.

## Architecture and capacity

The production image builds the Vite application and serves it with Caddy:

```text
Browser
  ├── HTTPS -> Caddy container -> static LightReader assets
  ├── IndexedDB -> EPUB/PDF binaries
  └── localStorage -> metadata, notes, settings and derived indexes
```

One CPU core and 256 MB are reserved as a container ceiling. A 2-core/4-GB,
30-GB SSD server is sufficient because book parsing, PDF rendering, search and
storage happen in the visitor's browser. Hashed assets receive one-year immutable
cache headers and Caddy enables Zstandard or gzip transfer compression.

The initial production assets are roughly 3 MB before compression. Actual
bandwidth depends on cache hit rate and visitor count; imported books are not
charged against server traffic.

## Prerequisites

- A Linux server with Docker Engine and the Compose plugin.
- For the recommended HTTPS setup, a domain such as `reader.example.com` with
  an `A` record pointing to the server's public IPv4 address.
- In the provider firewall/security group, allow inbound TCP 80 and 443. Do not
  expose the internal health port 8080.
- No other process may occupy ports 80 or 443.

HTTPS is strongly recommended for production privacy. Caddy obtains and renews
the certificate automatically after DNS and firewall configuration are correct.
The application includes UUID and SHA-256 fallbacks so an IPv4-only HTTP trial
can still import books, but HTTP traffic is not encrypted and the browser will
mark the site as insecure.

## Baota panel deployment without a domain

For a temporary IPv4-only deployment using an existing Baota Nginx installation:

1. Run `pnpm bundle:check` locally and archive the contents of `dist`.
2. In **Website > HTML project**, bind the server's public IPv4 on port 80.
3. Upload and extract the production files to a versioned directory such as
   `/www/wwwroot/light-reader/app`.
4. Point the Nginx site root at that directory.
5. Add these pseudo-static rules:

```nginx
location = /healthz {
    default_type text/plain;
    return 200 "ok\n";
}

location ~* ^/assets/.*\.mjs$ {
    try_files $uri =404;
    types { application/javascript mjs; }
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Validate the homepage, a refresh on `/settings`, and `/healthz`. Move to a
domain with HTTPS before using private notes over untrusted networks.

The explicit `.mjs` mapping is required for the PDF.js worker on Nginx builds
whose MIME table does not yet include that extension. When
`X-Content-Type-Options: nosniff` is enabled, serving the worker as
`application/octet-stream` prevents PDF rendering.

## Current production deployment

The current public web edition is available at
[`https://fisher-ai.com`](https://fisher-ai.com). `http://fisher-ai.com`, the
public IPv4 address, and `https://www.fisher-ai.com` redirect to that canonical
HTTPS origin.

It is served by the existing Baota Nginx installation from
`/www/wwwroot/light-reader/app`. The certificate covers both the apex and `www`
hostnames and is managed by Baota's daily ACME renewal task. The live Nginx
configuration also enforces TLS 1.2/1.3, immutable caching for hashed assets,
gzip transfer compression, SPA deep-link fallback, and the security headers
listed in the operational checks below.

Before replacing the deployed `app` directory, keep the previous build or the
uploaded release archive for rollback. Imported books and user data do not need
to be migrated during a frontend release because they remain in the browser's
storage for the unchanged `https://fisher-ai.com` origin.

## First deployment

The `Publish web image` CI job publishes
`ghcr.io/fisheree1/light-reader-web:latest` after the frontend and browser tests
pass on a push to `main`. Ensure the GitHub package is public, or authenticate
Docker on the server before pulling it.

```bash
git clone https://github.com/fisheree1/light-reader.git
cd light-reader
cp .env.deploy.example .env
```

Edit `.env` and replace `reader.example.com` with the real domain. Then run:

```bash
docker compose pull
docker compose up -d --no-build
docker compose ps
curl --fail https://reader.example.com/healthz
```

If the GitHub image is not available, build it on the server instead:

```bash
docker compose build --pull
docker compose up -d
```

View bounded container logs with:

```bash
docker compose logs --tail=100 light-reader-web
```

## Updating and rollback

For a normal update:

```bash
git pull --ff-only
docker compose pull
docker compose up -d --no-build
curl --fail https://reader.example.com/healthz
```

Every published image also receives a `sha-<commit>` tag. For rollback, set
`LIGHTREADER_IMAGE` in `.env` to a previously known-good SHA tag and run
`docker compose up -d --no-build` again.

## Web edition boundaries

- Data belongs to a browser profile and the exact HTTPS origin. Changing the
  domain creates a new empty browser store.
- Clearing site data or using private-browsing mode removes local books and
  notes. The server cannot restore them. Export important notes and keep the
  original EPUB/PDF files.
- Browser storage quotas vary. Very large libraries should use the desktop app,
  which stores books in its managed application directory and supports complete
  backups.
- The hosted web edition does not connect to a server-side database and has no
  user accounts, cloud sync, collaborative access, or server backup.
- Local Ollama integration remains a desktop feature. Running a large model on
  this 2-core/4-GB server is intentionally outside this deployment.
- Image-only/scanned PDFs still require future OCR for search and AI retrieval.

## Operational checks

- `https://<domain>/healthz` returns `ok`.
- `docker compose ps` reports the container as healthy.
- A direct refresh on `/library`, `/reader/...`, `/search`, or `/research`
  returns the application rather than a 404.
- Security headers are present and `/assets/*` responses use immutable caching.
- Import one EPUB and one text-based PDF, refresh the page, and confirm both can
  still open from IndexedDB.
