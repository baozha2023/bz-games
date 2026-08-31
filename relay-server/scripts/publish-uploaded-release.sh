#!/usr/bin/env bash
set -Eeuo pipefail

staging_id="${1:-}"
[[ "$staging_id" =~ ^action-[0-9]+-[0-9]+$ ]] || {
  echo "invalid release staging id" >&2
  exit 64
}

storage_root="/var/lib/bz-games-releases"
staged_dir="$storage_root/.incoming/$staging_id"
[[ ! -e "$staged_dir" ]]
cleanup() {
  rm -rf -- "$staged_dir"
}
trap cleanup EXIT
umask 077
mkdir -- "$staged_dir"
tar -x --no-same-owner --no-same-permissions -C "$staged_dir"
/usr/bin/node /opt/bz-games-relay/scripts/publish-desktop-release.js \
  --staged-dir "$staged_dir" \
  --channel stable \
  --allow-downgrade false
