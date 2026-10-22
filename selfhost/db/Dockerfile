# Postgres 16 + pgvector (the base image) + pg_cron (some Pinnacle migrations
# schedule jobs with it). Same extensions the Supabase project has.
FROM pgvector/pgvector:pg16
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-cron \
 && rm -rf /var/lib/apt/lists/*
COPY init/ /docker-entrypoint-initdb.d/
