from .storage import Storage

def main(base="."):
    s=Storage(base)
    s.ensure_v4_defaults()

    for pid in s.problem_ids():
        p=s.problem(pid)
        if "external_requests" not in p:
            p["external_requests"]=[]
            s.save_problem(p)

    print("V3 -> V4 migration complete.")
    print("Current round preserved:",s.world()["round"])
    print("Pixels preserved:",s.pixel_ids())
    print("Problems preserved:",s.problem_ids())

if __name__=="__main__":
    main(".")
