# Resolver operations runbook

How the self-hosted media resolver is deployed, wired, and kept healthy. Nothing
secret lives here — only env-var **names** and procedure. Real values (tokens,
proxy creds, cookies) live only in the resolver host's env and the Worker's
secrets, never in the repo.

## Architecture at a glance

```
browser ──▶ the Worker ──▶ (public Cobalt, then) self-hosted resolver ──▶ source
   ▲                              │  writes live URL
   │                              ▼
   └───────── media stream ◀── resolver /t  (streams DIRECT from CDN)

discovery:  resolver ──SET live URL──▶ Upstash Redis ──GET──▶ the Worker
```

- The app tries the public Cobalt instance first, then any configured
  `COBALT_API_URL`, then the **discovered** resolver URL (from Upstash).
- The resolver **extracts** through a proxy (small), then **streams the media
  direct from the CDN** (large) — proxy bytes are spent only if the CDN itself
  rejects the box. See `perf(resolver): stream media direct…` commit.

## Do you need this? No.

> **This whole component is obsolete.** Nothing in the app depends on it, and
> there is no longer a platform it would unblock. Kept only as reference.

Measured against production on **2026-07-30**, with no resolver running and no
secrets set on the Worker:

| Platform | Status without a resolver |
|---|---|
| TikTok | ✅ works — tikwm first, public Cobalt second |
| Instagram | ✅ works — reels resolve in <1s via Cobalt |
| Facebook | ✅ works — Cobalt returns a CDN redirect |
| X / Twitter | ✅ works |
| YouTube | ✅ works — **Innertube, extracted inside the Worker** |

YouTube was the last thing this resolver existed for, and it no longer needs a
resolver either. `src/lib/youtubeInnertube.ts` calls YouTube's own player API
directly from the Worker using the **ANDROID_VR** client, which still returns
unsigned stream URLs — so there is no signature cipher to interpret, no Python,
no ffmpeg, and no external host to keep alive. It costs 1-2 ms of CPU.

Both risks were verified on a real edge isolate rather than assumed, because
neither is observable from a dev machine:

- **Datacenter egress.** From colo MRS, ANDROID_VR returns `playabilityStatus:
  OK` with 27 formats. (IOS returns OK but adaptive-only; ANDROID 400s; MWEB,
  TVHTML5 and WEB_EMBEDDED all report the video unplayable.)
- **IP binding.** URLs extracted in Marseille play back from an unrelated IP
  (`206`, correct Content-Type), so googlevideo does not tie them to the
  extracting address.

Two honest limits, neither of which a resolver is worth rebuilding for:

- **Video caps at 360p.** YouTube publishes exactly one muxed progressive
  stream (itag 18); everything higher is adaptive and needs ffmpeg to
  recombine. A self-hosted yt-dlp *would* fix this — it is the only remaining
  reason to want one.
- **Bytes proxy through `/api/video`**, as TikTok/Instagram/Facebook already
  do. googlevideo sends neither `Content-Disposition: attachment` nor an
  `Access-Control-Allow-Origin` header, so the browser can neither be handed
  the URL directly nor fetch it cross-origin.

Audio is unaffected by the 360p ceiling — an audio-only adaptive stream needs
no muxing, so it comes back at full quality. Cobalt still serves audio first;
Innertube backs it up.

**Do not rebuild this.** The only scenario that justifies it is wanting
above-360p YouTube video badly enough to run a host.

## Hosting

