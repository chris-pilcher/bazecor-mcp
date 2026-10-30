# Keeping the fork current

Track Dygma's `development` branch as upstream. Published fork history should be
merged, not rebased, so installed release tags keep their source history.

```sh
git remote add upstream https://github.com/Dygmalab/Bazecor.git # once only
git switch development
git pull --ff-only origin development
git fetch upstream
git switch -c codex/update-upstream
git merge upstream/development
```

Resolve conflicts, run the checks below, and merge the update branch into the
fork's `development`. Publish a fresh `mcp-v...` tag after checks pass. Do not move
published release tags. Pull the fork's `development` normally on other machines.
If an `upstream` remote already exists, inspect `git remote -v` instead of adding
it again. Baseline for the initial fork was upstream commit `7b37713f16f6e6536fe9ee4da77d9fdfca2ad862`.

## Keep the integration additive

MCP-specific code lives in `src/mcp/` and `mcp/`. Preserve these directories while
merging upstream. The deliberate upstream touchpoints are:

- `src/api/backup/Backup.ts`: optional distinct recovery filenames, preventing
  the normal post-save backup from overwriting the pre-write recovery snapshot.
- `src/main/index.ts`: import and call `configureMcp()` once on startup.
- `src/renderer/views/LayoutEditor.tsx`: invoke the adapter hook, display its
  control panel, share the key picker state application path, and strengthen the
  existing save handler with recovery and explicit error checks.
- `forge.config.ts`: bundle `mcp/`, distinguish the executable/app identity and
  check native dependency installation failures.
- Package metadata, version/footer branding and automatic updater configuration:
  keep the fork distinguishable and prevent replacement by official binaries.
- README banner: retain the upstream documentation underneath it.

`mcp-appimage.yml` is this fork's standalone Linux pipeline. The original upstream
workflows are retained with only job-level repository guards so they do not need
Dygma's signing credentials in this fork. Keep those guards when upstream updates
the files. This includes the upstream E2E workflow, which attempts firmware
flashing and must not run routinely in this fork. No copied upstream application
modules or second transport implementation are maintained.

After an upstream merge, pay special attention to changes in draft ownership,
keymap parsing, color conversion, `Device.command`/`noCacheCommand`, backup schema,
transport acknowledgement/failure semantics and the save handler. These are the
integration contracts; if upstream changes them, update the adapter and its tests.
A small adapter is easier to merge, but does not eliminate semantic regressions.

## Checks before releasing

```sh
yarn install --frozen-lockfile
yarn test --run
yarn tsc --noEmit --skipLibCheck
yarn exec prettier --check src/mcp mcp
yarn exec prettier --ignore-path /dev/null --check docs/MCP.md docs/UPSTREAM.md
yarn make-lin --arch=x64
yarn test:mcp-live
```

Note that this repository's `yarn prettier` script rewrites many files. For a
check without invoking that script, use `yarn exec prettier --check ...` instead.
Use `yarn exec prettier --write ...` for newly authored MCP files. Avoid formatting
whole upstream files during routine edits. The pre-commit hook may format staged
TypeScript; inspect its changes before pushing.

Test with a virtual keyboard and a real MCP client, then confirm that a manual UI
edit changes the revision and is visible to the client. Hardware writes need a
concrete user-requested configuration, not a transport demonstration. Linux is
the release target; other platforms require their own verification.
