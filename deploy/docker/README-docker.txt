Offset Irtiqa on Docker
==========================

Everything you need is in this folder: compose.yaml describes what to run,
and env.example is the settings to fill in.

1. Copy the settings file

     Windows:  copy env.example .env
     Linux:    cp env.example .env

2. Open .env and fill in the two secrets it asks for. Make each one with:

     docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   Keep that file. Without the same SESSION_SECRET everyone is signed out on
   the next start, and without the same FIELD_ENC_KEY any stored secret -
   today the mail password - cannot be read back.

3. Choose a port, if 8080 is taken on this machine. Change BOTH lines:

     HTTP_PORT=8080
     PUBLIC_URL=http://localhost:8080

   They must match. The second one is the address that goes into the emails
   this product sends, so a mismatch sends people to a dead port.

4. Start it

     docker compose up -d

   It downloads two images - the product and its updater - and starts three
   containers. The updater is what lets an administrator install updates from
   Settings later; delete the COMPOSE_PROFILES line from .env if your policy
   does not allow a container access to the Docker socket.

5. Open it

     http://localhost:8080     (or whatever port you chose)

   The first screen asks you to create the administrator account.

Afterwards
----------

Stop it, keeping your data:      docker compose down
Start it again:                  docker compose up -d
See what is running:             docker compose ps
Read the logs:                   docker compose logs -f app

Your data lives in a Docker volume, not in this folder, so it survives all of
the above. It is deleted only by "docker compose down -v" - the -v is the
part that destroys it, and there is no undo.

HTTPS, backups, restoring, and what to do when something goes wrong are all
in INSTALL.md, inside the Windows or Linux download, and in the repository.

Offset Security - info@offsetsecurity.net
