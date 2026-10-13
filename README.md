English | [中文](README_CN.md)

# EmergentInc

**The open-source AI engine that helps anyone start and run an online business.**

**Beyond chatbots. Autonomous AI that executes operations, self-upgrades, and delivers real business value.**

You set business goals, allocate token budgets, and make final decisions. EmergentInc provides autonomous AI characters and Pixels that explore opportunities, build products, run marketing, serve customers, accept crypto payments, and continuously evolve through real business activity.

100% open source. Clone, configure, and run.

![EmergentInc Architecture](Imag_EmergentInc.png)

---

## Quick Start

Get your instance running in 5 minutes.

### Prerequisites

- **Node.js**: v24.x (required)
- **Package Manager**: `pnpm` (v9+)
- **OS**: Windows or Linux (macOS supported for development)

### 1. Clone & Install

```bash
# Clone repository
git clone https://github.com/lx00018310/EmergentInc.git
cd EmergentInc

# Install dependencies (Windows: pnpm.cmd)
pnpm install --frozen-lockfile --ignore-scripts
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

Required settings in `.env`:
- `EMERGENTINC_OWNER_SECRET`: Random string with **at least 32 characters** (protects `/OWNER` and backend management).
- `MCL_API_KEY`: Your LLM API key (OpenAI-compatible).
- `MCL_BASE_URL`: API base URL (default: `https://api.openai.com/v1`).
- `MCL_MODEL`: Default model (e.g., `gpt-4o`, `gpt-4o-mini`, or any compatible model).

### 3. Build & Launch

**On Windows:**
```powershell
.\EmergentInc_UI.bat
```
*(Alternatively, run manually: `pnpm.cmd --dir frontend build` then `node scripts/launch-approved.mjs`)*

**On Linux:**
```bash
bash ./EmergentInc_UI.sh
```

The launcher starts the server and automatically opens `http://127.0.0.1:8765/`.

### 4. First Steps

1. Visit **`http://127.0.0.1:8765/OWNER`** in your browser.
2. Enter your `EMERGENTINC_OWNER_SECRET` to unlock the Owner Console.
3. Define your first business goal (e.g., "Research market demand and draft a digital tool").
4. Set token allowance and round limit, then toggle **Automation ON**.

---

## How It Works

EmergentInc operates as a closed-loop business cycle:

```
[Owner Sets Goal] ──> [AI Deconstructs & Executes] ──> [Public Storefront / Checkout]
       ▲                                                           │
       │                                                           ▼
[Gene Evolution & Upgrades] <── [Human Approval / Receipts] <──────┘
```

1. **Set Goals**: The Owner defines goals in `/OWNER`, setting evidence rules (draft delivery, confirmed payment, or human review) and token limits.
2. **Autonomous Execution**: Characters and Pixels break goals into bounded Runs, writing code, generating tools, or preparing products inside a secure `pure-ast-json` sandbox.
3. **Run Business**: Products are published to the integrated public storefront (`/`), supporting on-chain USDT payments across Solana, BSC, Polygon, and TRON.
4. **Human in the Loop**: Key sensitive actions—code releases, large budget adjustments, or wallet rail toggles—require one-click Owner approval in the Inbox.
5. **Self-Evolution**: High-performing executable skills are promoted into system "Genes", inherited across Worlds and preserved through software upgrades.

---

## Control Consoles & Endpoints

| Route | Role | Description |
| --- | --- | --- |
| `/` | Public Storefront | Product browsing, checkout, and order lookup for visitors (no login required). |
| `/OWNER` | Owner Console | Business goal management, automation switch, decision inbox, and live timeline. |
| `/QIAN` | Qianji Hall | Character roster, narrative identities, conversational tasks, and income tracking. |
| `/YUAN?world=<id>` | Pixel Workspace | World-level Pixels, execution logs, live artifacts, and multi-agent collaboration. |
| `/GENE` | Gene & Assets | Root of trust, evolution lineage, memory, payment rails, and storefront settings. |
| `http://127.0.0.1:8766/` | Upgrade Service | Independent web service for version checks, candidates, releases, and safe rollback. |

