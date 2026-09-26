#!/usr/bin/env bash
# Habilita el deploy automático desde GitHub Actions. Idempotente. Corre como root en el
# VPS, después de vps-setup.sh, y recibe la clave pública que usa el workflow:
#
#   ssh hetzner 'bash -s' -- "\"$(cat laforja-gha.pub)\"" < scripts/vps-ci-setup.sh
#
# El script de deploy llega por stdin separado (ver docs/despliegue-vps.md), no se lee del
# repo clonado en el VPS: ese checkout es escribible por deploy-laforja.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy-laforja}"
DEPLOY_BIN=/usr/local/bin/laforja-deploy
PUBKEY="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "Correr como root" >&2
  exit 1
fi
if [[ ! "$PUBKEY" =~ ^ssh-ed25519\  ]]; then
  echo "Primer argumento: la clave pública de CI (ssh-ed25519 AAAA...)" >&2
  exit 1
fi
[[ -s /root/laforja-deploy.sh ]] || { echo "Falta /root/laforja-deploy.sh (scp de scripts/ci-deploy.sh)" >&2; exit 1; }

install -m 755 -o root -g root /root/laforja-deploy.sh "$DEPLOY_BIN"
rm -f /root/laforja-deploy.sh
echo "Instalado $DEPLOY_BIN"

home_dir="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
auth_keys="$home_dir/.ssh/authorized_keys"
key_body="$(awk '{print $1" "$2}' <<<"$PUBKEY")"
line="command=\"$DEPLOY_BIN\",restrict $key_body github-actions-laforja"
if grep -qF "$key_body" "$auth_keys"; then
  sed -i "\#$key_body#d" "$auth_keys"
fi
echo "$line" >> "$auth_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$auth_keys"
chmod 600 "$auth_keys"
echo "Clave de CI autorizada (solo puede correr $DEPLOY_BIN)"
