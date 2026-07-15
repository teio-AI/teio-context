-- Simplify: drop the connectors + sync_cursors subsystem. Write-back policy and
-- ownership move onto the token itself:
--   user_id       - when set, the token belongs to a member; its role follows
--                   that member's current project role (role column left null).
--   proposal_only - opt-in "require review": this token's writes open a PR
--                   instead of auto-merging. Default false (auto-merge).
-- Fresh DB (wiped), so dropping columns/tables is safe.
alter table api_tokens add column if not exists user_id text;
alter table api_tokens add column if not exists proposal_only boolean not null default false;
alter table api_tokens drop column if exists connector_id;
alter table api_tokens alter column role drop not null;

alter table audit_log drop column if exists connector_id;
alter table proposals drop column if exists connector_id;

drop table if exists sync_cursors;
drop table if exists connectors;
