#!/usr/bin/env bash
# Backs up the production Postgres database to s3://$S3_BUCKET/backups/.
# Cron example, every night at 3:00 AM IST:
#   30 21 * * * /home/ubuntu/aevora/Aevora_Backend/deploy/backup-db.sh >> /home/ubuntu/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a
. ./.env
set +a

name="aevora-db-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U aevora --no-owner --no-privileges aevora | gzip > "/tmp/$name"

docker run --rm -v /tmp:/backup \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$S3_REGION" \
  amazon/aws-cli ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} \
  s3 cp "/backup/$name" "s3://$S3_BUCKET/backups/$name"

rm -f "/tmp/$name"
echo "$(date -u +%FT%TZ) uploaded backups/$name"
