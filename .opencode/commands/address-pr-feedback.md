---
description: Inspect active PR feedback and apply valid corrections
agent: build
---

Please inspect the current pull request feedback and make the respective corrections.

If a PR number is provided, focus on PR #$1. Otherwise, identify the active PR from the current branch.

## Goal

Review all feedback on the active PR, including:

- CodeRabbit inline comments
- Human review comments
- GitHub review summaries
- Failing or pending CI checks, if available

Then make the smallest correct set of changes needed to resolve valid issues.

## Instructions

1. Identify the active PR for the current branch.
2. Read the PR description, changed files, review comments, inline threads, and CI status.
3. Classify each piece of feedback as one of:
   - Valid and should be fixed now
   - Valid but better as follow-up
   - Not applicable / already fixed
   - Incorrect or not worth changing
4. For every valid fix-now item:
   - Make the correction in the relevant source, test, or documentation file.
   - Keep changes minimal and aligned with existing project style.
   - Do not expand the scope beyond the PR.
5. Add or update tests when feedback reveals behavior that should be protected.
6. Run the appropriate validation commands.
7. Prepare a PR progress comment summarizing the work completed.
8. Report what changed.

## Current PR feedback themes to verify

### CLI storage behavior

Read-only trace commands should not silently create a new SQLite database when the storage path is missing or typoed.

Fix by either checking that the storage path exists before constructing storage, or by adding storage support for a read-only / file-must-exist mode.

The user should get a clear error for a missing storage database.

### Invalid report type behavior

Trace commands should reject unknown `--report` values instead of falling back to terminal output.

Match the existing `analyze` command behavior:

~~~text
Unknown report type: <value>
~~~

Supported formats:

- `traces list`: `terminal`, `json`
- `traces show`: `terminal`, `json`, `html`

### Test cleanup

Do not remove directories with `unlinkSync`.

Use an appropriate directory cleanup API, such as:

~~~ts
rmSync(dbDir, { recursive: true, force: true })
~~~

### CLI test coverage

Tests should exercise the actual CLI path, not only lower-level storage objects.

Cover:

- `traces list`
- `traces show <trace-id>`
- invalid `--report`
- missing or typoed storage path
- `--output`, if practical

### Docs alignment

Make sure documented CLI flags match actual parser behavior.

If `traces list` supports `--report json` and `--output`, document that.

If those flags should not be supported for `list`, reject them in the parser instead.

### Trace metrics duplication

Treat trace metrics deduplication as optional follow-up unless it is small, safe, and clearly improves this PR without churn.

Do not perform a large refactor unless needed for correctness.

## PR progress comment

After addressing the PR feedback and running validation, prepare a concise PR comment summarizing what changed.

Write the comment body to:

~~~text
/tmp/signalglass-pr-feedback-comment.md
~~~

The comment should be specific to the work just completed. Do not use generic filler.

Use this structure:

~~~markdown
## PR feedback addressed

Briefly summarize the review, CodeRabbit, and CI feedback that was addressed.

## Changes made

List the concrete code, doc, and test changes, grouped by area.

Suggested groups:

- Reports
- CLI
- Tests
- Docs/specs
- Privacy/safety
- Refactors

## CodeRabbit status

Summarize CodeRabbit threads:

- resolved threads
- remaining open threads, if any
- any threads intentionally deferred, with reason

Do not claim a thread is resolved unless the code actually addresses it.

## Validation

Include actual validation results:

- pnpm test
- pnpm build

Include test count if available.

## Commit

Include:

- branch name
- commit hash
- whether working tree is clean

## Next step

State whether the PR is ready for re-review, ready for Approver workflow, or still needs follow-up.
~~~

## GitHub comment behavior

If this environment allows GitHub CLI commands, post the comment with:

~~~bash
gh pr comment <PR_NUMBER> --body-file /tmp/signalglass-pr-feedback-comment.md
~~~

If GitHub CLI commands are blocked or permission-denied, do not treat that as a failure.

Instead, report the exact manual command the user should run:

~~~bash
gh pr comment <PR_NUMBER> --body-file /tmp/signalglass-pr-feedback-comment.md
~~~

Do not treat inability to post the GitHub comment as a failed implementation if the comment file was created successfully.

## Constraints

- Do not commit secrets, generated databases, local artifacts, `.env` files, or build output.
- Do not make unrelated formatting churn.
- Do not change public behavior beyond what is required by the feedback.
- Keep privacy behavior intact: reports must not expose raw payloads, API keys, authorization headers, secrets, or `storageKey` values in standard mode.

## Validation

Run the strongest reasonable validation:

~~~bash
pnpm test
pnpm build
~~~

If that is too broad or slow, run targeted tests first, then explain what was and was not run.

## Final response

When finished, report:

- Files changed
- Feedback addressed
- Feedback skipped or deferred
- Tests run
- PR progress comment file path
- Whether the PR comment was posted or the manual command to post it
- Commit hash, if a commit was created
- Branch name
- Working tree status
- Any follow-up recommendation
