-- teio-context control plane + derived FTS index (ARCHITECTURE §2.2).
-- Nothing canonical lives here; context lives in git. `documents` is a
-- rebuildable index storing tsvector + snippet only, NOT full bodies.

create extension if not exists "pgcrypto";

create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  github_owner text not null,
  github_repo text not null,
  github_installation_id bigint not null,
  default_branch text not null default 'main',
  current_sha text,
  write_back_default text not null default 'auto_merge_clean'
    check (write_back_default in ('auto_merge_clean', 'proposal_only')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_owner, github_repo)
);

create table if not exists space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  principal_type text not null check (principal_type in ('user', 'token')),
  principal_id text not null,
  role text not null check (role in ('owner', 'editor', 'reader')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (space_id, principal_type, principal_id)
);

create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  kind text not null check (kind in ('mcp', 'teio', 'customer')),
  name text not null,
  write_back_policy text not null default 'inherit'
    check (write_back_policy in ('auto_merge_clean', 'proposal_only', 'inherit')),
  config jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create table if not exists sync_cursors (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references connectors(id) on delete cascade,
  last_synced_sha text,
  last_synced_at timestamptz,
  last_notified_at timestamptz,
  status text not null default 'current' check (status in ('current', 'stale', 'error')),
  created_at timestamptz not null default now(),
  unique (connector_id)
);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  role text not null check (role in ('reader', 'editor')),
  created_by text not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (token_prefix)
);

create table if not exists audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  space_id uuid references spaces(id) on delete set null,
  actor_type text not null,
  actor_id text,
  actor_display text,
  connector_id uuid references connectors(id) on delete set null,
  action text not null,
  path text,
  base_sha text,
  result_sha text,
  outcome text not null check (outcome in ('ok', 'conflict', 'denied', 'error')),
  request_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  connector_id uuid references connectors(id) on delete set null,
  actor_display text not null,
  path text not null,
  base_sha text not null,
  branch_ref text not null,
  pr_number int,
  pr_url text,
  status text not null default 'open' check (status in ('open', 'merged', 'closed', 'conflict')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  path text not null,
  title text,
  snippet text,
  fts tsvector not null,
  content_sha text not null,
  commit_sha text not null,
  updated_at timestamptz not null default now(),
  unique (space_id, path)
);

create index if not exists documents_fts_idx on documents using gin (fts);
create index if not exists audit_log_space_ts_idx on audit_log (space_id, ts desc);
create index if not exists space_members_lookup_idx on space_members (space_id, principal_type, principal_id);
