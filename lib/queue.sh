#!/bin/bash
#!/usr/bin/env bash

fetch_jobs() {
  curl -fsS \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_URL/rest/v1/job_queue?status=eq.pending&order=priority.asc&limit=5"
}
