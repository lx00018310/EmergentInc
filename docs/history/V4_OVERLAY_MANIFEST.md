# V4 Overlay Manifest

## 会覆盖
- README.md
- MASTER_PROMPT.md
- requirements.txt
- .gitignore
- config/world_config.json
- schemas/pixel_action.schema.json
- schemas/problem.schema.json
- schemas/evidence_verdict.schema.json
- schemas/memory_update.schema.json
- prompts/*
- scripts/storage.py
- scripts/model_adapter.py
- scripts/local_view.py
- scripts/validator.py
- scripts/actions.py
- scripts/evidence.py
- scripts/memory.py
- scripts/runner.py
- scripts/self_check.py
- scripts/render_state.py

## 会新增
- AGENT_RUNNER_PROMPT.md
- OWNER_GUIDE.md
- V4 docs
- external request/capability/event/transaction schemas
- scripts/capability.py
- scripts/owner.py
- scripts/migrate_v3_to_v4.py
- scripts/metrics.py
- external_requests/
- capabilities/
- external_events/
- external_transactions/

## 明确不会覆盖
- world_state.json
- pixels/*
- problems/*
- rounds/*
