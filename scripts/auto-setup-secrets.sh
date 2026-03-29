#!/usr/bin/env bash
# Auto-generate and install common secrets for qflush
# Usage: ./scripts/auto-setup-secrets.sh [owner/repo]

set -euo pipefail
REPO=${1:-}
if [ -z "$REPO" ]; then
  if git remote get-url github >/dev/null 2>&1; then
    REPO=$(git remote get-url github | sed -E 's#.*/([^/]+/[^/]+)(\.git)?$#\1#')
  else
    REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*/([^/]+/[^/]+)(\.git)?$#\1#' || true)
  fi
fi
if [ -z "$REPO" ]; then
  echo "ERROR: cannot detect repo owner/name. Pass as first argument owner/repo" >&2
  exit 2
fi

# generate token function
gen_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

echo "Repo: $REPO"

NEZ_ADMIN_TOKEN=$(gen_hex)
echo "Generated NEZ_ADMIN_TOKEN: $NEZ_ADMIN_TOKEN"

# prompt for other values
read -r -p "Provide NPM_TOKEN (leave empty to skip): " NPM_TOKEN
read -r -p "Provide GUMROAD_TOKEN (leave empty to skip): " GUMROAD_TOKEN
read -r -p "Provide GUM_LICENSE_KEY (leave empty to skip): " GUM_LICENSE_KEY
read -r -p "Provide GUMROAD_APP_ID (leave empty to skip): " GUMROAD_APP_ID
read -r -p "Provide GUMROAD_APP_SECRET (leave empty to skip): " GUMROAD_APP_SECRET
read -r -p "Provide VSCE_TOKEN (leave empty to skip): " VSCE_TOKEN
read -r -p "Provide AZURE_CREDENTIALS file path (leave empty to skip): " AZ_JSON_PATH

# prepare env for set-secrets script
export REPO
export QFLUSH_TOKEN
export NPM_TOKEN
export GUMROAD_TOKEN
export GUM_LICENSE_KEY
export GUMROAD_APP_ID
export GUMROAD_APP_SECRET
export VSCE_TOKEN

# prefer gh if available
if command -v gh >/dev/null 2>&1; then
  echo "Using gh to set secrets on $REPO"
  gh secret set QFLUSH_TOKEN --body "$QFLUSH_TOKEN" --repo "$REPO"
  if [ -n "$NPM_TOKEN" ]; then gh secret set NPM_TOKEN --body "$NPM_TOKEN" --repo "$REPO"; fi
  if [ -n "$GUMROAD_TOKEN" ]; then gh secret set GUMROAD_TOKEN --body "$GUMROAD_TOKEN" --repo "$REPO"; fi
  if [ -n "$GUM_LICENSE_KEY" ]; then gh secret set GUM_LICENSE_KEY --body "$GUM_LICENSE_KEY" --repo "$REPO"; fi
  if [ -n "$GUMROAD_APP_ID" ]; then gh secret set GUMROAD_APP_ID --body "$GUMROAD_APP_ID" --repo "$REPO"; fi
  if [ -n "$GUMROAD_APP_SECRET" ]; then gh secret set GUMROAD_APP_SECRET --body "$GUMROAD_APP_SECRET" --repo "$REPO"; fi
  if [ -n "$VSCE_TOKEN" ]; then gh secret set VSCE_TOKEN --body "$VSCE_TOKEN" --repo "$REPO"; fi
  if [ -n "$AZ_JSON_PATH" ] && [ -f "$AZ_JSON_PATH" ]; then gh secret set AZURE_CREDENTIALS --body "$(cat "$AZ_JSON_PATH")" --repo "$REPO"; fi
  echo "Secrets set via gh for $REPO"
else
  echo "gh CLI not found — writing to .env.local"
  touch .env.local
  grep -v -E '^QFLUSH_TOKEN=' .env.local 2>/dev/null > .env.local.tmp || true
  echo "QFLUSH_TOKEN=$QFLUSH_TOKEN" >> .env.local.tmp
  if [ -n "$NPM_TOKEN" ]; then echo "NPM_TOKEN=$NPM_TOKEN" >> .env.local.tmp; fi
  if [ -n "$GUMROAD_TOKEN" ]; then echo "GUMROAD_TOKEN=$GUMROAD_TOKEN" >> .env.local.tmp; fi
  if [ -n "$GUM_LICENSE_KEY" ]; then echo "GUM_LICENSE_KEY=$GUM_LICENSE_KEY" >> .env.local.tmp; fi
  if [ -n "$GUMROAD_APP_ID" ]; then echo "GUMROAD_APP_ID=$GUMROAD_APP_ID" >> .env.local.tmp; fi
  if [ -n "$GUMROAD_APP_SECRET" ]; then echo "GUMROAD_APP_SECRET=$GUMROAD_APP_SECRET" >> .env.local.tmp; fi
  if [ -n "$VSCE_TOKEN" ]; then echo "VSCE_TOKEN=$VSCE_TOKEN" >> .env.local.tmp; fi
  mv .env.local.tmp .env.local
  echo "Wrote .env.local (not committed)."
fi

echo "Done. QFLUSH_TOKEN set. Keep it secret." 
