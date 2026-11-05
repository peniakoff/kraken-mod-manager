#!/usr/bin/env bash
# Rasterise the SVG brand sources in assets/brand into the PNG and ICO files
# that browsers, PWA installers and the README need. Requires Chrome or
# Chromium (set CHROME to override) and ImageMagick 7 (`magick`).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
brand="$root/assets/brand"
public="$root/apps/frontend/public"
chrome="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

render() {
  local source="$1" size="$2" output="$3"
  cat >"$work/page.html" <<HTML
<!doctype html><html><body style="margin:0;background:transparent">
<img src="file://$source" width="$size" height="$size" style="display:block">
</body></html>
HTML
  "$chrome" --headless=new --disable-gpu --no-first-run --hide-scrollbars \
    --user-data-dir="$work/profile" --allow-file-access-from-files \
    --default-background-color=00000000 --window-size="$size,$size" \
    --screenshot="$output" "file://$work/page.html" >/dev/null 2>&1
  local actual
  actual="$(magick identify -format '%wx%h' "$output")"
  if [[ "$actual" != "${size}x${size}" ]]; then
    echo "render: $output is $actual, expected ${size}x${size}" >&2
    exit 1
  fi
}

render "$brand/kraken-app-icon.svg" 16 "$public/favicon-16x16.png"
render "$brand/kraken-app-icon.svg" 32 "$public/favicon-32x32.png"
render "$brand/kraken-app-icon.svg" 48 "$work/favicon-48.png"
render "$brand/kraken-app-icon-maskable.svg" 180 "$public/apple-touch-icon.png"
render "$brand/kraken-app-icon.svg" 192 "$public/icon-192.png"
render "$brand/kraken-app-icon.svg" 512 "$public/icon-512.png"
render "$brand/kraken-app-icon-maskable.svg" 512 "$public/icon-maskable-512.png"
render "$brand/kraken-mark.svg" 512 "$root/assets/logo.png"
render "$brand/kraken-mark.svg" 256 "$root/assets/logo-256.png"

magick "$public/favicon-16x16.png" "$public/favicon-32x32.png" "$work/favicon-48.png" "$public/favicon.ico"
cp "$brand/kraken-app-icon.svg" "$public/favicon.svg"
cp "$brand/kraken-mark.svg" "$public/kraken-mark.svg"
echo "Brand icons written to $public and $root/assets"
