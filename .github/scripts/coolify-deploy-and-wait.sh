#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <coolify-resource-uuid[,uuid...]> [force]" >&2
  exit 2
fi

RESOURCE_UUIDS="$1"
FORCE="${2:-false}"
COOLIFY_API_URL="${COOLIFY_API_URL:-https://app.coolify.io/api/v1}"
COOLIFY_DEPLOY_TIMEOUT_SECONDS="${COOLIFY_DEPLOY_TIMEOUT_SECONDS:-900}"
COOLIFY_DEPLOY_POLL_INTERVAL_SECONDS="${COOLIFY_DEPLOY_POLL_INTERVAL_SECONDS:-10}"

if [ -z "${COOLIFY_API_KEY:-}" ]; then
  echo "COOLIFY_API_KEY is required." >&2
  exit 1
fi

if [ -z "${RESOURCE_UUIDS:-}" ]; then
  echo "Coolify resource UUID is required." >&2
  exit 1
fi

api_base="${COOLIFY_API_URL%/}"
trigger_response="$(mktemp)"

curl --fail --show-error --silent   --get "${api_base}/deploy"   --header "Authorization: Bearer ${COOLIFY_API_KEY}"   --header "Accept: application/json"   --data-urlencode "uuid=${RESOURCE_UUIDS}"   --data-urlencode "force=${FORCE}"   > "${trigger_response}"

python3 - "${trigger_response}" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
for item in data.get('deployments', []) if isinstance(data, dict) else []:
    message = item.get('message') or 'Deployment queued'
    resource_uuid = item.get('resource_uuid') or 'unknown-resource'
    deployment_uuid = item.get('deployment_uuid') or 'unknown-deployment'
    print(f"Coolify queued {resource_uuid}: {deployment_uuid} ({message})")
PY

mapfile -t deployment_uuids < <(python3 - "${trigger_response}" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
for item in data.get('deployments', []) if isinstance(data, dict) else []:
    deployment_uuid = item.get('deployment_uuid')
    if deployment_uuid:
        print(deployment_uuid)
PY
)

if [ "${#deployment_uuids[@]}" -eq 0 ]; then
  echo "Coolify deploy response did not include a deployment UUID." >&2
  cat "${trigger_response}" >&2
  exit 1
fi

for deployment_uuid in "${deployment_uuids[@]}"; do
  echo "Waiting for Coolify deployment ${deployment_uuid}"
  deadline=$((SECONDS + COOLIFY_DEPLOY_TIMEOUT_SECONDS))
  last_status=""

  deployment_finished=0
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    status_response="$(mktemp)"
    http_code="$(curl --show-error --silent       --output "${status_response}"       --write-out "%{http_code}"       --header "Authorization: Bearer ${COOLIFY_API_KEY}"       --header "Accept: application/json"       "${api_base}/deployments/${deployment_uuid}" || true)"

    if [ "${http_code}" -ge 200 ] && [ "${http_code}" -lt 300 ]; then
      status="$(python3 - "${status_response}" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    print('')
else:
    print(str(data.get('status') or ''))
PY
)"
      if [ "${status}" != "${last_status}" ]; then
        echo "Coolify deployment ${deployment_uuid} status: ${status:-unknown}"
        last_status="${status}"
      fi

      status_lower="$(printf '%s' "${status}" | tr '[:upper:]' '[:lower:]')"
      case "${status_lower}" in
        finished*|success*|succeeded*|completed*)
          echo "Coolify deployment ${deployment_uuid} finished successfully."
          deployment_finished=1
          break
          ;;
        failed*|error*|errored*|cancelled*|canceled*)
          echo "Coolify deployment ${deployment_uuid} ended with status: ${status}" >&2
          exit 1
          ;;
      esac
    else
      echo "Coolify deployment ${deployment_uuid} status lookup returned HTTP ${http_code}; retrying..."
    fi

    sleep "${COOLIFY_DEPLOY_POLL_INTERVAL_SECONDS}"
  done

  if [ "${deployment_finished}" -ne 1 ]; then
    echo "Timed out waiting for Coolify deployment ${deployment_uuid}." >&2
    exit 1
  fi
done
