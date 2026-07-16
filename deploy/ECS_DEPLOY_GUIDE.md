# Deploying The Pack — solo runbook (backend on Alibaba ECS, DB/cache/frontend elsewhere)

This is a **complete, standalone, do-it-yourself guide**. Every command is copy-pasteable. Every step
says exactly what you should see when it works, and what to do if it doesn't. You do not need to ask
anyone anything to get through this — if something doesn't match what's described, the
**Troubleshooting** section at the bottom covers it.

Follow the parts **in order, top to bottom, without skipping.** The order is deliberate — a couple of
steps (the password file, the whitelisting) are placed early on purpose so the app doesn't fail to
start on first launch.

---

## The shape of this deployment (and why)

To keep the monthly cost as low as possible for a hackathon demo, **only the backend runs on Alibaba
Cloud** — that's the one thing the Qwen hackathon actually requires ("the backend is running on
Alibaba Cloud"). Everything else runs on free external tiers:

```
                         ┌─────────────────────────────────────────┐
Browser ──► Frontend ────►         ECS box on Alibaba Cloud         │
        (Vercel, free)   │  nginx (password-gated) : port 80/443    │
                         │     ├─► /api/ → engine  (Python : 8000)  │──► Neon Postgres  (free, TLS)
                         │     └─► /ws/  → gateway (Rust   : 8080)  │──► Upstash Redis  (free, TLS)
                         └─────────────────────────────────────────┘
```

- **Alibaba ECS** — one small server running three containers: the engine (Python), the gateway
  (Rust), and nginx. This is the "backend running on Alibaba Cloud" the hackathon requires. **Paid**,
  but small — see the cost table at the bottom.
- **Neon** (neon.tech) — managed Postgres, **free tier**. Replaces Alibaba RDS.
- **Upstash** (upstash.com) — managed Redis, **free tier**. Replaces Alibaba Tair.
- **Vercel** (or Netlify / Cloudflare Pages) — hosts the frontend, **free tier**.
- **Qwen / Model Studio** — the LLM. You already have a working key. Pay-per-use.

Both Neon and Upstash connections go over the public internet and are **encrypted with TLS** — the
code is already set up for this (Postgres via `POSTGRES_SSLMODE=require`, Redis via a `rediss://` URL
and a TLS-enabled gateway build). You don't have to configure any of that; just paste the connection
strings.

---

## Before you start — the accounts you'll need

You'll create a handful of free accounts plus one paid server. None of them can be created for you —
each needs your email and a click-through — but every step below is spelled out.

- [ ] **Alibaba Cloud** account with billing enabled — for the ECS server (the paid part)
- [ ] **Neon** account (free) — https://neon.tech — for Postgres
- [ ] **Upstash** account (free) — https://upstash.com — for Redis
- [ ] **Vercel** account (free) — https://vercel.com — for the frontend (or Netlify/Cloudflare Pages)
- [ ] A **working Qwen API key** — you already have one, confirmed live and working: it's currently in
      `backend/.env` on this machine, starting `sk-ws-H.XHRRLX...`. Copy the FULL value from that file
      when you reach Part 6 — never re-type it by hand.
- [ ] This codebase, pushed to GitHub (it already is — `tobiloba/engine-spine` branch)
- [ ] ~40–60 minutes, most of it waiting for things to provision or build

Web search runs on DuckDuckGo — free, keyless, nothing to sign up for.

---

## Part 1 — Create the database (Neon Postgres, free)

1. Go to https://neon.tech and sign up (GitHub or Google login is fastest).
2. On first login it offers to **create a project**. Fill in:
   - **Project name:** `pack` (anything)
   - **Postgres version:** the default (latest) is fine
   - **Region:** pick the one closest to Singapore — **AWS Asia Pacific (Singapore)** if offered; if
     not, any region works (it just adds a little latency, which is fine for a demo).
   - Click **Create project**.
