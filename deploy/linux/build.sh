#!/usr/bin/env bash
#
# Builds the Linux release bundle for one product.
#
#   ./deploy/linux/build.sh ascend
#
# Produces dist/linux/offset-<product>-<version>-linux-x64.tar.gz, holding the
# built application, its pack, the web bundle, Node itself and the installer,
# with a .sha256 beside it.
#
# Runs on Linux or on Windows under Git Bash. Either way it needs pnpm and
# Docker; on Windows, Docker inside WSL is found without being asked for.
#
# WHY NODE IS BUNDLED
#
# It was not at first, on the reasoning that a Linux server has a package
# manager and can install Node itself. The reasoning missed something. The
# database driver is a compiled binary built for one version of Node, so a
# server that happened to have Node 22 could not load a driver fetched for
# Node 20. The installer would have reported success and left a service that
# crashed at start. Shipping the runtime the bundle was tested with makes that
# impossible, removes the only prerequisite, and works on a server with no
# route to nodejs.org. It is the same decision the Windows build made.
#
# WHY THE LAST STEP RUNS IN A CONTAINER
#
# Dependencies have to be fetched the way Linux fetches them. The first bundle
# was assembled on Windows and npm faithfully installed the Windows build of
# the database driver: a DLL, inside a Linux tarball, that no Linux machine
# could open.
#
# AND WHY THAT CONTAINER IS RHEL 8
#
# The second attempt installed inside the official Node image, and the bundle
# ran everywhere except RHEL 8, where the service crashed at start. The
# prebuilt database driver npm downloads needs glibc 2.29; RHEL 8 has 2.28, and
# it is what a great many banks run until 2029. Node itself only needs 2.28, so
# the two native modules are compiled here, against RHEL 8's own libraries,
# and the result runs on RHEL 8 and on everything newer. The bundle is also
# started once on that same base before it is packed, so the oldest system we
# claim is the one every build is proven on.

set -euo pipefail

product="${1:-}"
case "$product" in
  ascend) ;;
  *) echo "Usage: $0 ascend" >&2; exit 1 ;;
esac

die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$repo/dist/linux"
bundle="offset-$product"
stage="$out/$bundle"

# APP_VERSION names a release; without it the bundle is whatever the source says.
version="${APP_VERSION:-$(cd "$repo/apps/api" && node -p "require('./package.json').version")}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "APP_VERSION must be x.y.z, not $version"
# The Node pinned in .nvmrc, the same one the Windows bundle ships, unless
# told otherwise. Not the build machine's own Node, which is how an unsupported
# Node 20 came to be shipped.
NODE_VERSION="${NODE_VERSION:-$(tr -d '[:space:]' < "$repo/.nvmrc")}"
tarball="$bundle-$version-linux-x64.tar.gz"

# ── finding Docker ───────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  dock() { docker "$@"; }
  if command -v cygpath >/dev/null 2>&1; then
    # Docker Desktop, driven from Git Bash. It cannot read a Git Bash path such
    # as /c/Users/..., and mounted an empty folder in its place, so the build
    # failed with "cannot stat /out/offset-<product>". It wants C:/Users/...,
    # and Git Bash must be stopped from rewriting that and "/out" on the way.
    export MSYS_NO_PATHCONV=1
    mount_path() { cygpath -m "$1"; }
  else
    mount_path() { printf '%s' "$1"; }
  fi
elif command -v wsl.exe >/dev/null 2>&1; then
  distro="${WSL_DISTRO:-Ubuntu}"
  # Git Bash rewrites anything that looks like a path on its way to a Windows
  # program, which turns "/out" into "C:/Program Files/Git/out".
  export MSYS_NO_PATHCONV=1
  dock() { wsl.exe -d "$distro" -e docker "$@"; }
  mount_path() { wsl.exe -d "$distro" -e wslpath -a "$(cygpath -m "$1")" | tr -d '\r'; }
  wsl.exe -d "$distro" -e docker info >/dev/null 2>&1 \
    || die "Docker is not running inside WSL ($distro). Start it, or set WSL_DISTRO."
