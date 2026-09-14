import json, argparse
from .storage import Storage

def render(base="."):
    s=Storage(base); w=s.world()
    lines=["# World State",f"\nRound: **{w['round']}**\n","\n## Active Pixels\n",
           "| Pixel | Resource | Problem | Parent |","|---|---:|---|---|"]
    for pid in sorted(s.pixel_ids(active_only=True)):
        st=s.pixel_state(pid)
        lines.append(f"| {pid} | {st['resource']} | {st.get('current_problem')} | {st.get('parent')} |")
    lines+=["","\n## Problems\n","| Problem | Status | Holder | Reward |","|---|---|---|---:|"]
    for pr in s.problem_ids():
        p=s.problem(pr); lines.append(f"| {pr} | {p['status']} | {p.get('current_holder')} | {p['reward_offer']} |")
    (s.base/"world_state.md").write_text("\n".join(lines)+"\n",encoding="utf-8")

if __name__=="__main__": render(".")
