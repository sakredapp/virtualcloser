# restic + the Postgres 16 client tools, for the nightly database backup.
FROM alpine:3.20
RUN apk add --no-cache restic postgresql16-client tzdata
COPY backup.sh restore-check.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh
# busybox crond runs the nightly backup; schedule from BACKUP_CRON.
CMD ["/bin/sh", "-c", "echo \"${BACKUP_CRON:-30 2 * * *} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1\" > /etc/crontabs/root && exec crond -f -l 8"]
