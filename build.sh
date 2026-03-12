#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

XPI_NAME="enterscholar-translator.xpi"

rm -f "$XPI_NAME"

zip -r "$XPI_NAME" \
  manifest.json \
  bootstrap.js \
  prefs.js \
  content/ \
  locale/ \
  -x "*.DS_Store" -x "__MACOSX/*"

echo ""
echo "Built: $SCRIPT_DIR/$XPI_NAME ($(du -h "$XPI_NAME" | cut -f1))"
echo ""
echo "Install in Zotero:"
echo "  1. Open Zotero 7"
echo "  2. Tools -> Plugins"
echo "  3. Gear icon -> Install Plugin From File..."
echo "  4. Select: $SCRIPT_DIR/$XPI_NAME"
