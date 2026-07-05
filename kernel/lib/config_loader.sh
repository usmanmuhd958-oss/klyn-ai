#!/usr/bin/env bash

service_restart_policy() {
    awk -v svc="$1" '
    $1 == svc ":" {f=1; next}
    f && $1 == "restart:" {print $2; exit}
    ' config/services.yaml
}

service_dependencies() {
    awk -v svc="$1" '
    $1 == svc ":" {f=1; next}
    f && $1 == "-" {print $2}
    /^[-a-zA-Z0-9_]+:$/ && $1 != svc ":" {f=0}
    ' config/services.yaml
}
