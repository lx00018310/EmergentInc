<div align="center">

# BOSS:/AFK

### The boss is away. The business is alive.

**甩手掌柜 · 老板不在，生意还在。**

Give the company a goal. Review the decisions that matter.

[中文](README_CN.md) · [Owner guide](docs/guides/OWNER_GUIDE.md) · [V34 reset guide](docs/guides/V34_RESET.md) · [EmergentInc](https://github.com/lx00018310/EmergentInc)

</div>

## One page for the boss

Open **`http://127.0.0.1:8765/BOSS`** and sign in with the Owner secret.

- Start or pause the company. A manual pause survives restarts.
- See exactly three metrics selected from persisted company facts.
- Review at most three important messages, ranked by a deterministic fact score (blocking, risk, urgency, impact, wait); each card completes its own decision in place - approve, verify charges, stop or safely retry one task - without touching unrelated work.
- Give goals and decisions through one conversation input.
- **Inspect Company** shows goals, acceptance rules, task reports, deliverables, workers, products and orders, with access to budget, payment and recovery settings.

The public storefront remains at `/`. Retired owner URLs redirect to `/BOSS`; the old workbenches and APIs have been removed.

## What runs underneath

```text
Boss → Goal → Tasks → Workers → Tools / Skills → Deliverable
                  ↓                              ↓
             Company budget         Storefront → Order → Payment
                  └──────────── Verified facts ────────────┘
                                      ↓
                               Boss attention
```

V34 keeps the actual execution and safety kernel: bounded tasks, scoped tools, persistent evidence, approvals bound to hashes/revisions, idempotency, and explicit recovery of unknown outcomes. Workers are created for approved work without character draws or image generation.

Company costs use a shared **CNY money budget**. Revenue comes only from verified **USDT receipts**. These currencies are displayed separately. A model report, a submitted transfer, or a published product is never counted as verified revenue.

## Start locally

Requirements: Node.js with built-in `node:sqlite` support (22.13 or later), pnpm, and an OpenAI-compatible model endpoint.

```powershell
pnpm.cmd install --frozen-lockfile --ignore-scripts
Copy-Item .env.example .env
```

Set `EMERGENTINC_OWNER_SECRET` to a random secret of at least 32 characters. Configure `MCL_API_KEY`, `MCL_BASE_URL`, and `MCL_MODEL` in `.env`; verify the model's **CNY pricing** in `resources/config/model_pricing.json` before authorizing money. Keep `.env` private.

On Windows, run `EmergentInc_UI.bat` or `EmergentInc_UI.ps1`. The launcher builds a fresh installation and runs an approved frozen release. For an explicit terminal launch after building:

```powershell
pnpm.cmd build
pnpm.cmd --dir frontend build
node scripts/launch-approved.mjs --open-browser
```

A fresh V34 company starts **OFF**, with **no authorized budget, workers, goals, tasks, orders, receipts, or chat history**. Use the homepage budget message to authorize an amount, then start the company. Configure receive-only payments when required; no private wallet key belongs in chat.

An unmarked, nonempty old workspace is refused with `V34_DESTRUCTIVE_RESET_REQUIRED`. Normal startup, installation, pull, and software updates never perform a destructive reset. See the [separate, irreversible reset procedure](docs/guides/V34_RESET.md).

## Install with an AI agent

The repository ships [AGENTS.md](AGENTS.md), which coding agents such as Claude Code, OpenAI Codex, ZCode, Cursor, and Windsurf read automatically, so the whole setup can be delegated to them.

Prerequisites: git, Node.js with built-in `node:sqlite` (22.13 or later), and pnpm.

```bash
git clone https://github.com/lx00018310/EmergentInc.git
cd EmergentInc
```

Start your agent inside that folder — for example `claude` (Claude Code), `codex` (OpenAI Codex CLI), or open the folder in Cursor / Windsurf — and give it one instruction:

> Follow AGENTS.md and the "Start locally" section of README.md: install dependencies with pnpm, create `.env` from `.env.example`, generate a random Owner secret into it, build, and launch. Ask me to fill in the model API key in `.env` when needed.

Success looks like the Boss page reachable at `http://127.0.0.1:8765/BOSS`. Secrets belong in `.env` only: let the agent write the random Owner secret into the file, but paste your model API key into `.env` yourself instead of chat. Review each command before approving it, and never paste wallet keys anywhere in the conversation.

## Current scope

Implemented: authenticated bilingual Boss page, real goal/task execution, deterministic Worker creation, artifact evidence, shared money authorization and settlement, exact decisions, recovery, public products/orders, receive-only USDT verification, and controlled software publication/rollback on port **8766**. Enabled payment rails depend on configuration and chain finality.

The product is experimental. Autonomous market research, delivery quality, external publishing, customer acquisition, and commercial income depend on available models, tools, permissions, and independent evidence. They are outcomes to verify, not guarantees. Company inspection displays existing business records; the system does not provide autonomous wallet spending or promise profit.

Software rollback after V34 preserves new company data. It cannot recover the pre-V34 instance destroyed by the one-time reset. [Removal inventory and verification](docs/V34_REMOVAL_INVENTORY.md) records the scope of the reduction.

## Development checks

```powershell
pnpm.cmd typecheck
pnpm.cmd --dir frontend test
pnpm.cmd --dir frontend build
pnpm.cmd test --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
git diff --check
```

The process integration test uses synthetic model responses and chain evidence in an isolated workspace. No test payment is real revenue.

## Open source

Built on [EmergentInc](https://github.com/lx00018310/EmergentInc). See [LICENSE](LICENSE).

**Tell it what to do. Decide what matters.**