else
  die "This needs Docker, to fetch the Linux build of the dependencies."
fi

echo "Building Offset ($product) $version for Linux x64, with Node $NODE_VERSION"

# ── 1. the application, which is the same on every platform ─────────────────
# tsc never deletes what it did not just write, so start clean or every stray
# file that has ever been in dist ships for ever.
echo "  building the API..."
rm -rf "$repo/apps/api/dist"
(cd "$repo" && pnpm --filter @offset/api build >/dev/null)

echo "  building the $product web bundle..."
(cd "$repo" && PRODUCT="$product" pnpm --filter @offset/web build >/dev/null)

rm -rf "$stage"
mkdir -p "$stage/app"

# Everything the server resolves is relative to dist, so the layout has to
# match what it expects: the pack and the web bundle beside it.
cp -r "$repo/apps/api/dist" "$stage/app/dist"
cp -r "$repo/packs/$product" "$stage/app/pack"
cp -r "$repo/dist/web/$product" "$stage/app/public"

# Only what npm needs to install the runtime dependencies. The real manifest
# has scripts that would run during install and point at source that is not
# in the bundle. Every package is pinned to the version pnpm installed and the
# tests ran against, because npm does not read pnpm's lockfile; the script
# says why.
# The version written here is the one the application reports and the updater
# compares against, so it is the release version, not the source default.
# Relative paths, from the repository: on Windows, Git Bash is told above not
# to rewrite paths for Docker's sake, so a /c/Users/... path would reach Node
# unconverted and not be found.
(cd "$repo" && node deploy/runtime-manifest.mjs --version "$version" --out "dist/linux/$bundle/app/package.json")

# A checkout on Windows can hold these with CRLF endings, and a script whose
# first line ends "bash\r" does not run at all.
for f in install.sh uninstall.sh; do
  tr -d '\r' < "$repo/deploy/linux/$f" > "$stage/$f"
done
tr -d '\r' < "$repo/INSTALL.md" > "$stage/INSTALL.md"
tr -d '\r' < "$repo/LICENSE" > "$stage/LICENSE.txt"

# The documents, in the box. The same ones go in the Windows and Docker
# bundles, with their links fixed for a folder of their own.
(cd "$repo" && node deploy/bundle-docs.mjs "dist/linux/$bundle/docs")

# ── 2. the Linux half, inside Linux ──────────────────────────────────────────
echo "  compiling Linux dependencies on RHEL 8 and bundling Node $NODE_VERSION..."
rm -f "$out/$tarball" "$out/$tarball.sha256"

# Node, its headers and npm are taken from the official image rather than
# downloaded again: the same binary nodejs.org publishes, which needs glibc 2.28.
#
# The compiler is GCC Toolset 13, not RHEL 8's own GCC 8, which cannot build the
# driver's C++20. Toolset compilers exist for exactly this: newer language
# support, output that still runs on a stock RHEL 8 with nothing extra
# installed. The result needs glibc 2.28 and GLIBCXX 3.4.21 at most.
builder="offset-linux-build:node-$NODE_VERSION"
dock build -q --platform linux/amd64 -t "$builder" - >/dev/null <<DOCKERFILE
FROM node:$NODE_VERSION-bookworm-slim AS node
FROM redhat/ubi8
RUN dnf -y install gcc-toolset-13-gcc-c++ make python3.11 tar gzip findutils && dnf clean all
ENV PATH=/opt/rh/gcc-toolset-13/root/usr/bin:\$PATH
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/include/node /usr/local/include/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
DOCKERFILE

dock run --rm -i --platform linux/amd64 \
  -v "$(mount_path "$out"):/out" \
  -e "BUNDLE=$bundle" -e "PRODUCT=$product" -e "TARBALL=$tarball" \
  "$builder" bash -s <<'CONTAINER'
