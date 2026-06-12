# Project Guidelines

## Model Delegation Strategy

Optimize for capability and context efficiency via subagent delegation:

### Research & Investigation
- **Subagent**: Haiku 4.5
- **When**: Code exploration, file location, dependency mapping, architecture analysis
- **Why**: Fast token-efficient search across codebase; context preserved via agent compression
- **Command**: `Agent({ subagent_type: "general-purpose" })` with model override

### Planning & Architecture
- **Subagent**: Sonnet 4.6
- **When**: Multi-step implementation plans, design decisions, trade-off analysis
- **Why**: Strong reasoning for complex decisions; EnterPlanMode for structured output
- **Command**: `Agent({ subagent_type: "Plan" })` or EnterPlanMode for full session

### Implementation & Coding
- **Model**: Fable 5 (this session, do not delegate)
- **When**: Writing code, fixing bugs, refactoring
- **Why**: Highest capability for code quality and novel solutions
- **Constraint**: Write original code, never copy-paste from existing patterns without justification

### Graph/Context Operations
- **Subagent**: Haiku 4.5
- **When**: Codebase understanding (/understand, /understand-explain, /understand-domain)
- **Why**: Efficient knowledge graph construction and context preservation
- **Skills**: Use understand-anything:* family for structured analysis

## Original Thinking Mandate

**Never repeat existing patterns without justification.** Every solution must:

1. **Examine prior art** — check what exists in codebase
2. **Justify reuse** — if reusing pattern: document why (performance, maintainability, established convention)
3. **Innovate where possible** — propose novel approaches if they're cleaner, faster, or more maintainable
4. **Avoid cargo cult** — don't copy patterns just because they exist; evaluate each decision independently
5. **No false originality** — don't overcomplicate simple problems seeking novelty; balance innovation with pragmatism

**When in doubt**: Propose unique approach AND evaluate against existing patterns. Show both, let user decide.

## Design & Frontend

**MANDATORY**: Use `/frontend-design` skill before any UI/component work.
- Generates distinctive, production-grade interfaces
- Avoids generic AI aesthetics
- Creates original, polished designs

**Apply to**:
- New pages or views
- Component redesigns
- Layout improvements
- Style system work

**Workflow**:
1. Invoke `Skill({ skill: "frontend-design" })`
2. Follow design skill output directly
3. Implement with Fable 5 (this session)
4. Test in browser before completion

## Development Workflow

### Code Changes
- Always verify changes work before claiming completion
- Use `/verify` skill for manual feature testing in running app
- Run tests and type checks before committing
- Commit messages: meaningful, show intent not just what changed

### Pull Requests & Review
- Use `/code-review` for pre-commit quality check
- Use `/requesting-code-review` skill if involving complex decisions
- Request second opinion on architecture changes
- Include "why" in PR description, not just "what"

### Task Isolation
- Use git worktrees for feature work via `/using-git-worktrees` skill
- Parallel subagent work via `/dispatching-parallel-agents` for independent tasks
- Avoid long-running branches; integrate frequently

## Codebase Context

**Tech Stack** (detected at session start):
- Identify primary languages, frameworks, build tools
- Use Haiku subagent for quick mapping
- Preserve context across long sessions via memory

**Architecture Preservation**:
- Before major refactors, understand existing structure via `/understand`
- Document invariants and constraints in memory
- Avoid introducing abstraction debt

## Token Efficiency

- Use RTK proxy for Git/CLI commands (configured in parent CLAUDE.md)
- Delegate research to Haiku subagents (60% context savings via compression)
- Compress long memory files with `/caveman-compress` if over 2KB
- Check token usage with `rtk gain`

## Communication Style

- Caveman mode active (full level)
- Drop articles, filler, hedging in responses
- Code/PRs/commits: normal style
- Security warnings: normal clarity (not caveman)

## Memory & Session State

All session work persists in `C:\Users\oguz\.claude\projects\C--Users-oguz-Desktop-her--ey-fable\memory\`.

**Record**:
- Architectural decisions and their rationale
- Constraints learned during implementation
- APIs or patterns discovered
- Non-obvious project context

**Update periodically** to prevent stale memories from overriding current truth.

---

**Last Updated**: 2026-06-12
