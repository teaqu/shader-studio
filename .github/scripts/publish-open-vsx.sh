#!/usr/bin/env bash

set -uo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <extension.vsix>" >&2
  exit 2
fi

vsix_path="$1"
max_attempts=3
retry_delay="${OVSX_RETRY_DELAY_SECONDS:-10}"

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  output="$(npx --yes ovsx publish "${vsix_path}" -p "${OVSX_PAT}" --skip-duplicate 2>&1)"
  status=$?
  printf '%s\n' "${output}"

  if [[ ${status} -eq 0 ]]; then
    exit 0
  fi

  if [[ ! "${output}" =~ status[[:space:]]+(429|5[0-9][0-9]) ]] || (( attempt == max_attempts )); then
    exit "${status}"
  fi

  echo "Open VSX publish attempt ${attempt} failed transiently; retrying in ${retry_delay}s." >&2
  sleep "${retry_delay}"
  retry_delay=$((retry_delay * 2))
done