set -euo pipefail

# Worked on in the container's own filesystem. The mounted folder is a Windows
# drive on a Windows build machine, and npm's links do not survive it.
work=/tmp/work
mkdir -p "$work"
cp -r "/out/$BUNDLE" "$work/"
app="$work/$BUNDLE/app"
cd "$app"

# Compiled, not downloaded, for the reason at the top of this file. The headers
# come from the image, so nothing is fetched from nodejs.org either.
npm install --omit=dev --no-audit --no-fund --loglevel=error \
  --build-from-source --nodedir=/usr/local --python=/usr/bin/python3.11

# better-sqlite3 13 carries ready-made drivers and never compiles itself, and
# it loads a ready-made one whenever there is one for the machine. Its Linux one
# needs glibc 2.34, so on RHEL 8 it would refuse to load. It is compiled here
# like the rest, and the ready-made ones are removed so this is the one it
# loads. Built on Node-API, so the Node 24.19+ fault that aborted version 12
# when it was compiled with new headers cannot reach it.
( cd node_modules/better-sqlite3 \
  && rm -rf prebuilds \
  && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js \
       rebuild --release --force_build=1 --loglevel=error \
       --nodedir=/usr/local --python=/usr/bin/python3.11 >/dev/null \
  && find build -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} + \
  && find build/Release -mindepth 1 -maxdepth 1 ! -name better_sqlite3.node -exec rm -rf {} + )

mkdir -p node/bin
cp "$(command -v node)" node/bin/node

# ── does it actually run ─────────────────────────────────────────────────────
node/bin/node -e '
  new (require("better-sqlite3"))(":memory:").prepare("select 1").get();
  require("argon2");
' || { echo "  the native modules do not load on Linux" >&2; exit 1; }

# Started with the settings install.sh writes, so this proves the configuration
# a customer actually gets rather than a friendlier one.
scratch="$(mktemp -d)"
key() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
env -i PATH=/usr/bin:/bin PRODUCT="$PRODUCT" NODE_ENV=production \
  HOST=127.0.0.1 PORT=18080 LOG_TO_FILE=true \
  DATABASE_URL="file:$scratch/offset.db" EVIDENCE_DIR="$scratch/evidence" \
  BACKUP_DIR="$scratch/backups" LOG_DIR="$scratch/logs" \
  SESSION_SECRET="$(key)" FIELD_ENC_KEY="$(key)" \
  node/bin/node dist/server.js > "$scratch/server.log" 2>&1 &
server=$!

ok=no
for _ in $(seq 1 30); do
  sleep 1
  if node/bin/node -e '
       fetch("http://127.0.0.1:18080/api/v1/health/ready")
         .then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; then
    ok=yes; break
  fi
done
kill "$server" 2>/dev/null || true
wait "$server" 2>/dev/null || true

if [ "$ok" != yes ]; then
  echo "  the bundle did not start. What it said:" >&2
  cat "$scratch/server.log" "$scratch"/logs/* 2>/dev/null | tail -40 >&2
  exit 1
fi
echo "  started it once: it answered and opened its database"

# ── packing ──────────────────────────────────────────────────────────────────
cd "$work"
find "$BUNDLE" -type d -exec chmod 755 {} +
find "$BUNDLE" -type f -exec chmod 644 {} +
chmod 755 "$BUNDLE/install.sh" "$BUNDLE/uninstall.sh" "$BUNDLE/app/node/bin/node"

tar czf "/out/$TARBALL" --owner=0 --group=0 --numeric-owner "$BUNDLE"
(cd /out && sha256sum "$TARBALL" > "$TARBALL.sha256")
CONTAINER

# The staging folder has no dependencies in it, so it is not something to hand
# to anyone. The tarball is.
rm -rf "$stage"

size="$(du -h "$out/$tarball" | cut -f1)"
echo "  tar:    $out/$tarball ($size)"
echo "  sha256: $out/$tarball.sha256"