**Back4app is gone — do not use it.** Its free tier expired the custom domain
and destroyed the deployment ("The Back4app custom domain has expired for free
plan" → `DEPLOYMENT DESTROYED`, 2026-07-24). Free-tier containers there are not
durable enough to depend on.

If you do stand a resolver back up, in preference order:

1. **Hugging Face Spaces (Docker SDK)** — free, no card, and unlike Back4app it
   gives a **stable** URL (`https://<user>-<space>.hf.space`). That single
   property removes the entire self-registration loop below: set
   `COBALT_API_URL` once and never touch it. Free CPU tier sleeps after ~48 h
   idle, which the keep-warm cron already handles. Listen on port 7860.
2. **Oracle Cloud Always-Free VM** — a real always-on host in a served region,
   so no egress proxy needed. Requires a card for identity verification even
   though it never bills.
3. Render / Railway / Fly — all want a card now. Koyeb's free tier closed
   (acquired by Mistral, 2026).

Cloudflare is **not** an option for this piece: Workers can't run yt-dlp
(Python + ffmpeg), and Cloudflare Containers requires the paid Workers plan.

## Environment variables

Set on the **resolver host** (Back4app):

| Var | Purpose |
|-----|---------|
| `RESOLVER_SECRET` | HMAC key for tunnel tokens (keep stable across restarts) |
| `RESOLVER_PROXY` | `http://USER:PASS@HOST:PORT` — egress proxy in a **served region** for geo-gated extraction |
| `RESOLVER_COOKIES` | optional `cookies.txt` contents for login-walled sources (or `RESOLVER_COOKIES_URL` → raw URL) |
| `RESOLVER_API_KEY` | optional; if set, callers must send `Authorization: Api-Key <key>` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | shared store for self-registration |
| `REGISTRY_KEY` | optional; discovery key name (default `resolver_url`) |

Set on **the app**, as Cloudflare Worker secrets. Name the keys —
`pnpm cf:setup secrets COBALT_API_URL` — because a bare `secrets` pushes
everything in `.env`, including `PRO_TOKEN_SECRET`, which re-signs every session
and logs every user out. `wrangler secret put <KEY>` does one key too:

| Var | Purpose |
|-----|---------|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | **same values** as the resolver — lets the app discover the live URL |
| `REGISTRY_KEY` | optional; must match the resolver if overridden |
| `COBALT_API_URL` | optional now; discovery replaces the need to hand-set it |
| `COBALT_API_KEY` | only if `RESOLVER_API_KEY` is set on the resolver |

## Self-registration loop (only needed on a rotating-URL host)

> Skip this entirely on Hugging Face Spaces or any host with a stable URL —
> just set `COBALT_API_URL` and leave the Upstash vars unset. The app treats a
> missing store as "no discovered resolver" and falls through to its static
> list, which is exactly right. This section exists because Back4app rotated
> its URL on every restart.


1. On every `/health` ping and every resolve, the resolver derives its **current
   public URL** from the forwarded host and `SET`s it into Upstash with a 15-min
   TTL (`_register` in `app.py`).
2. The app reads that key (`discoverResolverBase` in `src/lib/downloader.ts`,
   60 s in-process cache) and tries the discovered URL ahead of its fallback list.
3. Back4app rotates the URL → next ping re-registers → app follows. No env churn.
4. If the resolver dies, the key expires (TTL) → app stops handing out a dead URL.

## Keep-warm cron (prevents rotation)

Free instances sleep when idle; the wake-up restart is what rotates the URL.
A scheduler ping keeps it hot **and** refreshes the discovery key.

- **cron-job.org** (free, no card): `GET https://<current-host>/health` every
  **5 min** (`*/5 * * * *`).
- ⚠️ This URL is **hardcoded** in the cron — the one spot that still needs a
  manual update if the host rotates. Keeping it warm prevents rotation, so in
  steady state it stays put; only a code redeploy forces a new URL.

## Health check

`GET /health` → `{"status":"ok","auth":<cookies loaded>,"proxy":<proxy set>,"registry":<store wired>}`

- `?geo=1` reports the effective egress region through the proxy (diagnose
  geo-restriction / dead proxy).
- `auth:true` = a cookie jar loaded. `proxy:true` = `RESOLVER_PROXY` set.
  `registry:true` = Upstash env present.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/health` → 404 | host URL rotated | grab the new URL from the host's dashboard; update the cron URL (does not happen on a stable-URL host) |
| resolve → `fetch.empty`, detail `Redirection detected` | egress IP geo-blocked by the source | point `RESOLVER_PROXY` at a **served** region |
| detail `CONNECT tunnel failed, response 402` / `ProxyError` | proxy quota exhausted (free tiers are metered, ~1 GB/mo) | refresh proxy creds; the direct-stream fix keeps quota from draining on downloads |
| `geo` → `JSONDecodeError` | proxy up but the lookup host returned non-JSON | benign; proxy is connecting |
| login-walled source fails | needs cookies | set `RESOLVER_COOKIES` (Netscape `cookies.txt`); refresh when expired |
| app not using resolver | discovery key missing/stale | check `registry:true` on `/health`; confirm same Upstash env on both sides; check the key in Upstash Data Browser |

Add `{"debug":true}` to a resolve POST body to surface the last extractor error
in the response `detail` field.

## Secrets hygiene

- Never commit proxy creds, cookies, Upstash tokens, or `RESOLVER_SECRET`.
- Rotate any credential that has ever been pasted into a chat/log.
- Cookies expire — refresh `RESOLVER_COOKIES` when a previously-working
  login-walled source starts failing.
