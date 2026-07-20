#!/bin/sh

set -eu

SUPABASE_REVISION="3d07613c2bc96c21aa9f74de23bc7a3ca2ca8dd0"
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_ROOT="$PROJECT_ROOT/.runtime/local-supabase"
SUPABASE_DOCKER="$RUNTIME_ROOT/docker"
APP_ENV="$PROJECT_ROOT/.env"
APP_PORT=${FAMILY_APP_PORT:-3000}
API_PORT=${SUPABASE_API_PORT:-8000}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '缺少命令：%s\n' "$1" >&2
    exit 1
  fi
}

detect_lan_host() {
  if [ -n "${FAMILY_APP_HOST:-}" ]; then
    printf '%s' "$FAMILY_APP_HOST"
    return
  fi
  if [ "$#" -gt 0 ] && [ -n "$1" ]; then
    printf '%s' "$1"
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

read_env() {
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

require_command docker
require_command git
require_command openssl

LAN_HOST=$(detect_lan_host "${1:-}")
case "$LAN_HOST" in
  ""|*[!A-Za-z0-9.:_-]*)
    printf '无法自动识别 NAS 局域网地址。请运行：FAMILY_APP_HOST=192.168.x.x %s\n' "$0" >&2
    exit 1
    ;;
esac

mkdir -p "$PROJECT_ROOT/.runtime"
if [ ! -d "$RUNTIME_ROOT/.git" ]; then
  if [ -e "$RUNTIME_ROOT" ]; then
    printf '运行目录已存在但不是完整安装：%s\n' "$RUNTIME_ROOT" >&2
    exit 1
  fi
  mkdir -p "$RUNTIME_ROOT"
  git -C "$RUNTIME_ROOT" init -q
  git -C "$RUNTIME_ROOT" remote add origin https://github.com/supabase/supabase.git
  git -C "$RUNTIME_ROOT" sparse-checkout init --cone
  git -C "$RUNTIME_ROOT" sparse-checkout set docker
  git -C "$RUNTIME_ROOT" fetch -q --depth 1 --filter=blob:none origin "$SUPABASE_REVISION"
  git -C "$RUNTIME_ROOT" checkout -q --detach FETCH_HEAD
fi

if [ ! -f "$SUPABASE_DOCKER/.env" ]; then
  cp "$SUPABASE_DOCKER/.env.example" "$SUPABASE_DOCKER/.env"
  (cd "$SUPABASE_DOCKER" && sh utils/generate-keys.sh --update-env >/dev/null)
fi

SUPABASE_LAN_URL="http://${LAN_HOST}:${API_PORT}"
APP_LAN_URL="http://${LAN_HOST}:${APP_PORT}"
set_env "$SUPABASE_DOCKER/.env" KONG_HTTP_PORT "$API_PORT"
set_env "$SUPABASE_DOCKER/.env" SUPABASE_PUBLIC_URL "$SUPABASE_LAN_URL"
set_env "$SUPABASE_DOCKER/.env" API_EXTERNAL_URL "$SUPABASE_LAN_URL/auth/v1"
set_env "$SUPABASE_DOCKER/.env" SITE_URL "$APP_LAN_URL"
set_env "$SUPABASE_DOCKER/.env" ADDITIONAL_REDIRECT_URLS "${FAMILY_APP_PUBLIC_URL:-}"
set_env "$SUPABASE_DOCKER/.env" ENABLE_PHONE_SIGNUP true
set_env "$SUPABASE_DOCKER/.env" ENABLE_PHONE_AUTOCONFIRM true

printf '正在启动本地 Supabase（首次会下载镜像）…\n'
attempt=1
while ! (cd "$SUPABASE_DOCKER" && docker compose up -d --wait); do
  if [ "$attempt" -ge 3 ]; then
    printf 'Supabase 镜像下载或启动失败，请检查 Docker 网络后重新运行。\n' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  printf 'Docker 网络暂时不可用，5 秒后重试（%s/3）…\n' "$attempt"
  sleep 5
done

SCHEMA_EXISTS=$(cd "$SUPABASE_DOCKER" && docker compose exec -T db psql -U postgres -d postgres -Atqc "select to_regclass('public.app_installation') is not null")
if [ "$SCHEMA_EXISTS" != "t" ]; then
  printf '正在创建家庭数据库…\n'
  (cd "$SUPABASE_DOCKER" && docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres) < "$PROJECT_ROOT/supabase/schema.sql"
fi

ANON_KEY=$(read_env "$SUPABASE_DOCKER/.env" ANON_KEY)
SERVICE_ROLE_KEY=$(read_env "$SUPABASE_DOCKER/.env" SERVICE_ROLE_KEY)
set_env "$APP_ENV" FAMILY_APP_LAN_ADDRESS "$LAN_HOST"
set_env "$APP_ENV" FAMILY_APP_PORT "$APP_PORT"
set_env "$APP_ENV" FAMILY_APP_ALLOW_FILE_FALLBACK false
set_env "$APP_ENV" FAMILY_APP_AUTH_REQUIRED true
set_env "$APP_ENV" NEXT_PUBLIC_FAMILY_APP_AUTH_REQUIRED true
set_env "$APP_ENV" NEXT_PUBLIC_FAMILY_APP_AUTH_PROVIDER supabase
set_env "$APP_ENV" NEXT_PUBLIC_APP_URL "$APP_LAN_URL"
set_env "$APP_ENV" NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_LAN_URL"
set_env "$APP_ENV" NEXT_PUBLIC_SUPABASE_PUBLIC_URL "${FAMILY_APP_SUPABASE_PUBLIC_URL:-}"
set_env "$APP_ENV" NEXT_PUBLIC_SUPABASE_LAN_PORT "$API_PORT"
set_env "$APP_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON_KEY"
set_env "$APP_ENV" SUPABASE_INTERNAL_URL "http://host.docker.internal:${API_PORT}"
set_env "$APP_ENV" SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_env "$APP_ENV" SUPABASE_VOICE_BUCKET voice-notes

printf '正在启动我爱饭米粒…\n'
(cd "$PROJECT_ROOT" && docker compose up --build -d --wait)

printf '\n部署完成：%s\n' "$APP_LAN_URL"
printf '同一局域网的手机或电脑可直接打开。首次进入会创建家庭管理员。\n'
if [ -n "${FAMILY_APP_PUBLIC_URL:-}" ]; then
  printf '公网入口：%s（请同时为 Supabase 配置 HTTPS 反向代理）\n' "$FAMILY_APP_PUBLIC_URL"
fi
