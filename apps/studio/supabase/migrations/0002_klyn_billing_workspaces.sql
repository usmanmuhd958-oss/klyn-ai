create extension if not exists "uuid-ossp";

-- Workspace container for teams and organizations
create table if not exists workspaces (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    owner_id uuid not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Workspace users and permissions
create table if not exists workspace_members (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    user_id uuid not null,
    role text not null default 'member',
    created_at timestamptz default now(),
    unique(workspace_id, user_id)
);

-- Allowed Klyn roles
create table if not exists user_roles (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    role text not null,
    created_at timestamptz default now()
);

-- Stripe subscription state
create table if not exists subscriptions (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    stripe_customer_id text,
    stripe_subscription_id text,
    plan text not null default 'free',
    status text not null default 'active',
    current_period_end timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_workspace_owner on workspaces(owner_id);
create index if not exists idx_workspace_members_user on workspace_members(user_id);
create index if not exists idx_subscription_workspace on subscriptions(workspace_id);

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table subscriptions enable row level security;

-- Users can view workspaces they belong to
create policy "workspace_member_access"
on workspaces
for select
using (
  exists (
    select 1
    from workspace_members
    where workspace_members.workspace_id = workspaces.id
    and workspace_members.user_id = auth.uid()
  )
);
