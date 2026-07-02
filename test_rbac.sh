#!/usr/bin/env bash

set -euo pipefail

KLYN_ROOT="$(pwd)"

source lib/core/security.sh

# Simulate user session
export KLYN_USER="alice"

# Assign role
mkdir -p runtime/users
echo "User" > runtime/users/alice.role

echo "Testing RBAC system..."

echo "Attempting User-level access:"
check_permission "User" && echo "ALLOWED" || echo "DENIED"

echo ""
echo "Attempting Admin-level access:"
check_permission "Admin" && echo "ALLOWED" || echo "DENIED"

