-- The management-system registers an ISO 27001 auditor asks for by name, and
-- the fields a corrective action needs to be one.
--
-- Every product gets the tables; only a pack that asks for the features shows
-- the screens. Keeping the schema the same across products means one migration
-- history and one set of queries, which is the whole reason the four products
-- share a database schema at all.
--
-- The shape follows the five registers from 0002: an id, a seq for a stable
-- human-facing number, the fields, an attrs escape hatch, and the two
-- timestamps with a touch trigger.

-- ── vendors and suppliers (A.5.19 to A.5.23) ────────────────────────────────
create table vendors (
  id             text primary key,
  seq            integer not null,
  name           text not null,
  service        text not null default '',
  criticality    text not null default 'Medium'
                 check (criticality in ('High', 'Medium', 'Low')),
  classification text not null default 'Internal'
                 check (classification in ('Public', 'Internal', 'Confidential', 'Restricted')),
  status         text not null default 'Prospective'
                 check (status in ('Prospective', 'Active', 'Under review', 'Exited')),
  owner          text not null default '',
  assurance      text not null default '',   -- what they showed you: a certificate, a report
  assessed_date  text,
  review_date    text,
  notes          text not null default '',
  attrs          text not null default '{}',
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index vendors_seq_idx on vendors (seq);
create index vendors_review_idx on vendors (review_date);

create table vendor_controls (
  vendor_id  text not null references vendors(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (vendor_id, control_id)
);
create table vendor_risks (
  vendor_id text not null references vendors(id) on delete cascade,
  risk_id   text not null references risks(id) on delete cascade,
  primary key (vendor_id, risk_id)
);

-- ── training and awareness (7.2, 7.3, A.6.3) ────────────────────────────────
create table training (
  id             text primary key,
  seq            integer not null,
  person         text not null,
  course         text not null default '',
  audience       text not null default '',
  completed_date text,
  next_due       text,
  result         text not null default 'Completed'
                 check (result in ('Completed', 'In progress', 'Not started', 'Failed')),
  notes          text not null default '',
  attrs          text not null default '{}',
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index training_seq_idx on training (seq);
create index training_due_idx on training (next_due);

create table training_controls (
  training_id text not null references training(id) on delete cascade,
  control_id  text not null references controls(id) on delete cascade,
  primary key (training_id, control_id)
);

-- ── security objectives (6.2) ───────────────────────────────────────────────
create table objectives (
  id          text primary key,
  seq         integer not null,
  title       text not null,
  measure     text not null default '',   -- how you will know
  target      text not null default '',   -- the number or state aimed at
  owner       text not null default '',
  due_date    text,
  status      text not null default 'Planned'
              check (status in ('Planned', 'On track', 'At risk', 'Met', 'Missed')),
  notes       text not null default '',
  attrs       text not null default '{}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index objectives_seq_idx on objectives (seq);
create index objectives_due_idx on objectives (due_date);

create table objective_controls (
  objective_id text not null references objectives(id) on delete cascade,
  control_id   text not null references controls(id) on delete cascade,
  primary key (objective_id, control_id)
);
create table objective_risks (
  objective_id text not null references objectives(id) on delete cascade,
  risk_id      text not null references risks(id) on delete cascade,
  primary key (objective_id, risk_id)
);

-- ── interested parties (4.2) ────────────────────────────────────────────────
create table parties (
  id            text primary key,
  seq           integer not null,
  name          text not null,
  kind          text not null default 'Other',
  needs         text not null default '',   -- what they require of you
  addressed     text not null default '',   -- how you meet it
  owner         text not null default '',
  notes         text not null default '',
  attrs         text not null default '{}',
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index parties_seq_idx on parties (seq);

create table party_controls (
  party_id   text not null references parties(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (party_id, control_id)
);

-- ── audits and management reviews (9.2, 9.3) ────────────────────────────────
create table reviews (
  id           text primary key,
  seq          integer not null,
  title        text not null,
  kind         text not null default 'Internal audit'
               check (kind in ('Internal audit', 'Management review', 'External audit', 'Supplier audit')),
  status       text not null default 'Planned'
               check (status in ('Planned', 'In progress', 'Completed', 'Cancelled')),
  planned_date text,
  held_date    text,
  led_by       text not null default '',
  attendees    text not null default '',
  scope        text not null default '',
  outcome      text not null default '',
  notes        text not null default '',
  attrs        text not null default '{}',
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index reviews_seq_idx on reviews (seq);
create index reviews_date_idx on reviews (status, planned_date);

create table review_controls (
  review_id  text not null references reviews(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (review_id, control_id)
);

-- ── corrective action, on the finding it belongs to (10.2) ──────────────────
-- Not a register of its own: a corrective action without the finding that
-- caused it is an orphan, and two lists that have to be kept in step is how
-- they stop being in step.
alter table findings add column root_cause text not null default '';
alter table findings add column action_taken text not null default '';
alter table findings add column verification text not null default '';
alter table findings add column verified_by text not null default '';
alter table findings add column verified_date text;

-- ── updated_at maintenance, as for every other table ────────────────────────
create trigger vendors_touch after update on vendors for each row
when new.updated_at = old.updated_at
begin update vendors set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger training_touch after update on training for each row
when new.updated_at = old.updated_at
begin update training set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger objectives_touch after update on objectives for each row
when new.updated_at = old.updated_at
begin update objectives set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger parties_touch after update on parties for each row
when new.updated_at = old.updated_at
begin update parties set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger reviews_touch after update on reviews for each row
when new.updated_at = old.updated_at
begin update reviews set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;
