#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

echo '正在启动批准版本 / Starting the approved EmergentInc release...'
if ! command -v node >/dev/null 2>&1; then
  echo '[ERROR] 请安装 Node.js 24+ / Install Node.js 24+.' >&2
  exit 1
fi

# Existing workspaces use their approved frozen release; only new installations build.
if node scripts/launch-approved.mjs --check; then
  :
else
  launch_status=$?
  if [ "$launch_status" -ne 2 ]; then
    echo '[ERROR] 批准版本校验失败 / Approved release validation failed.' >&2
    exit "$launch_status"
  fi
  npm run build
  npm --prefix frontend run build
fi

export EMERGENT_LLM_TRACE="${EMERGENT_LLM_TRACE:-1}"
exec node scripts/launch-approved.mjs --open-browser "$@"
