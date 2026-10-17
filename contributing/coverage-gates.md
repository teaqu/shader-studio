# Unit coverage gates

The required **Verify / Unit and extension tests** check runs three complementary gates:

- Package coverage ratchets in `vitest.config.ts` protect overall coverage.
- `coverage:new-files` checks every newly added executable source file.
- `coverage:changes` checks added or replacement code in existing source files.

The file gates require 90% statements, 90% lines, 80% branch paths and 85% functions, separately for each file. Changes cannot borrow coverage from another file or unrelated unchanged code. Changed statements are selected by overlapping source locations; a changed line only counts as covered when all statements spanning it execute. Branches and enclosing functions whose source locations overlap changed lines must also clear their thresholds.

The changed-source gate reads Istanbul's `coverage/coverage-final.json`. Missing instrumentation or invalid hit counters fail the check. Runtime edits in a workspace without unit coverage instrumentation therefore need instrumentation before they can pass. Deletions introduce no executable code; type-only files, tests and generated source use the same exclusions as the new-file gate. Unmapped lines do not add artificial coverage obligations.

For pull requests, the comparison uses the checked-out merge commit's first parent, covering the whole PR against its current base. Branch pushes compare against the previous pushed revision. To check a branch locally after running the unit suite with coverage:

```sh
npm run coverage:changes -- origin/main
npm run coverage:new-files -- origin/main
```

Each gate writes its per-file results to the Actions job summary. These are ordinary CI gates; workflow changes remain subject to normal code review.
