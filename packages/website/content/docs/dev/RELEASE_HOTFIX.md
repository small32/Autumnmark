# Prepare a Hotfix

Start from the published tag that needs the fix, rather than from a development branch that may include unreleased features.

```sh
git fetch origin --tags
git switch -c hotfix/vX.Y.Z vX.Y.P
```

Replace `vX.Y.P` with the affected release tag and `vX.Y.Z` with the intended patch version.

Apply the fix directly or cherry-pick the relevant commit:

```sh
git cherry-pick <commit>
```

When branching from an older tag, bring the current three-target release configuration onto the hotfix branch before tagging. GitHub runs the workflow from the tagged commit.

Follow the hosted verification steps in [Releasing Antumnmark+](RELEASE.md). Update both application package versions, record release highlights, push the hotfix branch and use its name for any required E2E dispatch. All hotfix testing runs on GitHub-hosted runners. The tag workflow builds the platform packages and publishes the release once verification succeeds.

Bring applicable fixes back to `develop` through a PR so later releases retain them.
