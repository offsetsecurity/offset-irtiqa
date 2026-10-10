-- Who has actually read the policy.
--
-- An approved policy and a policy people have read are different claims, and
-- A.5.10 asks for the second one. The product could show an approved
-- Acceptable Use Policy and had nothing to say when an auditor asked who had
-- read it.
--
-- Its own table rather than a column on the policy: the answer is a list that
-- grows, and each entry carries the version that was read. Reissuing a policy
-- must not inherit last year's sign-offs, so the version is part of the row
-- and part of what makes it unique.
create table policy_acknowledgements (
  id              text primary key,
  policy_id       text not null references policies(id) on delete cascade,
  person          text not null,
  version         text not null default '',
  acknowledged_on text not null,
  note            text not null default '',
  recorded_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One person acknowledges one version once. Acknowledging again after a
-- reissue is a new row, which is the whole point of keeping the version.
create unique index policy_acknowledgements_unique
  on policy_acknowledgements (policy_id, person, version);

create index policy_acknowledgements_policy_idx
  on policy_acknowledgements (policy_id, acknowledged_on desc);
