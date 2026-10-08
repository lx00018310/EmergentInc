English | [中文](README_CN.md)

# EmergentInc

**AI that helps anyone start and run an online business.**

You provide the idea, resources and final decisions. EmergentInc provides AI-powered characters and Pixels that explore opportunities, build products, market, sell, serve customers and continuously evolve through real business activity.

- **For users:** deploy EmergentInc and build your own AI-powered online business.
- **For customers:** EmergentInc itself also operates as a business and provides customization services.
- **For developers:** EmergentInc is open source.

## One business, one public website

| Address | Purpose |
| --- | --- |
| `/` | Public store, product details, checkout and order lookup; no Owner login required |
| `/QIAN` | Internal characters, conversations, Worlds and character income |
| `/YUAN?world=<world_id>` | Internal Pixels, Runs, messages, artifacts, Body and collaboration |
| `/GENE` | Internal business operations, Root of Trust, Gene, Evolution, Memory, payments and Public Site settings |

All four entries support English and Chinese. English is the initial language; an explicit selection is saved in localStorage. User documents, conversations and business records retain their original language.

The public website belongs to the instance. All characters and Worlds work for the same business and may divide work or collaborate using existing capabilities. Public orders and revenue belong to the instance, without an arbitrary character attribution. Existing World invoices and revenue retain their original attribution.

The store supports multiple products and initially displays two blank placeholders with empty names, descriptions and prices, and purchasing disabled. Edit both languages, price and availability for each product, or add a blank product, in `/GENE` → Public Site. The homepage Backend button requires the existing `.env` `EMERGENTINC_OWNER_SECRET`, validated by the server before opening `/QIAN`; the secret never enters the frontend bundle. QIAN / YUAN / GENE each provide all three page links in their top bar.

## World, Qianji and Pixel

A Qianji is a persistent character with a narrative and its own World. A World contains multiple Pixels with independent runtime records, messages and files. Characters remain after gateway Pixel death; the Owner can replace the gateway with an active Pixel from that World. Chat starts a bounded Run and returns replies through its outbox.

Root, Genome and Evolution are global. Each World's Current, Body Skills and ledger are separate. Identical coordinates in different Worlds do not share files or messages. V23's legacy meeting history is archived; V24 does not introduce a new collaboration architecture.

## Body, Gene and evolution

Body Skills grow, test and execute within inherited permissions. The minimal contract, `pure-ast-json@1`, interprets JavaScript functions using JSON tests without eval, host files, credentials, network, subprocesses or dependency installation. Body revisions do not create a new generation.

Promotion freezes an immutable snapshot with World, Pixel, generation and source hashes. The Owner reviews privacy, sharing rights and generality. Approved directions become Gene patches. Full releases must pass typecheck, tests, builds and smoke checks before the trusted Supervisor receives approval for the **exact candidate hash**.

All Worlds must prepare their next Current before the global generation pointer changes. Failure rolls back code and projections; Lineage, payments and failure evidence persist. New Worlds inherit promoted Gene capabilities without copying private Body files.

Self-evolution stays within verified contracts and approvals. Agents cannot edit a live production release or silently add arbitrary dependencies.

## Orders and USDT payments

Store → select a listed product → customer details → Order → USDT Invoice / QR → existing Payment Monitor → confirmed payment → paid Order → instance revenue visible in `/GENE`.

Enable a payment rail in `/GENE`. No merchant address is supplied by default. The server stores no wallet private key, signs no transaction and sends no funds. Supported rails reuse existing mainnet Solana USDT, BSC Binance-Peg USDT, Polygon PoS USDT0 and TRON TRC-20 USDT.

Solana invoices have distinct references. Other rails add a permanently unique suffix of 0.000001–0.009999 USDT. Pay the **exact displayed amount**, including all decimals. TRON QR codes contain the receiving address; select TRC-20 USDT and enter the exact amount manually. Existing chain finality and transfer verification govern receipts. Late or cancelled payments require review; unconfirmed observations create no revenue.

Public checkout uses an unpredictable token to query payment state. Keep the returned order link private. Public endpoints expose only site, product and token-authorized payment information. Other `/api/*` endpoints require Owner authentication; existing session and login endpoints remain available.

Private RPC settings: `EMERGENTINC_SOLANA_RPC_MAINNET`, `EMERGENTINC_SOLANA_WS_MAINNET`, `EMERGENTINC_BSC_RPC_MAINNET`, `EMERGENTINC_POLYGON_RPC_MAINNET`, `EMERGENTINC_TRON_RPC_MAINNET`, `EMERGENTINC_TRON_API_KEY`. Credentials never enter public responses or models.

## Persistent workspace

**Code changes. Business data continues.**

