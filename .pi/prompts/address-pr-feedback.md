Address PR Feedback

Please inspect the current pull request feedback and make the respective corrections.

Goal

Review all feedback on the active PR, including:

* CodeRabbit inline comments
* Human review comments
* GitHub review summaries
* Failing or pending CI checks, if available

Then make the smallest correct set of changes needed to resolve valid issues.

Instructions

1. Identify the active PR for the current branch.
2. Read the PR description, changed files, review comments, inline threads, and CI status.
3. Classify each piece of feedback as one of:
    * Valid and should be fixed now
    * Valid but better as follow-up
    * Not applicable / already fixed
    * Incorrect or not worth changing
4. For every valid fix-now item:
    * Make the correction in the relevant source, test, or documentation file.
    * Keep changes minimal and aligned with the existing project style.
    * Do not expand the scope beyond the PR.
5. Add or update tests when the feedback reveals behavior that should be protected.
6. Run the appropriate validation commands.
7. Prepare a concise report summarizing:
    * What feedback was addressed
    * What was intentionally deferred or skipped, and why
    * What tests or validation commands were run
    * Any remaining risks

Current PR-specific corrections to verify

For PR #5 in ecarlisle/signalglass, verify and address these items if still valid:

CLI storage behavior

signalglass traces --storage <path> list and show are read-only commands. They should not silently create a new SQLite database when the storage path is missing or typoed.

Fix by either:

* Checking that the storage path exists before constructing TraceStorage, or
* Adding storage support for a read-only / file-must-exist mode and using it for trace read commands.

The user should get a clear error for a missing storage database.

Invalid report type behavior

traces list and traces show should reject unknown --report values instead of falling back to terminal output.

Match the existing analyze command behavior:

Unknown report type: <value>

Supported formats:

* traces list: terminal, json
* traces show: terminal, json, html

Test cleanup

packages/cli/src/cli.test.ts currently attempts to remove a temp directory with unlinkSync. That does not remove directories.

Use the appropriate directory cleanup API, such as rmSync(dbDir, { recursive: true, force: true }).

CLI test coverage

The new trace CLI tests currently instantiate TraceStorage directly, so they do not actually test CLI command behavior.

Add or update tests that exercise the CLI path for:

* signalglass traces --storage <path> list
* signalglass traces --storage <path> show <trace-id>
* Invalid --report
* Missing or typoed storage path
* Optional --output, if practical

Use the existing test style in the repo.

Docs alignment

Update docs so the documented traces list flags match the parser behavior.

If traces list supports --report json and --output, document that.

If those flags should not be supported for list, reject them in the parser instead.

Trace metrics duplication

CodeRabbit suggested extracting duplicated trace aggregation logic into a shared module.

Treat this as optional follow-up unless the refactor is small, safe, and clearly improves this PR without creating churn.

Do not perform a large refactor unless needed to fix correctness.

Constraints

* Do not commit secrets, generated databases, local artifacts, .env files, or build output.
* Do not make unrelated formatting churn.
* Do not change public behavior beyond what is required by the feedback.
* Prefer small, readable fixes over broad rewrites.
* Keep privacy behavior intact: reports must not expose raw payloads, API keys, authorization headers, secrets, or storageKey values in standard mode.

Validation

Run the strongest reasonable validation for the changed area:

pnpm test
pnpm build

If that is too broad or slow, run targeted tests first, then explain what was and was not run.

Final response

When finished, report:

* Files changed
* Feedback addressed
* Feedback skipped or deferred
* Tests run
* Any follow-up recommendation
