# Cloudflare update-feed contract

This public repository owns the UEFN Transaction Manager update consumer and its GitHub Actions publication workflow. The private [ADEPT-Interactive/infrastructure](https://github.com/ADEPT-Interactive/infrastructure) repository owns the cross-project Cloudflare inventory and sanitized live baseline.

## Consumer

Installed Windows builds use Electron Updater's generic HTTPS provider:

~~~text
https://updates.adeptinteractive.net/uem/stable/
~~~

Portable builds read portable-latest.json and verify the exact version, byte size, SHA-256, archive readability, required executable/resources, portable marker, and managed-file list before replacing the current directory.

The client is anonymous public-read only. It contains no Cloudflare account credential, R2 write credential, Access policy, cookie, or session token.

## Publication

GitHub Actions uses scripts/publish-updates.mjs and the R2 bucket adept-software-updates:

1. stage writes immutable versioned installer, blockmap, manifest, portable archive, and portable metadata objects.
2. verify checks those public objects, byte identity, metadata, HTTP range support, and expected 404 behavior.
3. The separate published-release workflow runs promote, which copies the verified manifests to mutable latest.yml and portable-latest.json only as the final step.

R2 write credential names are kept in GitHub Actions configuration and secret storage; their values must never be committed or printed.

## Safety

The stable feed is not a website Worker binding. Do not treat the future website shop/product-storage design as live update infrastructure, and do not modify the stable bucket or DNS mapping during ordinary source work.
