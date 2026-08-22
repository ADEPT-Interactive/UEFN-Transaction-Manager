# Phase 28 showcase

The showcase fixture is deterministic and intentionally uses original, abstract vector icons. It demonstrates a mixed catalog without relying on Fortnite or other third-party artwork:

- durable and consumable entitlements;
- paid-random disclosure metadata;
- alternate offers with independent restrictions;
- fixed and runtime-priced offers;
- fixed, fill-to-max, and runtime-quantity bundles;
- explicit storefront membership.

Use `showcase-project.json` as a review fixture or run `npm run showcase:fixture -- --output <temporary-folder>` to create a disposable UEFN project with generated Verse and crisp PNG previews from the original SVG source icons. The generated project is disposable and is not committed. Native Content Browser acceptance still requires the icon adoption/import workflow.

The canonical 4.2.0 capture set is stored in [docs/screenshots](../screenshots/). Run `npm run showcase:capture` to regenerate the ten renderer-level PNGs from the disposable fixture. The capture uses an explicitly development-only healthy connection state and is not enabled in packaged/customer execution.
