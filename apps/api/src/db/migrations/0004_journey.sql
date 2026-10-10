-- The readiness journey: what a customer has ticked off, and what they have
-- ruled out.
--
-- Only the answers live here. The questions — the stages, the tasks, the
-- wording — come from the pack, because they are framework content and change
-- when the framework does. Storing the text here too would mean a migration
-- every time a sentence is reworded, and two copies to disagree with each
-- other.
--
-- A row only exists once somebody has said something about that task. No row
-- means outstanding, which is also the state of every task on a fresh install,
-- so there is nothing to seed.
--
-- The id is the task id from journey.json rather than a generated key. Tasks
-- are named, stable and unique in the pack, and using the natural key means a
-- task that is renamed or dropped simply stops matching rather than leaving an
-- orphan row pointing at nothing.

create table if not exists journey_tasks (
  task_id     text primary key,
  -- 'done' or 'not_applicable'. Checked here as well as in the API: this table
  -- has exactly two legal values for its whole life, which is the case a CHECK
  -- constraint is for.
  state       text not null check (state in ('done', 'not_applicable')),
  -- Why it does not apply. Required for not_applicable, empty otherwise.
  reason      text not null default '',
  actor_name  text not null default '',
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
