import json
from .utils import neighbors6
from .workspace_jail import WorkspaceJail

V8_AVAILABLE_TOOLS = [
    "READ_SELF_FILE", "WRITE_SELF_FILE", "DELETE_SELF_FILE",
    "LIST_WORKSPACE", "READ_WORKSPACE_FILE", "WRITE_WORKSPACE_FILE",
    "DELETE_WORKSPACE_FILE", "MOVE_WORKSPACE_FILE", "RUN_WORKSPACE_COMMAND",
    "READ_MARKET", "CLAIM_MARKET_OPPORTUNITY", "SUBMIT_MARKET_RESULT",
    "USE_CAPABILITY", "READ_INBOX"
]

V8_ACTIONS = ["WORK", "MESSAGE", "ASK_OWNER", "REPRODUCE", "WAIT"]

class LocalViewBuilder:
    def __init__(self, storage, visibility=None, capability_gateway=None):
        self.s = storage
        self.v = visibility
        self.cg = capability_gateway
        self.jail = WorkspaceJail(self.s)

    def build(self, pixel_id: str, round_num: int, environment_events=None):
        st = self.s.pixel_state(pixel_id)
        all_ids = set(self.s.pixel_ids())

        # Safe self state (only physical attributes, no forbidden organizational roles)
        safe_state = {
            "id": pixel_id,
            "position": st.get("position", [0, 0, 0]),
            "active": bool(st.get("active", False)),
            "energy": float(st.get("energy", st.get("resource", 100.0))),
            "parent": st.get("parent"),
            "born_round": st.get("born_round", 0),
            "sleep_until_round": st.get("sleep_until_round"),
            "capabilities": st.get("capabilities", st.get("capability_ids", [])),
            "last_active_round": st.get("last_active_round", 0)
        }

        # Neighbors: strictly 6-neighborhood, strictly public.md only
        neighbors = []
        for nid in neighbors6(pixel_id):
            if nid in all_ids:
                ns = self.s.pixel_state(nid)
                neighbors.append({
                    "id": nid,
                    "occupied": True,
                    "active": bool(ns.get("active", False)),
                    "energy": float(ns.get("energy", ns.get("resource", 0.0))),
                    "public_md": self.s.pixel_public(nid)
                })
            else:
                neighbors.append({
                    "id": nid,
                    "occupied": False,
                    "active": False
                })

        # Inbox
        inbox_msgs = self.s.inbox_messages(pixel_id)

        # External capabilities & events
        caps = self.cg.public_caps_for(pixel_id) if self.cg else []
        pending_reqs = self.cg.pending_requests_for(pixel_id) if self.cg else []
        ext_events = self.cg.events_for(pixel_id) if self.cg else []

        view = {
            "round": round_num,
            "self": {
                "pixel_id": pixel_id,
                "state": safe_state,
                "self_md": self.s.pixel_self(pixel_id),
                "memory_md": self.s.pixel_memory_md(pixel_id),
                "workspace_summary": self.jail.get_workspace_summary(pixel_id)
            },
            "neighbors": neighbors,
            "inbox": {
                "message_count": len(inbox_msgs),
                "messages": inbox_msgs[-5:]  # show latest 5
            },
            "last_feedback": st.get("last_feedback"),
            "external": {
                "capabilities": caps,
                "pending_requests": pending_reqs,
                "events": ext_events
            },
            "available_tools": V8_AVAILABLE_TOOLS,
            "allowed_actions": V8_ACTIONS
        }

        # Backwards compatibility fields for older tests
        view["self"]["genome"] = {}
        view["self"]["memory"] = {}
        view["visible_problems"] = []
        view["visible_bids"] = []
        view["environment_events"] = environment_events or []

        return view

    def should_wake(self, view: dict) -> bool:
        st = view["self"]["state"]
        rn = int(view["round"])

        # Inactive pixels do not wake
        if not st.get("active"):
            return False

        # 1. Just born
        if int(st.get("born_round", 0)) == rn:
            return True

        # 2. External events
        ext = view.get("external", {})
        if ext.get("events"):
            return True

        # 3. New inbox messages
        if view.get("inbox", {}).get("message_count", 0) > 0:
            return True

        # 4. Sleep duration expired
        sleep_until = st.get("sleep_until_round")
        if sleep_until is not None:
            if rn >= int(sleep_until):
                return True
            return False

        # 5. Natural wake cycle: maximum 5 rounds of silence
        last_active = int(st.get("last_active_round", 0))
        if rn - last_active >= 5:
            return True

        # Default: if not sleeping, pixel stays awake
        return True
