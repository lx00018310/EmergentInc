from pathlib import Path
from typing import Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from .utils import read_json, write_json

class Storage:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.live = self.paths.live_root
        self.private = self.paths.private_root
        self.resources = self.paths.resources_root

    def config(self):
        return read_json(self.paths.config_dir / 'world_config.json')

    def world(self):
        p = self.live / 'world_state.json'
        if not p.exists():
            return {"round": 0, "accounting": {}, "llm_accounting": {}, "counters": {}}
        return read_json(p)

    def save_world(self, obj):
        write_json(self.live / 'world_state.json', obj)

    def ensure_v5_defaults(self):
        for d in ['external_requests', 'capabilities', 'external_events', 'external_transactions', 'pixels', 'market']:
            (self.live / d).mkdir(parents=True, exist_ok=True)
        (self.private / 'capabilities').mkdir(parents=True, exist_ok=True)
        p = self.live / 'world_state.json'
        if not p.exists():
            write_json(p, {"round": 0, "accounting": {}, "llm_accounting": {}, "counters": {}})
        w = self.world()
        w.setdefault('external_accounting', {'CNY_in': 0.0, 'CNY_out': 0.0, 'USD_in': 0.0, 'USD_out': 0.0})
        w.setdefault('counters', {})
        for k in ['external_requests', 'capabilities_granted', 'external_events']:
            w['counters'].setdefault(k, 0)
        self.save_world(w)
        for pid in self.pixel_ids():
            st = self.pixel_state(pid)
            changed = False
            for k, v in {'waiting_external_request': None, 'waiting_for': [], 'sleep_until_round': None, 'capability_ids': []}.items():
                if k not in st:
                    st[k] = v
                    changed = True
            if changed:
                self.save_pixel_state(pid, st)

    def pixel_ids(self, active_only=False):
        root = self.live / 'pixels'
        out = []
        if not root.exists():
            return out
        for d in root.iterdir():
            if d.is_dir() and (d / 'state.json').exists():
                if active_only and not read_json(d / 'state.json').get('active'):
                    continue
                out.append(d.name)
        return out

    def pixel_state(self, pid):
        return read_json(self.live / f'pixels/{pid}/state.json')

    def pixel_genome(self, pid):
        p = self.live / f'pixels/{pid}/genome.json'
        return read_json(p) if p.exists() else {}

    def pixel_memory(self, pid):
        p = self.live / f'pixels/{pid}/memory.json'
        return read_json(p) if p.exists() else {}

    def save_pixel_state(self, pid, obj):
        write_json(self.live / f'pixels/{pid}/state.json', obj)

    def save_pixel_genome(self, pid, obj):
        write_json(self.live / f'pixels/{pid}/genome.json', obj)

    def save_pixel_memory(self, pid, obj):
        write_json(self.live / f'pixels/{pid}/memory.json', obj)

    def pixel_self(self, pid) -> str:
        p = self.live / f'pixels/{pid}/self.md'
        return p.read_text(encoding='utf-8') if p.exists() else ""

    def save_pixel_self(self, pid, content: str):
        p = self.live / f'pixels/{pid}/self.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def pixel_public(self, pid) -> str:
        p = self.live / f'pixels/{pid}/public.md'
        return p.read_text(encoding='utf-8') if p.exists() else ""

    def save_pixel_public(self, pid, content: str):
        p = self.live / f'pixels/{pid}/public.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def pixel_memory_md(self, pid) -> str:
        p = self.live / f'pixels/{pid}/memory.md'
        return p.read_text(encoding='utf-8') if p.exists() else ""

    def save_pixel_memory_md(self, pid, content: str):
        p = self.live / f'pixels/{pid}/memory.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def pixel_inheritance(self, pid) -> str:
        p = self.live / f'pixels/{pid}/inheritance.md'
        return p.read_text(encoding='utf-8') if p.exists() else ""

    def save_pixel_inheritance(self, pid, content: str):
        p = self.live / f'pixels/{pid}/inheritance.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def append_text(self, rel, text):
        p = self.live / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open('a', encoding='utf-8') as f:
            f.write(text)

    def problem_ids(self):
        return sorted(p.stem for p in (self.live / 'problems').glob('P*.json'))

    def problem(self, pid):
        return read_json(self.live / f'problems/{pid}.json')

    def save_problem(self, p):
        write_json(self.live / f'problems/{p["id"]}.json', p)

    def next_problem_id(self):
        nums = []
        for pid in self.problem_ids():
            try:
                nums.append(int(pid[1:]))
            except:
                pass
        return f'P{max(nums, default=0)+1:04d}'

    def _ids(self, folder, prefix):
        return sorted(p.stem for p in (self.live / folder).glob(f'{prefix}*.json'))

    def _next_id(self, folder, prefix):
        nums = []
        for x in self._ids(folder, prefix):
            try:
                nums.append(int(x[len(prefix):]))
            except:
                pass
        return f'{prefix}{max(nums, default=0)+1:04d}'

    def external_request_ids(self):
        return self._ids('external_requests', 'ER')

    def next_external_request_id(self):
        return self._next_id('external_requests', 'ER')

    def external_request(self, rid):
        return read_json(self.live / f'external_requests/{rid}.json')

    def save_external_request(self, o):
        write_json(self.live / f'external_requests/{o["id"]}.json', o)

    def capability_ids(self):
        return self._ids('capabilities', 'CAP')

    def capability(self, cid):
        return read_json(self.live / f'capabilities/{cid}.json')

    def save_capability(self, o):
        write_json(self.live / f'capabilities/{o["id"]}.json', o)

    def event_ids(self):
        return self._ids('external_events', 'EV')

    def next_event_id(self):
        return self._next_id('external_events', 'EV')

    def event(self, eid):
        return read_json(self.live / f'external_events/{eid}.json')

    def save_event(self, o):
        write_json(self.live / f'external_events/{o["id"]}.json', o)

    def transaction_ids(self):
        return self._ids('external_transactions', 'TX')

    def next_transaction_id(self):
        return self._next_id('external_transactions', 'TX')

    def transaction(self, tid):
        return read_json(self.live / f'external_transactions/{tid}.json')

    def save_transaction(self, o):
        write_json(self.live / f'external_transactions/{o["id"]}.json', o)

    def create_pixel(self, pid, state, genome, memory):
        d = self.live / f'pixels/{pid}'
        if d.exists():
            raise ValueError(f'coordinate occupied: {pid}')
        d.mkdir(parents=True)
        write_json(d / 'state.json', state)
        if genome:
            write_json(d / 'genome.json', genome)
        if memory:
            write_json(d / 'memory.json', memory)
        for name, title in [
            ('state.md', 'Pixel State'),
            ('genome.md', 'Genome'),
            ('memory.md', 'Memory'),
            ('history.md', 'History'),
            ('inbox.md', 'Inbox'),
            ('llm_log.md', 'LLM Log'),
            ('self.md', 'Self'),
            ('public.md', 'Public'),
            ('inheritance.md', 'Inheritance')
        ]:
            p = d / name
            if not p.exists():
                p.write_text(f'# {title} — {pid}\n', encoding='utf-8')
        (d / 'workspace').mkdir(parents=True, exist_ok=True)
        (d / 'inbox' / 'messages').mkdir(parents=True, exist_ok=True)
        (d / 'inbox' / 'attachments').mkdir(parents=True, exist_ok=True)
        (d / 'activity' / 'rounds').mkdir(parents=True, exist_ok=True)

    def create_pixel_v8(self, pid, position, energy=100.0, parent=None, born_round=0, inheritance_content=None):
        d = self.live / f'pixels/{pid}'
        if d.exists():
            raise ValueError(f'coordinate occupied: {pid}')
        d.mkdir(parents=True)
        state = {
            "id": pid,
            "position": position,
            "active": True,
            "energy": float(energy),
            "parent": parent,
            "born_round": born_round,
            "sleep_until_round": None,
            "capabilities": [],
            "last_feedback": None,
            "last_active_round": born_round
        }
        write_json(d / 'state.json', state)
        (d / 'self.md').write_text("# Self\n\nI exist.\nI can observe, act, learn, communicate and change myself.\n", encoding='utf-8')
        (d / 'public.md').write_text("# Public\n\nAvailable for collaboration.\n", encoding='utf-8')
        (d / 'memory.md').write_text("# Memory\n", encoding='utf-8')
        inh = inheritance_content if inheritance_content is not None else f"# Inheritance\n\nParent: {parent}\n"
        (d / 'inheritance.md').write_text(inh, encoding='utf-8')
        (d / 'workspace').mkdir(parents=True, exist_ok=True)
        (d / 'inbox' / 'messages').mkdir(parents=True, exist_ok=True)
        (d / 'inbox' / 'attachments').mkdir(parents=True, exist_ok=True)
        (d / 'activity' / 'rounds').mkdir(parents=True, exist_ok=True)
        (d / 'activity' / 'audit.log').write_text(f"Pixel {pid} born at round {born_round}\n", encoding='utf-8')
        (d / 'history.md').write_text(f"# History — {pid}\nBorn round {born_round}\n", encoding='utf-8')
        (d / 'inbox.md').write_text(f"# Inbox — {pid}\n", encoding='utf-8')
        (d / 'llm_log.md').write_text(f"# LLM Log — {pid}\n", encoding='utf-8')
        return state

    def inbox_messages(self, pid):
        msg_dir = self.live / f'pixels/{pid}/inbox/messages'
        if not msg_dir.exists():
            return []
        out = []
        for p in sorted(msg_dir.glob('*.json')):
            try:
                out.append(read_json(p))
            except Exception:
                pass
        return out

    def save_inbox_message(self, pid, msg):
        msg_dir = self.live / f'pixels/{pid}/inbox/messages'
        msg_dir.mkdir(parents=True, exist_ok=True)
        mid = msg.get('id') or f"MSG_{self.world().get('round', 0)}_{len(list(msg_dir.glob('*.json')))+1:04d}"
        msg['id'] = mid
        write_json(msg_dir / f'{mid}.json', msg)
        return mid

    def market_opportunity_ids(self):
        m_dir = self.live / 'market' / 'opportunities'
        if not m_dir.exists():
            return []
        return sorted(p.stem for p in m_dir.glob('M*.md'))

    def market_opportunity(self, mid):
        p = self.live / 'market' / 'opportunities' / f'{mid}.md'
        return p.read_text(encoding='utf-8') if p.exists() else None

    def save_market_opportunity(self, mid, content: str):
        p = self.live / 'market' / 'opportunities' / f'{mid}.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def archive_market_opportunity(self, mid):
        src = self.live / 'market' / 'opportunities' / f'{mid}.md'
        dst = self.live / 'market' / 'archive' / f'{mid}.md'
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)


