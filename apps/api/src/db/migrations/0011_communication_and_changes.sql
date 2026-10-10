-- The last two things ISO 27001 asks for that had nowhere to live.
--
-- 7.4 Communication: who is told what about security, when, by whom, and how.
-- An auditor asks for this as a plan, not as a pile of sent emails, so it is a
-- small register of arrangements with a next-due date rather than a log.
create table communications (
  id          text primary key,
  seq         integer not null,
  topic       text not null,
  audience    text not null default '',
  owner       text not null default '',
  channel     text not null default '',
  frequency   text not null default '',
  last_sent   text,
  next_due    text,
  notes       text not null default '',
  attrs       text not null default '{}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index communications_seq_idx on communications (seq);
create index communications_due_idx on communications (next_due);

create table communication_controls (
  communication_id text not null references communications(id) on delete cascade,
  control_id       text not null references controls(id) on delete cascade,
  primary key (communication_id, control_id)
);

create trigger communications_touch after update on communications for each row
when new.updated_at = old.updated_at
begin update communications set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

-- 6.3 Planning of changes: a change to the management system is planned, not
-- stumbled into. Two columns on tasks rather than a register of its own: a
-- planned change is work with a date and an owner, which is what a task is,
-- and a second list of work is a second list to forget to update.
alter table tasks add column kind text not null default 'Task'
  check (kind in ('Task', 'Change'));
alter table tasks add column security_impact text not null default '';
