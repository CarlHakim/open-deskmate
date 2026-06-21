# Changes And Git

Changes & Git is the Build Mode review panel for file changes and Git actions.

It replaces the older **Proposed Changes / Diff** workflow.

## When To Use It

Use Changes & Git whenever a Build task edits files, you want to check what changed, or you need to commit, push, create a branch, add a remote, or resolve a Git mismatch.

## What It Shows

- Environment summary.
- Git repository state.
- Current branch.
- Remote/upstream status.
- Ahead/behind information.
- Changed file count.
- Total additions and deletions.
- Per-file additions and deletions.
- Staged, unstaged, and untracked files.
- GitHub CLI availability when relevant.
- Suggested next step.
- A larger review popup with Overview, Files, Diff, Git, and Sources tabs.
- A side-by-side file review with additions, deletions, line numbers, linked scrolling, and a mini preview map.

## Quick Steps

1. Review changed files.
2. Commit updates with a clear message.
3. Push updates when a remote/upstream is available.

No Git action runs automatically after AI edits.

## Step-By-Step: Commit And Push Updates

1. Open **Changes & Git**.
2. Review the edited file count, total additions/deletions, and per-file changes.
3. Open **Review files** or the larger review popup if you need more room.
4. Choose **Commit updates** or **Commit & push updates** when the top strip says it is safe.
5. Enter or confirm the commit message.
6. Confirm the commit.
7. Push when the branch has a remote/upstream.

## Step-By-Step: Add A Remote

1. Open **Changes & Git**.
2. Check **Environment** for remote/upstream status.
3. Choose the remote setup action when the panel says no remote exists.
4. Pick GitHub, GitLab, Bitbucket, or manual setup.
5. Enter the remote URL or follow the provider-specific guidance.
6. Save the remote.
7. Push the branch after the remote is available.

## Git Next Step

The top strip suggests the safest next action:

- Commit updates.
- Push updates.
- Commit & push updates.
- Add remote.
- Resolve mismatch.
- Initialize Git.

Disabled buttons explain what is missing.

## Remote Setup

If there is no remote, use the remote setup flow.

- GitHub can use GitHub CLI when available.
- GitLab and Bitbucket provide guided manual setup.
- The app does not store Git passwords, tokens, or SSH private keys.

## Branches

Use branch tools to:

- Create a new branch.
- Switch branch.
- Check out a remote branch as a local branch.
- See whether the local branch is ahead, behind, or diverged.

## Resolve Mismatch

Use Resolve mismatch when local and remote history do not match.

The flow can help with:

- Pulling remote changes.
- Saving local changes aside.
- Committing local work first.
- Reviewing local-only and remote-only commits.
- Resolving conflicts.
- Continuing or aborting a rebase.
- Recovering from app-created backup branches.

## Conflicts

Conflict tools show conflicted files and hunks.

For each hunk you can:

- Use local.
- Use remote.
- Edit manually.
- Mark resolved.
- Finish merge commit when ready.

## Popup Review

Open the panel in a larger popup for maximal view:

- Overview.
- Files.
- Diff.
- Git.
- Sources.

The popup can also be switched to fullscreen.

## Files Tab

Use the Files tab when you want to understand exactly what changed in a selected file.

It can show:

- Before and after file content.
- Red deletion markers.
- Green addition markers.
- Line numbers.
- Linked scrolling so both sides move together.
- A mini preview map on the side, similar to an editor minimap, so you can jump to dense change areas.
- Full file content for the selected file when available.

If a preview says it was truncated, the app is protecting the review view from loading an overly large file into the comparison area. Use the full file option or open the file directly when you need every line.

## Diff Tab

Use the Diff tab when you want the compact patch-style view.

In this view:

- Lines starting with `-` are removals and are shown in red.
- Lines starting with `+` are additions and are shown in green.
- Unchanged context lines are shown without change coloring.

The Files tab is usually easier for beginners. The Diff tab is useful when you want a developer-style patch.

## Troubleshooting

- If Push is disabled, check whether the branch has a remote/upstream and whether Git credentials are configured.
- If the local branch is behind, use Resolve mismatch before pushing.
- If the branch is diverged, review the local-only and remote-only commits before choosing pull, merge, rebase, or backup recovery.
- If GitHub CLI is unavailable, normal Git can still work; only GitHub-specific automation is limited.
- If a private repository pushes successfully, the app is using credentials already available to Git or GitHub CLI on the machine.
- If the edited-files card or top change counter looks stale, refresh Changes & Git and compare against the Files tab before committing.

## Related Pages

- [Build Mode](./build-mode.md)
- [Build Mode Safety](./settings/build-mode-safety.md)
- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
- [Build Smoke Testing](./build-smoke-testing.md)
