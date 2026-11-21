# Contributing

The source is publicly visible so creators and developers can inspect it,
report problems, propose improvements, and help ADEPT improve the official
UEFN Transaction Manager release. It is not an open-source project and the
repository's source-available license does not permit unauthorized publication
of derivative releases, repackaging the tool, or using the codebase in another
release.

GitHub users may create platform forks to the extent required by GitHub's
Terms of Service. A platform fork is not permission to distribute, sublicense,
commercialize, or release the Software or a derivative product.

## Before submitting a contribution

Before submitting a pull request or patch, you must affirmatively accept the
[ADEPT Contributor License Agreement](CLA.md) through the [CLA Acceptance
Process](CLA-ACCEPTANCE.md) designated by AD3PT Interactive Inc. The process
must record your identity, the
CLA version, the acceptance timestamp, and your affirmative acceptance.
Opening a pull request, creating a GitHub fork, or sending a patch alone is
not CLA acceptance. AD3PT Interactive Inc. will not merge, incorporate, or
otherwise accept a Contribution without recorded CLA acceptance. Accepted
contributions are assigned to AD3PT Interactive Inc. so the project can maintain
one canonical official release and choose appropriate licensing for future
distributions.

Please keep pull requests focused, preserve unrelated work, include tests for
behavioral changes, describe any UEFN editor-session validation that was
performed, and identify any third-party material and its applicable license.
Third-party material requires explicit approval before inclusion.

Never commit machine-specific audit logs, session transcripts, local absolute
paths, usernames, environment dumps, or temporary E2E handoff reports to this
public repository. Release evidence must use repository-relative paths and
generic placeholders.

## CI policy

CI is the final check, not a linter.

- Run `npm run test:all` locally before pushing.
- Open pull requests as drafts. Drafts run no CI, so push to them as often as you like. Mark the pull request ready once, when it is finished; that runs CI once.
- Batch review fixes into one push. Each push to a ready pull request runs the full Windows build again and cancels the run before it.
- What runs when: drafts run nothing; ready pull requests and pushes to `main` run the full test and package build; release tags run `release.yml`.
- To check a draft or another branch, run CI by hand: Actions > CI > Run workflow, or `gh workflow run ci.yml --ref <branch>`. The packaged build is kept as a run artifact for 14 days.
