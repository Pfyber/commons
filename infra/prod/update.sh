#!/usr/bin/env bash
# Fetch the latest Commons from GitHub and rebuild what changed.
#
#   infra/prod/update.sh            # the branch the server is on (main)
#   infra/prod/update.sh some-branch
#
# Safe to run any time: if nothing changed, the build is cached and the
# containers stay up. Also run it after editing infra/prod/.env.
set -euo pipefail
cd "$(dirname "$0")/../.."

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
before=$(git rev-parse --short HEAD)

git fetch --quiet origin "$branch"
git checkout --quiet "$branch"
# Fast-forward only: a hand edit on the server stops the update instead of
# being merged or thrown away.
git merge --quiet --ff-only "origin/$branch"
after=$(git rev-parse --short HEAD)

if [ "$before" = "$after" ]; then
  echo "Code already at $after ($branch)."
else
  echo "Updated $before -> $after:"
  git log --oneline "$before..$after" | head -20
fi

docker=docker
$docker info >/dev/null 2>&1 || docker="sudo docker"
compose="$docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env"

$compose up -d --build --remove-orphans
$docker image prune -f >/dev/null
$compose ps
