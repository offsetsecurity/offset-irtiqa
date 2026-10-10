# Releasing an update

How a change on this machine reaches Settings → Updates on every install.

## In short

```bash
git tag -a v0.2.0 -m "Evidence reminders now include the control they belong to."
git push origin v0.2.0
```

GitHub then builds everything, signs it, and publishes it. Every install that
checks for updates afterwards sees 0.2.0, with the tag message as its notes.

Pushing commits without a tag publishes nothing. Customers only ever see what
you tag.

## What happens after you push a tag

The **Release** workflow (`.github/workflows/release.yml`):

1. Runs the full test suite. A failing test stops the release.
2. Builds and pushes the Docker images for all four products to
   `ghcr.io/offsetsecurity`: the application and its updater.
3. Builds the Linux tarballs, and the Windows installers.
4. Writes `release.json`, naming every file by its SHA-256 and every image by
   its digest.
5. Signs it with `RELEASE_SIGNING_KEY`.
6. Checks the signature with the key compiled into the application. If the
   secret and the application disagree, the release stops here, not on a
   customer's server.
7. Publishes each product to its own releases repository, with a manifest
   naming only that product.

It takes about half an hour, most of it the Windows and Linux builds.

## Choosing a version

`vMAJOR.MINOR.PATCH`, always three numbers, always going up.

- **Patch** (0.2.0 → 0.2.1): fixes only.
- **Minor** (0.2.1 → 0.3.0): new features.
- **Major** (0.9.0 → 1.0.0): anything a customer has to act on.

Installs refuse to move to a lower or equal version, so a mistaken tag cannot
be fixed by tagging a lower one. Tag the next version up instead.

## One-time setup

Do these once. None of them is needed again for later releases.

### 1. Where releases go

This repository's own **Releases** page. A tag builds the packages, signs one
manifest naming them, and attaches the lot to a release named after the tag.

Nothing else publishes there, which is what lets an install ask for "the
latest release" and get this product. Five products once shared a downloads
repository for exactly that reason - they could not each have a latest of
their own while one repository built them all. They can now, so that
repository is gone, and with it the cross-repository token a release used to
need: `offsetsecurity/offset-irtiqa` publishes to itself with the workflow's own GITHUB_TOKEN.

`grc-suite-releases`, the old single page, stays where it is. Copies installed
before this change still ask it for updates, and will until they are
reinstalled.

### 2. The signing key secret

The private key was created on 2026-09-17 at:

```
%USERPROFILE%\.offset-release\release-signing-key.pem
```

In `offsetsecurity/grc-suite` → **Settings → Secrets and variables → Actions →
New repository secret**:

- Name: `RELEASE_SIGNING_KEY`
- Value: the whole contents of that file, including the `BEGIN` and `END` lines

**Back that file up somewhere safe and offline**, such as an encrypted USB
drive. Anyone who has it can publish an update every install will accept. If it
is ever lost, or you think anyone else has seen it, see *Replacing the signing
key* below.

### 3. A token for publishing

GitHub → your profile → **Settings → Developer settings → Personal access
tokens → Fine-grained tokens → Generate new token**:

- Repository access: the `offsetsecurity/downloads` repository
- Permissions: **Contents: Read and write**
- Expiry: a year, with a calendar reminder to renew it

Save it in `offsetsecurity/grc-suite` as a repository secret named
`RELEASES_REPO_TOKEN`.

**Adding a product later means adding its repository to this token**, or the
release fails at the last step with a 403 that reads like a write-permission
problem.

### 3b. A token for the framework content

The packs are in repositories of their own and the build fetches them. A second
fine-grained token, read-only on `assure-pack-for-iso-27001`,
`irtiqa-pack-for-sama`, `nist-packs` and `abide-pack-for-hipaa`, saved as
`PACK_REPO_TOKEN`. See `docs/dev/product-parity.md`.

### 4. The release environment

