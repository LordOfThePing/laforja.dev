#!/bin/sh
# En vez de cron a hora fija: cada hora se fija si hay un dump de las últimas ~23 h y si no,
# hace uno. Así un reinicio o un deploy nunca hace saltear un día, ni duplica el backup.
set -u

while true; do
  if [ -z "$(find /backups -name 'laforja-*.dump' -mmin -1380 2>/dev/null | head -n1)" ]; then
    backup.sh || echo "backup: FALLÓ (se reintenta en una hora)" >&2
  fi
  sleep 3600
done
