# 2. SQLite, not PostgreSQL

- **Status:** Accepted
- **Date:** 2026-09-08
- **Supersedes:** [ADR 0001](0001-postgres-on-both-runtime-tracks.md)

## Context

ADR 0001 chose PostgreSQL 16 for both runtime tracks, and bundled portable
Postgres binaries into the Windows installer so the two tracks would stay
identical. That reasoning — one database everywhere, never two dialects — was
right, and this decision keeps it.

What changed is the size of the thing we are building for. The largest expected
deployment is **under 50 users**. That is not a number that needs a client/server
database. It is a number a single embedded database file handles without
noticing, and PostgreSQL was buying capacity we will never draw on while
charging for it on every install, every upgrade and every support call.

The build also proved the cost was not hypothetical. Docker Desktop on the
primary development machine could not start at all, and standing up the portable
Postgres path by hand — `initdb`, a non-default port, a generated password, a
service — was a full afternoon. Every customer without Docker would meet exactly
that, except with an installer doing it silently and no one to debug it when it
failed.

## Decision

Use **SQLite** (via `better-sqlite3`) as the only database, on both tracks.

- WAL journal mode, `busy_timeout = 5000`, `foreign_keys = ON`,
  `synchronous = NORMAL`.
- Writes go through `BEGIN IMMEDIATE` so the write lock is taken up front rather
  than discovered halfway through a transaction.
- Routes keep Postgres-style `$1, $2` placeholders. `toSqlite()` in
  `apps/api/src/db/pool.ts` rewrites them to `?` and reorders the parameters, so
  the SQL in the route files did not have to change and a future move back to a
  client/server database stays a one-file change.
- The Compose stack runs a single API container. Scaling out is not supported,
  and would mean changing database first.

## Consequences

**Good**

- The Windows installer no longer ships or manages a database service. It
  installs Node, the app, and a directory. The bundle loses roughly 180 MB.
- Backup is a file copy, and `pnpm db:backup` uses SQLite's online backup API,
  so it is safe to run against a live system. Restore is a file copy too. For an
  on-premise product bought by people who will run it themselves, this is worth
  more than any query the database engine can no longer do.
- Air-gapped delivery gets simpler: one image, no database image, no
  initialisation step that can fail on a machine we cannot see.
- Development needs nothing running. `pnpm migrate && pnpm dev` works on a clean
  checkout, and CI needs no service container.
- ADR 0001's core principle survives intact: still one schema, one dialect, one
  migration history, one test suite, both tracks identical.

**Bad**

- One writer at a time. Fine well past 50 users for this workload, which is
  overwhelmingly reads, but it is a real ceiling and not one we can raise by
  adding replicas.
- No `jsonb`, no enums, no `pgcrypto`, no identity columns. Replaced by JSON text
  with `json_extract()` expression indexes, `check` constraints, application-side
  encryption, and application-generated UUIDs.
- No `pg_advisory_lock`, so migrations serialise on `BEGIN IMMEDIATE` instead.
- `pg-boss` is gone. The job queue is a `jobs` table with a polling worker —
  roughly 100 lines we now own.
- Native module. `better-sqlite3` compiles per platform, so the Alpine image
  builds it from source and the Windows installer must ship a matching prebuild.
  This is the one place the two tracks genuinely differ.

## Measured, not assumed

"One writer at a time" is the obvious objection, so it was tested rather than
argued about. Ten separate OS processes, each running 200 write transactions
back to back with no pause, against one database file, while another process
read continuously throughout. Each transaction inserts a row and an audit row —
the same shape as a real mutation.

| | |
| --- | --- |
| Write transactions | 2,000, all committed, none lost |
| Failed with `SQLITE_BUSY` | 0 |
| Throughput | ~1,100–1,600 writes/sec |
| Median write | 0.04 ms |
| p95 | 0.10 ms |
| p99 | ~15 ms |
| Reads during the storm | ~275,000, never blocked |

Two things sit in the tail, and both are understood:

- **p99 of ~15 ms is the WAL auto-checkpoint.** Confirmed by re-running with
  `wal_autocheckpoint = 0`, which drops p99 to 0.19 ms. Whichever writer trips
  the threshold pays to fold the WAL back into the database. If this ever shows
  up in practice, the fix is a scheduled `wal_checkpoint(TRUNCATE)` on the
  worker so no user request pays for it.
- **The first write in a process can take 100–650 ms.** Every one of these was
  write #0, immediately after ten processes started at once. It is cold start —
  opening the file, creating the shared-memory index, first lock acquisition —
  and a long-lived server pays it once at boot, not per request.

For scale: 50 users doing GRC work might generate a few writes each per minute.
That is single digits per second against a measured ceiling three orders of
magnitude higher.

**If this needs revisiting**

The trigger is concurrent *writers*, not user count: sustained write contention,
or `SQLITE_BUSY` appearing in logs under normal load. The `toSqlite()` shim and
the untouched `$n` SQL in the routes exist so that day is a migration, not a
rewrite.
