# UEFN Transaction Manager distribution and update infrastructure

Transaction Manager 4.3.6 separates human downloads from machine updates and keeps portable upgrades in-place.

The cross-project Cloudflare inventory is maintained in the private [ADEPT-Interactive/infrastructure](https://github.com/ADEPT-Interactive/infrastructure) repository. This public document remains limited to the UTM update contract and intentionally contains no account credentials or secret values.

## Current supported release

`v4.3.6` is the current supported public release. `v4.3.5` remains publicly retained as the prior identity-preservation and updater baseline; `v4.3.2` remains publicly retained as the earlier portable-updater acceptance baseline. Their tags, releases, and Git history remain intact.

## Human downloads

GitHub Releases is the manual distribution surface. The stable aliases are:

- [Windows installer](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Installer.exe)
- [Portable ZIP](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Portable.zip)
- [Latest release page](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest)

The custom GitHub assets for the current release are only those two unversioned aliases. Versioned installers, blockmaps, `latest.yml`, portable metadata, checksums, and inventories are internal release artifacts or machine-update objects, not release-page clutter.

## Machine updates

Electron Updater uses the generic HTTPS provider at:

`https://updates.adeptinteractive.net/uem/stable/`

The ADEPT-wide convention is:

`https://updates.adeptinteractive.net/{product}/{channel}/`

A reserved future beta path is `uem/beta/`. The preferred R2 bucket is `adept-software-updates`, with these stable objects:

```text
uem/stable/latest.yml
uem/stable/UEFN-Transaction-Manager-Setup-4.3.6.exe
uem/stable/UEFN-Transaction-Manager-Setup-4.3.6.exe.blockmap
uem/stable/manifests/4.3.6.yml
uem/stable/manifests/portable-4.3.6.json
uem/stable/portable-latest.json
uem/stable/UEFN-Transaction-Manager-4.3.6-Portable.zip
```

The stable R2 origin will contain only the active 4.3.6 payload and feed objects listed above after guarded promotion. `latest.yml` and `portable-latest.json` are the two mutable pointers; the referenced 4.3.6 artifacts are immutable for this release. Git history and the public 4.3.5 and 4.3.2 releases retain prior acceptance baselines; older public artifacts are not otherwise part of the supported distribution.

### Build and installer contract

The canonical release version is read from `version.json`, and a tagged release must use the matching `v<version>` tag. The release build targets Windows x64 and the NSIS installer is the primary end-user artifact. Run the complete local candidate flow from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-release.ps1
```

The per-user NSIS installer creates Start Menu and desktop shortcuts plus uninstall registrations while preserving Transaction Manager user data on uninstall. Its custom install macro recreates both shortcuts against the current executable and refreshes their AppUserModelID on every installer upgrade. The portable ZIP is a marked `win-unpacked` application directory; portable updates use `portable-latest.json`, staged extraction, rollback, and same-location relaunch without NSIS registrations or shortcuts.

### Portable application updates

The portable ZIP is a `win-unpacked` application directory with a `portable.json` marker at its root. The marker is added only after the installed NSIS package has been built, so the installed build does not identify itself as portable. The application uses that marker to select the portable updater path deterministically.

Portable mode still uses the existing `%LOCALAPPDATA%\UEFN Entitlement Manager` compatibility namespace for settings, logs, discovery cache, and temporary import data. It does not imply a self-contained profile. The portable updater downloads `portable-latest.json`, checks the exact version, byte size, SHA-256, archive readability, required executable/resources, marker, and managed-file list, then extracts to a staging directory. An external PowerShell helper waits for the running process to exit, backs up only marker-declared UTM files, swaps the staged files, preserves neighboring user files, relaunches the same executable, and restores the backup if any swap step fails.

If the directory is read-only, on write-protected media, or blocked by a file lock, the current copy is left in place and the user receives an actionable failure result. The updater never falls back to NSIS. A verified ZIP may be retained for manual installation when automatic replacement is not possible.

The endpoint is intentionally anonymous public-read. It has no Cloudflare Access, application credentials, signed URLs, cookies, or session tokens. Write access is limited to the GitHub Actions R2 credential. The application contains no Cloudflare credentials.

## Publication order

`scripts/publish-updates.mjs` provides the auditable `stage`, `verify`, `promote`, and test-prefix cleanup operations. A release stages and verifies the versioned installer, blockmap, immutable manifest, portable ZIP, and portable-latest.json through the public custom domain. It never uploads `latest.yml` during staging.

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

Before promotion, fix staged objects and rerun verification. If a bad mutable manifest is promoted, restore a previously verified manifest only after confirming that its referenced immutable artifacts remain available. Recovery must leave the public stable origin on the last verified payload until a separately authorized release is ready. The retained 4.3.5 and 4.3.2 public releases are not the stable pointer after 4.3.6 promotion.

The compatibility namespace and updater path continue to support existing installs, including older 4.0.1 clients; the public 4.3.2 release remains only as the explicitly retained updater baseline. New versions use the ADEPT endpoint and retain the established `uem/stable/` path.

## Release checklist

1. Confirm `version.json`, package metadata, and the tag agree.
2. Run `npm run test:all` and `scripts/verify-release.ps1`.
3. Confirm packaged `resources/app-update.yml` is generic and points exactly at the stable ADEPT URL.
4. Confirm versioned installer, blockmap, and manifest are present and public through HTTPS.
5. Confirm human aliases are byte-identical to their versioned build artifacts.
6. Create or update a draft GitHub Release with only the two aliases.
7. Review hashes, unsigned SmartScreen wording, and release notes.
8. Publish the release only after review; the separate workflow promotes `latest.yml` last.

The 4.3.6 installer remains unsigned in local builds unless a secure Authenticode certificate is supplied through the release environment. Signing is an owner-controlled launch gate; MCP integration and Agent Skill work remain part of the 4.3 release line.

## Rename compatibility boundary

The public product identity is **UEFN Transaction Manager**. The following old-name identifiers are intentionally retained because changing them would fragment existing installs, project state, or editor integrations:

- `AD3PTInteractive.UEFNEntitlementManager` remains the Electron/Windows application ID and AppUserModelID.
- `%LOCALAPPDATA%\UEFN Entitlement Manager` remains the user-data, discovery-cache, log, session, and temporary import namespace.
- `https://updates.adeptinteractive.net/uem/stable/` and its `uem/test/` safety boundary remain the updater paths for existing 4.0.1 installations.
- The `uem-launcher` protocol, `uemDesktop` preload surface, `UEM_*` environment variables and headers, and the `UEFN Entitlement Manager Bridge` health identity remain private technical compatibility surfaces.
- Existing project markers such as `UEFN_ENTITLEMENT_MANAGER_DATA_*`, `# UEM_DATA`, `managed_transactions.verse`, `entitlement_manager.py`, and generated `UEM_*` Verse symbols remain stable so existing projects and editor assignments continue to load.
- The private package name `uefn-entitlement-manager` and bundled `uem-icon.*` asset filenames remain implementation paths; their visible artwork and all customer-facing labels use the new identity.

Installer shortcut behavior is part of that compatibility boundary. The per-user NSIS installer creates `UEFN Transaction Manager.lnk` in Start Menu and on the desktop. Its custom install macro deliberately recreates those links against the current `UEFN Transaction Manager.exe` after each installer upgrade, repairing links carried forward from the old visible/executable name instead of preserving a stale target. The desktop shortcut is therefore expected by default after an installed-build upgrade; portable ZIP updates do not create shell registrations or shortcuts.