In `offsetsecurity/grc-suite` → **Settings → Environments → New environment**,
name it `release`. Optionally add yourself as a required reviewer: every
release then waits for you to click Approve before it is signed.

### 5. After the first release: make the images public

GitHub creates the container images as private. Customers' servers pull them
without logging in, so each one has to be made public, once:

GitHub → `offsetsecurity` profile → **Packages** → for each of
`offset-ascend`, `offset-ascend-updater`, `offset-align`, `offset-align-updater`,
`offset-assure`, `offset-assure-updater`, `offset-anchor`, `offset-anchor-updater`
→ **Package settings → Change visibility → Public**.

## How installs trust a release

- The manifest is signed with Ed25519. The public key is compiled into the
  application (`TRUSTED_KEYS` in `apps/api/src/update/release.ts`).
- Every file is checked against the SHA-256 in the signed manifest, and every
  image is pulled by digest, so nothing swapped after signing can install.
- An install only moves forward, and only to the signed latest release.
- The part that installs (a container, a root service, a SYSTEM task) never
  takes its settings from anything the web application can write.
- Nothing contacts the internet until an administrator presses the button.

## Replacing the signing key

1. `node deploy/release/keygen.mjs <new-key-file.pem>`
2. Add the printed public key to `TRUSTED_KEYS`, **keeping the old one**, and
   release that version signed with the **old** key.
3. Once customers have updated to it, put the new private key in
   `RELEASE_SIGNING_KEY`. Later releases are signed with the new key, which
   every updated install now trusts.
4. Remove the old public key from `TRUSTED_KEYS` in a later release.

If the old key has leaked rather than been lost, do step 2 as quickly as
possible and tell customers to update. Installs that never update cannot be
protected from a leaked key.

## One product's Docker image, without a release

To get an image onto a machine before any release exists, for a demonstration
or a test install, use the **Build a Docker image** workflow
(`.github/workflows/docker-image.yml`). It builds nothing else and publishes
nothing to customers.

1. In `offsetsecurity/grc-suite` → **Actions** → **Build a Docker image** →
   **Run workflow**.
2. Pick a version such as `0.1.0`.
   Press **Run workflow**. It takes a few minutes.
3. The images are stored, private, as
   `ghcr.io/offsetsecurity/offset-ascend:<version>` and
   `ghcr.io/offsetsecurity/offset-ascend-updater:<version>`, each also
   tagged `latest`.

To download them, the machine needs a GitHub token that can read packages:
GitHub → **Settings → Developer settings → Personal access tokens → Tokens
(classic)**, with only **read:packages** ticked. Then:

```bash
docker login ghcr.io -u <your GitHub username>
docker pull ghcr.io/offsetsecurity/offset-ascend:<version>
docker pull ghcr.io/offsetsecurity/offset-ascend-updater:<version>
```

Paste the token when it asks for a password. Nothing appears as you paste;
press Enter. Then, in the install folder's `.env`, point the stack at them:

```
OFFSET_IMAGE=ghcr.io/offsetsecurity/offset-ascend:<version>
OFFSET_UPDATER_IMAGE=ghcr.io/offsetsecurity/offset-ascend-updater:<version>
```

and run `docker compose up -d`. Customers do not install this way: they get
the published images once a release has been made.

## Testing the pipeline without publishing

Point a test install at your own channel instead of GitHub:

- **Docker:** in its `.env`, set `UPDATE_URL`, `UPDATE_TRUSTED_KEYS` (your test
  public key) and, for a plain-HTTP test server, `UPDATE_ALLOW_HTTP=true`.
- **Linux:** create `/etc/offset-ascend/updater.json` as root, with
  `{"url": "...", "trustedKeys": ["..."], "allowHttp": true}`, and set the same
  three `UPDATE_*` values in `/var/lib/offset-ascend/.env` for the screen.
- **Windows:** the same JSON in `updater.json` beside `node.exe` in the install
  folder.

Settings → Updates shows a warning whenever a non-standard key is trusted.
