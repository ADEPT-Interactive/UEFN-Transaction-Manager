# UTM 4.3.0 coordinated release checklist

> Internal operational checklist. Phase 30 prepares the candidate but does not execute these release actions.

- [ ] Confirm the separate ADEPT website UTM page is complete and approved for launch.
- [ ] Confirm final legal, support, moderation, and release communications approval.
- [ ] Confirm Authenticode signing and the intended publisher for the installer, installed executable, and portable executable. The local Phase 30 candidate is unsigned; if 4.3 will ship unsigned, explicitly approve the expected Unknown Publisher/SmartScreen friction and add first-run support wording.
- [ ] Run a local Microsoft Defender scan against the final installer, portable archive, and portable executable; record any detection before launch.
- [ ] Review the final local candidate and confirm the exact commit to publish; do not push `main` yet.
- [ ] Create and push the `v4.3.0` tag from that exact commit only after the coordinated launch window is confirmed.
- [ ] Wait for the tag workflow to build, verify, stage immutable R2 versioned objects, and create the draft GitHub release. Review its artifacts and notes.
- [ ] Publish the verified GitHub 4.3.0 release first. This moves `/releases/latest/download/...` to 4.3 before the 4.3 README is visible on `main`.
- [ ] Wait for the release-triggered R2 promotion to complete, then verify `latest.yml`, portable metadata, hashes, sizes, Range/206 behavior, and expected 404s.
- [ ] Push the exact already-tagged release commit to `main` only after GitHub latest downloads are 4.3 and R2 promotion has passed, eliminating the normal README=4.3/latest-download=4.2 interval.
- [ ] Publish the separate ADEPT website UTM page and verify canonical links and download actions.
- [ ] At coordinated launch, update GitHub About metadata: keep the current UTM description, add any approved 4.3/MCP/transaction topics, replace the root homepage with the completed UTM page, and refresh the social preview image if approved.
- [ ] Publish the approved X, Epic Developer Community, Discord, and other launch messaging.
- [ ] Recheck screenshots, release links, Agent Integration docs, and support routes from the public surfaces.
