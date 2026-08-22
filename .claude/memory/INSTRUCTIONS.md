# Persistent Memory — Instructions

This file is auto-loaded into every session via `@.claude/memory/INSTRUCTIONS.md`.
Read and follow these rules without being asked.

## When to save (do not wait to be asked)

Save a memory **only** when a future session would benefit from knowing this **before trying to discover it alone**.
Hard-won knowledge only — obvious things, summaries, and temporary context do not qualify.

| Learned... | Memory type |
|------------|-------------|
| Model kept repeating a mistake until corrected by the user | `feedback` |
| Architecture or pattern discovered after failures or many attempts | `architecture` |
| Business rule that affects code and is not obvious from reading the repo | `business-rule` |
| Where external info lives (Linear, Grafana, Slack, dashboards, wikis) | `reference` |

**Do NOT save:**
- Things derivable by reading the code or git history
- Deadlines, motivations, or temporary project context
- Debug steps or fix recipes (those belong in the commit message)
- Anything already documented in CLAUDE.md files

**Quality test before saving:** Would a future Claude session working on this codebase be surprised
and grateful to know this before starting? If not, skip it.

## How to save

1. Write a `.md` file in `.claude/memory/` with this frontmatter:

```markdown
---
name: kebab-case-slug
description: one-line summary — used to decide relevance in future sessions
metadata:
  type: feedback | architecture | business-rule | reference
---

Fact or rule. **Why:** the reason this matters or was hard to discover. **How to apply:** when and where this applies.
```

2. Add one line to `.claude/memory/MEMORY.md` (the index):
   `- [Title](filename.md) — one-line hook describing what this memory is for`

## Sanitation (mandatory when index is large)

Before writing a new memory entry, count the non-blank lines in `.claude/memory/MEMORY.md`.
If ≥ 130 lines, run sanitation first.

This project has an Obsidian vault for long-term memory (see `.claude/rules/obsidian.md`).
A memory entry that no longer earns its place in the always-loaded index is never just
discarded — it migrates there, where there is no size limit. Only `.claude/memory/`
itself has to stay small.

1. Read every file in `.claude/memory/` and score each entry: **recency ×
   specificity × likelihood of preventing a real future mistake**.
2. For each low-score entry, migrate it before deleting anything — in this
   exact order, never skipping or reordering a step:
   1. **Dedup** — `mcp__obsidian__search_notes_tool` with one specific term
      from the entry. A note on the same topic already exists → extend it
      with `mcp__obsidian__edit_note_section_tool` instead of creating a
      duplicate.
   2. **Contract** — `mcp__obsidian__get_note_template_tool` for the target
      folder below returns the required headings and frontmatter. Match it
      exactly; the server rejects a note that doesn't.
   3. **Create** — `mcp__obsidian__create_note_tool`, kebab-case filename, in
      the folder matching the entry's type:

      | Memory type | Vault folder |
      |---|---|
      | `architecture`, `feedback` | `03-knowledge/` |
      | `business-rule` | `03-knowledge/` (a topic subfolder if the vault already has one) |
      | `reference` | `04-resources/` |

   4. **Confirm** — `mcp__obsidian__read_note_tool` on the path just
      created. No successful read means the migration did not happen.
   5. **Only then** delete `.claude/memory/<file>.md` and its line in
      `MEMORY.md`.
3. Rewrite the `MEMORY.md` index with only what's left (target: ≤ 130
   lines).
4. Then write the new memory.

Deleting a memory file before step 2.4 confirms the read is forbidden — an
unconfirmed migration is data loss, not a move. Unsure whether an entry
still earns its place? Leave it in `.claude/memory/` — migrating later
costs nothing; a lesson lost from both places is expensive to relearn.

## Reading memories

Before acting on any complex request: scan `MEMORY.md` for entries relevant to the current task.
Load and apply the relevant memory files before responding — do not rely solely on the index summary.
