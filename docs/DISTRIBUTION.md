# UEFN Transaction Manager distribution and update infrastructure

Transaction Manager 4.1.0 separates human downloads from machine updates.

## Human downloads

GitHub Releases is the manual distribution surface. The stable aliases are:

- [Windows installer](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Setup.exe)
- [Portable ZIP](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Portable.zip)
- [Latest release page](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest)

Starting with 4.1.0, the custom GitHub assets are only those two unversioned aliases. Versioned installers, blockmaps, `latest.yml`, checksums, and inventories are internal release artifacts or machine-update objects, not release-page clutter.

## Machine updates

Electron Updater uses the generic HTTPS provider at:

`https://updates.adeptinteractive.net/uem/stable/`

The ADEPT-wide convention is:

`https://updates.adeptinteractive.net/{product}/{channel}/`

The reserved future beta path is `uem/beta/`; Transaction Manager 4.1.0 has no beta UI. The preferred R2 bucket is `adept-software-updates`, with these stable objects:

```text
uem/stable/latest.yml
uem/stable/UEFN-Transaction-Manager-Setup-4.1.0.exe
uem/stable/UEFN-Transaction-Manager-Setup-4.1.0.exe.blockmap
uem/stable/manifests/4.1.0.yml
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

The 4.0.0 and 4.0.1 releases remain historical compatibility releases. New versions use the ADEPT endpoint and retain the established `uem/stable/` path.

## Release checklist

1. Confirm `version.json`, package metadata, and the tag agree.
2. Run `npm run test:all` and `scripts/verify-release.ps1`.
3. Confirm packaged `resources/app-update.yml` is generic and points exactly at the stable ADEPT URL.
4. Confirm versioned installer, blockmap, and manifest are present and public through HTTPS.
5. Confirm human aliases are byte-identical to their versioned build artifacts.
6. Create or update a draft GitHub Release with only the two aliases.
7. Review hashes, unsigned SmartScreen wording, and release notes.
8. Publish the release only after review; the separate workflow promotes `latest.yml` last.

The 4.1.0 installer remains unsigned. Signing, MCP integration, dynamic transaction support, and other deferred product work are outside this release.

## Rename compatibility boundary

The public product identity is **UEFN Transaction Manager**. The following old-name identifiers are intentionally retained because changing them would fragment existing installs, project state, or editor integrations:

- `AD3PTInteractive.UEFNEntitlementManager` remains the Electron/Windows application ID and AppUserModelID.
- `%LOCALAPPDATA%\UEFN Entitlement Manager` remains the user-data, discovery-cache, log, session, and temporary import namespace.
- `https://updates.adeptinteractive.net/uem/stable/` and its `uem/test/` safety boundary remain the updater paths for existing 4.0.1 installations.
- The `uem-launcher` protocol, `uemDesktop` preload surface, `UEM_*` environment variables and headers, and the `UEFN Entitlement Manager Bridge` health identity remain private technical compatibility surfaces.
- Existing project markers such as `UEFN_ENTITLEMENT_MANAGER_DATA_*`, `# UEM_DATA`, `managed_transactions.verse`, `entitlement_manager.py`, and generated `UEM_*` Verse symbols remain stable so existing projects and editor assignments continue to load.
- The private package name `uefn-entitlement-manager` and bundled `uem-icon.*` asset filenames remain implementation paths; their visible artwork and all customer-facing labels use the new identity.
