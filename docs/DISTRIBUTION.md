# UEM distribution and update infrastructure

UEM 4.0.1 separates human downloads from machine updates.

## Human downloads

GitHub Releases is the manual distribution surface. The stable aliases are:

- [Windows installer](https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager/releases/latest/download/UEFN-Entitlement-Manager-Setup.exe)
- [Portable ZIP](https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager/releases/latest/download/UEFN-Entitlement-Manager-Portable.zip)
- [Latest release page](https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager/releases/latest)

Starting with 4.0.1, the custom GitHub assets are only those two unversioned aliases. Versioned installers, blockmaps, `latest.yml`, checksums, and inventories are internal release artifacts or machine-update objects, not release-page clutter.

## Machine updates

Electron Updater uses the generic HTTPS provider at:

`https://updates.adeptinteractive.net/uem/stable/`

The ADEPT-wide convention is:

`https://updates.adeptinteractive.net/{product}/{channel}/`

The reserved future beta path is `uem/beta/`; UEM 4.0.1 has no beta UI. The preferred R2 bucket is `adept-software-updates`, with these stable objects:

```text
uem/stable/latest.yml
uem/stable/UEFN-Entitlement-Manager-Setup-4.0.1.exe
uem/stable/UEFN-Entitlement-Manager-Setup-4.0.1.exe.blockmap
uem/stable/manifests/4.0.1.yml
```

Versioned artifacts and manifest history are immutable and retained. Only `latest.yml` is mutable.

The endpoint is intentionally anonymous public-read. It has no Cloudflare Access, application credentials, signed URLs, cookies, or session tokens. Write access is limited to the GitHub Actions R2 credential. The application contains no Cloudflare credentials.

## Publication order

`scripts/publish-updates.mjs` provides the auditable `stage`, `verify`, `promote`, and test-prefix cleanup operations. A release stages and verifies the versioned installer, blockmap, and immutable manifest through the public custom domain. It never uploads `latest.yml` during staging.

Promotion is a separate `release.published` workflow. It checks the release tag, stable/non-prerelease state, public R2 objects, the GitHub human installer alias, byte identity, manifest references, HTTPS availability, unknown-object 404 behavior, and installer range support. It copies the immutable manifest to `latest.yml` only as the final publication step, then requires `no-store, no-cache, must-revalidate` on the mutable feed.

Immutable objects use long-lived immutable cache metadata. `latest.yml` is no-cache. No broad CORS policy is required because Electron Updater is not browser JavaScript.

Use `uem/test/<unique-run-id>/` for isolated updater tests. Never put fake versions in stable and never promote a test manifest. Test cleanup is restricted by the helper to `uem/test/` prefixes.

## Credentials

The intended least-privilege R2 S3-compatible credential has Object Read & Write permission scoped to `adept-software-updates`. GitHub Actions receives only these names:

- `ADEPT_UPDATES_R2_ACCESS_KEY_ID`
- `ADEPT_UPDATES_R2_SECRET_ACCESS_KEY`
- repository variable `CLOUDFLARE_ACCOUNT_ID`

The helper uses `region=auto` and the account R2 endpoint. Values are read from the environment, never logged, committed, embedded, or written to update metadata.

## Recovery and cutoff

Before promotion, fix staged objects and rerun verification. If a bad mutable manifest is promoted, restore a previously verified manifest only after confirming that its referenced immutable artifacts remain available. Do not delete versioned release history during recovery.

UEM 4.0.0 intentionally remains a historical GitHub-updater release. There is no GitHub/R2 fallback and no automatic migration branch for 4.0.0. Controlled 4.0.0 users can install 4.0.1 manually. New versions use the ADEPT endpoint.

## Release checklist

1. Confirm `version.json`, package metadata, and the tag agree.
2. Run `npm run test:all` and `scripts/verify-release.ps1`.
3. Confirm packaged `resources/app-update.yml` is generic and points exactly at the stable ADEPT URL.
4. Confirm versioned installer, blockmap, and manifest are present and public through HTTPS.
5. Confirm human aliases are byte-identical to their versioned build artifacts.
6. Create or update a draft GitHub Release with only the two aliases.
7. Review hashes, unsigned SmartScreen wording, and release notes.
8. Publish the release only after review; the separate workflow promotes `latest.yml` last.

The installer remains unsigned in 4.0.1. Signing, MCP integration, transaction migration, and other deferred product work are outside this release.
