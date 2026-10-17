#!/usr/bin/env bash
# Loads a deploy stage's secrets and variables into the GitHub environment of the same name.
# Usage: pnpm github-env <staging|production>
#
# The names come from .github/workflows/deploy.yml (`secrets.X` and `vars.X`), the values from the env files
# varlock loads, with .env.<stage>.local on top (the stage's own database, auth secret and webhook id).
# No value is printed: each name reports "set" or "empty, skipped".
set -euo pipefail

stage=${1:?usage: github-env <staging|production>}
infra=$(cd "$(dirname "$0")/.." && pwd)
workflow="$infra/../../.github/workflows/deploy.yml"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

if [ -f "$infra/.env.$stage.local" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$infra/.env.$stage.local"
  set +a
fi

secrets=$(grep -o 'secrets\.[A-Z0-9_]*' "$workflow" | cut -d. -f2 | sort -u | tr '\n' ' ')
vars=$(grep -o 'vars\.[A-Z0-9_]*' "$workflow" | cut -d. -f2 | sort -u | tr '\n' ' ')

gh api -X PUT "repos/$repo/environments/$stage" --silent

cd "$infra"
export STAGE="$stage" REPO="$repo" SECRET_NAMES="$secrets" VAR_NAMES="$vars"
JENDAL_DEPLOY_STAGE="$stage" exec pnpm exec varlock run -- bash -c '
  for n in $SECRET_NAMES; do
    v=${!n:-}
    if [ -z "$v" ]; then echo "secret $n: empty, skipped"; continue; fi
    printf "%s" "$v" | gh secret set "$n" --env "$STAGE" -R "$REPO" >/dev/null && echo "secret $n: set"
  done
  for n in $VAR_NAMES; do
    v=${!n:-}
    if [ -z "$v" ]; then echo "var $n: empty, skipped"; continue; fi
    gh variable set "$n" --env "$STAGE" -R "$REPO" --body "$v" >/dev/null && echo "var $n: set"
  done
'