*All UI routes support both English and Chinese with persistence.*

---

## Key Features

- **Autonomous Business Goals**: Deconstruct goals into measurable runs with hard token caps and round limits.
- **Multi-Character & World Isolation**: Characters maintain independent identities, memory, and runtime files without cross-world corruption.
- **Non-Custodial Web3 Payments**: Built-in payment monitoring for Solana, BSC, Polygon, and TRON USDT. Zero private key storage—verification relies purely on public on-chain finality.
- **Safe Sandboxed Execution**: Executes custom skills via `pure-ast-json@1` without arbitrary `eval`, disk escapes, network access, or untrusted package installation.
- **Private Extensions & Gene Heritage (V30)**: World-level private computation extensions are preserved locally, while approved system assets inherit cleanly into new Core releases.
- **Complete Physical Data Isolation**: Code lives in Git, business facts live in SQLite. Core software updates never overwrite your business data.

---

## Persistent Workspace & Upgrades

**Code updates. Business data continues.**

### Storage Structure

```text
workspace/
  system/
    control/control.sqlite3       # Goals, permits, characters, orders, storefront settings
    payment/payment.sqlite3       # Payment rails, invoices, receipts, instance revenue
    lineage/lineage.sqlite3        # Evolutionary lineage, memory, business evidence
  worlds/<world_id>/
    ledger/v9_core.sqlite3         # Checkpoints, runs, message history
    extensions/                    # World-private extensions and active pointers (V30)
    live/                          # Artifacts, generated files, shared resources
```

### Safe Upgrades

- **Zero Overwrite**: The `workspace/` directory is strictly separated from repository source code and frozen release directories.
- **Independent Upgrade Portal**: Access `http://127.0.0.1:8766/` (or run `EmergentInc_Upgrade.bat`) to inspect candidate releases, run dry-run compatibility checks, approve hashes, and switch releases.
- **Atomic Rollback**: If a new release fails health checks or compatibility validation, the system rolls back cleanly with zero loss to orders, revenue, or memories.

---

## Security & Boundary

- **No Private Keys**: EmergentInc does not store wallet private keys, sign transactions, or hold custody of funds. Payment rails only listen to public blockchain transactions.
- **Owner Authentication**: The `EMERGENTINC_OWNER_SECRET` is verified strictly server-side and never injected into the client-side JavaScript bundle.
- **Sandbox Bounds**: Pure AST interpreter restricts tool execution to verified AST trees with strict byte and execution step caps.
- **Reality Principle**: Automation defaults to **OFF**. Unknown model billing or unverified external states pause execution until audited by the Owner.

---

## Troubleshooting & Documentation

### Common Issues

- **Node Version Error**: EmergentInc requires Node.js 24. Ensure your active runtime matches (`node -v`).
- **Owner Secret Too Short**: `EMERGENTINC_OWNER_SECRET` must be at least 32 characters.
- **Port Conflict**: Default runtime port is `8765`, upgrade service port is `8766`. Ensure both ports are free.

### Deep Architecture & Implementation Guides

All technical deep dives and historical implementation notes are maintained in `docs/`:
- [Owner Operating Guide](docs/guides/OWNER_GUIDE.md)
- [V30 Core Assets & Extensions Report](docs/EmergentInc_V30_实施记录.md)
- [V29 Goal Control Implementation](docs/EmergentInc_V29_实施记录.md)
- [Version Upgrade Entry Points](docs/版本升级入口.md)
- [Security Boundary Specification](docs/security_boundary.md)

---

## License & Support

- **License**: Open-source under [MIT License](LICENSE) (see repository LICENSE).
- **Feedback & Issues**: Submit bugs and discussions via [GitHub Issues](https://github.com/lx00018310/EmergentInc/issues).
- **Customization Services**: For commercial deployments and enterprise agent customization, contact via `/OWNER` or project maintainers.
