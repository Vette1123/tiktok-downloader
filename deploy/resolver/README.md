---
title: Media Resolver
emoji: 🔗
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 8080
pinned: false
---

# Generic media resolver

A tiny self-hosted service that resolves a link server-side and **tunnels** the
bytes through its own host, so the media streams from any IP. It speaks the same
API shape as the public tunnel service, so the main app uses it as a drop-in
fallback via the `COBALT_API_URL` env var — no app code changes needed.

The main app already routes any link it doesn't have a bespoke extractor for to
this path, so once this is deployed and wired, those links resolve on the live
(deployed) site with no local tooling required.

## Deploy to Koyeb (free, no credit card)

1. **Sign up / log in** at koyeb.com — use **GitHub**. The Hobby plan needs
   **no card** (it may ask a human-check, not a card).
2. **Create Web Service → GitHub**, pick the repo. Grant Koyeb access if asked.
3. Configure the build:
   - Branch: `main`
   - **Work directory:** `deploy/resolver`  ← critical (the service lives here)
   - Builder: **Dockerfile** (auto-detected)
   - Instance: **Free**
   - **Exposed port: 8080** (matches the image default)
4. **Environment variables:** add `RESOLVER_SECRET` = any long random string
   (keeps tunnel tokens valid across restarts). Optional: `RESOLVER_API_KEY`,
   `RESOLVER_COOKIES` (see below).
5. **Deploy.** When it's healthy, copy the public URL
   `https://<name>-<org>.koyeb.app`. Koyeb usually injects this automatically; if
   playback URLs come back pointing at localhost, add an env var
   `BASE_URL = https://<name>-<org>.koyeb.app` and redeploy.

## Wire it to the app

On the app, as Worker secrets (`pnpm cf:setup secrets <KEY>`, or `wrangler secret put <KEY>`):

- `COBALT_API_URL` = the Space URL from step 4 (e.g.
  `https://<user>-media-resolver.hf.space`).
  This var accepts a comma/space-separated list, so it stacks with any existing
  value.
- If you set `RESOLVER_API_KEY` on the Space, also set `COBALT_API_KEY` to the
  same value here.

Secrets apply to the next request, so there is nothing to redeploy. Paste a link on the site — it resolves through the
resolver.

## Auto-discovery (hosts with rotating / temporary URLs)

Some free hosts hand out a **temporary public URL** that changes on restart, and
expose no API to read the current one — so you can't keep `COBALT_API_URL`
pointed at it by hand. Instead, let this box **announce its own URL** to a tiny
free key/value store, and let the app read it back:

1. Create a free **Upstash Redis** database (no credit card). Copy its
   **REST URL** and **REST TOKEN**.
2. On **this service** (the resolver host), set:
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
3. On the **app**, set the same two secrets (identical values).
4. Point the keep-warm cron (below) at `/health`. Each ping re-announces the
   current URL (and refreshes its 15-min TTL); the app discovers it before its
   fallback list, so a rotated URL heals with zero manual updates.

Optional `REGISTRY_KEY` overrides the key name (default `resolver_url`) on both
sides. With this wired you can leave `COBALT_API_URL` unset — discovery covers it.

## Keep it warm (optional)

Free instances may sleep after idle. To keep it hot, ping it with a free
scheduler — **cron-job.org** (also no card):

- Create a cron job: `GET https://<name>-<org>.koyeb.app/health` every 10 min.

## Sources behind a login / anti-bot check

Some sources gate downloads behind cookies + a browser check. To handle them:

1. Export a `cookies.txt` (Netscape format) with a browser extension such as
   "Get cookies.txt LOCALLY" while logged in on that site.
2. Paste the file **contents** into the `RESOLVER_COOKIES` secret on the Space
   and it redeploys.

The image already installs `curl_cffi`, so the service impersonates a real
browser's TLS fingerprint automatically. Cookies expire, so refresh them if a
previously-working source starts failing.

## Run it at home, for sites that block datacenter IPs

Some sites answer any datacenter IP — Cloudflare, Koyeb, Back4app, a VPS, all
of them — with a few hundred bytes of redirect stub instead of their markup,
while the same URL from a home connection returns the real page. Nothing in a
request fixes that: the block is on the address. The only thing that changes
the answer is fetching from a residential connection.

This container is that fetch, if you run it on a machine at home. Free, no
provider, no per-request credit.

1. Run the image on a home box that stays on — a spare PC, a Raspberry Pi:

   ```bash
   docker run -d --restart unless-stopped -p 8080:8080 \
     -e RESOLVER_API_KEY=<long random string> \
     --name media-resolver media-resolver
   ```

2. Give it a public hostname with a **Cloudflare Tunnel** (free, and it needs
   no open port or static IP on your router):

   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

   For a hostname that survives restarts, create a named tunnel instead and
   point a subdomain at it.

3. On the Worker, set the page-fetch secret to this box's `/html` route.
   `{url}` is substituted with the blocked page; the app only ever calls it
   after it has already detected a wall, so nothing else routes through home:

   ```bash
   wrangler secret put SCRAPE_UNLOCKER_URL
   # https://<your-tunnel-host>/html?key=<RESOLVER_API_KEY>&url={url}
   ```

Traffic to those pages now leaves from your home IP, which is the point, and
is worth knowing before you switch it on. Everything else keeps resolving on
the Worker exactly as before.

## Alt hosts

- **Back4app Containers** — also no card (GitHub import, Docker). Only 256 MB
  RAM, so heavier remuxes may struggle; fine for most progressive links.
- **Render** — ships a `render.yaml` blueprint, but its free tier now requires a
  `$1` card authorization. Use only if you already have a card on file.
- **Hugging Face Spaces** — Docker Spaces now require a paid PRO plan (only
  Static Spaces stay free), so it no longer works as a no-card option.

## Local test

```bash
cd deploy/resolver
docker build -t media-resolver .
docker run -p 8080:8080 -e BASE_URL=http://localhost:8080 media-resolver
# resolve:
curl -s -X POST http://localhost:8080/ -H 'content-type: application/json' \
  -d '{"url":"<link>"}'
# then GET the returned .url to stream it
```
