#!/usr/bin/env bash
# Deploy que dispara GitHub Actions. No se corre desde el repo: vps-ci-setup.sh lo
# copia a /usr/local/bin/laforja-deploy (dueño root) y la clave de CI queda atada a
# él con command="..." en authorized_keys. Así, si se filtra esa clave, lo único que
# permite es deployar lo que ya está en origin/main.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/laforja}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
# Dos pushes seguidos disparan dos deploys: el segundo espera al primero en vez de pisarle el build.
exec 9>"$APP_DIR/.deploy.lock"
flock 9

git fetch -q origin "$BRANCH"
git checkout -q "$BRANCH"
git pull -q --ff-only origin "$BRANCH"
echo "Deployando $(git log -1 --format='%h %s')"

docker compose up -d --build --wait --remove-orphans
docker compose ps
docker image prune -f >/dev/null
