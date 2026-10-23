#!/usr/bin/env bash
# Suite CXO self-hosted box installer. Run as root on a fresh Ubuntu 24.04+ box,
# from a clone of sakredapp/virtualcloser:
#
#   sudo bash selfhost/install.sh                 # install Docker if missing, write .env, build, start
#   sudo bash selfhost/install.sh --no-docker     # Docker already installed
#   sudo bash selfhost/install.sh --env-only      # only write .env (then edit it and run again)
#
# Settings you may pass in the environment the first time (else defaults from
# .env.example): BOX_ID, SITE_HOST, BIND_ADDR, HTTPS_PORT, HTTP_PORT, BACKUP_DIR.
# Generated secrets are written to selfhost/.env (chmod 600) and never printed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
INSTALL_DOCKER=1; ENV_ONLY=0
for a in "$@"; do
  case "$a" in
    --no-docker) INSTALL_DOCKER=0 ;;
    --env-only) ENV_ONLY=1 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }

# 1. Docker Engine + compose + buildx from Ubuntu's own archive (no third-party
#    repo, so unattended-upgrades patches it with the OS).
if [ "$INSTALL_DOCKER" = 1 ] && ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine + compose + buildx (Ubuntu packages)"
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q ca-certificates curl openssl docker.io docker-compose-v2 docker-buildx
  systemctl enable --now docker
fi
# Docker publishes ports past ufw, so the compose file binds Caddy to BIND_ADDR
# and the health agent to 127.0.0.1 only. Nothing else is published.
docker compose version >/dev/null

# 2. .env with fresh secrets (only blanks are filled; an existing .env is kept).
rand() { openssl rand -hex "${1:-32}"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
sign_service_jwt() {
  local secret="$1" header payload sig
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  # role=service_role, issued now, valid 10 years (rotated by re-running with JWT_SECRET blanked).
  local now; now=$(date +%s)
  payload=$(printf '{"role":"service_role","iss":"suitecxo-selfhost","iat":%d,"exp":%d}' "$now" $((now + 315360000)) | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}
getv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E "s/[[:space:]]+#.*$//; s/^'(.*)'$/\1/"; }
setv() { # setv KEY VALUE (single-quoted so compose does not expand $ in bcrypt hashes)
  local k="$1" v="$2" tmp; tmp=$(mktemp)
  awk -v k="$k" -v v="'$v'" 'BEGIN{d=0} $0 ~ "^"k"=" {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' .env > "$tmp"
  cat "$tmp" > .env; rm -f "$tmp"
}

if [ ! -f .env ]; then
  log "Writing selfhost/.env from .env.example"
  cp .env.example .env
  for k in BOX_ID SITE_HOST BIND_ADDR HTTPS_PORT HTTP_PORT BACKUP_DIR ROOT_DOMAIN; do
    if [ -n "${!k:-}" ]; then setv "$k" "${!k}"; fi
  done
fi
chmod 600 .env
for k in POSTGRES_PASSWORD PGRST_AUTHENTICATOR_PASSWORD JWT_SECRET SESSION_SECRET CRON_SECRET RESTIC_PASSWORD; do
  [ -n "$(getv "$k")" ] || setv "$k" "$(rand 32)"
done
[ -n "$(getv SUPABASE_SERVICE_ROLE_KEY)" ] || setv SUPABASE_SERVICE_ROLE_KEY "$(sign_service_jwt "$(getv JWT_SECRET)")"
mkdir -p "$(getv BACKUP_DIR)" box-licence
[ "$ENV_ONLY" = 1 ] && { log ".env written (secrets not shown). Edit it, then run install.sh again."; exit 0; }

# 3. Build the images (app build is the long step: ~5-10 min).
log "Building images"
docker compose build

# 4. Admin password: generated once, bcrypt hash into .env, plain copy root-only.
if [ -z "$(getv ADMIN_PASSWORD_HASH)" ]; then
  pw=$(rand 12)
  hash=$(docker run --rm -e PW="$pw" suitecxo-worker:local node -e "console.log(require('bcryptjs').hashSync(process.env.PW, 12))")
  setv ADMIN_PASSWORD_HASH "$hash"
  umask 077; printf '%s\n' "$pw" > .admin-password; unset pw
  echo "Admin password written to $HERE/.admin-password (root-only). Put it on the build sheet, then delete the file."
fi

# 4b. Licence: the signed file from Suite CXO goes at selfhost/box-licence/licence.key.
# Without a valid one the app shows a "no valid licence" page instead of starting.
log "Checking the licence"
if ! docker run --rm -v "$HERE/box-licence:/licence:ro" -e BOX_ID="$(getv BOX_ID)" suitecxo-worker:local \
     node /selfhost-licence/check.mjs verify; then
  echo "No valid licence for box $(getv BOX_ID) yet. Put it at $HERE/box-licence/licence.key; the app picks it up within 5 minutes."
fi

# 5. Start. The migrate service applies supabase/*.sql before PostgREST starts.
log "Starting the stack"
docker compose up -d
docker compose logs migrate | tail -3
# Our remote-care tunnel joins the tailnet only when a key is in .env.
if [ -n "$(getv TS_AUTHKEY)" ]; then
  log "Joining the Suite CXO tailnet (TS_AUTHKEY set)"
  docker compose --profile remote up -d tailscale
fi
# The client's own model (LOCAL_LLM_URL at the bundled Ollama): start it and
# pull the model once (a vLLM box elsewhere needs nothing here).
if printf '%s' "$(getv LOCAL_LLM_URL)" | grep -q '//ollama:'; then
  log "Starting the local model server and pulling $(getv LOCAL_LLM_MODEL)"
  docker compose --profile local-llm up -d ollama
  docker compose --profile local-llm exec -T ollama ollama pull "$(getv LOCAL_LLM_MODEL)"
fi

# 6. Wait for the health agent to report every check green.
log "Waiting for health (up to 5 min)"
port=$(getv HEALTH_PORT); port=${port:-8099}
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    curl -sS "http://127.0.0.1:${port}/health"; echo
    log "Suite CXO is up: https://$(getv SITE_HOST)/login"
    exit 0
  fi
  sleep 5
done
curl -sS "http://127.0.0.1:${port}/health" || true
echo "Health is not green yet; see: docker compose ps; docker compose logs --tail 50"
exit 1
