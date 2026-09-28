#!/bin/sh
# En vez de cron a hora fija: cada minuto se fija si hay un dump de las últimas ~23 h y si no,
# hace uno. Así un reinicio o un deploy nunca hace saltear un día, ni duplica el backup.
# También atiende el «Hacer backup ahora» del panel admin (un archivo `request` en $state).
set -u

state="${BACKUP_STATE_DIR:-/state}"
mkdir -p "$state"
# La API corre como otro usuario y tiene que poder dejar el pedido.
chmod 1777 "$state"

recent() {
  find /backups -name 'laforja-*.dump' -mmin -1380 2>/dev/null | sort | tail -n1
}

# Lo que el panel muestra como configuración: nunca las credenciales.
printf '{"keepDays":%s,"bucket":"%s","provider":"%s"}\n' \
  "${BACKUP_KEEP_DAYS:-14}" "${BACKUP_S3_BUCKET:-}" "${BACKUP_S3_PROVIDER:-}" > "$state/config.json"

last="$(recent)"
if [ -n "$last" ]; then
  echo "backup: ya hay uno de las últimas 23 h ($(basename "$last")); el próximo sale cuando pase ese plazo"
fi
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "backup: copia fuera del VPS activada (offsite:$BACKUP_S3_BUCKET)"
else
  echo "backup: sin BACKUP_S3_BUCKET, los dumps quedan solo en el VPS"
fi

# Después de un fallo se espera una hora: sin esto reintentaría cada minuto.
retry_at=0

attempt() {
  if backup.sh; then
    retry_at=0
  else
    echo "backup: FALLÓ (se reintenta en una hora)" >&2
    retry_at=$(( $(date +%s) + 3600 ))
  fi
}

while true; do
  touch "$state/alive"
  # Nombre, tamaño y fecha de cada dump, para la lista del panel.
  find /backups -name 'laforja-*.dump' -exec stat -c '%n	%s	%Y' {} + 2>/dev/null | sort > "$state/dumps.tsv.tmp"
  mv "$state/dumps.tsv.tmp" "$state/dumps.tsv"

  if [ -e "$state/request" ]; then
    rm -f "$state/request"
    echo "backup: pedido desde el panel"
    attempt
  elif [ -z "$(recent)" ] && [ "$(date +%s)" -ge "$retry_at" ]; then
    attempt
  fi
  sleep 60
done
