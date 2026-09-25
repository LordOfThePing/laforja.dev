#!/usr/bin/env bash
# Setup inicial del VPS para La Forja. Idempotente: se puede correr de nuevo sin romper nada.
# Corre como root en el VPS y recibe la clave pública que va a poder entrar como el usuario de deploy:
#
#   ssh hetzner 'bash -s' -- "$(cat ~/.ssh/id_ed25519.pub)" < scripts/vps-setup.sh
#
# Solo crea cosas propias de La Forja (usuario, directorio); no toca otros proyectos del VPS.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy-laforja}"
APP_DIR="${APP_DIR:-/opt/laforja}"
PUBKEY="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "Correr como root" >&2
  exit 1
fi
if [[ ! "$PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\  ]]; then
  echo "Primer argumento: la clave pública SSH (ssh-ed25519 AAAA...)" >&2
  exit 1
fi
getent group docker >/dev/null || { echo "No existe el grupo docker" >&2; exit 1; }

if id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Usuario $DEPLOY_USER ya existe"
else
  # Sin password: solo entra por clave. Sin sudo: docker alcanza para deployar.
  adduser --disabled-password --gecos "La Forja deploy" "$DEPLOY_USER"
  echo "Usuario $DEPLOY_USER creado"
fi
usermod -aG docker "$DEPLOY_USER"

home_dir="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home_dir/.ssh"
auth_keys="$home_dir/.ssh/authorized_keys"
touch "$auth_keys"
if grep -qxF "$PUBKEY" "$auth_keys"; then
  echo "La clave ya estaba autorizada"
else
  echo "$PUBKEY" >> "$auth_keys"
  echo "Clave agregada a $auth_keys"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$auth_keys"
chmod 600 "$auth_keys"

# 750: el .env de producción vive acá y no tiene que ser legible por otros usuarios del VPS.
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo
echo "Listo: $DEPLOY_USER (grupo docker) y $APP_DIR."
echo "Probá desde tu máquina: ssh laforja 'id && docker ps --format {{.Names}} | head -1'"
