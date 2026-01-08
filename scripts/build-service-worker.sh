#!/bin/bash
# Build script for MetaChain Service Worker
# Concatenates modular handler files into a single service.js

SOURCE_DIR="public/service-workers"
OUTPUT_FILE="public/service.js"

echo "🔧 Building Service Worker..."

# Concatenate files in order
cat \
  "$SOURCE_DIR/utils.js" \
  "$SOURCE_DIR/db-init.js" \
  "$SOURCE_DIR/handlers/group.handler.js" \
  "$SOURCE_DIR/handlers/chat.handler.js" \
  "$SOURCE_DIR/handlers/contact.handler.js" \
  "$SOURCE_DIR/handlers/profile.handler.js" \
  "$SOURCE_DIR/handlers/beacon.handler.js" \
  "$SOURCE_DIR/handlers/gossip.handler.js" \
  "$SOURCE_DIR/main.js" \
  > "$OUTPUT_FILE"

echo "✅ Service Worker built: $OUTPUT_FILE"
echo "   Lines: $(wc -l < "$OUTPUT_FILE")"
