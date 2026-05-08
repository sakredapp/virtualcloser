# Campaign Worker — Hetzner Deployment

## Server setup (one-time)

```bash
# On a Hetzner CX11 ($4.51/mo) running Ubuntu 22.04
apt update && apt upgrade -y
apt install -y git nodejs npm

# Install global tools
npm install -g pm2 tsx

# Clone the repo
git clone https://github.com/sakredapp/virtualcloser.git /app
cd /app
npm install
```

## Environment

Create `/app/.env.production` with the same vars as your Vercel project:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
REVRING_API_KEY=rr_...
SMS_AI_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=...       # optional — only if not per-rep in DB
TWILIO_AUTH_TOKEN=...        # optional
CAMPAIGN_TICK_MS=30000       # 30s tick (adjust as needed)
```

## Start the worker

```bash
cd /app
pm2 start hetzner-worker/ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

## Useful commands

```bash
pm2 status                   # see if worker is running
pm2 logs campaign-worker     # tail live logs
pm2 restart campaign-worker  # restart after a deploy
pm2 stop campaign-worker     # pause without removing
```

## Deploy updates

```bash
cd /app
git pull origin main
npm install                  # if dependencies changed
pm2 restart campaign-worker
```

Or use the GitHub Actions workflow at `.github/workflows/deploy-worker.yml` to auto-deploy on push to main.

## Cost

- Hetzner CX11: ~$4.51/mo
- Handles ~10,000 active campaigns with 30s ticks comfortably
- Scale to CX21 ($8.81/mo) for 50k+ active campaigns
