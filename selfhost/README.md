# Suite CXO self-hosted box (package v1)

Everything a client's own machine needs to run Suite CXO without Vercel or
Supabase: one `docker compose` stack, one installer, one test.

| Service | Image | What it does | Replaces |
|---|---|---|---|
| `app` | `suitecxo-app` (`app.Dockerfile`, Next.js `output: standalone`) | the Ciao chat page + dashboard | Vercel |
| `worker` | `suitecxo-worker` (`worker.Dockerfile`, `hetzner-worker/index.ts`) | background ticks (briefs, reminders, inbox) | Hetzner worker under pm2 |
| `db` | `pgvector/pgvector:pg16` + `pg_cron` (`db/Dockerfile`) | Postgres 16, vector search | Supabase DB |
| `migrate` | same as `db`, one-shot | fresh box: applies `db/baseline.sql` (the live schema, no rows); every boot: applies the files listed after `# baseline` in `db/migrations.txt`, once each | Supabase migrations |
| `postgrest` | `postgrest/postgrest:v12` | the REST API `@supabase/supabase-js` calls, behind Caddy's internal `:8000/rest/v1` | Supabase API |
| `caddy` | `caddy:2.8` | HTTPS on the office network with the box's own CA (`tls internal`) | Vercel edge |
| `ofelia` | `mcuadros/ofelia` | calls `/api/cron/*` with `CRON_SECRET` (`ofelia/config.ini`) | Vercel crons |
| `backup` | `suitecxo-backup` (restic + pg_dump) | nightly encrypted backup to a second disk or S3 | Supabase backups |
| `health` | `node:22-alpine` + `health/agent.mjs` | app, API, worker heartbeat, disk; `127.0.0.1:8099/health`, optional POST to us | cron_heartbeats |
| `ollama` | profile `local-llm` | the local model on a GPU box | OpenRouter |
| `tailscale` | profile `remote` | our outbound-only management tunnel | — |
| `mailpit` | profile `mailtest` | test-only mail catcher for `golden-test.sh` | — |

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

### Email (the client's own mailbox)
The box has no Resend or SES. With `SMTP_HOST` set, every email the app sends
goes through `lib/emailSmtp.ts` (Nodemailer) from `SMTP_FROM`, an address on the
client's own domain (Microsoft 365 `smtp.office365.com:587`, Google
`smtp.gmail.com:587` with an app password, or their relay). Blank `SMTP_HOST` =
the box sends no mail. It only switches on where `SELFHOST=1` (set by compose),
so Vercel is unaffected. Prove it on the box:

```bash
MAIL_TEST_TO=it@client.com bash selfhost/golden-test.sh     # sends one real test email
```
The build-box test uses the `mailtest` profile instead (`SMTP_HOST=mailpit`,
`SMTP_PORT=1025`, `docker compose --profile mailtest up -d mailpit`).

### Remote access (ours, revocable by the client)
Put a one-off tailnet key in `TS_AUTHKEY`; `install.sh` then starts the `remote` profile
(or run `docker compose --profile remote up -d tailscale`). The box joins as
`suitecxo-<BOX_ID>`. The client cuts us off with `docker compose --profile remote stop tailscale`,
or by removing the box from the tailnet. No auth key is ever committed; keys are made in
the Suite CXO tailnet admin (vault: Secrets & Access) as one-off, pre-approved, tagged `tag:suitecxo-box`.

### Fleet check-in (ours)
The `health` agent posts the box's health to `HEALTH_REPORT_URL` every minute, signed with the
box's licence (no extra secret). Suite CXO keeps one row per box in `private_server_boxes`;
`private_server_box_status` adds `health` (`ok`, `failing`, or `offline` after 10 quiet minutes)
and licence days left. The report holds check names, timings and errors only, never client data.
`curl -s 127.0.0.1:8099/health` shows the last post under `report`. Blank the URL to stop it.

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

## Schema: why a baseline
`supabase/*.sql` is not a full history (some live tables, e.g. `plaud_notes`,
`onboarding_tokens`, were made outside the repo), so a fresh replay fails. 
`db/baseline.sql` is the live Suite CXO public schema (tables, constraints,
functions, indexes, triggers, RLS; schema only, no rows), generated read-only from
the catalogs with `db/baseline-generate.sql`. New migrations are appended BELOW the
`# baseline` line in `db/migrations.txt` (the vitest guard fails if one is missing).
Regenerate the baseline when the list below the line gets long.

## AI on the client's own model

By default Ciao uses OpenRouter (`LLM_API_KEY`). For a client whose data may not leave the building, set
`LOCAL_LLM_URL` and `LOCAL_LLM_MODEL` in `.env` and Ciao talks only to a model server on their network:

- **Bundled Ollama:** `LOCAL_LLM_URL=http://ollama:11434/v1`. `install.sh` starts the `local-llm` profile and pulls
  `LOCAL_LLM_MODEL`. On an NVIDIA box, uncomment the GPU reservation on `ollama` and set `OLLAMA_MEMORY`.
- **vLLM (or any OpenAI-compatible server):** point `LOCAL_LLM_URL` at its `/v1` base; `LOCAL_LLM_API_KEY` if it asks for one.
- Pictures need `LOCAL_LLM_VISION_MODEL`; without one they are refused with a clear message.
- Claude, Anthropic and Haiku models are refused here too. The model name is internal: clients only ever see "Ciao".
- Prove it: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<box>/api/cron/selfhost-ai-test` answers
  `{"ok":true,"provider":"local",...}`; `golden-test.sh` check 13 does the same.

## Notes and limits (v1)
- Building the app image needs internet (next/font fetches Google fonts; the build retries 3 times). The built image runs offline.
- Docker publishes ports past ufw. Only Caddy (on `BIND_ADDR`) and the health agent (on 127.0.0.1) publish.
- Every container has a CPU and memory limit (about 7 GB total).
- The app routes `localhost`, bare IPs and private names such as `ciao.acme.local` to Suite CXO (`lib/brand.ts`).
- The Pinnacle Airtable cron is not scheduled on a box. Whop, Resend/SES, Fathom, Telegram and Tavily stay off unless set in `.env`; mail goes through the client's SMTP.
- Compliance: infra only. No lead data flows change; the box keeps a client's data on the client's machine.
