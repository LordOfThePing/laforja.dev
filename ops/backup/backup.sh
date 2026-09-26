#!/bin/sh
# Un dump de la base en /backups (formato custom, se restaura con pg_restore) y, si hay
# bucket configurado, una copia fuera del VPS. Borra los dumps de más de BACKUP_KEEP_DAYS.
set -eu

keep_days="${BACKUP_KEEP_DAYS:-14}"
name="laforja-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Se escribe a .tmp y se renombra: un dump cortado a la mitad nunca queda con nombre válido,
# y loop.sh no lo cuenta como backup del día.
pg_dump --format=custom --file="/backups/$name.tmp"
mv "/backups/$name.tmp" "/backups/$name"
echo "backup: /backups/$name ($(du -h "/backups/$name" | cut -f1))"

find /backups -name 'laforja-*.dump' -mtime "+$keep_days" -print -delete
find /backups -name '*.tmp' -mmin +120 -delete

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  rclone copyto "/backups/$name" "offsite:$BACKUP_S3_BUCKET/$name"
  rclone delete --min-age "${keep_days}d" --include 'laforja-*.dump' "offsite:$BACKUP_S3_BUCKET"
  echo "backup: copiado a offsite:$BACKUP_S3_BUCKET/$name"
fi
