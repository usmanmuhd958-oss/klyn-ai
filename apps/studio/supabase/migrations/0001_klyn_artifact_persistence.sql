create extension if not exists "uuid-ossp";

create table if not exists projects (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    name text not null,
    description text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table if not exists artifacts (
    id uuid primary key default uuid_generate_v4(),
    project_id uuid not null references projects(id) on delete cascade,
    filename text not null,
    language text not null,
    content text not null,
    artifact_type text default 'code',
    agent_source text,
    version integer default 1,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table if not exists spatial_nodes (
    id uuid primary key default uuid_generate_v4(),
    project_id uuid not null references projects(id) on delete cascade,
    node_id text not null,
    node_type text not null,
    position_x float8 not null,
    position_y float8 not null,
    data_json jsonb not null default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(project_id, node_id)
);

create table if not exists spatial_edges (
    id uuid primary key default uuid_generate_v4(),
    project_id uuid not null references projects(id) on delete cascade,
    edge_id text not null,
    source_node text not null,
    target_node text not null,
    metadata_json jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(project_id, edge_id)
);

create index if not exists idx_artifacts_project on artifacts(project_id);
create index if not exists idx_nodes_project on spatial_nodes(project_id);
create index if not exists idx_edges_project on spatial_edges(project_id);

alter table projects enable row level security;
alter table artifacts enable row level security;
alter table spatial_nodes enable row level security;
alter table spatial_edges enable row level security;
