#!/bin/sh
# Calls one cron route on the app with the cron bearer secret. Exit code is the
# job's result in Ofelia's log. The secret is read from the env, never echoed.
path="$1"
code=$(wget -q -S -O /dev/null --timeout=900 \
  --header="Authorization: Bearer ${CRON_SECRET}" \
  --header="Host: localhost" \
  "http://app:3000${path}" 2>&1 | awk '/HTTP\//{c=$2} END{print c}')
echo "$(date -u +%FT%TZ) ${path} -> HTTP ${code:-none}"
[ "${code}" = "200" ]
