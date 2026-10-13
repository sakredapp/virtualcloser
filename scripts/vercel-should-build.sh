#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand). Ported from
# sakredapp/crmbuilds scripts/vercel-should-build.sh.
#
# EXIT CODES ARE INVERTED FROM INTUITION:
#     exit 0        -> SKIP the build
#     exit non-zero -> RUN the build
#
# Two rules, and everything else builds:
#
# 1. BUILDS MOVED TO THE HETZNER BUILD BOX. Production is built by
#    .github/workflows/vercel-prebuilt.yml on our self-hosted runner and
#    uploaded with `vercel deploy --prebuilt --prod`, which never runs this
#    script. Vercel's own git-triggered build of the same commit is duplicate
#    spend, so it skips once the Vercel project carries the env var
#    HETZNER_BUILDS=1. Scoped three ways on purpose:
#      - VERCEL=1: only on Vercel's builders.
#      - a non-empty git ref: a CLI `vercel deploy` from a laptop (no git ref)
#        still builds, so that stays the break-glass path.
#      - per project: the variable is set by hand on each Vercel project, AFTER
#        the prebuilt workflow has shipped production once. Until then Vercel
#        keeps building main exactly as before.
#    Rollback: delete HETZNER_BUILDS from the Vercel project and set the
#    repository variable PREBUILT_PRODUCTION to off.
#
# 2. BRANCH PUSHES NEVER BUILD. GitHub is the durable store for work in
#    progress; a pushed branch must cost nothing on Vercel. VERCEL_ENV=production
#    is honoured as an override, so a deliberate production deploy from another
#    ref is never skipped.
#
# EVERY UNKNOWN FAILS OPEN (builds). An empty ref, a missing variable, an
# unexpected value: build. This guard may cost a redundant build; it may never
# silently withhold production.
set -u

say() { echo "[build-guard] $*" >&2; }

PROD_BRANCH="${VERCEL_PRODUCTION_BRANCH:-main}"
REF="${VERCEL_GIT_COMMIT_REF:-}"

if [ "${VERCEL:-}" = "1" ] && [ "${HETZNER_BUILDS:-}" = "1" ] && [ -n "$REF" ]; then
  say "HETZNER_BUILDS=1 - skipping; production is built on the Hetzner box (vercel-prebuilt workflow)"
  exit 0
fi

if [ -n "$REF" ] && [ "$REF" != "$PROD_BRANCH" ]; then
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    say "ref '$REF' is not '$PROD_BRANCH', but VERCEL_ENV=production - building (a deliberate production deploy is never skipped)"
    exit 1
  fi
  say "ref '$REF' is not '$PROD_BRANCH' - skipping (production builds only)"
  exit 0
fi

if [ -z "$REF" ]; then
  say "no git ref - building (fail open)"
else
  say "ref '$REF' is the production branch and HETZNER_BUILDS is not 1 - building"
fi
exit 1
