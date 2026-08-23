#!/usr/bin/env bash
# Runs the pure-logic unit tests with Node's built-in type stripping — no test
# runner needed. Modules are staged into a temp folder first because Node can't
# resolve the "@/" path alias; "@/lib/x" is rewritten to a relative "./x.ts".
# Type-only imports (e.g. "@/types") are erased by the type stripper, so they
# never need staging.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=".test-run"
# Tolerate a temp dir that can't be removed (e.g. a sandboxed mount): staged
# files are overwritten by name, so a stale folder is harmless.
rm -rf "$TMP" 2>/dev/null || true
mkdir -p "$TMP"
trap 'rm -rf "$TMP" 2>/dev/null || true' EXIT

# Every lib a test touches, directly or transitively.
LIBS="roster rosterCompliance rosterForecast staffing positions"

for lib in $LIBS; do
  sed -E 's#"@/lib/([A-Za-z]+)"#"./\1.ts"#g' "src/lib/$lib.ts" > "$TMP/$lib.ts"
done

status=0
for t in scripts/*.test.ts; do
  name="$(basename "$t")"
  sed -E 's#"@/lib/([A-Za-z]+)"#"./\1.ts"#g' "$t" > "$TMP/$name"
  echo "── $name"
  node --experimental-strip-types "$TMP/$name" || status=1
done
exit $status
