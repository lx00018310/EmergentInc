from .utils import neighbors6

FORBIDDEN_STATE_FIELDS = {
    'role', 'profession', 'department', 'manager',
    'specialization', 'job_type', 'job', 'genome',
    'handoff_preference', 'risk_tolerance', 'spawn_preference',
    'cost_sensitivity', 'novelty_preference', 'learned_principles'
}

def check_invariants(storage, local_views=None, audits=None):
    errors = []
    for pid in storage.pixel_ids():
        st = storage.pixel_state(pid)
        # 1. Check forbidden role/genome fields in state.json
        for field in FORBIDDEN_STATE_FIELDS:
            if field in st:
                errors.append(f"pixel {pid} state.json contains forbidden organizational/genome field: {field}")

        # 2. Check held problem if legacy field is present
        cp = st.get("current_problem")
        if cp:
            if cp not in storage.problem_ids():
                errors.append(f"{pid} holds missing problem {cp}")
            else:
                p = storage.problem(cp)
                if p.get("current_holder") and p.get("current_holder") != pid:
                    errors.append(f"holder mismatch {cp}: pixel={pid}, problem={p.get('current_holder')}")

    # 3. Check neighbor locality
    if local_views:
        for pid, v in local_views.items():
            legal = set(neighbors6(pid)) | {pid}
            for n in v.get("neighbors", []):
                nid = n.get("id") or n.get("pixel_id")
                if nid and nid not in legal:
                    errors.append(f"{pid} sees illegal neighbor {nid}")

    # 4. Check audits if provided
    if audits is not None:
        for pid, a in audits.items():
            if not a.get("prompt_hash"):
                errors.append(f"missing LLM audit prompt_hash for {pid}")

    return errors
