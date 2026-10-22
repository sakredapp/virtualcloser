# Suite CXO self-hosted box (package v1)

Everything a client's own machine needs to run Suite CXO without Vercel or
Supabase: one `docker compose` stack, one installer, one test.

| Service | Image | What it does | Replaces |
|---|---|---|---|
| `app` | `suitecxo-app` (`app.Dockerfile`, Next.js `output: standalone`) | the Ciao chat page + dashboard | Vercel |
| `worker` | `suitecxo-worker` (`worker.Dockerfile`, `hetzner-worker/index.ts`) | background ticks (briefs, reminders, inbox) | Hetzner worker under pm2 |
| `db` | `pgvector/pgvector:pg16` + `pg_cron` (`db/Dockerfile`) | Postgres 16, vector search | Supabase DB |
| `migrate` | same as `db`, one-shot | applies `supabase/*.sql` in `db/migrations.txt` order; new files only on later boots | Supabase migrations |
| `postgrest` | `postgrest/postgrest:v12` | the REST API `@supabase/supabase-js` calls, behind Caddy's internal `:8000/rest/v1` | Supabase API |
| `caddy` | `caddy:2.8` | HTTPS on the office network with the box's own CA (`tls internal`) | Vercel edge |
| `ofelia` | `mcuadros/ofelia` | calls `/api/cron/*` with `CRON_SECRET` (`ofelia/config.ini`) | Vercel crons |
| `backup` | `suitecxo-backup` (restic + pg_dump) | nightly encrypted backup to a second disk or S3 | Supabase backups |
| `health` | `node:22-alpine` + `health/agent.mjs` | app, API, worker heartbeat, disk; `127.0.0.1:8099/health`, optional POST to us | cron_heartbeats |
| `ollama` | profile `local-llm` | the local model on a GPU box | OpenRouter |
| `tailscale` | profile `remote` | our outbound-only management tunnel | — |

The app needs no code change: it already reads one Supabase URL + service key
and one OpenAI-compatible AI endpoint (`OPENROUTER_CHAT_URL`). The Vercel build
is untouched; `next.config.selfhost.mjs` is used only inside the image.

## Install on a client box

Fresh Ubuntu 24.04+ (disk encrypted, ufw on, SSH keys only), then as root:

```bash
git clone https://github.com/sakredapp/virtualcloser.git /opt/suitecxo
cd /opt/suitecxo
BOX_ID=acme-01 SITE_HOST=192.168.1.50 BACKUP_DIR=/mnt/backup/suitecxo bash selfhost/install.sh
bash selfhost/golden-test.sh
```

`install.sh` installs Docker (Ubuntu's `docker.io`, `docker-compose-v2`,
`docker-buildx`), writes `selfhost/.env` from `.env.example` with fresh random
secrets (chmod 600, never printed), builds the images, starts the stack and waits
for the health agent. The admin password lands in `selfhost/.admin-password`
(root-only): copy it to the client's build sheet in our password manager, then
delete the file. Real secrets live only in the box's `.env` and the build sheet,
never in git or the vault.

### AI
v1 points at OpenRouter (`LLM_BASE_URL`, `LLM_API_KEY`). On a GPU box:

```bash
docker compose --profile local-llm up -d ollama
docker compose exec ollama ollama pull <model>
# .env: LLM_BASE_URL=http://ollama:11434/v1 ; then docker compose up -d app worker
```
Open item: `lib/aiProvider.ts` only accepts `openrouter:` GLM ids, so a local
model id needs a small guard change before Ciao answers from Ollama.

### Remote access (ours, revocable by the client)
Put a one-off tailnet key in `TS_AUTHKEY`, then `docker compose --profile remote up -d tailscale`.
The client cuts us off with `docker compose --profile remote stop tailscale`, or by
removing the box from the tailnet. No auth key is ever committed.

### Backups
`backup` runs `backup.sh` on `BACKUP_CRON` (default 02:30). Check a restore any time:
`docker compose exec backup restore-check.sh` (restores the newest snapshot into a
scratch database, compares table counts, drops it).

## Day-2

| Do | Command |
|---|---|
| status | `docker compose ps` and `curl -s 127.0.0.1:8099/health` |
| update | `git pull && docker compose build && docker compose up -d` (migrate applies new SQL) |
| logs | `docker compose logs --tail 100 app worker` |
| stop (keeps data) | `docker compose stop` |
| remove (keeps data volumes) | `docker compose down` |

## Notes and limits (v1)
- Docker publishes ports past ufw. Only Caddy (on `BIND_ADDR`) and the health agent (on 127.0.0.1) publish.
- Every container has a CPU and memory limit (about 7 GB total).
- The app routes `localhost` and bare IPs to Suite CXO (`LOCAL_BRAND=cxo`). A named host such as `ciao.acme.local` needs a host mapping in `lib/brand.ts` (open item).
- The Pinnacle Airtable cron is not scheduled on a box. Whop, Resend/SES, Fathom, Telegram and Tavily stay off unless set in `.env`.
- Compliance: infra only. No lead data flows change; the box keeps a client's data on the client's machine.
