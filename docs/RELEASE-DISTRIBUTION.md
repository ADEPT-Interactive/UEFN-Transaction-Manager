# UEFN Transaction Manager release distribution

The canonical release version is read from `version.json`. A tagged release must use the matching `v<version>` tag. The release build is Windows x64 and the NSIS installer is the primary end-user artifact.

Run the complete local candidate flow from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-release.ps1
```

The 4.0.0 and 4.0.1 releases remain historically intact with their original updater configuration and assets. Starting with 4.1.0, follow the split distribution contract in [DISTRIBUTION.md](DISTRIBUTION.md).

The v4.1.0 GitHub Release custom assets are only:

- `UEFN-Transaction-Manager-Setup.exe`
- `UEFN-Transaction-Manager-Portable.zip`

The machine-update objects are staged under `uem/stable/` in the ADEPT R2 update service. `latest.yml` is promoted separately and last, after the immutable installer, blockmap, manifest, public hashes, and GitHub installer alias have been verified.

The release workflow creates a draft release after building and verifying these assets. Publish the draft only after reviewing the candidate. The 4.0.1 installer is intentionally unsigned and may produce a Windows SmartScreen unrecognized-publisher warning.

The per-user NSIS installer creates the Start Menu and uninstall registrations while preserving Transaction Manager user data on uninstall. Do not delete UEFN project content as part of release testing.
