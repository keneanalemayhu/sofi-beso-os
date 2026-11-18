#!/usr/bin/env bash
# Pull, rebuild, migrate and restart the backend. Run from the repo root.
# Pulls the branch that is checked out (normally development).
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)

# GitHub sometimes refuses a connection for a moment ("Permission denied
# (publickey)" or a 5xx) and lets the next one in: try a few times before
# giving up. --ff-only: the server never has commits of its own.
pull() {
  for i in 1 2 3 4; do
    git pull --ff-only origin "$branch" && return 0
    echo "git pull failed (try $i of 4), trying again in $((i * 5)) s" >&2
    sleep $((i * 5))
  done
  echo "Could not pull from GitHub. Check: ssh -T git@github.com" >&2
  return 1
}

# psql/pg_dump connect with the DB_* settings from .env.
db_env() {
  while IFS='=' read -r key value; do
    value=${value%$'\r'}; value=${value%\"}; value=${value#\"}
    case "$key" in
      DB_HOST) export PGHOST=$value ;;
      DB_PORT) export PGPORT=$value ;;
      DB_NAME) export PGDATABASE=$value ;;
      DB_USER) export PGUSER=$value ;;
      DB_PASSWORD) export PGPASSWORD=$value ;;
      DB_SSL) if [ "$value" = true ]; then export PGSSLMODE=require; fi ;;
    esac
  done < <(grep -E '^DB_[A-Z_]+=' .env)
}

# Runs each migrations/*.sql once. Applied files are recorded in the
# schema_migrations table; a file that fails is rolled back (each has its
# own BEGIN/COMMIT), not recorded, and stops the deploy before the restart.
migrate() {
  db_env
  if [ "$(psql -XAtc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" != t ]; then
    echo "No schema_migrations table in $PGDATABASE. Record the migrations already applied first, e.g. up to 011:" >&2
    echo "  psql -c \"CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())\"" >&2
    echo "  for f in migrations/0{00..11}_*.sql; do psql -c \"INSERT INTO schema_migrations (name) VALUES ('\$(basename \$f)')\"; done" >&2
    return 1
  fi

  applied=$(psql -XAtc "SELECT name FROM schema_migrations")
  pending=()
  for f in migrations/*.sql; do
    grep -qxF "$(basename "$f")" <<<"$applied" || pending+=("$f")
  done
  if [ ${#pending[@]} -eq 0 ]; then
    echo "No pending migrations."
    return 0
  fi

  mkdir -p deploy/backups
  backup="deploy/backups/$PGDATABASE-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "Backing up $PGDATABASE to $backup"
  pg_dump --no-owner | gzip >"$backup"

  for f in "${pending[@]}"; do
    echo "Applying $f"
    # Skip psql-only lines (pg_dump's \restrict) and record the file in the
    # same session, so only a file that ran without error is recorded.
    grep -v '^\\' "$f" | psql -Xq -v ON_ERROR_STOP=1 -f - \
      -c "INSERT INTO schema_migrations (name) VALUES ('$(basename "$f")')"
  done
}

pull
npm ci
npm run build
migrate
# --update-env copies this shell's environment into the app. Take PORT
# from .env explicitly, so a PORT exported in this shell (e.g. after
# sourcing another app's .env) can never move the app onto the wrong port.
port=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '\r"' || true)
PORT=${port:-4000} pm2 reload sofi-beso-backend --update-env

pm2 list
