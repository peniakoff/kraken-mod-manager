#!/usr/bin/env bash
# Runs the Linux SEA inside a container image without Node.js and checks the
# health endpoint, to prove the binary does not depend on a host Node install.
set -euo pipefail

runtime="${CONTAINER_RUNTIME:-docker}"
image="${KMM_NO_NODE_IMAGE:-debian:bookworm-slim}"
script_directory="$(cd "$(dirname "$0")" && pwd)"
binary="$(realpath "${1:-$script_directory/../dist/kraken-mod-manager-linux-x64}")"
port="${KMM_SMOKE_PORT:-31499}"
name="kmm-no-node-$$"

if [[ ! -x "$binary" ]]; then
  echo "SEA binary not found or not executable: $binary" >&2
  exit 1
fi

# label=disable lets SELinux hosts (Fedora) read the bind-mounted binary
# without relabelling the user's file; it is a no-op elsewhere.
run_flags=(--network host --security-opt label=disable)

if "$runtime" run --rm "${run_flags[@]}" "$image" sh -c 'command -v node' >/dev/null; then
  echo "Image $image unexpectedly provides node; the check would prove nothing." >&2
  exit 1
fi

"$runtime" run -d --name "$name" "${run_flags[@]}" \
  -e KMM_PORT="$port" -e KMM_OPEN_BROWSER=false \
  -v "$binary:/opt/kraken-mod-manager:ro" \
  "$image" /opt/kraken-mod-manager >/dev/null

cleanup() {
  "$runtime" rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if body="$(curl -fsS "http://127.0.0.1:$port/api/v1/health" 2>/dev/null)"; then
    if [[ "$body" == *'"status":"ok"'* ]]; then
      echo "SEA is healthy in $image without Node.js: $body"
      exit 0
    fi
    echo "Unexpected health response: $body" >&2
    break
  fi
  sleep 0.5
done

echo "SEA did not become healthy in $image. Container logs:" >&2
"$runtime" logs "$name" >&2 || true
exit 1
