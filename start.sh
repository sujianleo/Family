#!/bin/sh

set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUNTIME_ROOT="$PROJECT_ROOT/.runtime"
RUNTIME_ENV="$RUNTIME_ROOT/family.env"
APP_PORT=${FAMILY_APP_PORT:-3000}
ACTION=${1:-start}

detect_lan_host() {
  if [ -n "${FAMILY_APP_HOST:-}" ]; then
    printf '%s' "$FAMILY_APP_HOST"
    return
  fi
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/) { print $i; exit } }'
    return
  fi
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  fi
}

set_env() {
  target=$1
  key=$2
  value=$3
  temporary="${target}.tmp.$$"
  if [ -f "$target" ]; then
    awk -v prefix="${key}=" -v replacement="${key}=${value}" '
      index($0, prefix) == 1 { if (!done) print replacement; done = 1; next }
      { print }
      END { if (!done) print replacement }
    ' "$target" > "$temporary"
  else
    printf '%s=%s\n' "$key" "$value" > "$temporary"
  fi
  mv "$temporary" "$target"
}

if ! command -v docker >/dev/null 2>&1; then
  printf '缺少命令：docker\n' >&2
  exit 1
fi

LAN_HOST=$(detect_lan_host)
if [ -z "$LAN_HOST" ]; then
  LAN_HOST=localhost
fi

mkdir -p "$RUNTIME_ROOT"
set_env "$RUNTIME_ENV" FAMILY_APP_HOST "$LAN_HOST"
set_env "$RUNTIME_ENV" FAMILY_APP_PORT "$APP_PORT"
set_env "$RUNTIME_ENV" NEXT_PUBLIC_APP_URL "http://${LAN_HOST}:${APP_PORT}"

run_compose() {
  (cd "$PROJECT_ROOT" && docker compose --env-file "$RUNTIME_ENV" -f docker-compose.yml "$@")
}

case "$ACTION" in
  start|update)
    printf '正在启动 Family…\n'
    run_compose pull family
    run_compose up -d --wait
    printf '\nFamily 已启动：\n'
    printf '  本机：http://localhost:%s\n' "$APP_PORT"
    if [ "$LAN_HOST" != "localhost" ]; then
      printf '  局域网：http://%s:%s\n' "$LAN_HOST" "$APP_PORT"
    fi
    printf '首次打开时请创建本地家庭管理员账号。\n'
    ;;
  stop)
    run_compose stop
    ;;
  status)
    run_compose ps
    ;;
  logs)
    run_compose logs -f family
    ;;
  *)
    printf '用法：%s [start|update|stop|status|logs]\n' "$0" >&2
    exit 2
    ;;
esac
