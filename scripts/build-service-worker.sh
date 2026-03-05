#!/bin/bash
# Build script for MetaChain Service Worker
# Concatenates modular handler files into a single service.js

SOURCE_DIR="public/service-workers"
OUTPUT_FILE="public/service.js"

echo "🔧 Building Service Worker..."

# Concatenate files in order
# Concatenate files in order (with newlines to prevent syntax errors)
files=(
  "$SOURCE_DIR/utils.js"
  "$SOURCE_DIR/utils/maxima-sender.js"
  "$SOURCE_DIR/utils/tx-checker.js"
  "$SOURCE_DIR/utils/coin-discovery.js"
  "$SOURCE_DIR/db-init.js"
  "$SOURCE_DIR/handlers/group.handler.js"
  "$SOURCE_DIR/handlers/channel.handler.js"
  "$SOURCE_DIR/handlers/chat.handler.js"
  "$SOURCE_DIR/handlers/contact.handler.js"
  "$SOURCE_DIR/handlers/profile.handler.js"
  "$SOURCE_DIR/handlers/transaction.handler.js"
  "$SOURCE_DIR/handlers/beacon.handler.js"
  "$SOURCE_DIR/handlers/gossip.handler.js"
  "$SOURCE_DIR/main.js"
)

# Clear output file
> "$OUTPUT_FILE"

for f in "${files[@]}"; do
  if [ -f "$f" ]; then
    cat "$f" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE" # Force newline
  else
    echo "⚠️ Warning: File not found: $f"
  fi
done

echo "✅ Service Worker built: $OUTPUT_FILE"
echo "   Lines: $(wc -l < "$OUTPUT_FILE")"
