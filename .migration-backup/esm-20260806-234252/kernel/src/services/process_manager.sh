#!/bin/bash
list_services() {
    # Only show the API service – it's the main one
    if pgrep -f "node api/server.js" >/dev/null 2>&1; then
        echo "api (RUNNING)"
    else
        echo "api (DEAD)"
    fi
}