```text
workspace/
  workspace-layout.json
  system/
    active-generation.json
    control/control.sqlite3       # Characters, Worlds, Public Site, product, orders
    payment/payment.sqlite3       # Rails, invoices, receipts, revenue, outbox
    lineage/lineage.sqlite3        # Shared lineage, memories, business evidence
    generations/Gxxxx/current.sqlite3
    evolution/{promotions,requests}/
    legacy/v22/{raw,snapshots}/
  worlds/<world_id>/
    world.json
    ledger/v9_core.sqlite3
    live/{pixels,artifacts,shared}/
    runtime/
    generations/Gxxxx/{current.sqlite3,body/skills}/
```

Site settings and orders use the existing control database. Payments remain in the existing payment database. Business data never lives in frontend source, Git JSON files or a release directory.

## Run and develop

Use Node.js 24 and pnpm. On Windows use `pnpm.cmd`. Configure a random Owner secret of at least 32 characters and model pricing in local `.env`; keep credentials out of Git.

```powershell
pnpm.cmd install --frozen-lockfile --ignore-scripts
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
node scripts/launch-approved.mjs --check
node scripts/launch-approved.mjs
```

`EmergentInc_UI.bat` also launches the approved release. Startup verifies frozen code against generation, Current, pointer and Owner approval receipts. Editing development source does not update a running instance.

Windows launchers open the page only after the launched process reports readiness and its homepage responds. On Linux, run `bash ./EmergentInc_UI.sh` for the same foreground startup. A desktop session uses `xdg-open`; a headless session prints the URL. Install Node.js 24 and pnpm, and configure Linux paths in `.env` and the Owner release configuration. This local launcher does not replace the production systemd units or migrate a Windows workspace.

After a controlled upgrade replaces the launched process, the launcher checks the switch record, exact approval and new process readiness before reporting a successful handoff. The new service runs independently, with output in the displayed runtime log. An ordinary crash still returns an error.

Daily upgrades use the independent page at `http://127.0.0.1:8766/`. `EmergentInc_Upgrade.bat` remains an optional command-line entry for status, rollback and recovery; the web upgrade service does not depend on this batch file.

Version labels accept free text, including Chinese, spaces and symbols (up to 200 characters). Leave the label blank to generate a timestamp label; a change description is still required. Display labels are stored separately from the system-generated release IDs.

Owner and Agent development use separate branches / worktrees. Keep production releases frozen. Do not edit `/srv/emergentinc/current` or `git pull` into a live production directory. Tests and a local commit precede merging and release approval. Do not share a working tree between simultaneous editors.

## Upgrade and rollback

Linux code stays in `/srv/emergentinc/releases/<release_id>` with `current` pointing to the approved release. Data stays in `/var/lib/emergentinc/workspace`. Never overwrite that workspace.

Sequence: typecheck → tests → frontend build → frozen candidate → stop instance → workspace backup → required migration → switch release → start → health check. Failed health checks roll back code. Orders, payments, revenue, Memory and Lineage remain as facts.

V22 workspaces require explicit V23 migration:

```powershell
node scripts/v23-migration-dry-run.mjs <stopped-V22-workspace> <new-backup-directory>
node scripts/v23-upgrade.mjs prepare <V22-workspace> <verified-backup-directory> <new-owner-directory>
node scripts/v23-upgrade.mjs approve <owner-directory> <exact-candidate-hash> "reason"
node scripts/v23-upgrade.mjs apply <owner-directory> <exact-candidate-hash>
```

For V23 → V24 and later software releases retaining the same Workspace layout, use `EmergentInc_Upgrade.bat` or `node scripts/version-upgrade.mjs`: status / prepare / show / approve / apply / rollback / recover. See [version upgrade entry points](docs/版本升级入口.md). Owner software maintenance archives unsynthesized facts without calling a model. Direct rollback to V23 is refused after any instance invoice exists. Normal Gene upgrades retain their Root restrictions and Final Dream requirement.

Subsequent approved changes use `scripts/v23-generation.mjs` submit / validate / approve / birth. V24 retains the V23 workspace layout and adds no new Gene mechanism. See the [V24 implementation record](docs/EmergentInc_V24_实施记录.md) for schema compatibility and validation evidence.

## Validation status

V24 is a development candidate until its exact release is approved and deployed. Local tests use isolated workspaces and simulated RPC evidence. They do not prove real customer payments or Linux production acceptance. Record deployment and real payment acceptance separately.

Plans and history: [V24 Plan](docs/EmergentInc%20V24%20产品化收口执行%20Plan.md), [V23 implementation](docs/EmergentInc_V23_实施记录.md), [V22 rectification](docs/EmergentInc_V22_整改实施记录.md), [original launch materials](docs/launch/README.md).
