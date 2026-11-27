#!/usr/bin/env bash
# Deterministic Vercel production deploy for the CartridgeFi web app.
#
# Builds from a clean snapshot of the working tree (tracked + untracked, minus
# ignored files) in a scratch directory, so a running `next dev` in apps/web
# never shares a `.next` directory with the production build. The snapshot is
# built locally with `vercel build --prod` and shipped with `--prebuilt`.
#
# Usage: scripts/deploy-vercel.sh [build-dir]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-${TMPDIR:-/tmp}/cartridgefi-vercel-build}"
# The Vercel project uses Root Directory = apps/web, so it is linked at the
# monorepo root; function traces then resolve against the root node_modules.
LINK_SRC="${VERCEL_PROJECT_JSON:-$BUILD_DIR/.vercel/project.json}"

saved_link=""
if [[ -f "$LINK_SRC" ]]; then
  saved_link="$(cat "$LINK_SRC")"
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy every non-ignored file (tracked and untracked) — respects .gitignore,
# which excludes .env*, .keys/, keypairs, node_modules, .next and AppleDouble files.
# Tracked files deleted in the working tree are dropped (macOS openrsync has no
# --ignore-missing-args).
(cd "$REPO_ROOT" && git ls-files -z --cached --others --exclude-standard \
  | python3 -I -c 'import os, sys; sys.stdout.buffer.write(b"".join(p + b"\0" for p in sys.stdin.buffer.read().split(b"\0") if p and os.path.lexists(p)))') \
  | (cd "$REPO_ROOT" && rsync -a --from0 --files-from=- ./ "$BUILD_DIR/")

cd "$BUILD_DIR"
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" -r run build

if [[ -n "$saved_link" ]]; then
  mkdir -p .vercel
  printf '%s' "$saved_link" > .vercel/project.json
else
  vercel link --yes --project cartridgefi
fi

vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
