#!/bin/sh
# Un dump de la base en /backups (formato custom, se restaura con pg_restore) y, si hay
# bucket configurado, una copia fuera del VPS. Borra los dumps de más de BACKUP_KEEP_DAYS.
# El resultado queda en $BACKUP_STATE_DIR/last-run.json para el panel admin.
set -eu

keep_days="${BACKUP_KEEP_DAYS:-14}"
state="${BACKUP_STATE_DIR:-/state}"
name="laforja-$(date -u +%Y%m%dT%H%M%SZ).dump"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stage=dump
offsite=off
size=0
err="$state/.stderr"

mkdir -p "$state"
: > "$err"

write_status() {
  code=$1
  ok=false
  [ "$code" -eq 0 ] && ok=true
  if [ "$ok" = true ]; then rm -f "$state/last-error.txt"; else tail -c 4000 "$err" > "$state/last-error.txt"; fi
  printf '{"startedAt":"%s","finishedAt":"%s","ok":%s,"stage":"%s","file":"%s","size":%s,"offsite":"%s"}\n' \
    "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ok" "$stage" "$name" "$size" "$offsite" \
    > "$state/last-run.json.tmp"
  mv "$state/last-run.json.tmp" "$state/last-run.json"
  rm -f "$err"
}
trap 'write_status $?' EXIT

# El stderr va al log del contenedor y además al archivo que muestra el panel si falla.
run() {
  "$@" 2>>"$err" || { code=$?; cat "$err" >&2; return "$code"; }
}

# Se escribe a .tmp y se renombra: un dump cortado a la mitad nunca queda con nombre válido,
# y loop.sh no lo cuenta como backup del día.
run pg_dump --format=custom --file="/backups/$name.tmp"
mv "/backups/$name.tmp" "/backups/$name"
size="$(stat -c %s "/backups/$name")"
echo "backup: /backups/$name ($(du -h "/backups/$name" | cut -f1))"

find /backups -name 'laforja-*.dump' -mtime "+$keep_days" -print -delete
find /backups -name '*.tmp' -mmin +120 -delete

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  stage=offsite
  offsite=failed
  run rclone copyto "/backups/$name" "offsite:$BACKUP_S3_BUCKET/$name"
  offsite=ok
  run rclone delete --min-age "${keep_days}d" --include 'laforja-*.dump' "offsite:$BACKUP_S3_BUCKET"
  echo "backup: copiado a offsite:$BACKUP_S3_BUCKET/$name"
fi
stage=done
