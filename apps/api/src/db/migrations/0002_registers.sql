-- Phase 3: the five remaining registers.
--
-- Field lists follow the standalone HTML tools rather than being invented, so
-- data from an existing deployment maps across without translation.
--
-- Every register carries a `seq`, allocated inside the write transaction the
-- way risks already are. An auditor refers to "finding 7", not to a UUID.

-- ── assets ───────────────────────────────────────────────────────────────────
create table assets (
  id             text primary key,
  seq            integer not null,
  name           text not null,
  type           text not null default 'Software',
  category       text not null default 'Supporting asset'
                 check (category in ('Primary asset', 'Supporting asset')),
  criticality    text not null default 'Medium'
                 check (criticality in ('High', 'Medium', 'Low')),
  classification text not null default 'Internal'
                 check (classification in ('Public', 'Internal', 'Confidential', 'Restricted')),
  owner          text not null default '',
  location       text not null default '',
  notes          text not null default '',
  attrs          text not null default '{}',
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index assets_seq_idx on assets (seq);
create index assets_criticality_idx on assets (criticality);

create table asset_controls (
  asset_id   text not null references assets(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (asset_id, control_id)
);
create index asset_controls_control_idx on asset_controls (control_id);

create table asset_risks (
  asset_id text not null references assets(id) on delete cascade,
  risk_id  text not null references risks(id) on delete cascade,
  primary key (asset_id, risk_id)
);
create index asset_risks_risk_idx on asset_risks (risk_id);

-- ── policies ─────────────────────────────────────────────────────────────────
create table policies (
  id            text primary key,
  seq           integer not null,
  name          text not null,
  version       text not null default '1.0',
  owner         text not null default '',
  status        text not null default 'Draft'
                check (status in ('Draft', 'In Review', 'Approved')),
  review_date   text,
  approver      text not null default '',
  approval_date text,
  notes         text not null default '',
  attrs         text not null default '{}',
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index policies_seq_idx on policies (seq);
create index policies_review_idx on policies (review_date);

-- Document control: changing a policy's version archives the version it was on
-- before the edit is applied. An assessor asks "show me what changed and when",
-- and this is the answer.
create table policy_versions (
  id          text primary key,
  policy_id   text not null references policies(id) on delete cascade,
  version     text not null,
  status      text not null,
  approver    text not null default '',
  change_note text not null default '',
  archived_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index policy_versions_policy_idx on policy_versions (policy_id, archived_at desc);

create table policy_controls (
  policy_id  text not null references policies(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (policy_id, control_id)
);
create index policy_controls_control_idx on policy_controls (control_id);

-- ── tasks ────────────────────────────────────────────────────────────────────
-- A task points at one control and one risk, matching the tools. Both are
-- optional, and both null out rather than cascade-delete the task: losing the
-- work because the thing it referred to was removed would be wrong.
create table tasks (
  id         text primary key,
  seq        integer not null,
  title      text not null,
  owner      text not null default '',
  due_date   text,
  priority   text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status     text not null default 'Open' check (status in ('Open', 'In Progress', 'Done')),
  notes      text not null default '',
  control_id text references controls(id) on delete set null,
  risk_id    text references risks(id) on delete set null,
  attrs      text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index tasks_seq_idx on tasks (seq);
create index tasks_due_idx on tasks (status, due_date);
create index tasks_control_idx on tasks (control_id);

-- ── incidents ────────────────────────────────────────────────────────────────
create table incidents (
  id            text primary key,
  seq           integer not null,
  title         text not null,
  detected_date text,
  owner         text not null default '',
  severity      text not null default 'Medium'
                check (severity in ('Low', 'Medium', 'High', 'Critical')),
  status        text not null default 'Open'
                check (status in ('Open', 'Investigating', 'Contained', 'Resolved', 'Closed')),
  description   text not null default '',
  attrs         text not null default '{}',
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index incidents_seq_idx on incidents (seq);
create index incidents_status_idx on incidents (status, detected_date desc);

create table incident_controls (
  incident_id text not null references incidents(id) on delete cascade,
  control_id  text not null references controls(id) on delete cascade,
  primary key (incident_id, control_id)
);
create index incident_controls_control_idx on incident_controls (control_id);

create table incident_risks (
  incident_id text not null references incidents(id) on delete cascade,
  risk_id     text not null references risks(id) on delete cascade,
  primary key (incident_id, risk_id)
);
create index incident_risks_risk_idx on incident_risks (risk_id);

-- ── findings ─────────────────────────────────────────────────────────────────
create table findings (
  id          text primary key,
  seq         integer not null,
  title       text not null,
  type        text not null default 'Observation',
  status      text not null default 'Open'
              check (status in ('Open', 'In Progress', 'Closed')),
  source      text not null default '',
  description text not null default '',
  clause      text not null default '',
  owner       text not null default '',
  due_date    text,
  attrs       text not null default '{}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index findings_seq_idx on findings (seq);
create index findings_status_idx on findings (status, due_date);

create table finding_controls (
  finding_id text not null references findings(id) on delete cascade,
  control_id text not null references controls(id) on delete cascade,
  primary key (finding_id, control_id)
);
create index finding_controls_control_idx on finding_controls (control_id);

-- ── touch triggers ───────────────────────────────────────────────────────────
create trigger assets_touch after update on assets for each row
when new.updated_at = old.updated_at   -- guard against re-firing on our own write
begin update assets set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger policies_touch after update on policies for each row
when new.updated_at = old.updated_at   -- guard against re-firing on our own write
begin update policies set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger tasks_touch after update on tasks for each row
when new.updated_at = old.updated_at   -- guard against re-firing on our own write
begin update tasks set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger incidents_touch after update on incidents for each row
when new.updated_at = old.updated_at   -- guard against re-firing on our own write
begin update incidents set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;

create trigger findings_touch after update on findings for each row
when new.updated_at = old.updated_at   -- guard against re-firing on our own write
begin update findings set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id; end;
