class ResourceLedger:
    def __init__(self, storage):
        self.s = storage
        cfg_res = self.s.config().get("resource", {})
        self.maintenance_cost = float(cfg_res.get("maintenance_cost_per_round", 0.25))
        self.birth_cost = float(cfg_res.get("spawn_cost", 10.0))

    def _get_energy(self, st):
        if "energy" in st:
            return float(st["energy"])
        return float(st.get("resource", 0.0))

    def _set_energy(self, st, val):
        val = round(float(val), 4)
        st["energy"] = val
        # Maintain resource alias for legacy compatibility
        st["resource"] = val

    def charge_action(self, pixel_id, cost):
        cost = float(cost)
        st = self.s.pixel_state(pixel_id)
        cur = self._get_energy(st)
        self._set_energy(st, cur - cost)
        self.s.save_pixel_state(pixel_id, st)
        w = self.s.world()
        w.setdefault("accounting", {})
        w["accounting"]["action_cost_burned"] = round(float(w["accounting"].get("action_cost_burned", 0.0)) + cost, 4)
        self.s.save_world(w)

    def transfer_energy(self, from_pid, to_pid, amount):
        amount = float(amount)
        if amount <= 0:
            return False, "transfer amount must be > 0"
        st_from = self.s.pixel_state(from_pid)
        cur_from = self._get_energy(st_from)
        if cur_from < amount:
            return False, f"insufficient energy: has {cur_from}, requires {amount}"
        st_to = self.s.pixel_state(to_pid)
        cur_to = self._get_energy(st_to)

        self._set_energy(st_from, cur_from - amount)
        self._set_energy(st_to, cur_to + amount)

        self.s.save_pixel_state(from_pid, st_from)
        self.s.save_pixel_state(to_pid, st_to)

        w = self.s.world()
        w.setdefault("accounting", {})
        w["accounting"]["resource_transferred"] = round(float(w["accounting"].get("resource_transferred", 0.0)) + amount, 4)
        self.s.save_world(w)
        return True, "TRANSFERRED"

    def charge_reproduction(self, parent_id, energy_to_child, birth_cost=None):
        cost = self.birth_cost if birth_cost is None else float(birth_cost)
        energy_to_child = float(energy_to_child)
        total_needed = energy_to_child + cost
        st_parent = self.s.pixel_state(parent_id)
        cur = self._get_energy(st_parent)
        if cur < total_needed:
            raise ValueError(f"insufficient energy for reproduction: has {cur}, requires {total_needed}")

        # Deduct total from parent
        self._set_energy(st_parent, cur - total_needed)
        self.s.save_pixel_state(parent_id, st_parent)

        w = self.s.world()
        w.setdefault("accounting", {})
        w["accounting"]["action_cost_burned"] = round(float(w["accounting"].get("action_cost_burned", 0.0)) + cost, 4)
        self.s.save_world(w)
        return energy_to_child

    def reward_market_energy(self, pixel_id, amount):
        amount = float(amount)
        st = self.s.pixel_state(pixel_id)
        cur = self._get_energy(st)
        self._set_energy(st, cur + amount)
        self.s.save_pixel_state(pixel_id, st)

        w = self.s.world()
        w.setdefault("accounting", {})
        w["accounting"]["environment_reward_injected"] = round(float(w["accounting"].get("environment_reward_injected", 0.0)) + amount, 4)
        self.s.save_world(w)

    def maintenance_all(self):
        cost = self.maintenance_cost
        dormant = []
        for pid in self.s.pixel_ids(active_only=True):
            st = self.s.pixel_state(pid)
            cur = self._get_energy(st)
            new_energy = round(cur - cost, 4)
            self._set_energy(st, new_energy)
            if new_energy <= 0:
                st["active"] = False
                dormant.append(pid)
            self.s.save_pixel_state(pid, st)

        w = self.s.world()
        w.setdefault("accounting", {})
        w.setdefault("counters", {})
        w["accounting"]["maintenance_burned"] = round(float(w["accounting"].get("maintenance_burned", 0.0)) + cost * len(self.s.pixel_ids(active_only=True)), 4)
        w["counters"]["deaths"] = int(w["counters"].get("deaths", 0)) + len(dormant)
        self.s.save_world(w)
        return dormant

    # --- Legacy Problem settlement support ---
    def close_distribution(self, p):
        reward = float(p.get("reward_offer", 0.0))
        route = [x for x in p.get("route", []) if x != "ENVIRONMENT"]
        if not route:
            return {}
        dist = {x: 0.0 for x in route}
        dist[route[-1]] = reward
        return dist

    def settle_closed(self, p):
        dist = self.close_distribution(p)
        for pid, amt in dist.items():
            if pid in self.s.pixel_ids():
                self.reward_market_energy(pid, amt)
        return dist
