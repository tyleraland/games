#!/usr/bin/env bash
set -euo pipefail

# Repo prerequisites for Claude Code on the web containers.
#
# Invoked by the environment's container setup script (which cd's into the
# cloned repo before calling this). Kept in the repo so changes land via PR
# rather than living only in the environment config. Safe to re-run.

# Resolve the repo root from this script's location so it works no matter where
# it is invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Install Node dependencies from the lockfile for reproducible installs.
npm ci

# Ensure the pinned Chromium that @playwright/test expects is present. In the
# web container the browsers are pre-provisioned under $PLAYWRIGHT_BROWSERS_PATH
# and the pinned Playwright version (see devDependencies) matches that build, so
# this resolves instantly; elsewhere it downloads the matching build. The
# chrome-devtools MCP server (registered by the container setup script) points
# at this same browser via chromium.executablePath().
npx --yes playwright install chromium
