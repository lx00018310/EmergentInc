from .storage import Storage

def render(base=None):
    s = Storage(base)
    w = s.world()
    rn = w.get('round', 0)
    lines = [
        "# World State (V8 Minimal Kernel)",
        f"\nRound: **{rn}**",
        "\n## Active Pixels",
        "| Pixel | Energy | Parent | Born | Sleep Until | Capabilities |",
        "|---|---:|---|---:|---|---|"
    ]
    for pid in sorted(s.pixel_ids(active_only=True)):
        st = s.pixel_state(pid)
        energy = st.get('energy', st.get('resource', 0.0))
        lines.append(
            f"| {pid} | {energy} | {st.get('parent')} | {st.get('born_round', 0)} | "
            f"{st.get('sleep_until_round')} | {','.join(st.get('capabilities', st.get('capability_ids', [])))} |"
        )
    lines += [
        "",
        "## Accounting",
        "```json",
        str(w.get("accounting", {})),
        "```"
    ]
    (s.live / "world_state.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

if __name__ == "__main__":
    render()
