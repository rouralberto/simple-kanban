#!/usr/bin/env bash
# Move your WeKan boards into simple-kanban in one go.
#
#   ./migrate-from-wekan.sh --mongo-container mongodb            # WeKan's Mongo runs in Docker
#   ./migrate-from-wekan.sh --mongo-url mongodb://host:27017/wekan
#
# Options:
#   --mongo-container NAME   Docker container running WeKan's MongoDB. A temporary socat
#                            sidecar exposes it on 127.0.0.1 for the duration of the import,
#                            so you don't need to publish Mongo's port.
#   --mongo-url URL          Connect directly instead (include the database name).
#   --db NAME                Database name when using --mongo-container (default: wekan).
#   --wekan-files DIR        Host folder mounted as WeKan's /data (WRITABLE_PATH). Only needed when
#                            attachments live on disk rather than in GridFS.
#   --data-dir DIR           Where simple-kanban keeps kanban.db + uploads (default: ./data).
#   --dry-run, --include-templates, --skip-archived   passed through to the importer.
#
# Nothing in WeKan is modified. Re-running only adds what is missing.
set -euo pipefail
cd "$(dirname "$0")"

MONGO_CONTAINER="" MONGO_URL="" DB_NAME="wekan" PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mongo-container) MONGO_CONTAINER="$2"; shift 2 ;;
    --mongo-url) MONGO_URL="$2"; shift 2 ;;
    --db) DB_NAME="$2"; shift 2 ;;
    --wekan-files|--data-dir) PASS+=("$1" "$(cd "$2" && pwd)"); shift 2 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PASS+=("$1"); shift ;;
  esac
done

if [[ -z "$MONGO_CONTAINER" && -z "$MONGO_URL" ]]; then
  echo "Need --mongo-container NAME or --mongo-url URL (see --help)." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js 22+ is required." >&2; exit 1; }
if [[ ! -d node_modules/mongodb ]]; then
  echo "Installing dependencies…"
  npm install --ignore-scripts --no-fund --no-audit >/dev/null
fi

BRIDGE=""
cleanup() { [[ -n "$BRIDGE" ]] && docker rm -f "$BRIDGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [[ -n "$MONGO_CONTAINER" ]]; then
  command -v docker >/dev/null || { echo "docker not found." >&2; exit 1; }
  NETWORK=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$MONGO_CONTAINER" | awk '{print $1}')
  [[ -n "$NETWORK" ]] || { echo "Container $MONGO_CONTAINER is not running or has no network." >&2; exit 1; }
  PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  BRIDGE="wekan-bridge-$$"
  echo "Bridging $MONGO_CONTAINER (network $NETWORK) to 127.0.0.1:${PORT}…"
  docker run -d --rm --name "$BRIDGE" --network "$NETWORK" -p "127.0.0.1:$PORT:27017" \
    alpine/socat -d TCP-LISTEN:27017,fork,reuseaddr "TCP:$MONGO_CONTAINER:27017" >/dev/null
  MONGO_URL="mongodb://127.0.0.1:$PORT/$DB_NAME?directConnection=true"
  sleep 1
fi

node scripts/import-wekan.mjs --mongo "$MONGO_URL" "${PASS[@]+"${PASS[@]}"}"

cat <<'EOF'

Next steps:
  npm run build && npm start        # or: docker compose up -d --build
  open http://localhost:3000 and log in with your WeKan username (or email) and password.
EOF
