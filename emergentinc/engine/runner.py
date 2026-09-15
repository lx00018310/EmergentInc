import argparse
from typing import Optional, List, Dict, Any
from .storage import Storage
from .model_adapter import LLMClient
from .local_view import LocalViewBuilder
from .environment import EnvironmentScheduler
from .validator import RuleValidator
from .ledger import ResourceLedger
from .spawn import SpawnService
from .actions import ActionExecutor
from .market import MarketService
from .capability import CapabilityGateway
from .utils import seeded_order, write_json
from .invariants import check_invariants
from .render_state import render

class OwnerActionRequired(RuntimeError):
    def __init__(self, request_ids):
        self.request_ids = request_ids
        super().__init__('OWNER_ACTION_REQUIRED: ' + ','.join(request_ids))

class RoundRunner:
    def __init__(self, base=None):
        self.s = Storage(base)
        self.s.ensure_v5_defaults()
        self.cfg = self.s.config()
        if self.cfg.get('runtime', {}).get('mode') != 'api_sandbox':
            raise RuntimeError('V8 EXPERIMENT_INVALID: runtime must be api_sandbox')
        self.llm = LLMClient(self.s.paths)
        self.market = MarketService(self.s)
        self.capability = CapabilityGateway(self.s)
        self.lv = LocalViewBuilder(self.s, capability_gateway=self.capability)
        self.env = EnvironmentScheduler(self.s)
        self.validator = RuleValidator(self.s)
        self.ledger = ResourceLedger(self.s)
        self.spawn = SpawnService(self.s, self.ledger)
        self.executor = ActionExecutor(
            self.s, self.validator, self.ledger, self.spawn, self.capability, self.market
        )

    def _audit(self, pid: str, rn: int, audit: dict, action: str):
        u = audit['token_usage']
        log_entry = (
            f"\n## Round {rn}\n"
            f"- kind: {audit.get('kind', 'PIXEL_DECISION')}\n"
            f"- model: {audit.get('model', '')}\n"
            f"- action: {action}\n"
            f"- prompt_hash: {audit.get('prompt_hash', '')}\n"
            f"- sandbox_hash: {audit.get('sandbox_hash', '')}\n"
            f"- tokens: {u.get('total_tokens', 0)}\n"
        )
        self.s.append_text(f'pixels/{pid}/llm_log.md', log_entry)

        w = self.s.world()
        w.setdefault('llm_accounting', {'decision_calls': 0, 'prompt_tokens': 0, 'completion_tokens': 0})
        w['llm_accounting']['decision_calls'] = int(w['llm_accounting'].get('decision_calls', 0)) + 1
        w['llm_accounting']['prompt_tokens'] = int(w['llm_accounting'].get('prompt_tokens', 0)) + int(u.get('prompt_tokens', 0))
        w['llm_accounting']['completion_tokens'] = int(w['llm_accounting'].get('completion_tokens', 0)) + int(u.get('completion_tokens', 0))
        self.s.save_world(w)

    def run_one(self) -> Dict[str, Any]:
        w = self.s.world()
        rn = int(w.get('round', 0)) + 1
        w['round'] = rn
        self.s.save_world(w)

        # 1. Environment events injection
        env_events, created = self.env.inject(rn)

        # 2. Perception & Wake calculation
        active = self.s.pixel_ids(active_only=True)
        views = {}
        awakened = []
        skipped = []
        for pid in active:
            v = self.lv.build(pid, rn, env_events.get(pid, []))
            views[pid] = v
            if self.lv.should_wake(v):
                awakened.append(pid)
            else:
                skipped.append(pid)

        # 3. LLM Decisions
        seed = int(self.cfg.get('experiment_seed', 20260915)) + rn
        order = seeded_order(awakened, seed)
        decisions = {}
        audits = {}
        for pid in order:
            dec, audit = self.llm.decide(pid, rn, views[pid])
            decisions[pid] = dec
            audits[pid] = audit
            self._audit(pid, rn, audit, dec.get('action', ''))

        # 4. Action execution
        applied = []
        rejected = []
        owner_requests = []
        for pid in order:
            dec = decisions[pid]
            ok, reason = self.validator.validate(pid, dec, views[pid])
            if not ok:
                # Deduct minimal invalid action cost
                self.ledger.charge_action(pid, float(self.cfg.get('resource', {}).get('invalid_action_cost', 0.2)))
                st = self.s.pixel_state(pid)
                st['last_feedback'] = {"success": False, "events": [f"REJECTED: {reason}"]}
                self.s.save_pixel_state(pid, st)
                rejected.append({'pixel': pid, 'action': dec, 'reason': reason})
                print(f"[Round {rn:03d}] [{pid}] [REJECTED] {reason}")
                continue

            try:
                res = self.executor.execute(pid, dec, rn, views[pid])
                applied.append({'pixel': pid, 'action': dec, 'result': res})
                st = self.s.pixel_state(pid)
                st['last_feedback'] = {"success": True, "events": res.get("events", [])}
                self.s.save_pixel_state(pid, st)
                intent = dec.get('intent', dec.get('reasoning_summary', ''))
                print(f"[Round {rn:03d}] [{pid}] [THINK] {intent} -> [ACTION] {dec['action']}: {', '.join(res.get('events', []))}")
                if res.get('owner_action_required'):
                    owner_requests.append(res['external_request_id'])
                    print(f"[Round {rn:03d}] [HALT] OWNER_ACTION_REQUIRED by {pid}: {res.get('external_request_id')}")
            except Exception as e:
                st = self.s.pixel_state(pid)
                st['last_feedback'] = {"success": False, "events": [f"EXECUTION_ERROR: {str(e)}"]}
                self.s.save_pixel_state(pid, st)
                rejected.append({'pixel': pid, 'action': dec, 'reason': f'EXECUTION_ERROR: {e}'})
                print(f"[Round {rn:03d}] [{pid}] [ERROR] {e}")

        # 5. Metabolism & Dormancy
        deaths = self.ledger.maintenance_all()

        # 6. Consume events
        for pid in awakened:
            if self.capability:
                self.capability.consume_events(pid, [e['id'] for e in views[pid].get('external', {}).get('events', [])])

        # 7. Invariants validation
        inv = check_invariants(self.s, views, audits)
        if inv:
            raise RuntimeError('EXPERIMENT_INVALID invariants: ' + '; '.join(inv))

        # 8. Persist logs
        log = {
            'round': rn,
            'active_at_start': active,
            'awakened': awakened,
            'skipped_idle': skipped,
            'decision_order': order,
            'decisions': decisions,
            'applied': applied,
            'rejected': rejected,
            'deaths': deaths,
            'owner_requests': owner_requests
        }
        write_json(self.s.live / f'rounds/round_{rn:04d}.json', log)

        # Markdown timeline report
        md = [
            f'# Round {rn:04d}',
            '',
            f'Awakened: {awakened}',
            f'Skipped (Sleeping/Idle): {skipped}',
            '',
            '## Heartbeat Timeline'
        ]
        for x in applied:
            intent = x['action'].get('intent', x['action'].get('reasoning_summary', ''))
            events_str = ", ".join(x['result'].get('events', []))
            md.append(f"- **{x['pixel']}**: `{x['action']['action']}` | *{intent}* -> {events_str}")
        if rejected:
            md += ['', '## Rejected Actions']
            for x in rejected:
                md.append(f"- **{x['pixel']}**: {x['reason']}")
        if owner_requests:
            md += ['', '## 🛑 Owner Action Required']
            for req in owner_requests:
                md.append(f"- {req}")
        (self.s.live / f'rounds/round_{rn:04d}.md').write_text('\n'.join(md) + '\n', encoding='utf-8')

        # Refresh world state rendering
        render(self.s.paths)

        if owner_requests:
            raise OwnerActionRequired(owner_requests)

        return log

    def run(self, rounds: int) -> List[Dict[str, Any]]:
        out = []
        for _ in range(rounds):
            out.append(self.run_one())
        return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--rounds', type=int, default=1)
    ap.add_argument('--workspace', default=None, help='工作区路径')
    ap.add_argument('--base', default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()
    ws = args.workspace or args.base
    try:
        RoundRunner(ws).run(args.rounds)
    except OwnerActionRequired as e:
        print('OWNER_ACTION_REQUIRED:', e.request_ids)
