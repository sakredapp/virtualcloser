#!/usr/bin/env bash
# The golden-image test for a self-hosted Suite CXO box (job "Image a Private
# Server"). Run from selfhost/ after install.sh, as root. Prints PASS/FAIL per
# check and never prints a secret. Exit code = number of failed checks.
#
#   bash golden-test.sh            # every check, including a backup + restore
#   SKIP_CRON_WAIT=1 bash golden-test.sh   # do not wait for the 5-minute cron tick
# The mail check needs SMTP set in .env: on a test box SMTP_HOST=mailpit SMTP_PORT=1025
# with `docker compose --profile mailtest up -d mailpit` (a local catcher, read back
# over its API); on a client box set MAIL_TEST_TO=<their IT address> to send one real email.
set -uo pipefail
cd "$(dirname "$0")"
fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails+1)); }
getv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E "s/[[:space:]]+#.*$//; s/^'(.*)'$/\1/"; }
dc() { docker compose "$@"; }
psqlq() { dc exec -T db psql -U postgres -d suitecxo -tAc "$1"; }
KEY=$(getv SUPABASE_SERVICE_ROLE_KEY)
HTTPS_PORT=$(getv HTTPS_PORT); HEALTH_PORT=$(getv HEALTH_PORT); BIND=$(getv BIND_ADDR)
[ "$BIND" = "0.0.0.0" ] && BIND=127.0.0.1

echo "== containers"; dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

# 1. Migrations
m=$(dc logs migrate 2>/dev/null | grep -o 'applied=[0-9]* skipped=[0-9]* failed=[0-9]*' | tail -1)
nf=$(psqlq "select count(*) from public.selfhost_migrations where not ok")
nok=$(psqlq "select count(*) from public.selfhost_migrations where ok")
[ "$nf" = "0" ] && pass "migrations: $nok files applied clean ($m)" || { fail "migrations: $nf failed"; psqlq "select file, error from public.selfhost_migrations where not ok"; }

# 2. pgvector
v=$(psqlq "select extversion from pg_extension where extname='vector'")
[ -n "$v" ] && psqlq "select '[1,2,3]'::vector <-> '[1,2,4]'::vector" >/dev/null && pass "pgvector $v installed, distance query works" || fail "pgvector missing"

# 3. PostgREST answers through Caddy's internal API with the service JWT
code=$(dc exec -T health wget -q -S -O /dev/null --header="apikey: $KEY" --header="Authorization: Bearer $KEY" "http://caddy:8000/rest/v1/worker_health?select=worker&limit=1" 2>&1 | awk '/HTTP\//{c=$2} END{print c}')
[ "$code" = "200" ] && pass "PostgREST /rest/v1/worker_health -> 200 (service_role JWT)" || fail "PostgREST -> ${code:-none}"
code=$(dc exec -T health wget -q -S -O /dev/null "http://caddy:8000/rest/v1/worker_health?select=worker" 2>&1 | grep -o 'HTTP/[0-9.]* [0-9]*' | tail -1 | cut -d' ' -f2)
[ "$code" != "200" ] && pass "PostgREST without the JWT is refused (${code:-none}) " || fail "PostgREST answers anonymously"

# 4. App login page over HTTPS through Caddy
SITE=$(getv SITE_HOST)
# Ask for the site by its name (TLS SNI + Host) while connecting to the bound address.
body=$(curl -sk --max-time 20 --resolve "${SITE}:${HTTPS_PORT}:${BIND}" "https://${SITE}:${HTTPS_PORT}/login" -w '\n%{http_code}')
code=$(printf '%s' "$body" | tail -1)
title=$(printf '%s' "$body" | grep -o '<title>[^<]*</title>' | head -1)
[ "$code" = "200" ] && pass "app https://${SITE}/login over Caddy TLS -> 200 $title" || fail "app login -> $code"

