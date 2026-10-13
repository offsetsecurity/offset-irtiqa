# Local development

There is nothing to install and nothing to start. The database is a SQLite file
that the app creates on first run, so a clean checkout to a running server is
three commands.

## Setup

```bash
pnpm install
cp .env.example .env
```

Then edit `.env` and set the two secrets. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The default database path is already correct:

```
DATABASE_URL=file:./data/offset.db
```

`data/` and `.local/` are git-ignored. The database is never committed.

## Run

```bash
pnpm migrate     # create the schema
pnpm seed        # load the framework pack into `controls`
pnpm dev         # API on http://localhost:8080
```

The server migrates and seeds on boot when the database is empty, so `pnpm dev`
alone is enough on a fresh clone.

`PRODUCT` in `.env` is `ascend`, and this repository carries no other pack.

One thing to know:

- **Restart the server after a rebuild.** The page is read from disk on every
  request, but the API routes are fixed when the process starts. A new build
  with an unrestarted server gives you new screens calling routes that do not
  exist yet — the app says so rather than showing a bare 404.

## Reset

Delete the file. WAL mode writes two siblings, so remove all three:

```bash
rm -f data/offset.db data/offset.db-wal data/offset.db-shm
```

## Tests

```bash
pnpm test                                          # unit tests, no database
E2E_DATABASE_URL=file:./.tmp/e2e.db pnpm test      # plus the end-to-end suite
```

The end-to-end suite is skipped unless `E2E_DATABASE_URL` is set, and it empties
every table it touches before running — so point it at a throwaway file, never
at `data/offset.db`.

## Inspecting the database

Any SQLite client works. Without installing one:

```bash
node -e "const d=require('better-sqlite3')('data/offset.db');console.table(d.prepare('select status, count(*) as n from controls group by status').all())"
```

## Handy checks

```bash
curl -s localhost:8080/api/v1/health
curl -s localhost:8080/api/v1/health/ready
```

## Backups

```bash
pnpm db:backup                     # ./backups/offset-<timestamp>.db
pnpm db:backup /path/to/copy.db
```

This uses SQLite's online backup API, so it is safe to run against a server that
is handling traffic. Restoring is a file copy: stop the app, replace
`data/offset.db`, delete any leftover `-wal` and `-shm`, start it again.

## Docker

Docker is the production runtime, not a development dependency. The Compose
stack in `deploy/compose/compose.yaml` runs the built image. There is no
development stack any more, because there is no database service to run.
