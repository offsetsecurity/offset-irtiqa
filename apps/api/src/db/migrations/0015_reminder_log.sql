-- Every reminder sent, so nothing goes out twice and an auditor can see that
-- people were chased.
--
-- One row per email. `kind` is "owner" for the person who owns the work and
-- "chain" for the people told once it is overdue; `stage` says which moment it
-- was ("before-30", "on", "after-3", "level-2"). The item is identified by
-- `item_key` (its table and id) and `due_date`, so moving a date starts a fresh
-- run of reminders for the new date rather than staying quiet for the old one.
create table reminder_log (
  id         text primary key,
  item_key   text not null,
  item_ref   text not null default '',
  item_title text not null default '',
  owner      text not null default '',
  due_date   text not null,
  kind       text not null,
  stage      text not null,
  level      integer not null default 0,
  to_email   text not null default '',
  cc         text not null default '',
  subject    text not null default '',
  sent_on    text not null,
  ok         integer not null default 1,
  error      text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index reminder_log_item on reminder_log (item_key, due_date, kind, stage);
create index reminder_log_recent on reminder_log (created_at);
