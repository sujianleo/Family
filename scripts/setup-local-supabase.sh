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

require_compose_include_support() {
  version=$(docker compose version --short 2>/dev/null | sed 's/^v//; s/[^0-9.].*$//')
  major=$(printf '%s' "$version" | cut -d. -f1)
  minor=$(printf '%s' "$version" | cut -d. -f2)
  case "$major:$minor" in
    *[!0-9:]*|:|*:)
      printf '无法识别 Docker Compose 版本，请安装 Docker Compose 2.20 或更高版本。\n' >&2
      exit 1
      ;;
  esac
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 20 ]; }; then
    printf '当前 Docker Compose 为 %s，需要 2.20 或更高版本。\n' "$version" >&2
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

ensure_secret() {
  target=$1
  key=$2
  current=$(read_env "$target" "$key")
  case "$current" in
    ""|replace-with-*) set_env "$target" "$key" "$(openssl rand -hex 32)" ;;
  esac
}

ensure_vapid_keys() {
  target=$1
  public_key=$(read_env "$target" VAPID_PUBLIC_KEY)
  private_key=$(read_env "$target" VAPID_PRIVATE_KEY)
  if [ -z "$public_key" ] || [ -z "$private_key" ]; then
    node_image=${FAMILY_APP_NODE_IMAGE:-node:22-alpine}
    pair=$(docker run --rm --network none --read-only --cap-drop ALL --entrypoint node "$node_image" -e '
      const { generateKeyPairSync } = require("node:crypto");
      const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const publicJwk = publicKey.export({ format: "jwk" });
      const privateJwk = privateKey.export({ format: "jwk" });
      const encoded = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(publicJwk.x, "base64url"),
        Buffer.from(publicJwk.y, "base64url")
      ]).toString("base64url");
      process.stdout.write(`${encoded} ${privateJwk.d}`);
    ')
    public_key=${pair%% *}
    private_key=${pair#* }
    set_env "$target" VAPID_PUBLIC_KEY "$public_key"
    set_env "$target" VAPID_PRIVATE_KEY "$private_key"
  fi
  set_env "$target" NEXT_PUBLIC_VAPID_PUBLIC_KEY "$public_key"
  if [ -z "$(read_env "$target" VAPID_SUBJECT)" ]; then
    set_env "$target" VAPID_SUBJECT "mailto:admin@family-app.local"
  fi
}

default_db_config_volume_name() {
  compose_project=${COMPOSE_PROJECT_NAME:-$(basename "$PROJECT_ROOT")}
  normalized_project=$(printf '%s' "$compose_project" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g; s/^[^a-z0-9]*//')
  printf '%s_db-config' "${normalized_project:-family-app}"
}

prepare_supabase_compose_for_include() {
  compose_file=$1
  temporary="${compose_file}.tmp.$$"
  awk '
    /^name:[[:space:]]*supabase[[:space:]]*$/ { next }
    /^[[:space:]]+# This container name looks inconsistent/ {
      print "    # Realtime derives its tenant from this hostname; Kong also routes to it."
      next
    }
    /^[[:space:]]+container_name:[[:space:]]*realtime-dev\.supabase-realtime[[:space:]]*$/ {
      print "    hostname: realtime-dev.supabase-realtime"
      print "    networks:"
      print "      default:"
      print "        aliases:"
      print "          - realtime-dev.supabase-realtime"
      next
    }
    /^[[:space:]]+container_name:[[:space:]]*/ { next }
    /^  db-config:[[:space:]]*$/ {
      print
      print "    name: ${SUPABASE_DB_CONFIG_VOLUME}"
      in_db_config = 1
      next
    }
    in_db_config && /^    name:[[:space:]]*/ { next }
    in_db_config && !/^    / { in_db_config = 0 }
    { print }
  ' "$compose_file" > "$temporary"
  mv "$temporary" "$compose_file"
}

require_command docker
require_command git
require_command openssl
require_compose_include_support

