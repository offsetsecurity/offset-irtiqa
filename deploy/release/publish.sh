#!/usr/bin/env bash
#
# Publishes a release to this repository's own releases page.
#
#   bash deploy/release/publish.sh <version> <tag> <files-dir> <notes-file>
#
# Its own page, so "the latest release" means this product and nothing else.
# There was a shared downloads repository for a while, which existed only
# because five products used to be built from one repository and could not
# each have a "latest" of their own. They can now.
#
# Needs RELEASE_SIGNING_KEY, and GH_TOKEN - which is the workflow's own
# GITHUB_TOKEN, since a repository may publish to itself. No cross-repository
# token, and so no secret to rotate or leak.
set -euo pipefail

version=${1:?usage: publish.sh <version> <tag> <files-dir> <notes-file>}
tag=${2:?}
files=${3:?}
notes=${4:?}
repo="${GITHUB_REPOSITORY:-offsetsecurity/offset-irtiqa}"

id=ascend
winname=OffsetIrtiqa
display="Offset Irtiqa"

out="$files/$id"
mkdir -p "$out"

cp "$files/offset-$id-$version-linux-x64.tar.gz" "$out/" 2>/dev/null || true
cp "$files/offset-$id-$version-linux-x64.tar.gz.sha256" "$out/" 2>/dev/null || true
cp "$files/$winname-$version-setup.exe" "$out/" 2>/dev/null || true

# What a Docker customer needs and cannot get anywhere else. These files were
# only inside the Linux tarball and this repository, so somebody on Windows
# running Docker had the image and nothing to start it with: the product needs
# a port, a volume and two secrets, and compose.yaml is what says so.
# zip is on every GitHub runner; a machine without it should say so
# plainly rather than fail three lines later inside a subshell.
command -v zip >/dev/null 2>&1 || { echo "zip is not installed, and the docker bundle needs it" >&2; exit 1; }
docker_zip="offset-$id-$version-docker.zip"
docker_dir="$out/docker"
mkdir -p "$docker_dir"
cp deploy/docker/compose.yaml deploy/docker/env.example "$docker_dir/"
cp deploy/docker/README-docker.txt "$docker_dir/README.txt"
( cd "$docker_dir" && zip -q -r "../$docker_zip" . )
rm -rf "$docker_dir"
echo "  packed $docker_zip"

# The files are named at the address they will have once this release exists,
# which is the tag being built - not "latest", whose meaning moves.
node deploy/release/make-manifest.mjs \
  --version "$version" \
  --only "$id" \
  --base-url "https://github.com/$repo/releases/download/$tag" \
  --files "$out" \
  --images images.json \
  --notes "$notes" \
  --out "$out/release.json"

node deploy/release/sign.mjs "$out/release.json"

# With the application's own code and the keys compiled into it, so a
# mismatched signing key stops the release here rather than on a customer's
# server.
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { verifyRelease, TRUSTED_KEYS } from "./apps/api/dist/update/release.js";
  const dir = process.argv[1];
  const r = verifyRelease(readFileSync(`${dir}/release.json`), readFileSync(`${dir}/release.json.sig`, "utf8"), TRUSTED_KEYS);
  console.log(`verified ${r.version}: ${Object.keys(r.products).join(", ")}`);
' "$out"

gh release create "$tag" \
  --repo "$repo" \
  --title "$display $version" \
  --notes-file "$notes" \
  "$out"/*

echo "published $display $version to $repo"
