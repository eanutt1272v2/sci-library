# Contributing

How to work on sci-library: running the tests, what CI does, and how to make
CI actually gate merges. See also [`ARCHITECTURE.md`](./ARCHITECTURE.md) (how the
apps are structured) and [`CODESTYLE.md`](./CODESTYLE.md) (conventions to follow).

---

### 1. Running the tests

Tests use Node's built-in test runner — **no dependencies to install**. You need
Node 22 or newer.

```bash
npm test              # run every test once
npm run test:watch    # re-run automatically as you edit
npm run test:coverage # run with a coverage report
```

Tests live in the top-level `tests/` directory, mirroring `library/`'s structure.
They are kept out of `library/` on purpose: that folder is copied verbatim into
the production image and served with directory listing on, so nothing under it
should be test code. Add a test as `tests/<same/path/as/source>/<Name>.test.js`.

---

### 2. What CI does

Every push to `main` and every pull request runs `.github/workflows/ci.yml`, which
has two jobs:

* **`test`** — runs `npm test`.
* **`security`** — runs [Trivy](https://trivy.dev) against the repository and
  against the Docker image that actually ships, failing on `CRITICAL`/`HIGH`
  vulnerabilities that have a fix available.

The `security` job does not use a third-party scanning action. It downloads
Trivy's official release binary and verifies it two ways before running it — a
pinned SHA-256 checksum, plus `gh attestation verify` (the official GitHub CLI)
to confirm Trivy's signed build provenance. Only GitHub's own `actions/*` and the
Trivy binary itself are trusted. To upgrade Trivy, change the two pinned lines
(`TRIVY_VERSION` and `TRIVY_TARBALL_SHA256`) in the workflow's `env:` block; the
comment there explains how to re-derive the hash.

---

### 3. Making CI gate merges (branch protection)

By default CI only *reports* pass/fail — a red pull request can still be merged.
To require green checks before merging, set up branch protection on `main`. This
is a one-time repository setting (you need **admin** access), separate from the
workflow file.

> [!IMPORTANT]
> The `test` and `security` checks only become selectable **after CI has run at
> least once** on the repo. Push a branch and open a pull request first, let the
> run finish, then do the steps below.

1. On GitHub, open the repo → **Settings** → **Branches** (left sidebar).
2. Click **Add branch protection rule**.
3. **Branch name pattern:** `main`.
4. Tick **Require status checks to pass before merging**.
5. In the search box, add both **`test`** and **`security`** (these names come
   from the `name:` of each job in `ci.yml`). If they don't appear, CI hasn't run
   yet — see the note above.
6. Tick **Require a branch to be up to date before merging** so a PR is re-tested
   against the latest `main` before it can merge.
7. Recommended: also tick **Require a pull request before merging**, so nobody can
   `git push` straight to `main` and skip the checks.
8. Click **Create** / **Save changes**.

> [!NOTE]
> GitHub also offers **Settings → Rules → Rulesets**, a newer screen that does the
> same job. Either approach works; the Branches rule above is the simplest.

**To confirm it worked:** open a pull request and check that the **Merge** button
stays disabled until both `test` and `security` pass. Deliberately breaking a test
and pushing should lock the button — that proves the gate is live.
