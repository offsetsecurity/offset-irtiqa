-- Somewhere to write, on the two things that could be chased and were not.
--
-- Controls gained a due date and an owner's email in 0005. Tasks already had an
-- owner and a due date but nowhere to send anything, and the readiness plan had
-- none of the three: a step could sit outstanding for months with nobody named
-- against it.
--
-- All three now carry the same pair - a date and an address - because the
-- reminder job asks the same question of each: who is late, and where do I
-- write. Three different shapes would have meant three answers to that, and
-- eventually three that disagreed.
--
-- Everything is nullable or empty by default, so nothing is chased until
-- somebody fills both in. That is what keeps a fresh install silent.

alter table tasks add column owner_email text;

create index if not exists idx_tasks_due_owner
  on tasks (due_date) where owner_email is not null and owner_email <> '';

-- ── the readiness plan ──────────────────────────────────────────────────────
-- Rebuilt rather than altered. The original CHECK allows two states, 'done' and
-- 'not_applicable', because a row only existed once a step was settled.
-- Assigning a step to somebody means a row has to exist while it is still
-- outstanding, and SQLite cannot loosen a CHECK in place - only a new table can.
--
-- Everything already recorded is carried across unchanged; the new columns start
-- empty, which is the same as having no assignment.

create table journey_tasks_new (
  task_id     text primary key,
  -- Three states now. 'outstanding' is the normal state of work somebody has
  -- been given and has not finished, which is exactly when chasing matters.
  state       text not null default 'outstanding'
                check (state in ('outstanding', 'done', 'not_applicable')),
  reason      text not null default '',
  -- Who is doing it, and where reminders go. Useless apart, which is the point:
  -- a date with nobody to tell is not an instruction to chase anyone.
  owner       text not null default '',
  owner_email text,
  due_date    text,
  actor_name  text not null default '',
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

insert into journey_tasks_new (task_id, state, reason, actor_name, updated_at)
  select task_id, state, reason, actor_name, updated_at from journey_tasks;

drop table journey_tasks;
alter table journey_tasks_new rename to journey_tasks;

create index if not exists idx_journey_due
  on journey_tasks (due_date) where due_date is not null;
