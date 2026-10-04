BEGIN;

CREATE TABLE IF NOT EXISTS klyn_missions (
  mission_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('INTENT_CAPTURED','ENVELOPE_DEFINED','PLAN_GENERATED','ACTION_EXECUTED','ARTIFACT_PRODUCED','AUTOMATED_VERIFICATION','HUMAN_APPROVAL','PRODUCTION_ROLLOUT_AUDITED')),
  breaker_level TEXT NOT NULL DEFAULT 'NONE' CHECK (breaker_level IN ('NONE','SOFT_HALT','EXECUTION_HALT','MISSION_HALT','TENANT_HALT')),
  breaker_reason TEXT,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  ledger_sequence BIGINT NOT NULL DEFAULT 0 CHECK (ledger_sequence >= 0),
  ledger_head_hash BYTEA NOT NULL DEFAULT decode(repeat('00',32),'hex') CHECK (octet_length(ledger_head_hash)=32),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS klyn_ledger_events (
  event_id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES klyn_missions(mission_id),
  execution_id UUID,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id UUID NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  previous_hash BYTEA NOT NULL CHECK (octet_length(previous_hash)=32),
  payload_hash BYTEA NOT NULL CHECK (octet_length(payload_hash)=32),
  event_hash BYTEA NOT NULL CHECK (octet_length(event_hash)=32),
  payload JSONB NOT NULL,
  UNIQUE (mission_id, sequence),
  UNIQUE (mission_id, event_hash)
);

CREATE INDEX IF NOT EXISTS idx_klyn_ledger_mission_sequence ON klyn_ledger_events(mission_id, sequence);
CREATE INDEX IF NOT EXISTS idx_klyn_ledger_event_type ON klyn_ledger_events(event_type);

CREATE TABLE IF NOT EXISTS klyn_ledger_checkpoints (
  checkpoint_id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES klyn_missions(mission_id),
  first_sequence BIGINT NOT NULL,
  last_sequence BIGINT NOT NULL,
  leaf_count BIGINT NOT NULL,
  root_hash BYTEA NOT NULL CHECK (octet_length(root_hash)=32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mission_id, last_sequence)
);

