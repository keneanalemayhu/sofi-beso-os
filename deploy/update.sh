#!/usr/bin/env bash
# deploy/update.sh — pull the latest code, build it and restart the app.
#
#   deploy/update.sh              update to the latest commit of the current branch
#   deploy/update.sh --yes        don't ask before running new database migrations
#   deploy/update.sh --force      rebuild and restart even if nothing changed
#   deploy/update.sh --rollback   go back to the version that ran before the last update
#   deploy/update.sh --baseline=010
#                                 first run only (backend): the last migration that
#                                 was already applied to this database by hand
#
# Settings (environment variables, all optional):
#   BRANCH      branch to deploy             (default: the branch checked out now)
#   APP_NAME    pm2 process / systemd unit   (default: below)
#   HEALTH_URL  checked after the restart    (default: below)
#
# Safe to run again: it never discards local changes, refuses to run twice
# at once, and if the build or a migration fails it puts the previous
# version back so the running app is not left half-updated.

set -Eeuo pipefail

# Everything is inside main(), so bash has read the whole file before any of
# it runs: the update itself may replace this file on disk.
main() {

  # ---- per-repo defaults ------------------------------------------------------
  DEFAULT_APP_NAME="sofi-beso-os"
  ENV_PORT="$(grep -E '^PORT=' "$(dirname "${BASH_SOURCE[0]}")/../.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '\r"' || true)"
  DEFAULT_HEALTH_URL="http://127.0.0.1:${ENV_PORT:-4000}/health"
  HAS_MIGRATIONS=1
  # -----------------------------------------------------------------------------

  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$ROOT"

  APP_NAME="${APP_NAME:-$DEFAULT_APP_NAME}"
  YES=0 FORCE=0 ROLLBACK=0 BASELINE="${BASELINE:-}"
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) YES=1 ;;
      --force) FORCE=1 ;;
      --rollback) ROLLBACK=1 ;;
      --baseline=*) BASELINE="${arg#--baseline=}" ;;
      -h|--help) sed -n '2,20p' "$ROOT/deploy/update.sh" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
    esac
  done

  STATE_DIR="$ROOT/deploy/.state"
  mkdir -p "$STATE_DIR"

  say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
  warn() { printf '\033[33mWARNING:\033[0m %s\n' "$*" >&2; }
  die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

  confirm() {
    [[ $YES -eq 1 ]] && return 0
    [[ -t 0 ]] || die "$1 — rerun with --yes to confirm without a terminal."
    read -r -p "$1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
  }

  # ---- one deploy at a time ---------------------------------------------------
  exec 9>"$STATE_DIR/lock"
  if command -v flock >/dev/null; then
    flock -n 9 || die "Another deploy of $APP_NAME is already running."
  fi

  command -v git >/dev/null || die "git is not installed."
  command -v npm >/dev/null || die "npm is not installed."

  # Your own edits on this server would be lost or block the update.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short --untracked-files=no
    die "There are uncommitted changes in $ROOT. Commit or stash them first."
  fi

  BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
  [[ "$BRANCH" != "HEAD" ]] || die "Not on a branch. Run: git checkout development (or main), then try again."

  OLD="$(git rev-parse HEAD)"
  # The version this script last built and restarted (a manual `git pull`
  # moves the code but does not build, migrate or restart).
  DEPLOYED="$(cat "$STATE_DIR/deployed" 2>/dev/null || true)"

  # ---- pick the target version -----------------------------------------------
  if [[ $ROLLBACK -eq 1 ]]; then
    [[ -f "$STATE_DIR/previous" ]] || die "No previous version recorded yet."
    NEW="$(cat "$STATE_DIR/previous")"
    say "Rolling back $APP_NAME to $(git log -1 --format='%h %s' "$NEW")"
    warn "Database migrations are NOT undone by a rollback."
    confirm "Roll back now?" || die "Cancelled."
  else
    say "Fetching $BRANCH"
    git fetch --quiet origin "$BRANCH"
    NEW="$(git rev-parse "origin/$BRANCH")"

    if [[ "$OLD" == "$NEW" && "$DEPLOYED" == "$NEW" && $FORCE -eq 0 ]]; then
      echo "Already up to date ($(git log -1 --format='%h %s')). Use --force to rebuild anyway."
      exit 0
    fi
    if [[ "$OLD" == "$NEW" && "$DEPLOYED" != "$NEW" ]]; then
      echo "The code is current but was not deployed by this script yet: building and restarting it."
    fi
    if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
      die "This server has commits that are not on origin/$BRANCH. Sort that out by hand; nothing was changed."
    fi
    if [[ "$OLD" != "$NEW" ]]; then
      echo "Updating $(git rev-parse --short "$OLD") -> $(git rev-parse --short "$NEW"):"
      git log --format='  %h %s' "$OLD..$NEW"
    fi
  fi

  # ---- helpers ----------------------------------------------------------------
  install_deps() {
    if [[ -f package-lock.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
  }

  deps_changed() {
    [[ ! -d node_modules ]] && return 0
    [[ "$1" == "$2" ]] && return 1
    ! git diff --quiet "$1" "$2" -- package.json package-lock.json
  }

  # Put the code back to OLD and rebuild it, so the app keeps working.
  restore_old() {
    warn "Putting back the previous version ($(git rev-parse --short "$OLD"))..."
    local current
    current="$(git rev-parse HEAD)"
    git checkout --quiet -B "$BRANCH" "$OLD"
    if deps_changed "$OLD" "$current"; then install_deps || warn "npm install of the previous version failed."; fi
    if npm run build; then
      warn "Previous version rebuilt. The app was not restarted and keeps running as before."
    else
      warn "Rebuilding the previous version also failed — check the app now."
    fi
  }

  # ---- database check, before anything is changed (backend only) ------------
  # Applied migrations are recorded in the schema_migrations table, so files
  # are run exactly once per database, however the code got onto this server.
  if [[ $HAS_MIGRATIONS -eq 1 && $ROLLBACK -eq 0 ]]; then
    command -v psql >/dev/null ||
      { die "psql is not installed (sudo apt install postgresql-client)."; }

    # Connection settings from .env (only the DB_* lines are read).
    if [[ -f .env ]]; then
      while IFS='=' read -r key value; do
        value="${value%$'\r'}"; value="${value%\"}"; value="${value#\"}"
        case "$key" in
          DB_HOST) export PGHOST="$value" ;;
          DB_PORT) export PGPORT="$value" ;;
          DB_NAME) export PGDATABASE="$value" ;;
          DB_USER) export PGUSER="$value" ;;
          DB_PASSWORD) export PGPASSWORD="$value" ;;
          DB_SSL) [[ "$value" == "true" ]] && export PGSSLMODE=require ;;
        esac
      done < <(grep -E '^DB_[A-Z_]+=' .env || true)
    fi
    [[ -n "${PGDATABASE:-}" ]] || { die "DB_NAME is not set in .env."; }

    q() { psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

    q -c "SELECT 1" >/dev/null ||
      { die "Cannot connect to database ${PGDATABASE} on ${PGHOST:-localhost}."; }

    mapfile -t ALL_MIGRATIONS < <(
      git ls-tree --name-only "$NEW" migrations/ | grep -E '\.sql$' | sed 's#^migrations/##' | sort
    )

    has_table="$(q -c "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"
    if [[ "$has_table" != "t" ]]; then
      # First run on this database: record what was already applied by hand.
      say "No migration history in ${PGDATABASE} yet"
      if [[ -z "$BASELINE" ]]; then
        echo "Migrations in this version:"
        printf '  %s\n' "${ALL_MIGRATIONS[@]}"
        [[ -t 0 ]] || { die "Rerun with --baseline=NNN: the number of the last migration already applied to this database."; }
        read -r -p "Number of the LAST migration already applied to this database (e.g. 010): " BASELINE
      fi
      [[ "$BASELINE" =~ ^[0-9]+$ ]] || { die "Not a migration number: '$BASELINE'"; }
      baseline_file="$(printf '%s\n' "${ALL_MIGRATIONS[@]}" | grep -E "^0*${BASELINE#0*}_|^${BASELINE}_" | head -1 || true)"
      [[ -n "$baseline_file" ]] || { die "No migration numbered $BASELINE."; }

      values=""
      for f in "${ALL_MIGRATIONS[@]}"; do
        values+="('$f'),"
        [[ "$f" == "$baseline_file" ]] && break
      done
      q -c "CREATE TABLE schema_migrations (
              name TEXT PRIMARY KEY,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT now())" \
        -c "INSERT INTO schema_migrations (name) VALUES ${values%,}" >/dev/null
      echo "Recorded migrations up to $baseline_file as already applied."
    fi
  fi

  # ---- move the code ----------------------------------------------------------
  git checkout --quiet -B "$BRANCH" "$NEW"

  if deps_changed "$OLD" "$NEW"; then
    say "Installing dependencies"
    install_deps || { restore_old; die "npm install failed."; }
  fi

  say "Building"
  if ! npm run build; then
    restore_old
    die "Build failed. Fix it and run deploy/update.sh again."
  fi

  # ---- database migrations (backend only) ------------------------------------
  if [[ $HAS_MIGRATIONS -eq 1 && $ROLLBACK -eq 0 ]]; then
    mapfile -t APPLIED < <(q -c "SELECT name FROM schema_migrations")
    PENDING=()
    for f in "${ALL_MIGRATIONS[@]}"; do
      printf '%s\n' "${APPLIED[@]}" | grep -qxF -- "$f" || PENDING+=("$f")
    done

    if [[ ${#PENDING[@]} -gt 0 ]]; then
      say "Database migrations to run on ${PGDATABASE} (${PGHOST:-localhost})"
      printf '  %s\n' "${PENDING[@]}"
      if ! confirm "Back up the database and run them now?"; then
        restore_old
        die "Cancelled. Nothing was changed."
      fi

      if command -v pg_dump >/dev/null; then
        mkdir -p deploy/backups
        backup="deploy/backups/${PGDATABASE}-$(date +%Y%m%d-%H%M%S).sql.gz"
        say "Backing up to $backup"
        if ! pg_dump --no-owner | gzip > "$backup"; then
          rm -f "$backup"
          restore_old
          die "Backup failed; no migration was run."
        fi
      else
        warn "pg_dump is not installed, so no backup can be made."
        confirm "Run the migrations WITHOUT a backup?" || { restore_old; die "Cancelled."; }
      fi

      for f in "${PENDING[@]}"; do
        say "Running $f"
        # Same session: the file (which has its own BEGIN/COMMIT), then the
        # record. ON_ERROR_STOP means a failed file is never recorded.
        # pg_dump's psql-only \restrict lines are skipped.
        if ! grep -v '^\\' "migrations/$f" |
             psql -X -q -v ON_ERROR_STOP=1 -f - \
                  -c "INSERT INTO schema_migrations (name) VALUES ('$f')"; then
          restore_old
          die "$f failed and was rolled back. Earlier migrations (if any) stay applied."
        fi
      done
    else
      echo "Database is up to date."
    fi
  fi

  # ---- restart ----------------------------------------------------------------
  say "Restarting $APP_NAME"
  restarted=0
  if command -v pm2 >/dev/null && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
    pm2 save >/dev/null 2>&1 || true
    restarted=1
  elif command -v systemctl >/dev/null &&
       systemctl list-unit-files "$APP_NAME.service" --no-legend 2>/dev/null | grep -q .; then
    if [[ $EUID -eq 0 ]]; then systemctl restart "$APP_NAME"; else sudo systemctl restart "$APP_NAME"; fi
    restarted=1
  fi

  if [[ $restarted -eq 1 ]]; then
    # --rollback goes back to whatever ran before this deploy.
    running_before="${DEPLOYED:-$OLD}"
    [[ "$running_before" != "$NEW" ]] && echo "$running_before" > "$STATE_DIR/previous"
    echo "$NEW" > "$STATE_DIR/deployed"
  fi

  if [[ $restarted -eq 0 ]]; then
    warn "No pm2 process or systemd service named '$APP_NAME' was found, so the app was NOT restarted."
    cat <<EOF
The new version is built. Restart the app the way you normally do, or let
pm2 keep it running from now on (one time):

    pm2 start npm --name $APP_NAME -- start
    pm2 save

If it already runs under another name: APP_NAME=<name> deploy/update.sh --force
EOF
    exit 0
  fi

  # ---- health check -----------------------------------------------------------
  HEALTH_URL="${HEALTH_URL:-$DEFAULT_HEALTH_URL}"
  if command -v curl >/dev/null; then
    say "Checking $HEALTH_URL"
    for _ in $(seq 1 30); do
      if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then
        say "Done: $APP_NAME is running $(git log -1 --format='%h %s')"
        exit 0
      fi
      sleep 1
    done
    die "$APP_NAME did not answer on $HEALTH_URL within 30s. Check its logs (pm2 logs $APP_NAME / journalctl -u $APP_NAME). To go back: deploy/update.sh --rollback"
  fi

  say "Done: $APP_NAME is running $(git log -1 --format='%h %s')"
}

main "$@"
