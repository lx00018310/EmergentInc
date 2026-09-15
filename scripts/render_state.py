from .storage import Storage

def render(base="."):
    s=Storage(base); w=s.world()
    lines=[
      "# World State",
      f"\nRound: **{w['round']}**",
      "\n## Active Pixels",
      "| Pixel | Resource | Problem | Sleep Until | Waiting Request | Capabilities |",
      "|---|---:|---|---:|---|---|"
    ]
    for pid in sorted(s.pixel_ids(active_only=True)):
        st=s.pixel_state(pid)
        lines.append(
          f"| {pid} | {st['resource']} | {st.get('current_problem')} | "
          f"{st.get('sleep_until_round')} | {st.get('waiting_external_request')} | {','.join(st.get('capability_ids',[]))} |"
        )
    lines += [
      "",
      "## External Accounting",
      "```json",
      str(w.get("external_accounting",{})),
      "```"
    ]
    (s.base/"world_state.md").write_text("\n".join(lines)+"\n",encoding="utf-8")

if __name__=="__main__":
    render(".")
