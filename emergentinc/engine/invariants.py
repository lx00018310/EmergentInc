from .utils import neighbors6

def check_invariants(storage, local_views=None, audits=None):
    errors=[]
    # pixel uniqueness inherent by directory
    held={}
    for pid in storage.pixel_ids():
        st=storage.pixel_state(pid)
        cp=st.get("current_problem")
        if cp:
            if cp in held: errors.append(f"problem {cp} held by multiple pixels")
            held[cp]=pid
            if cp not in storage.problem_ids():
                errors.append(f"{pid} holds missing problem {cp}")
            else:
                p=storage.problem(cp)
                if p.get("current_holder")!=pid:
                    errors.append(f"holder mismatch {cp}: pixel={pid}, problem={p.get('current_holder')}")
    if local_views:
        allp=set(storage.problem_ids())
        for pid,v in local_views.items():
            legal=set(neighbors6(pid))|{pid}
            for n in v.get("neighbors",[]):
                if n["pixel_id"] not in legal:
                    errors.append(f"{pid} sees illegal neighbor {n['pixel_id']}")
    if audits is not None:
        for pid,a in audits.items():
            if not a.get("prompt_hash") or not a.get("sandbox_hash"):
                errors.append(f"missing LLM audit for {pid}")
    return errors