3. Neon immediately shows you a **Connection string**. It looks like:
   ```
   postgresql://neondb_owner:AbCd1234XyZ@ep-cool-name-a1b2c3d4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
   Click the copy button and **save it somewhere.** You'll need it in Part 6.

> **Important — how you'll use this string later:** the engine (asyncpg) does **not** understand the
> `?sslmode=require&channel_binding=require` part on the end. In Part 6 you'll paste this string but
> **delete everything from the `?` onward**, and TLS is turned on separately by a `POSTGRES_SSLMODE`
> line that's already in the config template. This is handled for you — just remember the connection
> string has a `?...` tail you'll trim.

That's the whole database. No accounts to create, no whitelisting — Neon is reachable over the public
internet by default (secured by the password in the string + TLS).

---

## Part 2 — Create the cache (Upstash Redis, free)

1. Go to https://upstash.com and sign up (GitHub/Google login works).
2. In the console, click **Create Database** (under the **Redis** product — Upstash also has other
   products; make sure it's Redis).
3. Fill in:
   - **Name:** `pack`
   - **Type / Primary Region:** pick the region closest to Singapore (e.g. `ap-southeast-1`). A
     single-region database is free and correct — you do **not** need "Global."
   - Leave **TLS/SSL enabled** (it's on by default and required — do not turn it off).
   - Click **Create**.
4. On the database's page, find the connection details. You want the one that starts with **`rediss://`**
   (two s's — that means TLS). It looks like:
   ```
   rediss://default:AbCdEf0123456789@apn1-cool-name-12345.upstash.io:6379
   ```
   Upstash shows this a few ways — as a plain "Endpoint," as a `redis-cli` command, and often as a
   ready-made `rediss://…` URL under a tab like **"Node"/"ioredis"** or **"Connect"**. Copy the full
   **`rediss://` URL** and **save it.** If you only see host/port/password separately, assemble it as:
   `rediss://default:<PASSWORD>@<ENDPOINT_HOST>:6379`

> **Must start with `rediss://`, not `redis://`.** Upstash only accepts TLS connections; the gateway
> is built to speak TLS specifically so this works. A plain `redis://` URL will be rejected at connect
> time.

That's the whole cache. Like Neon, it's reachable over the public internet by default — no
whitelisting step.

---

## Part 3 — Create the server (Alibaba ECS)

This is the one paid piece, and the one the hackathon requires ("backend running on Alibaba Cloud").

1. Log into the Alibaba Cloud console → https://home.console.aliyun.com
2. Search **"ECS"** → click **Elastic Compute Service** → **Instances** → **Create Instance**
3. Fill in:
   - **Billing Method:** Pay-As-You-Go
   - **Region:** **Singapore (ap-southeast-1)** — use this to match the international Qwen endpoint and
     keep latency low. (China regions require ICP filing — avoid them.)
   - **Instance Type:** a **2 vCPU / 4 GB** general-purpose type is enough now that Postgres and Redis
     are NOT on this box (e.g. `ecs.e-c1m2.large` or any 2 vCPU / 4 GB). Do **not** go below 4 GB RAM —
     the Rust gateway needs real memory to compile on first build. (If you want the build to finish
     faster, a 4 vCPU / 8 GB box compiles quicker, but 2/4 + the swap step below works fine.)
   - **Image:** Public Image → **Ubuntu** → **22.04 64-bit**
   - **Storage (System Disk):** 40 GB, ESSD (Enhanced SSD) if offered, otherwise standard SSD
   - **Network — VPC:** the default VPC is fine. (There's no RDS/Tair to share a VPC with anymore — the
     database and cache are external, reached over the public internet — so VPC choice no longer
     matters here. Just make sure the instance gets a public IP, next.)
   - **Public IP:** tick **"Assign Public IP"** — you need it to reach the app and to SSH in. Bandwidth
     5 Mbps pay-by-traffic is cheap and fine for a demo.
   - **Security Group:** create one (or use existing) with these inbound rules — add all three:
     | Protocol | Port | Source |
     |---|---|---|
     | TCP | 22 | 0.0.0.0/0 (or your own IP only, if you know it — safer) |
     | TCP | 80 | 0.0.0.0/0 |
     | TCP | 443 | 0.0.0.0/0 |
   - **Logon Credentials:** choose **Password**, set a strong root password, **write it down.** (An SSH
     key pair is more secure if you already use one — either works.)
4. Confirm the order and click **Create Instance.** Takes **1-3 minutes** to reach "Running."

**Once running:** on the instance list, copy the **Public IP Address** next to your instance.

**Write this down:**
```
ECS_PUBLIC_IP = <the public IP>
ECS_ROOT_PASSWORD = <the root password from step 3>
```

There's **no database/cache whitelisting step** in this setup — Neon and Upstash are public-internet
services secured by their passwords + TLS, so the ECS box reaches them with no firewall dance.

---

## Part 4 — (Optional) Alibaba OSS for forged-file storage

Skip this on a first pass — the app runs fine without it (forged PDFs/DOCX are stored on the ECS box's
own disk). It's worth adding later since you're already on Alibaba, but it is **not** required to be
live. If you want it:

1. Search **"OSS"** → **Object Storage Service** → **Buckets** → **Create Bucket**
   - **Bucket Name:** `pack-artifacts` (globally unique — add a suffix if taken, e.g.
     `pack-artifacts-autrans`)
   - **Region:** Singapore — same as the ECS box
   - **Storage Class:** Standard; **ACL:** Private
2. Search **"RAM"** → **RAM Access Control** → **Users** → **Create User**
   - **Logon Name:** `pack-oss-user`; tick **OpenAPI Access** (this generates the API keys)
   - After creating, copy the **AccessKey ID** and **AccessKey Secret** (the secret shows once)
   - Click the user → **Add Permissions** → attach **`AliyunOSSFullAccess`**

**Write these down (only if you did this part):**
```
OSS_BUCKET = pack-artifacts   (or your suffix)
OSS_ENDPOINT = https://oss-ap-southeast-1.aliyuncs.com
OSS_ACCESS_KEY_ID = <from RAM>
OSS_ACCESS_KEY_SECRET = <from RAM>
```

---

## Part 5 — Connect to your server and install Docker

**On your own computer**, open a terminal (PowerShell on Windows is fine) and run:

```bash
ssh root@ECS_PUBLIC_IP
```

Replace `ECS_PUBLIC_IP` with the real IP from Part 3. It asks:
```
Are you sure you want to continue connecting (yes/no)?
```
Type `yes`, Enter. Then enter the root password from Part 3.

You should now see a prompt like `root@iZxxxxxxx:~#` — you are IN the server. **Everything from here
through Part 8 runs ON THE SERVER** unless a step says "on your own computer."

### Install Docker

Copy this **whole block** and paste it in one go, then Enter and wait (~1-2 minutes):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg apache2-utils
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

(This also installs `apache2-utils` **now** — that's the `htpasswd` tool you need in Part 6, before the
app's first startup.)

Verify:
```bash
docker --version
docker compose version
```
Both should print version numbers (any version is fine).

### Add swap space (prevents the Rust build from running out of memory)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Verify: `free -h` shows a `Swap:` row with `4.0Gi` total.

---

## Part 6 — Get the code, configure secrets, and create the password file

### 6a — Clone the code

```bash
cd ~
git clone https://github.com/tobilobacodes00/the-pack.git
cd the-pack
git checkout tobiloba/engine-spine
git branch --show-current      # should print: tobiloba/engine-spine
```

**If the repo is private** and git asks for a login (GitHub no longer accepts plain passwords):
generate a token at https://github.com/settings/tokens → "Generate new token (classic)" → tick `repo`
→ generate, then:
```bash
git clone https://YOUR_GITHUB_USERNAME:YOUR_TOKEN@github.com/tobilobacodes00/the-pack.git
```

### 6b — Create the production env file

```bash
cd ~/the-pack/deploy
cp .env.prod.example .env.prod
nano .env.prod
```

nano opens a text editor. Arrow keys move around; **Ctrl+X** then **Y** then **Enter** saves and
exits. Fill in these values (everything else in the file ships correct, verified defaults):

**QWEN_API_KEY** — the FULL key from `backend/.env` on your computer:
```
QWEN_API_KEY=sk-ws-H.XHRRLX...          ← paste the whole thing, no spaces/line breaks
```

**POSTGRES_URL** — paste your Neon string from Part 1, but **delete the `?sslmode=...` tail**:
```
# Neon gave you:
#   postgresql://neondb_owner:PASS@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
# Paste it WITHOUT the "?..." part:
POSTGRES_URL=postgresql://neondb_owner:PASS@ep-xxx.ap-southeast-1.aws.neon.tech/neondb
```
Leave the `POSTGRES_SSLMODE=require` line already in the file exactly as it is — that's what turns on
TLS for Neon.

**REDIS_URL** — paste your Upstash `rediss://` string from Part 2, verbatim:
```
REDIS_URL=rediss://default:PASS@your-db.upstash.io:6379
```
Make sure it starts with `rediss://` (two s's).

**SESSION_SECRET** and **API_AUTH_TOKEN** — each needs a random value. Generate them (run the command
twice, once per line — it prints a different value each time):
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```
(If nano is open, exit with Ctrl+X first, run the command, then `nano .env.prod` again to paste.)
Paste one result as `SESSION_SECRET=...` and the other as `API_AUTH_TOKEN=...`.

**CORS_ORIGINS** — where the frontend will be served from. If you don't have the Vercel URL yet, put
your ECS IP for now and update it in Part 9 once the frontend is live:
```
CORS_ORIGINS=http://ECS_PUBLIC_IP
```

**OSS (only if you did Part 4)** — fill in `OSS_BUCKET`, `OSS_ENDPOINT`, `OSS_ACCESS_KEY_ID`,
`OSS_ACCESS_KEY_SECRET`. If you skipped Part 4, leave them as `replace-me`/blank — the app falls back
to local disk automatically.

Save and exit (Ctrl+X, Y, Enter).

### 6c — Create the password file (BEFORE starting the app)

The app **refuses to start** without this file because `nginx.conf` requires it. Create it now:

```bash
cd ~/the-pack/deploy
htpasswd -bc .htpasswd YOUR_USERNAME YOUR_PASSWORD
```
Pick real values (e.g. `htpasswd -bc .htpasswd packmaster Sunset2026!`). This is the login prompt
anyone visiting the backend directly will see. Verify: `ls -la .htpasswd` shows a file dated today.

---

## Part 7 — Start the backend

```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml up -d --build
```

First run takes **5-10 minutes** — the Rust gateway compiles from source (this is the slow part; it's
normal for it to look "stuck" while Cargo compiles). Watch it:
```bash
docker compose -f docker-compose.prod.yml logs -f
```
Ctrl+C stops watching (does NOT stop the app).

> **If the gateway build fails** with a TLS/redis compile error: that would mean the TLS feature isn't
> resolving. It shouldn't happen — the build is pinned via `Cargo.lock` and the TLS feature
> (`tokio-rustls-comp`) is standard — but if it does, `docker compose -f docker-compose.prod.yml logs
> gateway` shows the exact Cargo error to act on. This is the one build step that can't be verified
> from a Windows dev machine, so it's called out here explicitly.

When done, check all three containers:
```bash
docker compose -f docker-compose.prod.yml ps
```
You should see **3 rows** — engine, gateway, web — all `Up` / `running (healthy)`. If any shows `Exit`
or `Restarting`, go to **Troubleshooting**.

---

## Part 8 — Verify the backend works

Run these on the server, one at a time:

```bash
curl -s http://localhost/healthz
```
Expected: `ok`

```bash
curl -su YOUR_USERNAME:YOUR_PASSWORD http://localhost/api/health
```
Expected: `{"status":"ok","service":"pack-engine"}`

```bash
curl -su YOUR_USERNAME:YOUR_PASSWORD http://localhost/ws/health
```
Expected: `ok`

**All three must succeed before moving on.** The `/api/health` check proves the engine reached Neon;
if it hangs or errors, see Troubleshooting → Postgres. If `/ws/health` is fine but live streams don't
work later, that's the gateway↔Upstash link — Troubleshooting → Redis.

You can also do the full browser test against the backend directly right now: open
`http://ECS_PUBLIC_IP`, enter the Part 6c login, and you should see The Pack. But the **proper**
frontend lives on Vercel — that's Part 9.

---

## Part 9 — Deploy the frontend (Vercel, free) — this is the site people visit

The backend is now live on Alibaba. The frontend is a static site (built from `frontend/`) hosted
free on Vercel, pointed at your ECS box.

> You can instead serve the frontend from the ECS box itself (the `web` container already does this —
> just visit `http://ECS_PUBLIC_IP`). But a separate Vercel deploy is free, gives you HTTPS and a clean
> URL automatically, and keeps the ECS box small. Pick one; this part covers the Vercel path.

**The two values the frontend needs**, pointing at your ECS box:
- `VITE_ENGINE_URL` = `http://ECS_PUBLIC_IP/api`
- `VITE_GATEWAY_URL` = `ws://ECS_PUBLIC_IP/ws`

> ⚠️ **Mixed-content caveat:** Vercel serves the frontend over **HTTPS**. A browser on an HTTPS page
> will **refuse** to call a plain `http://`/`ws://` backend (mixed content blocked). So for the Vercel
> frontend to actually reach the backend, **the ECS box must have HTTPS too** (Part 10) and you'd use
> `https://…/api` and `wss://…/ws`. Until the backend has HTTPS, either (a) do your demo against the
> ECS box directly at `http://ECS_PUBLIC_IP` (the `web` container, no mixed-content issue because it's
> all HTTP), or (b) finish Part 10 first, then deploy the Vercel frontend pointing at the `https://`
> backend. **Recommended for the hackathon: do Part 10, then this part**, so the public URL is clean
> HTTPS end-to-end.

Assuming the backend has HTTPS (Part 10 done, domain e.g. `api.yourdomain.com`):

1. Go to https://vercel.com and sign up (GitHub login easiest).
2. **Add New… → Project** → import the `the-pack` GitHub repo.
3. In the import screen:
   - **Root Directory:** set to `frontend`
   - **Framework Preset:** Vite (auto-detected)
   - **Build Command:** `npm run build` (default); **Output Directory:** `dist` (default)
   - **Environment Variables** — add these two:
     | Name | Value |
     |---|---|
     | `VITE_ENGINE_URL` | `https://api.yourdomain.com/api` |
     | `VITE_GATEWAY_URL` | `wss://api.yourdomain.com/ws` |
4. Click **Deploy.** In ~1-2 minutes you get a URL like `https://the-pack-xxxx.vercel.app`.
5. **Point the backend's CORS at this URL:** back on the ECS box, edit `.env.prod`:
   ```bash
   nano ~/the-pack/deploy/.env.prod
   ```
   Set `CORS_ORIGINS=https://the-pack-xxxx.vercel.app` (your real Vercel URL), save, then:
   ```bash
   cd ~/the-pack/deploy && docker compose -f docker-compose.prod.yml restart engine
   ```
6. Open the Vercel URL, log in through the backend's Basic-auth prompt when the app first calls the
   API, and run a real hunt — confirm the canvas comes alive (wolves appear, statuses change, clicking
   one shows the live inspector). That proves the whole path: Vercel frontend → HTTPS backend on
   Alibaba → Neon + Upstash.

**Netlify or Cloudflare Pages** instead of Vercel: identical idea — set the build's root to `frontend`,
build command `npm run build`, publish/output dir `dist`, and add the same two `VITE_…` env vars.

---

## Part 10 — Add HTTPS to the backend (needed for the Vercel frontend, and before sharing any link)

You need a domain for this (any domain you own; a subdomain like `api.yourdomain.com` for the backend
is clean). If you're demoing only against the ECS box directly over `http://ECS_PUBLIC_IP` you can skip
this — but the Vercel frontend path (Part 9) requires it.

1. In your domain's DNS, add an **A record**: `api.yourdomain.com` → `ECS_PUBLIC_IP`. Wait ~10 minutes
   (check with `nslookup api.yourdomain.com` from your computer).

2. On the server:
```bash
sudo apt-get install -y certbot
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml stop web
sudo certbot certonly --standalone -d api.yourdomain.com
```
Follow the prompts (email, agree to terms). Success saves the cert to
`/etc/letsencrypt/live/api.yourdomain.com/`.

3. Edit `deploy/nginx.conf` on the server:
```bash
nano ~/the-pack/deploy/nginx.conf
```
Replace the **entire file** with (swap `api.yourdomain.com` for your real domain — 3 places):

```nginx
server {
    listen 8080;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 8443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 25m;

    auth_basic           "The Pack";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location = /healthz { auth_basic off; access_log off; add_header Content-Type text/plain; return 200 "ok\n"; }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://engine:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://gateway:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

4. Mount the cert and open 443. Edit `docker-compose.prod.yml`:
```bash
nano ~/the-pack/deploy/docker-compose.prod.yml
```
In the `web:` service, change `volumes:` and `ports:` to:
```yaml
    volumes:
      - ./.htpasswd:/etc/nginx/.htpasswd:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    ports:
      - "80:8080"
      - "443:8443"
```

5. Rebuild and restart:
```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml up -d --build
```

6. Auto-renew the cert (expires every 90 days):
```bash
sudo crontab -e
```
Pick `nano` if asked. Add at the bottom:
```
0 3 * * 1 certbot renew --quiet --deploy-hook "cd /root/the-pack/deploy && docker compose -f docker-compose.prod.yml restart web"
```
Save and exit.

Now `https://api.yourdomain.com` works with a padlock. Use `https://api.yourdomain.com/api` and
`wss://api.yourdomain.com/ws` as the two `VITE_…` values in Part 9.

---

## For the hackathon submission — proof the backend runs on Alibaba

The judges need to see the backend on Alibaba Cloud. Capture these while it's live:

- A screenshot of the **ECS instance** in the Alibaba console (region **Singapore**, status
  **Running**, the public IP visible).
- A screenshot of `docker compose -f docker-compose.prod.yml ps` on the box showing all 3 containers
  `Up`.
- The live URL working — the Vercel frontend (or `http://ECS_PUBLIC_IP` directly) running a real hunt.
- Mention in the write-up: **engine + gateway run on Alibaba Cloud ECS (Singapore); the LLM is Qwen
  via Alibaba Cloud Model Studio.** Both are Alibaba services — that's your "runs on Alibaba" proof,
  doubly so because the model itself is Qwen/DashScope.

Keep the ECS box running through the judging window. To save money outside it, **stop** (don't delete)
the instance — Alibaba only bills storage while stopped, not compute. Neon and Upstash free tiers cost
nothing regardless.

---

## Updating the app later

**On your own computer:** `git push` your changes. **On the server:**
```bash
cd ~/the-pack && git pull && cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```
Docker rebuilds only what changed (fast, unless you touched the Rust gateway, which recompiles fully).
Frontend changes redeploy automatically on Vercel when you push (if you connected the repo).

---

## Viewing logs

```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml logs -f            # everything
docker compose -f docker-compose.prod.yml logs -f engine     # Python engine — hunt/API/DB errors
docker compose -f docker-compose.prod.yml logs -f gateway    # live-stream gateway — Redis errors
docker compose -f docker-compose.prod.yml logs -f web        # nginx
```
Ctrl+C stops watching (does not stop the app).

---

## Troubleshooting

### `docker compose up` fails immediately, `web` won't start
- Almost always a missing `.htpasswd`. Run `ls -la ~/the-pack/deploy/.htpasswd`; if absent, redo
  **Part 6c**, then `docker compose -f docker-compose.prod.yml up -d --build`.

### The app doesn't load in the browser (times out / refused)
- Check the ECS **Security Group** allows inbound TCP 80 (and 443 if you did Part 10).
- `docker compose -f docker-compose.prod.yml ps` — are all 3 containers `Up`? If `web` isn't:
  `docker compose -f docker-compose.prod.yml logs web` and read the last ~20 lines.

### `curl .../api/health` fails or hangs → engine can't reach Neon Postgres
- `docker compose -f docker-compose.prod.yml logs engine` and look for `connection`, `timeout`, `ssl`,
  or `password authentication failed`.
- **"password authentication failed" / auth error:** the `POSTGRES_URL` in `.env.prod` is wrong. Most
  common causes: you left the `?sslmode=require&channel_binding=require` tail on the end (remove it —
  see Part 6b), or a character got mangled pasting into nano. Re-copy the string from Neon.
- **SSL/TLS error or "server does not support SSL":** confirm `POSTGRES_SSLMODE=require` is present in
  `.env.prod` (Neon requires it). After any fix:
  `docker compose -f docker-compose.prod.yml restart engine`
- **Hangs forever:** Neon databases on the free tier **auto-suspend when idle** and take a few seconds
  to wake on the first connection — a brief pause on the very first request is normal, not a bug. A
  permanent hang instead means a wrong host in `POSTGRES_URL`.

### Hunts don't stream live (canvas stays empty) → gateway can't reach Upstash, or browser can't reach gateway
- `docker compose -f docker-compose.prod.yml logs gateway`. If you see a Redis connect/TLS error:
  - Confirm `REDIS_URL` starts with **`rediss://`** (two s's). A plain `redis://` to Upstash is
    refused — this is the #1 cause.
  - Confirm the password in the URL matches Upstash (re-copy from the Upstash console).
- If the gateway logs are clean, the browser↔gateway hop is the issue. Open the browser devtools (F12)
  → Network → look for the `/ws/` WebSocket. If it's red/failed:
  - **On the Vercel (HTTPS) frontend:** you're almost certainly hitting the **mixed-content** block —
    an HTTPS page can't open a `ws://` (insecure) socket. The backend must be HTTPS and the frontend
    must use `wss://…/ws` (Part 10 + Part 9). This is the most common live-stream failure in this
    setup.
  - Otherwise confirm `web` is healthy in `ps` and the `/ws/` block in `nginx.conf` matches this guide.

### "Couldn't reach Alpha" / hunts never start → Qwen key
- `QWEN_API_KEY` in `.env.prod` is wrong/missing/typo'd (very long string — one wrong char breaks it).
  Re-copy from `backend/.env`. Then `docker compose -f docker-compose.prod.yml restart engine` and
  check `docker compose -f docker-compose.prod.yml logs engine | grep -i qwen`.

### The build seems frozen during the Rust compile
- Confirm the swap step in Part 5 (`free -h` shows 4 GB swap) — the Rust build is memory-hungry.
- If it's just slow, that's normal: Rust release builds take several minutes. Give it up to 15.

### Scouts always return empty results
- Search is DuckDuckGo (free, keyless) — nothing to misconfigure. If consistently empty, DuckDuckGo
  may be rate-limiting the ECS box's shared cloud IP. Check
  `docker compose -f docker-compose.prod.yml logs engine | grep -i duckduckgo`. Rare; usually
  self-resolves. Stopping/starting the ECS instance often assigns a fresh public IP.
- If `QWEN_API_KEY` is missing/wrong the app falls back to canned results entirely — check that first.

### Fix a typo in `.env.prod`
```bash
nano ~/the-pack/deploy/.env.prod       # fix, save
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml restart engine gateway
```
(Env-only changes need a restart, not a rebuild.)

### Start over cleanly
```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build
```
This does NOT touch your data — Neon and Upstash are external and untouched.

---

## Monthly cost estimate

| What | Approx. cost |
|---|---|
| **ECS server** (2 vCPU / 4 GB, Singapore) | **$25–40/month** |
| Public IP + bandwidth | $5–10/month |
| **Neon Postgres** (free tier) | **$0** |
| **Upstash Redis** (free tier) | **$0** (free tier: generous daily command limit, fine for a demo) |
| **Vercel frontend** (free tier) | **$0** |
| OSS storage (if used) | ~$1–5/month |
| Qwen AI usage | ~$0.05–$0.20 per hunt (pay per use) |
| Web search (DuckDuckGo) | Free |
| **Fixed monthly total** | **~$30–55/month** |

Roughly **half** the all-in-one-on-Alibaba cost, because Postgres and Redis moved to free external
tiers. To cut it further during the hackathon: **stop** (don't delete) the ECS instance when you're
not actively demoing — Alibaba bills only storage while stopped, not compute. Neon/Upstash/Vercel free
tiers cost nothing whether you're using them or not.
```