CREATE TABLE IF NOT EXISTS klyn_idempotency_keys (
  tenant_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest BYTEA NOT NULL CHECK (octet_length(request_digest)=32),
  result_digest BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS klyn_resource_envelopes (
  envelope_id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES klyn_missions(mission_id),
  execution_id UUID NOT NULL UNIQUE,
  policy_id UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > issued_at),
  input_tokens_max NUMERIC(30,0) NOT NULL CHECK (input_tokens_max >= 0),
  output_tokens_max NUMERIC(30,0) NOT NULL CHECK (output_tokens_max >= 0),
  total_tokens_max NUMERIC(30,0) NOT NULL CHECK (total_tokens_max >= 0 AND total_tokens_max <= input_tokens_max + output_tokens_max),
  cpu_millicores INTEGER NOT NULL CHECK (cpu_millicores >= 0),
  memory_bytes NUMERIC(30,0) NOT NULL CHECK (memory_bytes >= 0),
  gpu_millicores INTEGER NOT NULL CHECK (gpu_millicores >= 0),
  disk_write_bytes_max NUMERIC(30,0) NOT NULL CHECK (disk_write_bytes_max >= 0),
  network_egress_bytes_max NUMERIC(30,0) NOT NULL CHECK (network_egress_bytes_max >= 0),
  mission_timeout_ms BIGINT NOT NULL CHECK (mission_timeout_ms > 0),
  execution_timeout_ms BIGINT NOT NULL CHECK (execution_timeout_ms > 0 AND execution_timeout_ms <= mission_timeout_ms),
  tool_timeout_ms BIGINT NOT NULL CHECK (tool_timeout_ms > 0 AND tool_timeout_ms <= execution_timeout_ms),
  allowed_capabilities JSONB NOT NULL,
  network_policy JSONB NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS klyn_resource_reservations (
  reservation_id UUID PRIMARY KEY,
  envelope_id UUID NOT NULL REFERENCES klyn_resource_envelopes(envelope_id),
  execution_id UUID NOT NULL,
  input_tokens NUMERIC(30,0) NOT NULL CHECK (input_tokens >= 0),
  output_tokens NUMERIC(30,0) NOT NULL CHECK (output_tokens >= 0),
  cpu_millicores_ms NUMERIC(30,0) NOT NULL CHECK (cpu_millicores_ms >= 0),
  memory_bytes NUMERIC(30,0) NOT NULL CHECK (memory_bytes >= 0),
  gpu_millicores_ms NUMERIC(30,0) NOT NULL CHECK (gpu_millicores_ms >= 0),
  disk_write_bytes NUMERIC(30,0) NOT NULL CHECK (disk_write_bytes >= 0),
  network_egress_bytes NUMERIC(30,0) NOT NULL CHECK (network_egress_bytes >= 0),
  wall_clock_ms BIGINT NOT NULL CHECK (wall_clock_ms >= 0),
  committed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS klyn_credentials (
  credential_id UUID PRIMARY KEY,
  execution_id UUID NOT NULL,
  provider TEXT NOT NULL,
  scopes JSONB NOT NULL,
  audience TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token_hash BYTEA NOT NULL CHECK (octet_length(token_hash)=32),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT credential_max_ttl CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '15 minutes')
);

CREATE TABLE IF NOT EXISTS klyn_workers (
  worker_id UUID PRIMARY KEY,
  execution_class TEXT NOT NULL,
  available_memory_bytes NUMERIC(30,0) NOT NULL,
  available_cpu_cores INTEGER NOT NULL,
  has_gpu BOOLEAN NOT NULL,
  privacy_domain TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  model_capabilities JSONB NOT NULL,
  queue_depth INTEGER NOT NULL CHECK (queue_depth >= 0),
  latency_p50_ms DOUBLE PRECISION NOT NULL CHECK (latency_p50_ms >= 0),
  estimated_cost_milliunits DOUBLE PRECISION NOT NULL CHECK (estimated_cost_milliunits >= 0),
  health TEXT NOT NULL,
  network_available BOOLEAN NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS klyn_context_nodes (
  node_id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES klyn_missions(mission_id),
  layer TEXT NOT NULL CHECK (layer IN ('L0','L1','L2')),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_digest BYTEA NOT NULL CHECK (octet_length(content_digest)=32),
  token_cost INTEGER NOT NULL CHECK (token_cost >= 0),
  importance DOUBLE PRECISION NOT NULL CHECK (importance >= 0 AND importance <= 1),
  critical BOOLEAN NOT NULL,
  source_event_ids JSONB NOT NULL,
  parent_node_ids JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION klyn_commit_transition(
  p_mission_id UUID, p_execution_id UUID, p_expected_version BIGINT,
  p_from_state TEXT, p_to_state TEXT, p_event_id UUID, p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ, p_actor_id UUID, p_schema_version INTEGER,
  p_previous_hash BYTEA, p_payload_hash BYTEA, p_event_hash BYTEA, p_payload JSONB
) RETURNS TABLE(new_version BIGINT, ledger_sequence BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  current_mission klyn_missions%ROWTYPE;
  next_sequence BIGINT;
BEGIN
  SELECT * INTO current_mission FROM klyn_missions
  WHERE mission_id=p_mission_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_NOT_FOUND'; END IF;
  IF current_mission.breaker_level <> 'NONE' THEN RAISE EXCEPTION 'BREAKER_ACTIVE'; END IF;
  IF current_mission.version <> p_expected_version OR current_mission.state <> p_from_state THEN
    RAISE EXCEPTION 'STATE_CONFLICT';
  END IF;
  IF current_mission.ledger_head_hash <> p_previous_hash THEN RAISE EXCEPTION 'LEDGER_HEAD_MISMATCH'; END IF;

  next_sequence := current_mission.ledger_sequence + 1;

  INSERT INTO klyn_ledger_events(
    event_id,mission_id,execution_id,sequence,event_type,occurred_at,actor_id,
    schema_version,previous_hash,payload_hash,event_hash,payload
  ) VALUES (
    p_event_id,p_mission_id,p_execution_id,next_sequence,p_event_type,p_occurred_at,p_actor_id,
    p_schema_version,p_previous_hash,p_payload_hash,p_event_hash,p_payload
  );

  UPDATE klyn_missions SET
    state=p_to_state, version=version+1, ledger_sequence=next_sequence,
    ledger_head_hash=p_event_hash, updated_at=p_occurred_at
  WHERE mission_id=p_mission_id;

  RETURN QUERY SELECT current_mission.version+1, next_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION klyn_trigger_breaker(
  p_mission_id UUID, p_expected_version BIGINT, p_level TEXT, p_reason TEXT,
  p_event_id UUID, p_occurred_at TIMESTAMPTZ, p_actor_id UUID,
  p_schema_version INTEGER, p_previous_hash BYTEA, p_payload_hash BYTEA,
  p_event_hash BYTEA, p_payload JSONB
) RETURNS TABLE(new_version BIGINT, ledger_sequence BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  current_mission klyn_missions%ROWTYPE;
  next_sequence BIGINT;
BEGIN
  SELECT * INTO current_mission FROM klyn_missions
  WHERE mission_id=p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_NOT_FOUND'; END IF;
  IF current_mission.version <> p_expected_version THEN RAISE EXCEPTION 'STATE_CONFLICT'; END IF;
  IF current_mission.ledger_head_hash <> p_previous_hash THEN RAISE EXCEPTION 'LEDGER_HEAD_MISMATCH'; END IF;

  next_sequence := current_mission.ledger_sequence + 1;

  INSERT INTO klyn_ledger_events(
    event_id,mission_id,sequence,event_type,occurred_at,actor_id,schema_version,
    previous_hash,payload_hash,event_hash,payload
  ) VALUES (
    p_event_id,p_mission_id,next_sequence,'CircuitBreakerTriggered',p_occurred_at,p_actor_id,
    p_schema_version,p_previous_hash,p_payload_hash,p_event_hash,p_payload
  );

  UPDATE klyn_missions SET
    breaker_level=p_level, breaker_reason=p_reason, version=version+1,
    ledger_sequence=next_sequence, ledger_head_hash=p_event_hash, updated_at=p_occurred_at
  WHERE mission_id=p_mission_id;

  RETURN QUERY SELECT current_mission.version+1, next_sequence;
END;
$$;

COMMIT;
