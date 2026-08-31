# Self-hosted cobalt (TikTok fallback)

A private [cobalt](https://github.com/imputnet/cobalt) API instance that extracts
and **tunnels** media. The site calls it server-side; because cobalt
tunnels the bytes through its own server, the URLs it returns play from any IP
(which is why this fixes TikTok where tikwm/datacenter extraction fails).

**Ordering:** the app tries the **public** cobalt instance first (warm + fast)
and only falls back to your self-hosted `COBALT_API_URL` when the public one
fails/rate-limits. So your instance is a safety net, not the hot path.

---

## Option A — Render (free, no card) ✅ recommended

Render runs the public cobalt image directly; its free tier needs no credit card.

### Deploy (Render dashboard)

1. [dashboard.render.com](https://dashboard.render.com) → **New → Web Service**.
2. Choose **"Deploy an existing image"** and enter:
   `ghcr.io/imputnet/cobalt:11`
3. Settings:
   - **Instance type:** Free
   - **Region:** Frankfurt
4. **Environment variables** — add:
   - `API_PORT` = `10000`  ← match Render's expected port so it routes/health-checks correctly
   - `API_URL` = `https://<your-service>.onrender.com/`  ← the URL Render assigns you (set it after the first deploy, then redeploy; **trailing slash required**)
5. Create the service. Verify it's live — should return cobalt JSON:
   ```bash
   curl https://<your-service>.onrender.com/
   ```

### Keep it warm (important)

Free Render services **spin down after 15 min idle** and take **30–60s** to wake —
longer than the app's request timeout, so a *cold* fallback won't actually
respond in time. Keep it warm with a free pinger (e.g. [UptimeRobot](https://uptimerobot.com)
or [cron-job.org](https://cron-job.org)) hitting `https://<your-service>.onrender.com/`
every ~14 min. A month is ~730 hrs, under Render's 750 free instance-hours, so an
always-pinged single service stays free.

> Bandwidth: free tier is capped at **100 GB/mo**, and video streams *through*
> cobalt. Plenty for a small site; watch it if traffic grows.

---

## Option B — Fly.io (paid, ~cents–$3/mo)

Requires a credit card (Fly disables deploys for card-less trial orgs). The
`fly.toml` here is preconfigured (`socialdownloader-cobalt`, region `fra`, single
512 MB machine, auto-sleep).

```bash
# flyctl: Windows  iwr https://fly.io/install.ps1 -useb | iex
fly auth login
# from this deploy/cobalt/ folder (app name + API_URL already set in fly.toml):
fly deploy --config fly.toml --ha=false   # --ha=false = ONE machine
fly scale count 1                          # tunnels are signed per-machine
curl https://socialdownloader-cobalt.fly.dev/
```

---

## Point the app at your instance

Set it as a Worker secret — `pnpm cf:setup secrets COBALT_API_URL`, or `wrangler secret put COBALT_API_URL`. Secrets apply to the next request; no redeploy needed:

```
COBALT_API_URL = https://<your-service>.onrender.com/    # or your .fly.dev URL
```

The app uses the public instance first and this one as the fallback. Locally you
can put the same line in `.env`, which is the repo's single env file.

## Notes

- **Single instance only** (both hosts). cobalt signs each tunnel URL to the
  instance that created it, so a second instance would serve some tunnels a
  404/403 — which looks exactly like the "Preview unavailable" bug.
- **Locking it down (optional):** the instance is open by default. To restrict
  it to this app, enable cobalt API-key auth (`API_AUTH_REQUIRED=1` + a keys
  file) and set `COBALT_API_KEY` as a Worker secret — the app already forwards it as an
  `Authorization: Api-Key <key>` header when present.
- **YouTube** is intentionally out of scope — it bot-blocks datacenter IPs and
  needs a residential IP or session cookies.
