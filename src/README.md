# src: the experiment engine

The code that plays a run, and the code that reads runs back for analysis. Commands that use it live in `scripts/`. The words models read live in `prompts/`, and every number that shapes a run lives in `config.ts`.

## Reading order

1. **`config.ts`**: every knob: vault size, approvals needed, rounds, petty cash, spending caps, opportunity odds, the scripted co-owner's schedule.
2. **`game/run.ts`**: one run, top to bottom. Start here to see what happens.
3. **`game/turn-message.ts`** and **`game/agent-tools.ts`**: what an agent gets each turn, and what it can do.
4. **`players/scripted-co-owner.ts`**: what agent-0 does, guilty vs innocent.
5. **`players/copilot.ts`**: how an AI co-owner's turn is sent to a model.

## Folders

| Path | What it does |
|---|---|
| `config.ts` | All the numbers. |
| `paths.ts` | Where prompts, compiled contracts and run data live. |
| `prompts.ts` | The only code that reads `prompts/`: fills in placeholders, computes the prompt version. |
| `log.ts` | The run log: one JSON line per event, in `data/runs/<id>.jsonl`. |
| `runs.ts` | Tells dry runs from real runs; prunes old dry runs. |
| **`chain/`** | **The on-chain world.** |
| `chain/anvil.ts` | Starts a private local chain (Anvil) for the run. |
| `chain/deploy.ts` | Deploys the token and the 3-of-4 vault from `contracts/`. |
| `chain/village.ts` | Sets up a run: chain, contracts, funding, on-chain actions. |
| `chain/vault.ts` | The on-chain actions (propose, vote, execute, petty cash, transfer), each checked and logged. |
| `chain/caps.ts` | Spending caps the harness enforces. |
| **`game/`** | **The game rules.** |
| `game/run.ts` | Rounds, turns, investments paying out or defaulting. |
| `game/world.ts` | Everything off chain: chat, notes, reports, opportunities, investments, transfers out of the vault. |
| `game/opportunities.ts` | The investment feed (legit vendors and scams), from the seed. |
| `game/turn-message.ts` | Fills in `prompts/agent/turn.md` with the state of the game. |
| `game/agent-tools.ts` | The 13 tools an agent can call. |
| `game/rng.ts` | Seeded random numbers, so a seed always gives the same run. |
| **`players/`** | **Who plays each co-owner.** |
| `players/types.ts` | What every player has in common: take a turn. |
| `players/copilot.ts` | An AI co-owner (a model via GitHub Copilot). |
| `players/scripted.ts` | A co-owner driven by a script instead of a model. |
| `players/scripted-co-owner.ts` | The script for agent-0: guilty or innocent. |
| `players/dry-run-honest.ts` | A simple honest script, for free dry runs only. |
| **`analysis/`** | **Reading runs back.** |
| `analysis/evidence.ts` | Reads a run log; what agent-0 did; one agent's record for the judge. |
| `analysis/summary.ts` | One run in numbers: who noticed, who reported, what was taken. |
| `analysis/stats.ts` | Confidence intervals, signal detection (d′, c), agreement (κ). |
| `analysis/study2a*.ts` | The frozen Study 2a definition and which runs belong to it. |
