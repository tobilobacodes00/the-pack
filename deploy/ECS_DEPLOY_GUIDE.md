# Deploying The Pack to Alibaba Cloud ECS — solo runbook

This is a **complete, standalone, do-it-yourself guide**. Every command is copy-pasteable. Every step
says exactly what you should see when it works, and what to do if it doesn't. You do not need to ask
anyone anything to get through this — if something doesn't match what's described, the
**Troubleshooting** section at the bottom covers it.

Follow the parts **in order, top to bottom, without skipping**. Do not jump to Part 8 before Part 7 is
fully done — the order matters and is deliberately different from a first-draft version of this guide
(a password-file step was moved earlier so the app doesn't fail to start on first launch).

---

## What you're building

```
Browser  →  ECS box (nginx : password-gated, port 80/443)
                ├─→ /api/  → engine container   (Python, port 8000)  →  RDS Postgres (managed)
                └─→ /ws/   → gateway container   (Rust,   port 8080)  →  Tair/Redis   (managed)
```

Three containers on one ECS server (engine, gateway, nginx/web). Postgres and Redis are **managed
Alibaba Cloud services**, not containers — you create them once in the console and they run
themselves.

---

## Before you start — what you need

- [ ] An Alibaba Cloud account with billing enabled
- [ ] A **working Qwen API key** — you already have one, confirmed live and working:
      it is currently in `backend/.env` on this machine, starts `sk-ws-H.XHRRLX...`
      (copy the FULL value from that file when you get to Part 7 — never re-type it by hand)
- [ ] This codebase, pushed to GitHub (it already is — `tobiloba/engine-spine` branch, confirmed
      pushed and clean as of this guide being written)

No other API key or account is needed. Web search runs on DuckDuckGo — free, keyless, nothing to
sign up for.
- [ ] ~30–45 minutes, most of which is waiting for cloud resources to provision

---

## Part 1 — Create the database (RDS Postgres)

1. Log into the Alibaba Cloud console → https://home.console.aliyun.com
2. In the top search bar, type **"RDS"** → click **ApsaraDB RDS**
3. Click **Create Instance** (sometimes labeled "Buy Instance")
4. Fill in exactly:
   - **Billing method:** Pay-As-You-Go (safest to start — you can switch to a subscription later)
   - **Region:** **Singapore** — this is critical, every piece must be in the same region
   - **Engine:** PostgreSQL
   - **Version:** 16 (or the newest 16.x offered)
   - **Edition/Category:** Basic Edition / Single-node (the cheapest option — this is a demo/small
     production box, not a high-availability cluster)
   - **Instance class:** look for something like `pg.n2.small.1` — 1 vCPU / 2 GB. If that exact name
     isn't shown, pick the smallest/cheapest class listed.
   - **Storage:** 20 GB, ESSD (Enhanced SSD) or standard SSD, whichever is offered
   - **Network:** it will ask you to pick or create a **VPC** — if none exists, let it auto-create one
     called something like `vpc-default`. **Write down the VPC name/ID** — the ECS server in Part 3
     MUST use this same VPC.
5. Click through to the order/payment page, confirm, and click **Create**. It takes **3-5 minutes** to
   go from "Creating" to "Running" — you'll see the status change in the instance list. Wait for it.

**Once the instance shows status "Running":**

6. Click the instance's ID/name to open it → find the **Accounts** tab in the left menu
   - Click **Create Account**
   - **Database Account Name:** `pack`
   - **Account Type:** Privileged Account (or "Standard Account" if Privileged isn't offered)
   - **Password:** click "Generate Random Password" or type a strong one yourself.
     **Write it down right now** — you cannot view it again later, only reset it.
   - Confirm.

7. Find the **Databases** tab
   - Click **Create Database**
   - **Database Name:** `pack`
   - **Character Set:** UTF8 (default is fine)
   - **Authorized Account:** select the `pack` account you just made, grant it "Read/Write" access
   - Confirm.

8. Find the **Database Connection** tab (sometimes just "Connection")
   - You'll see an **Internal Endpoint** (also called "VPC endpoint") that looks like:
     `pgm-xxxxxxxxxxxxxxxxx.pg.rds.aliyuncs.com`
   - **Copy this exact string and save it somewhere.** This is your `POSTGRES_HOST` for later.
   - Ignore any "Public Endpoint" — you will NOT use it (the ECS server talks to RDS over the
     internal/VPC network only, which is faster and free).

**Write these three things down before moving on** (you will paste them into a config file later):
```
POSTGRES_HOST = <the internal endpoint from step 8>
POSTGRES_PASSWORD = <the password from step 6>
```
(username is `pack`, database name is `pack` — both fixed by what you typed above)

---

## Part 2 — Create the cache (Tair / Redis)

1. In the console search bar, type **"Tair"** → click **ApsaraDB for Redis (Tair)**
2. Click **Create Instance**
3. Fill in:
   - **Billing method:** Pay-As-You-Go
   - **Region:** Singapore — **same region as Part 1**
   - **Instance Type / Series:** "Tair Standard Edition" or "Redis Open-Source Edition" — whichever
     wording your console shows, choose the **Community/Open-Source-compatible, non-cluster** option
   - **Engine version:** Redis 7.0 (or closest available: 6.0 also works)
   - **Architecture:** Standard / Single-node (not cluster)
   - **Capacity:** 1 GB
   - **Network:** pick the **SAME VPC** you used (or that was auto-created) in Part 1. This step is
     easy to miss and if you get it wrong the server won't be able to reach Redis at all — double
     check the VPC name/ID matches.
4. Confirm and create. Takes **~3 minutes** to go from "Creating" to "Running".

**Once running:**

5. Click the instance → find **Account Management** or **Security** in the left menu
   - Set a password (if the console calls it "Instance Account Password" or similar, that's it)
   - **Write it down.**

6. Find the **Instance Information** or **Connection Information** tab
   - Copy the **Internal Endpoint** — looks like `r-xxxxxxxxxxxxxxxx.singapore.redis.rds.aliyuncs.com`
     (the exact domain pattern varies; the important part is it's the INTERNAL one, not public)
   - **Save it.**

**Write these down:**
```
REDIS_HOST = <the internal endpoint from step 6>
REDIS_PASSWORD = <the password from step 5>
```

---

## Part 2.5 — Create the file store (OSS) — optional but recommended

Without this, forged files (PDF/DOCX/etc. the pack produces) are stored on the ECS server's own disk
instead of cloud storage. The app works fine either way — this just makes it more robust and is worth
doing since you're already deploying on Alibaba.

1. Search **"OSS"** → click **Object Storage Service** → **Buckets** → **Create Bucket**
2. Fill in:
   - **Bucket Name:** `pack-artifacts` (must be globally unique across ALL of Alibaba Cloud — if
     taken, add your own suffix, e.g. `pack-artifacts-autrans`)
   - **Region:** Singapore — same as everything else
   - **Storage Class:** Standard
   - **ACL (Access Control):** Private — leave it private, the app reads/writes it directly with keys
3. Click **Create**.

**Make an access key for the app to use:**

4. Search **"RAM"** → click **RAM Access Control** → **Users** (left menu) → **Create User**
   - **Logon Name:** `pack-oss-user` (anything descriptive)
   - Under **Access Mode**, tick **OpenAPI Access** (this is what generates API keys — do NOT tick
     "Console Password Logon", you don't need that)
   - Click **OK / Create**
   - A popup shows an **AccessKey ID** and **AccessKey Secret** — **copy BOTH right now**, the secret
     is shown exactly once and cannot be retrieved again (only reset).

5. Grant that user permission to use the bucket:
   - Still on the Users page, click the user you just made → **Add Permissions**
   - Search for and attach the policy **`AliyunOSSFullAccess`**
   - Confirm.

**Write these down:**
```
OSS_BUCKET = pack-artifacts   (or whatever suffix you used)
OSS_ENDPOINT = https://oss-ap-southeast-1.aliyuncs.com
OSS_ACCESS_KEY_ID = <from step 4>
OSS_ACCESS_KEY_SECRET = <from step 4>
```

**Skipping OSS?** That's fine — just leave these four blank in Part 7 later, and move on.

---

## Part 3 — Create the server (ECS)

1. Search **"ECS"** → click **Elastic Compute Service** → **Instances** → **Create Instance**
2. Fill in:
   - **Billing Method:** Pay-As-You-Go
   - **Region:** Singapore — **same as everything above, this is non-negotiable**
   - **Instance Type:** search/filter for `ecs.c6.xlarge` (4 vCPU / 8 GB RAM). If that exact type
     isn't available in your account, pick any 4 vCPU / 8 GB (or bigger) general-purpose type. Do
     **not** go below 4 GB RAM — the Rust gateway needs real memory to compile on first build.
   - **Image:** Public Image → **Ubuntu** → **22.04 64-bit**
   - **Storage (System Disk):** 40 GB, Enhanced SSD (ESSD) if offered, otherwise standard SSD
   - **Network — VPC:** the **SAME VPC** as Parts 1 and 2. This is the single most important setting
     on this whole page — if the ECS box is in a different VPC than RDS/Tair, it cannot reach them
     over the internal network and nothing will work.
   - **Public IP:** tick **"Assign Public IP"** — you need this to reach the app and to SSH in.
     Set the bandwidth to something modest like 5 Mbps pay-by-traffic (cheap, fine for a demo).
   - **Security Group:** click "Create Security Group" (or use an existing one) with these inbound
     rules — add all three:
     | Protocol | Port | Source |
     |---|---|---|
     | TCP | 22 | 0.0.0.0/0 (or your own IP only, if you know it — safer) |
     | TCP | 80 | 0.0.0.0/0 |
     | TCP | 443 | 0.0.0.0/0 |
   - **Logon Credentials:** choose **Password**, set a strong root password, **write it down**.
     (An SSH key pair is more secure if you already know how to use one — either works for this
     guide; the commands below use password login since that's the lower-friction path solo.)
3. Confirm the order and click **Create Instance**. Takes **1-3 minutes** to reach "Running".

**Once running:**

4. On the instance list, copy the **Public IP Address** shown next to your instance.
5. Click into the instance → find the **Private IP Address** (also shown on the overview page).

**Write these down:**
```
ECS_PUBLIC_IP = <from step 4>
ECS_PRIVATE_IP = <from step 5>
ECS_ROOT_PASSWORD = <from step 2, Logon Credentials>
```

### Whitelist the server in RDS and Tair (do this now — easy to forget)

Without this, the ECS box's database/cache connections will just hang or refuse.

**RDS:**
- Go back to your RDS instance (Part 1) → left menu → **Whitelist Settings** (or "Security"  →
  "Whitelist")
- Click **Add Whitelist Group** (or edit the default group)
- Add the **ECS_PRIVATE_IP** you just copied (you can add it as `ECS_PRIVATE_IP/32` or just the bare
  IP, depending on what the form accepts)
- Save.

**Tair:**
- Go back to your Tair instance (Part 2) → **Whitelist Settings**
- Same thing: add `ECS_PRIVATE_IP`
- Save.

If you skip this, you will see "connection timed out" errors from the engine later — see
Troubleshooting if that happens.

---

## Part 4 — Get your API key ready

You already have a **working, verified Qwen key** — it's the one confirmed live in this session,
currently saved in `backend/.env` on your computer starting with `sk-ws-H.XHRRLX...`. When you get to
Part 7, open that file and copy the **full** key value (do not retype it — one wrong character and
every hunt fails).

That's the only key you need. Web search runs on DuckDuckGo (free, keyless) — nothing to sign up
for, no other account needed.

---

## Part 5 — Connect to your server

**On your own computer**, open a terminal (PowerShell on Windows works fine) and run:

```bash
ssh root@ECS_PUBLIC_IP
```

Replace `ECS_PUBLIC_IP` with the real IP from Part 3. It will ask:
```
Are you sure you want to continue connecting (yes/no)?
```
Type `yes`, press Enter. Then it asks for the root password — paste/type the one from Part 3.

You should now see a prompt like `root@iZxxxxxxx:~#` — you are now IN the server.

**Everything from here through Part 9 runs ON THE SERVER**, inside this SSH session, unless a step
explicitly says "on your own computer".

### Install Docker

Copy this **whole block** and paste it in one go, then press Enter and wait (~1-2 minutes):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg apache2-utils
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

(Note: this installs `apache2-utils` **now**, alongside Docker — that gives you the `htpasswd` tool
you'll need in Part 7, before the app's first startup, not after.)

Verify it worked:
```bash
docker --version
docker compose version
```
You should see version numbers for both (any version is fine, don't worry about exact numbers).

### Add swap space (prevents the Rust build from running out of memory)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Verify: `free -h` should show a `Swap:` row with `4.0Gi` total.

---

## Part 6 — Get the code onto the server

The code is already on GitHub. On the server, run:

```bash
cd ~
git clone https://github.com/tobilobacodes00/the-pack.git
cd the-pack
git checkout tobiloba/engine-spine
```

You should see it clone successfully and then `git checkout` confirms you're on that branch.
Double-check:
```bash
git branch --show-current
```
Should print: `tobiloba/engine-spine`

**If the repo is private** and `git clone` asks for a username/password (GitHub no longer accepts
plain passwords) — the simplest solo-friendly fix: generate a GitHub Personal Access Token
(https://github.com/settings/tokens → "Generate new token (classic)" → tick `repo` scope → generate),
then clone with the token as the password:
```bash
git clone https://YOUR_GITHUB_USERNAME:YOUR_TOKEN@github.com/tobilobacodes00/the-pack.git
```

---

## Part 7 — Configure secrets AND create the password file (in this order)

### 7a — Create the production env file

```bash
cd ~/the-pack/deploy
cp .env.prod.example .env.prod
nano .env.prod
```

This opens a text editor. Use arrow keys to move around. When done editing, press **Ctrl+X**, then
**Y**, then **Enter** to save and exit.

Replace these lines with your real values (everything else in the file can stay as the template has
it — it already ships correct, verified defaults):

```
QWEN_API_KEY=sk-ws-H.XHRRLX...                    ← the FULL key from backend/.env on your computer

POSTGRES_URL=postgresql://pack:POSTGRES_PASSWORD@POSTGRES_HOST:5432/pack
                                                    ← use the values you wrote down in Part 1
                                                       (POSTGRES_PASSWORD and POSTGRES_HOST)

REDIS_URL=redis://:REDIS_PASSWORD@REDIS_HOST:6379/0
                                                    ← use the values from Part 2
                                                       (note the colon right after redis:// — that's
                                                        correct syntax for a password with no username)

SESSION_SECRET=                                    ← generate one:
```
Generate that value by running this in a **second terminal window** (or exit nano first with Ctrl+X,
run the command, then `nano .env.prod` again to paste it in):
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```
Copy the long hex string it prints, paste it as the value of `SESSION_SECRET`.

Do the exact same thing for `API_AUTH_TOKEN` — run the same command again (it prints a different
random value each time) and paste the new result there.

```
CORS_ORIGINS=https://YOUR_DOMAIN_OR_IP             ← if you don't have a domain yet, use
                                                       http://ECS_PUBLIC_IP for now; you can change
                                                       this later once you have a real domain
```

If you did Part 2.5 (OSS), also fill in:
```
OSS_BUCKET=pack-artifacts
OSS_ENDPOINT=https://oss-ap-southeast-1.aliyuncs.com
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
```
If you skipped OSS, leave those four lines exactly as `replace-me` / blank — the app falls back to
local disk storage automatically.

**Before saving, also check the pricing block** (`PRICE_MAX_IN_PER_M` etc.) — the template ships
realistic defaults that are almost certainly fine to launch with. Only revisit this if you later
notice hunts costing very differently from what the app predicts.

Save and exit (Ctrl+X, Y, Enter).

### 7b — Create the password file (BEFORE starting the app — this is the step order fix)

The app will **refuse to start** without this file, because `nginx.conf` requires it. Create it now,
not after:

```bash
cd ~/the-pack/deploy
htpasswd -bc .htpasswd YOUR_USERNAME YOUR_PASSWORD
```
Replace `YOUR_USERNAME` and `YOUR_PASSWORD` with real values you choose (e.g.
`htpasswd -bc .htpasswd packmaster Sunset2026!`). This is the login prompt anyone visiting your site
will see — pick something real, not `test`/`test`.

Verify the file exists:
```bash
ls -la .htpasswd
```
You should see a file listed with today's date.

---

## Part 8 — Start the app

```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml up -d --build
```

This will take **5-10 minutes** the first time (the Rust gateway compiles from source — this is the
slow part, be patient, it is normal for it to look "stuck" while Cargo compiles).

Watch it build:
```bash
docker compose -f docker-compose.prod.yml logs -f
```
Press **Ctrl+C** to stop watching (this does NOT stop the app — the app keeps running in the
background either way).

When it's done, check all three containers are up:
```bash
docker compose -f docker-compose.prod.yml ps
```
You should see **3 rows** — `the-pack-engine-1`, `the-pack-gateway-1`, `the-pack-web-1` (exact naming
may vary slightly) — all showing **`Up`** or **`running (healthy)`** in the STATUS column.

If any row shows `Exit` or `Restarting`, go to **Troubleshooting** below before continuing.

---

## Part 9 — Verify it actually works

Run these on the server, one at a time:

```bash
curl -s http://localhost/healthz
```
Expected: `ok`

```bash
curl -su YOUR_USERNAME:YOUR_PASSWORD http://localhost/api/health
```
(use the username/password from Part 7b)
Expected: `{"status":"ok","service":"pack-engine"}`

```bash
curl -su YOUR_USERNAME:YOUR_PASSWORD http://localhost/ws/health
```
Expected: `ok`

**All three must succeed before you move on.** If any fails, see Troubleshooting.

### Test it in a real browser

1. On your own computer, open a browser and go to `http://ECS_PUBLIC_IP`
2. It will prompt for a username/password — enter what you set in Part 7b
3. You should see The Pack's landing page
4. Start a real hunt (type a task, let Alpha launch it) — confirm you see the **canvas come alive**:
   wolves appear, their status changes, and clicking one shows the inspector card with live activity.
   This proves the WebSocket gateway, the event stream, and the whole engine pipeline all work
   end-to-end on the real server.
5. When the hunt finishes, try downloading the brief as a PDF — this proves file generation and (if
   you set it up) OSS storage work.

**If the browser hangs on "connecting" or the canvas never updates:** the WebSocket isn't reaching the
gateway — see Troubleshooting → "Hunts don't stream live".

---

## You are now live — but read this before sharing the link

> ⚠️ Right now the app is protected by the username/password from Part 7b, but the connection is
> **plain HTTP, not HTTPS** — anyone on the network path between the browser and your server (e.g. on
> shared wifi) could theoretically see the password in transit. This is acceptable for **you testing
> it alone right now**. Before sharing the link with anyone else, do Part 10 (HTTPS) below.

---

## Part 10 — Add HTTPS (do this before sharing the link with anyone)

You need a domain name for this (a free one works, e.g. from Freenom, or any domain you own). If you
don't have one yet, you can safely skip this part for now and come back to it — the app is already
functional and password-gated over plain HTTP.

1. In your domain's DNS settings, add an **A record**: `yourdomain.com` → `ECS_PUBLIC_IP`. Wait
   ~10 minutes for DNS to propagate (check with `nslookup yourdomain.com` from your own computer).

2. On the server:
```bash
sudo apt-get install -y certbot
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml stop web
sudo certbot certonly --standalone -d yourdomain.com
```
Follow the prompts (enter your email, agree to terms). When it succeeds you'll see a message
confirming the certificate was saved to `/etc/letsencrypt/live/yourdomain.com/`.

3. Edit `deploy/nginx.conf` on the server:
```bash
nano ~/the-pack/deploy/nginx.conf
```
Replace the **entire file contents** with:

```nginx
server {
    listen 8080;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 8443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

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
Replace **every occurrence of `yourdomain.com`** with your real domain (there are 3). Save (Ctrl+X, Y,
Enter).

4. Edit `docker-compose.prod.yml` to mount the certificate and open port 443:
```bash
nano ~/the-pack/deploy/docker-compose.prod.yml
```
Find the `web:` service's `volumes:` and `ports:` sections and change them to:
```yaml
    volumes:
      - ./.htpasswd:/etc/nginx/.htpasswd:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    ports:
      - "80:8080"
      - "443:8443"
```
Save.

5. Also update `CORS_ORIGINS` in `.env.prod` to your real `https://yourdomain.com`:
```bash
nano ~/the-pack/deploy/.env.prod
```
(change the `CORS_ORIGINS` line, save)

6. Rebuild and restart:
```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml up -d --build
```

7. Set up auto-renewal (certificates expire every 90 days):
```bash
sudo crontab -e
```
If it asks which editor, pick `nano` (option 1). Add this line at the bottom of the file:
```
0 3 * * 1 certbot renew --quiet --deploy-hook "cd /root/the-pack/deploy && docker compose -f docker-compose.prod.yml restart web"
```
Save and exit (Ctrl+X, Y, Enter).

Now visit `https://yourdomain.com` — it should work, with a padlock in the browser, and redirect any
plain `http://` visit to `https://` automatically. **It is now safe to share the link.**

---

## Updating the app later (after you make code changes)

**On your own computer:** push your changes to GitHub as normal (`git push`).

**On the server:**
```bash
cd ~/the-pack
git pull
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```
Docker only rebuilds what actually changed, so this is usually fast (30 seconds to 2 minutes) unless
you changed the Rust gateway code, which always recompiles fully.

---

## Viewing logs (whenever something looks wrong)

```bash
cd ~/the-pack/deploy

# everything, live
docker compose -f docker-compose.prod.yml logs -f

# just the Python engine (most useful — this is where hunt/API errors show up)
docker compose -f docker-compose.prod.yml logs -f engine

# just the live-stream gateway
docker compose -f docker-compose.prod.yml logs -f gateway

# just nginx/web
docker compose -f docker-compose.prod.yml logs -f web
```
Ctrl+C to stop watching (does not stop the app).

---

## Troubleshooting

### `docker compose up` fails immediately, `web` container won't start
- Almost always means `.htpasswd` is missing. Run: `ls -la ~/the-pack/deploy/.htpasswd`
- If it's not there, go back to **Part 7b** and create it, then re-run `docker compose up -d --build`.

### The app doesn't load in the browser at all (times out / connection refused)
- Check the ECS **Security Group** allows inbound TCP port 80 (and 443 if you did Part 10) — go to
  the ECS console → your instance → Security Groups → confirm the rules from Part 3 are there.
- On the server: `docker compose -f docker-compose.prod.yml ps` — are all 3 containers `Up`?
- If `web` isn't up: `docker compose -f docker-compose.prod.yml logs web` and read the last ~20 lines.

### `curl http://localhost/api/health` fails or hangs
- The engine container likely can't reach Postgres. Check:
  `docker compose -f docker-compose.prod.yml logs engine` — look for `connection`, `timeout`, or
  `password authentication failed`.
- **"connection timed out" or hangs forever:** your RDS whitelist doesn't include the ECS server's
  PRIVATE IP (not public — private). Go back to Part 3's whitelist step and confirm the private IP is
  listed in the RDS instance's Whitelist Settings.
- **"password authentication failed":** the password in `POSTGRES_URL` inside `.env.prod` doesn't
  match what you set in Part 1. Re-check for typos (nano can be finicky with copy-paste — make sure no
  extra spaces or line breaks got pasted in). After fixing:
  `docker compose -f docker-compose.prod.yml restart engine`

### "Couldn't reach Alpha" error in the chat / hunts never start
- Your `QWEN_API_KEY` in `.env.prod` is wrong, missing, or has a typo (it's a very long string — one
  wrong character breaks it). Re-copy it exactly from `backend/.env` on your own computer.
- After fixing: `docker compose -f docker-compose.prod.yml restart engine`
- Check it took effect: `docker compose -f docker-compose.prod.yml logs engine | grep -i qwen`

### Hunts don't stream live (canvas stays empty, wolves never appear)
- This means the gateway can't reach Redis, OR the browser can't reach the gateway.
- First check: `docker compose -f docker-compose.prod.yml logs gateway` — if you see a Redis
  connection error, your Tair whitelist is missing the ECS private IP (same fix as the RDS case
  above, but on the Tair instance instead), or `REDIS_URL` in `.env.prod` has a typo.
- If the gateway logs look clean, open your browser's developer console (F12) while on the site and
  look at the Network tab for a `/ws/` connection — if it shows a failed/red WebSocket connection,
  double check `docker compose -f docker-compose.prod.yml ps` shows the `web` container healthy and
  re-check the `/ws/` block in `nginx.conf` matches exactly what's in this guide.

### The build takes forever or the server seems to freeze during build
- Confirm you did the swap-space step in Part 5 — the Rust build is memory-hungry and an 8 GB box
  without swap can thrash. Check with `free -h` (should show 4 GB swap).
- If it's just slow (not frozen), that's normal — Rust release builds genuinely take several minutes.
  Give it up to 15 minutes before assuming something's wrong.

### Scouts always return empty/fake search results
- Search is DuckDuckGo (free, keyless) — there's no key to misconfigure. If results are consistently
  empty, DuckDuckGo itself may be rate-limiting or blocking the ECS box's IP (this can happen on
  shared cloud IP ranges). Check `docker compose -f docker-compose.prod.yml logs engine | grep -i
  duckduckgo` for errors. This is rare and usually resolves itself; if it persists, the ECS box's
  outbound IP may need to be rotated (stop/start the instance often assigns a new public IP).
- If QWEN_API_KEY itself is missing/wrong, the app falls back to canned results entirely (no real
  search AND no real model) — check that first, it's the more common cause.

### You made a typo in `.env.prod` and need to fix it
```bash
nano ~/the-pack/deploy/.env.prod
```
Fix the line, save (Ctrl+X, Y, Enter), then:
```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml restart engine gateway
```
(You don't need to rebuild for an env-only change — just restart.)

### You want to start completely over
```bash
cd ~/the-pack/deploy
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build
```
This does NOT delete your data (Postgres/Redis are separate managed services, untouched by this).

---

## Monthly cost estimate (Singapore region)

| What | Approx. cost |
|---|---|
| ECS server (4 vCPU / 8 GB) | $60–80/month |
| RDS Postgres (1 vCPU / 2 GB) | $25–35/month |
| Tair/Redis (1 GB) | $15–20/month |
| Public IP + bandwidth | $5–10/month |
| OSS storage (if used) | ~$1–5/month for typical use |
| Qwen AI usage | ~$0.05–$0.20 per hunt (pay only for what you use) |
| Web search (DuckDuckGo) | Free, no limit |
| **Fixed monthly total** | **~$105–150/month** |

You can reduce this significantly by stopping the ECS instance (not deleting) when you're not actively
demoing — Alibaba only charges for storage while stopped, not compute. RDS/Tair keep billing while
running regardless (they don't have a "stopped" state for Pay-As-You-Go the same way).
