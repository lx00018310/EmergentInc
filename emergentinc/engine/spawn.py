from pathlib import Path
from .utils import coord_to_id, neighbors6

class SpawnService:
    def __init__(self, storage, ledger=None):
        self.s = storage
        self.ledger = ledger
        self.cfg = self.s.config().get("resource", {})
        self.birth_cost = float(self.cfg.get("spawn_cost", 10.0))

    def spawn_v8(self, parent_id, target_pos, energy_to_child, inheritance_text, round_num):
        child_id = coord_to_id(target_pos)
        # Check neighbor legality
        if child_id not in neighbors6(parent_id):
            raise ValueError(f"Spawn target {child_id} is not a 6-neighbor of {parent_id}")

        # Check occupancy
        child_dir = self.s.live / f"pixels/{child_id}"
        if child_dir.exists() and (child_dir / "state.json").exists():
            st = self.s.pixel_state(child_id)
            if st.get("active"):
                raise ValueError(f"Spawn coordinate occupied by active pixel: {child_id}")

        # Charge parent energy
        energy_to_child = float(energy_to_child)
        if self.ledger:
            self.ledger.charge_reproduction(parent_id, energy_to_child, self.birth_cost)

        # Create child pixel
        child_state = self.s.create_pixel_v8(
            pid=child_id,
            position=list(target_pos),
            energy=energy_to_child,
            parent=parent_id,
            born_round=round_num,
            inheritance_content=f"# Inheritance\n\nParent: {parent_id}\n\n{inheritance_text}\n"
        )

        # Set child's self.md to default undecided identity
        self.s.save_pixel_self(
            child_id,
            "# Self\n\nI exist.\n\nI received an inheritance message.\nI will decide who I become.\n"
        )

        w = self.s.world()
        w.setdefault("counters", {})
        w["counters"]["spawns"] = int(w["counters"].get("spawns", 0)) + 1
        self.s.save_world(w)

        return {
            "child_id": child_id,
            "parent_id": parent_id,
            "energy": energy_to_child,
            "round": round_num
        }

    # Backward-compatible spawn method
    def spawn(self, parent_id, proposal, round_num):
        tgt = proposal.get("target_pixel")
        if not tgt:
            pos = proposal.get("position", [0, 0, 0])
            tgt = coord_to_id(pos)
        from .utils import id_to_coord
        coords = id_to_coord(tgt)
        energy = float(proposal.get("energy", proposal.get("initial_resource", 40.0)))
        inh = proposal.get("inheritance", proposal.get("rationale", "Legacy spawn"))
        return self.spawn_v8(parent_id, coords, energy, inh, round_num)
