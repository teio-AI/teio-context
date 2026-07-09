-- Tokens can be bound to a connector so write-back policy resolves per
-- connector kind (ARCHITECTURE §3.1: MCP defaults proposal_only, TEIO
-- defaults auto_merge_clean). Nullable: a bare space-scoped token (no
-- connector) still resolves to the space default, unchanged from Phase 2-3.
alter table api_tokens add column if not exists connector_id uuid references connectors(id) on delete set null;
create index if not exists api_tokens_connector_idx on api_tokens (connector_id);
