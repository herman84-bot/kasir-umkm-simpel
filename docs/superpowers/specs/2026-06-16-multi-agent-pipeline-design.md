# Multi-Agent Development Pipeline Design

**Date:** 2026-06-16
**Status:** Approved

## Overview

A Claude Code multi-agent pipeline for this repository. User triggers one command; agents execute in sequence — CTO → Senior SWE → QA → Red Team — with automatic retry (max 3x) on failure.

## Architecture

```
User: /dev-pipeline "task description"
         │
         ▼
  [Orchestrator Skill]  (.claude/commands/dev-pipeline.md)
         │
         ▼
  CTO Agent             (.claude/agents/cto.md)
  • Reads repo context (stack, patterns, recent commits)
  • Produces PRD with acceptance criteria and constraints
         │
         ▼
  Senior SWE Agent      (.claude/agents/senior-swe.md)
  • Receives PRD from CTO
  • Implements code changes
  • Outputs: files changed + summary
         │
         ▼
  QA Agent              (.claude/agents/qa.md)
  • Tests each acceptance criterion from PRD
  • May run app via Bash
  • Outputs: PASS/FAIL per criterion
         │ FAIL → SWE (shared retry counter++)
         ▼ PASS
  Red Team Agent        (.claude/agents/redteam.md)
  • Static: scans for vuln patterns (XSS, injection, exposed secrets)
  • Runtime: simulates attack vectors via Bash
  • Outputs: PASS/FAIL + severity list
         │ FAIL → SWE (shared retry counter++)
         ▼ PASS
  Orchestrator reports success → prompts user to commit
```

## Tools & Permissions

| Agent | Allowed Tools | Denied Tools |
|-------|--------------|--------------|
| CTO | Read, Glob, Grep, Bash | Edit, Write |
| Senior SWE | Read, Edit, Write, Glob, Grep, Bash | — |
| QA | Read, Glob, Grep, Bash | Edit, Write |
| Red Team | Read, Glob, Grep, Bash | Edit, Write |

QA and Red Team cannot write code — prevents test contamination.

Note: CTO's Bash access is constrained by its system prompt (read-only commands only: `git log`, `glob`, `wc -l`), not by tool restriction — Bash is a single indivisible tool in Claude Code.

## PRD Handoff Format

### CTO → SWE

```
## PRD
**Feature:** <feature name>
**Stack detected:** <detected from repo>
**Scope:** <affected files/modules>

## Acceptance Criteria
- [ ] AC1: <measurable criterion>
- [ ] AC2: ...

## Constraints
- Do not modify: <sensitive files>
- Follow pattern: <existing codebase patterns>

## Out of Scope
- <explicitly excluded items>
```

### SWE → QA/Red Team

```
## Implementation Summary
**Files changed:** [list]
**Changes:** <summary>
**How to test:** <run instructions>
```

## Feedback Loop

- `retry_count` starts at 0, shared across QA and Red Team stages.
- On any FAIL: `retry_count++`
  - If `retry_count < 3`: spawn SWE again with PRD + all accumulated FAIL reports
  - If `retry_count >= 3`: escalate to user

### Escalation Report Format

```
## Escalation Report
**Attempts:** 3/3 failed
**Last QA failures:** <detail>
**Last RedTeam findings:** <severity list>
**Action needed:** Manual review required
```

Each SWE retry receives cumulative failure context — richer each iteration.

## File Structure

```
.claude/
├── agents/
│   ├── cto.md
│   ├── senior-swe.md
│   ├── qa.md
│   └── redteam.md
└── commands/
    └── dev-pipeline.md
docs/
└── superpowers/
    └── specs/
        └── 2026-06-16-multi-agent-pipeline-design.md
```

## Known Issues

- `config.js:4` contains a hardcoded Groq API key committed to repo history. Red Team will flag this on every run. **Requires manual action:** rotate the key at Groq console and remove from repo. Outside scope of this pipeline.

## Design Decisions

- **Generic agents** — no stack-specific hardcoding; CTO detects stack at runtime via `git log`, `glob`, and `read`.
- **Shared retry counter** — 3 total attempts across QA + Red Team, not 3 per stage. Prevents runaway loops.
- **SWE is sole writer** — QA and Red Team are read-only. Single write authority prevents conflicting edits.
- **Orchestrator owns loop logic** — agents are stateless personas; loop state lives only in the orchestrator skill.