LAN_HOST=$(detect_lan_host "${1:-}")
case "$LAN_HOST" in
  ""|*[!A-Za-z0-9.:_-]*)
    printf '无法自动识别 NAS 局域网地址。请运行：FAMILY_APP_HOST=192.168.x.x ./start.sh\n' >&2
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
set_env "$APP_ENV" SUPABASE_INTERNAL_URL "http://kong:8000"
set_env "$APP_ENV" SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_env "$APP_ENV" SUPABASE_VOICE_BUCKET voice-notes
ensure_secret "$APP_ENV" FAMILY_APP_CONFIRMATION_SECRET
ensure_secret "$APP_ENV" INVITE_CODE_SECRET
ensure_secret "$APP_ENV" GUEST_CHAT_SESSION_SECRET
ensure_secret "$APP_ENV" GUEST_CHAT_CODE_SECRET
ensure_vapid_keys "$APP_ENV"

printf '正在启动饭米粒与本地 Supabase（首次会下载并构建镜像）…\n'
# Older releases started Supabase as a separate Compose project. Removing only
# those containers keeps the bind-mounted data and the pgsodium key volume intact.
legacy_db_config_volume=""
legacy_container_id=$(docker ps -aq --filter label=com.docker.compose.project=supabase | head -n 1)
if [ -n "$legacy_container_id" ]; then
  legacy_working_dir=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$legacy_container_id" 2>/dev/null || true)
  if [ "$legacy_working_dir" = "$SUPABASE_DOCKER" ]; then
    legacy_db_config_volume="supabase_db-config"
    (cd "$SUPABASE_DOCKER" && docker compose -p supabase down) >/dev/null 2>&1 || true
  fi
fi

DEFAULT_DB_CONFIG_VOLUME=$(default_db_config_volume_name)
DB_CONFIG_VOLUME=$(read_env "$SUPABASE_DOCKER/.env" SUPABASE_DB_CONFIG_VOLUME)
if [ -z "$DB_CONFIG_VOLUME" ]; then
  if [ -n "$legacy_db_config_volume" ]; then
    DB_CONFIG_VOLUME=$legacy_db_config_volume
  elif docker volume inspect "$DEFAULT_DB_CONFIG_VOLUME" >/dev/null 2>&1; then
    DB_CONFIG_VOLUME=$DEFAULT_DB_CONFIG_VOLUME
  elif [ -d "$SUPABASE_DOCKER/volumes/db/data" ] && docker volume inspect supabase_db-config >/dev/null 2>&1; then
    # The old stack may have been stopped with `down`, leaving only its bind
    # mounted database and the pgsodium key volume behind.
    DB_CONFIG_VOLUME="supabase_db-config"
  else
    DB_CONFIG_VOLUME=$DEFAULT_DB_CONFIG_VOLUME
  fi
fi
set_env "$SUPABASE_DOCKER/.env" SUPABASE_DB_CONFIG_VOLUME "$DB_CONFIG_VOLUME"
set_env "$APP_ENV" SUPABASE_DB_CONFIG_VOLUME "$DB_CONFIG_VOLUME"

# Start from the pinned upstream file on every run so the transformation stays
# deterministic even after an earlier release modified the generated Compose.
git -C "$RUNTIME_ROOT" checkout -q -- docker/docker-compose.yml
prepare_supabase_compose_for_include "$SUPABASE_DOCKER/docker-compose.yml"

attempt=1
while ! (cd "$PROJECT_ROOT" && docker compose up --build -d --wait); do
  if [ "$attempt" -ge 3 ]; then
    printf 'Docker 镜像下载、构建或启动失败，请检查 Docker 网络后重新运行。\n' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  printf 'Docker 网络暂时不可用，5 秒后重试（%s/3）…\n' "$attempt"
  sleep 5
done

SCHEMA_EXISTS=$(cd "$PROJECT_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc "select to_regclass('public.app_installation') is not null")
if [ "$SCHEMA_EXISTS" != "t" ]; then
  printf '正在创建家庭数据库…\n'
  (cd "$PROJECT_ROOT" && docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres) < "$PROJECT_ROOT/supabase/schema.sql"
fi

printf '\n部署完成：%s\n' "$APP_LAN_URL"
printf '同一局域网的手机或电脑可直接打开。首次进入会创建家庭管理员。\n'
if [ -n "${FAMILY_APP_PUBLIC_URL:-}" ]; then
  printf '公网入口：%s（请同时为 Supabase 配置 HTTPS 反向代理）\n' "$FAMILY_APP_PUBLIC_URL"
fi
