#!/usr/bin/env bash
# Pins the Ignored Build Step. Run: bash scripts/vercel-should-build.test.sh
# Remember: exit 0 = SKIP, exit 1 = BUILD.
set -u
cd "$(dirname "$0")"
fail=0
check() { # name, expected exit, env assignments...
  local name="$1" want="$2"; shift 2
  env -i PATH="$PATH" "$@" bash ./vercel-should-build.sh 2>/dev/null
  local got=$?
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: wanted exit $want, got $got"; fail=1; fi
}
BUILD=1; SKIP=0
check "main, no switch: Vercel builds production"            $BUILD VERCEL=1 VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=main
check "main, HETZNER_BUILDS=1: Vercel skips"                 $SKIP  VERCEL=1 VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=main HETZNER_BUILDS=1
check "branch push: skips"                                   $SKIP  VERCEL=1 VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feature/x
check "branch push, HETZNER_BUILDS=1: skips"                 $SKIP  VERCEL=1 VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feature/x HETZNER_BUILDS=1
check "branch, no VERCEL_ENV at all: skips"                  $SKIP  VERCEL=1 VERCEL_GIT_COMMIT_REF=feature/x
check "production deploy from another ref: builds"           $BUILD VERCEL=1 VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=hotfix
check "no git ref (CLI deploy), switch on: builds"           $BUILD VERCEL=1 VERCEL_ENV=production HETZNER_BUILDS=1
check "no git ref, nothing known: builds"                    $BUILD
check "switch on but not on Vercel (our runner): builds"     $BUILD VERCEL_GIT_COMMIT_REF=main HETZNER_BUILDS=1
check "HETZNER_BUILDS=0 on main: builds"                     $BUILD VERCEL=1 VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=main HETZNER_BUILDS=0
check "HETZNER_BUILDS=true (not exactly 1) on main: builds"  $BUILD VERCEL=1 VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=main HETZNER_BUILDS=true
check "empty ref string: builds"                             $BUILD VERCEL=1 VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=
exit $fail
