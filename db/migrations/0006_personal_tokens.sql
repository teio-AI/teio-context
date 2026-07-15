-- Personal access tokens: a token can be unbound from a space (space_id null)
-- and instead carry a user_id. It authenticates AS that user across every
-- project they can access — one token for all projects, no per-project swapping.
-- Per-space service/member tokens keep space_id set.
alter table api_tokens alter column space_id drop not null;
