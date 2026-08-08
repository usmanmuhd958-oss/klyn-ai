#!/bin/bash
# Secure secrets storage – for demo, use gpg-encrypted file
SECRETS_FILE="${PROJECT_ROOT:-..}/config/secrets.gpg"

load_secrets() {
    if [ -f "$SECRETS_FILE" ]; then
        gpg --decrypt "$SECRETS_FILE" 2>/dev/null
    else
        echo "Warning: No secrets file found."
    fi
}
# Usage: eval $(load_secrets)
