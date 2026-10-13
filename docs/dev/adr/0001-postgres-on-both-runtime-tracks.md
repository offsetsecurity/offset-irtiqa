# 1. PostgreSQL on both runtime tracks

- **Status:** Superseded by [ADR 0002](0002-sqlite-not-postgres.md)
- **Date:** 2026-09-08

> Superseded on 2026-09-08. The reasoning below is sound and still worth
> reading, but it answered the wrong question. It asked "which database on each
> track?" and concluded, correctly, that the answer must be the same on both.
> ADR 0002 keeps that conclusion and changes the database, because the target
> deployment size turned out to be far smaller than assumed here.

## Context

Offset GRC ships two ways: a Docker Compose bundle for production, and a native
Windows installer so people who do not use Docker can evaluate and run it.

Docker obviously gets PostgreSQL. For the Windows track there was an obvious
shortcut: use SQLite, since it is a single file with no service to manage.

## Decision

Both tracks use **PostgreSQL 16**. The Windows installer bundles portable
PostgreSQL binaries, runs `initdb` at install time, and registers it as a second
Windows service bound to `127.0.0.1` on a random port with a generated password.
The user never has to know it is there.

## Consequences

**Good**

- One schema, one SQL dialect, one migration history, one integration test suite.
- A backup taken on Windows restores into Docker and vice versa.
- No class of bug that only reproduces on one track.
- Real concurrency on the Windows track too, so it is a supportable production
  option up to the M sizing profile rather than a toy.

**Bad**

- The Windows bundle grows by roughly 180 MB.
- The installer has more to do and more to undo: `initdb`, service registration,
  port selection, and a clean uninstall.
- We take on responsibility for patching the bundled Postgres in our own release
  cadence rather than the customer's.

**Rejected alternative — SQLite on Windows**

Cheaper to build, permanently more expensive to own. Two dialects would have
doubled the test matrix for the life of the product, and the first
"works in Docker, fails on Windows" bug would have wiped out the saving.
