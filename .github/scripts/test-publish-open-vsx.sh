#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_SCRIPT="${SCRIPT_DIR}/publish-open-vsx.sh"
WORKFLOW="${SCRIPT_DIR}/../workflows/release-extension.yml"
REPOSITORY_ROOT="${SCRIPT_DIR}/../.."
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

export PATH="${TEST_DIR}:${PATH}"
export MOCK_ATTEMPTS_FILE="${TEST_DIR}/attempts"
export OVSX_RETRY_DELAY_SECONDS=0
export OVSX_PAT=test-token

cat > "${TEST_DIR}/npx" <<'EOF'
#!/usr/bin/env bash

attempt=0
if [[ -f "${MOCK_ATTEMPTS_FILE}" ]]; then
  attempt="$(cat "${MOCK_ATTEMPTS_FILE}")"
fi
attempt=$((attempt + 1))
printf '%s' "${attempt}" > "${MOCK_ATTEMPTS_FILE}"

if [[ " $* " != *" -p ${OVSX_PAT} "* ]]; then
  echo 'Open VSX token was not passed to the CLI.' >&2
  exit 97
fi

IFS=',' read -r -a responses <<< "${MOCK_RESPONSES}"
response_index=$((attempt - 1))
if (( response_index >= ${#responses[@]} )); then
  response_index=$((${#responses[@]} - 1))
fi

case "${responses[response_index]}" in
  success)
    echo "Published successfully"
    exit 0
    ;;
  *)
    echo "The server responded with status ${responses[response_index]}" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${TEST_DIR}/npx"

run_case() {
  local responses="$1"
  local expected_status="$2"
  local expected_attempts="$3"

  rm -f "${MOCK_ATTEMPTS_FILE}"
  export MOCK_RESPONSES="${responses}"

  set +e
  bash "${PUBLISH_SCRIPT}" shader-studio-test.vsix >/dev/null 2>&1
  actual_status=$?
  set -e

  actual_attempts="$(cat "${MOCK_ATTEMPTS_FILE}")"
  [[ "${actual_status}" -eq "${expected_status}" ]] || {
    echo "Expected status ${expected_status}, got ${actual_status} for ${responses}." >&2
    exit 1
  }
  [[ "${actual_attempts}" -eq "${expected_attempts}" ]] || {
    echo "Expected ${expected_attempts} attempts, got ${actual_attempts} for ${responses}." >&2
    exit 1
  }
}

run_case '503,503,success' 0 3
run_case '429,success' 0 2
run_case '401,success' 1 1
run_case '503,503,503,success' 1 3

set +e
bash "${PUBLISH_SCRIPT}" >/dev/null 2>&1
usage_status=$?
set -e
[[ "${usage_status}" -eq 2 ]] || {
  echo "Expected missing VSIX path to exit 2, got ${usage_status}." >&2
  exit 1
}

grep -q 'uses: actions/checkout@v7' "${WORKFLOW}"
grep -q 'uses: actions/setup-node@v6' "${WORKFLOW}"
grep -q 'uses: actions/upload-artifact@v7' "${WORKFLOW}"
grep -q 'uses: actions/download-artifact@v8' "${WORKFLOW}"
if grep -Eq 'uses: actions/(checkout|setup-node|upload-artifact|download-artifact)@v4' "${WORKFLOW}"; then
  echo 'Release workflow still uses a Node 20 action.' >&2
  exit 1
fi

extension_version="$(node -p "require('${REPOSITORY_ROOT}/extension/package.json').version")"
lock_version="$(node -p "require('${REPOSITORY_ROOT}/package-lock.json').packages.extension.version")"
[[ "${extension_version}" == '1.0.2' && "${lock_version}" == "${extension_version}" ]] || {
  echo "Expected synchronized extension version 1.0.2, got manifest=${extension_version}, lock=${lock_version}." >&2
  exit 1
}

echo 'Open VSX publish retry tests passed.'
