#!/bin/bash
PLUGIN_DIR="$HOME/klyn-ai-os/plugins/installed"
for plugin in $(ls "$PLUGIN_DIR" 2>/dev/null); do
  if [ -f "$PLUGIN_DIR/$plugin/init.sh" ]; then
    source "$PLUGIN_DIR/$plugin/init.sh"
    echo "Auto-loaded plugin: $plugin" >> runtime/logs/plugins.log
  fi
done