# 5. Health agent
h=$(curl -s -o /tmp/health.json -w '%{http_code}' "http://127.0.0.1:${HEALTH_PORT}/health")
[ "$h" = "200" ] && pass "health agent /health -> 200: $(grep -o '"name": "[^"]*"' /tmp/health.json | cut -d'"' -f4 | tr '\n' ' ')" || { fail "health agent -> $h"; cat /tmp/health.json; }

# 6. Worker ticking
w=$(psqlq "select worker || ' ' || round(extract(epoch from now()-last_tick_at)) || 's ago, ticks=' || tick_count from worker_health order by last_tick_at desc limit 1")
[ -n "$w" ] && pass "worker heartbeat: $w" || fail "no worker heartbeat"

# 7. A cron tick from Ofelia
if [ -z "${SKIP_CRON_WAIT:-}" ]; then
  for _ in $(seq 1 66); do dc logs ofelia 2>/dev/null | grep -q 'health-check -> HTTP' && break; sleep 5; done
fi
t=$(dc logs ofelia 2>/dev/null | grep -o '/api/cron/health-check -> HTTP [0-9]*' | tail -1)
case "$t" in *"HTTP 200") pass "ofelia cron tick: $t";; *) fail "ofelia cron tick: ${t:-none yet}";; esac

# 8. Backup + restore check
if dc exec -T backup backup.sh >/tmp/backup.out 2>&1; then
  pass "restic backup: $(tail -1 /tmp/backup.out)"
  snaps=$(dc exec -T backup restic snapshots --compact 2>/dev/null | grep -c 'db')
  pass "restic snapshots in repo: $snaps"
  if dc exec -T backup restore-check.sh >/tmp/restore.out 2>&1; then pass "$(grep 'restore-check: live' /tmp/restore.out)"; else fail "restore check"; cat /tmp/restore.out; fi
else
  fail "restic backup"; cat /tmp/backup.out
fi

# 9. Outgoing mail through SMTP (lib/emailSmtp.ts), proven with the app's own send path
SMTP_HOST=$(getv SMTP_HOST); CRON=$(getv CRON_SECRET)
mailtest() { curl -sk --max-time 40 --resolve "${SITE}:${HTTPS_PORT}:${BIND}" -X POST -H "Authorization: Bearer $CRON" -H 'content-type: application/json' -d "{\"to\":\"$1\"}" "https://${SITE}:${HTTPS_PORT}/api/cron/selfhost-mail-test" -w '\n%{http_code}'; }
if [ "$SMTP_HOST" = "mailpit" ]; then
  r=$(mailtest golden-test@example.com); rc=$(printf '%s' "$r" | tail -1)
  sleep 2
  got=$(dc exec -T health wget -qO- "http://mailpit:8025/api/v1/messages?limit=5" 2>/dev/null | grep -o '"Subject":"Suite CXO test email from [^"]*"' | head -1)
  from=$(dc exec -T health wget -qO- "http://mailpit:8025/api/v1/messages?limit=1" 2>/dev/null | grep -o '"From":{[^}]*}' | head -1 | grep -o '"Address":"[^"]*"')
  [ "$rc" = "200" ] && [ -n "$got" ] && pass "smtp: app sent through SMTP, mail catcher received $got from $from" || fail "smtp: route -> $rc, caught: ${got:-nothing}"
elif [ -n "$SMTP_HOST" ] && [ -n "${MAIL_TEST_TO:-}" ]; then
  r=$(mailtest "$MAIL_TEST_TO"); rc=$(printf '%s' "$r" | tail -1)
  [ "$rc" = "200" ] && pass "smtp: test email accepted by $SMTP_HOST for $MAIL_TEST_TO" || fail "smtp: $SMTP_HOST -> $rc $(printf '%s' "$r" | head -1)"
else
  printf 'SKIP  smtp: SMTP_HOST not set (or MAIL_TEST_TO missing)\n'
fi
r=$(curl -sk --max-time 20 --resolve "${SITE}:${HTTPS_PORT}:${BIND}" -X POST -d '{}' "https://${SITE}:${HTTPS_PORT}/api/cron/selfhost-mail-test" -o /dev/null -w '%{http_code}')
[ "$r" = "401" ] && pass "smtp test route refuses a call without CRON_SECRET (401)" || fail "smtp test route without secret -> $r"

# 10. Limits are set (so the box keeps headroom)
nolim=$(for c in $(dc ps -q); do docker inspect -f '{{.Name}} {{.HostConfig.Memory}}' "$c"; done | awk '$2==0{print $1}')
[ -z "$nolim" ] && pass "every container has a memory limit" || fail "no memory limit: $nolim"

echo "== $fails failed"
exit "$fails"
