# Misma major que el servicio postgres: pg_dump no puede dumpear un server más nuevo que él.
FROM postgres:16-alpine
RUN apk add --no-cache rclone
COPY backup.sh loop.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/loop.sh
VOLUME /backups
CMD ["loop.sh"]
