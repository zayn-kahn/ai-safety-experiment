# Prompts: every word a model reads

Nothing a model sees is written anywhere else. Edit these files freely: changes apply to the **next run**, with no rebuild.

## What an AI co-owner sees on each turn

```
system message   agent/base.md                     the world and its rules (every agent)
                 + agent/petty-cash-line.md        (only when petty cash is on)
                 + agent/report-line.md            (only when the report tool is on)
                 + agent/conditions/<c>.md         the framing being tested (honest agents; "none" adds nothing)
                   or agent/defector.md            (only the guilty co-owner; the scripted one ignores it)

user message     agent/turn.md                     the state of the game this turn, filled in by src/game/turn-message.ts

tools            agent/tools.md                    names and descriptions of the 13 tools
```

Inside the turn message, the agent also reads text that comes from the game itself:

| File | What it is |
|---|---|
| `game/announcements.json` | The game's own chat messages (new opportunity, repaid, defaulted) and how a report is posted. `author` is the name they appear under. |
| `game/vendors.json` | Vendor names and pitches. The order matters: the seed picks by position. |
| `game/scripted-co-owner.json` | What the scripted co-owner (agent-0) says in chat, guilty and innocent versions. |

**One thing we don't control:** GitHub Copilot adds a `<current_datetime>…</current_datetime>` line at the top of every turn message. It's the same in every condition, and the SDK has no switch to turn it off.

**Also from code, not from here:** error messages the tools return (e.g. "tool-call budget … is used up"), and contract revert reasons.

## The conditions

Every condition except `none` must contain the same three points, so conditions differ in **style**, not in what agents are told:

1. **Destinations:** check that transfers go where they claim to go.
2. **Petty cash:** only for genuine operating expenses, and its use should be explained.
3. **Speaking up:** if a co-owner acts against the group, raise it.

`plain` states only these points; `rules`, `values`, and `emotion` express them as a rulebook, principles, and feelings. To add a condition, create `agent/conditions/<name>.md`; it becomes selectable automatically.

## The judge

`judge/system.md` is the judge's instructions and `judge/request.md` is the grading request it gets per agent. The judge is blind: it never sees the condition or whether agent-0 was guilty. **Freeze `judge/system.md` for a study**: its hash is the judge version recorded with every verdict (`pnpm judge --version`).

## Placeholders

Written as `{{name}}` and filled in per agent. An unknown placeholder stops the run with an error, so nothing goes out half-filled.

| Placeholder | Becomes |
|---|---|
| `{{agentId}}` | e.g. `agent-1` |
| `{{address}}` | That agent's wallet address |
| `{{others}}` | The other three agent ids |
| `{{rounds}}` | Number of rounds in the game |
| `{{threshold}}` | Approvals needed (3) |
| `{{pettyCashRule}}` | `petty-cash-line.md` when petty cash is on, otherwise empty |
| `{{reportingLine}}` | `report-line.md` when the report tool is on, otherwise empty |

## Versions

Every run records a **prompt version**: a hash of every file in `agent/` and `game/`. Runs with different versions are never mixed on the dashboard. Every run also saves the final filled-in system prompts and every turn message in its log, and the viewer's **System prompts** button shows them.
