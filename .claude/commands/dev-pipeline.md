# Dev Pipeline Orchestrator

Runs the full CTO → Senior SWE → QA → Red Team pipeline for a development task with automatic retry (max 3 attempts).

## Usage

```
/dev-pipeline "description of feature or fix"
```

The argument is the feature request. Pass it exactly as the user wrote it.

## Your Role

You are the orchestrator. You do not write code or analyze security yourself. You spawn agents and pass structured outputs between them. You track state.

## State to Track

Initialize at pipeline start:
- `retry_count = 0`
- `prd = null`
- `implementation_summary = null`
- `failure_reports = []` (accumulates all QA + Red Team FAIL reports)

## Pipeline Steps

### Step 0: Request Classification

Spawn the appropriate specialist agent based on the request type.

```
If request mentions bug, error, crash, unexpected behavior → spawn `debug-specialist`
If request mentions deployment, hosting, CI/CD, Docker, Render, Vercel, Cloudflare → spawn `deployment-engineer`
If request mentions authentication, authorization, Clerk, permissions, security → spawn `security-reviewer`
If request mentions database, Convex, Supabase, PostgreSQL, schema, migration, indexing → spawn `database-architect`
Otherwise → set `specialist_report = null`
```

The specialist agent should be given the raw feature request as context and must output a concise report. Capture the output as `specialist_report`.

### Step 1: CTO Analysis

Spawn the `cto` agent with this prompt:

```
Feature request: "[user's feature request verbatim]"

Analyze the repository and produce a PRD following your instructions exactly.
```

Capture the full PRD output. Store as `prd`.

---

### Step 2: Senior SWE Implementation

Spawn the `senior-swe` agent with this prompt:

```
[paste prd here]

[If failure_reports is not empty, append:]

## Previous Failure Reports (address ALL of these)
[paste all accumulated failure reports here, separated by ---]
```

Capture the full Implementation Summary output. Store as `implementation_summary`.

---

### Step 3: QA Testing

Spawn the `qa` agent with this prompt:

```
[paste prd here]

[paste implementation_summary here]
```

Read the QA Report output:
- If `**Overall:** PASS` → proceed to Step 4
- If `**Overall:** FAIL`:
  - Append QA Report to `failure_reports`
  - `retry_count++`
  - If `retry_count < 3` → go to Step 2
  - If `retry_count >= 3` → go to Escalation

---

### Step 4: Red Team Testing

Spawn the `redteam` agent with this prompt:

```
[paste implementation_summary here]

Test the code changes described above for security vulnerabilities.
```

Read the Red Team Report output:
- If `**Overall:** PASS` → go to Success
- If `**Overall:** FAIL`:
  - Append Red Team Report to `failure_reports`
  - `retry_count++`
  - If `retry_count < 3` → go to Step 2
  - If `retry_count >= 3` → go to Escalation

---

### Success

Output:

```
## Pipeline Complete ✅
All checks passed in [retry_count + 1] attempt(s).

**QA:** ✅ PASS
**Red Team:** ✅ PASS

**Files changed:**
[paste "Files changed" line from implementation_summary]

**Next step:** Review changes above, then commit:
git add [list files]
git commit -m "feat: [feature description]"
```

---

### Escalation

Output:

```
## Pipeline Escalation ⚠️ — Manual Review Required
Maximum attempts (3) reached. Pipeline could not achieve clean PASS.

**QA status:** [PASS/FAIL from last QA run]
**Red Team status:** [PASS/FAIL from last Red Team run]
**Total retries:** 3

## Accumulated Failure Reports
[paste all failure_reports here in order, separated by ---]

**Recommended action:** Review the failure reports above manually and fix the issues before re-running /dev-pipeline.
```
