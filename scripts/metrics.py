from .storage import Storage

def main(base="."):
    s=Storage(base); s.ensure_v5_defaults(); w=s.world()
    inflow={}; outflow={}
    for tid in s.transaction_ids():
        t=s.transaction(tid)
        bucket=inflow if t["direction"]=="INFLOW" else outflow
        bucket[t["currency"]]=bucket.get(t["currency"],0.0)+float(t["amount"])

    print("Round:",w["round"])
    print("Active pixels:",len(s.pixel_ids(active_only=True)))
    print("Problems closed:",sum(1 for p in s.problem_ids() if s.problem(p)["status"]=="CLOSED"))
    print("External requests:",len(s.external_request_ids()))
    print("Capabilities:",len(s.capability_ids()))
    print("Real inflow:",inflow)
    print("Real outflow:",outflow)
    for cur in set(inflow)|set(outflow):
        print(f"Real P&L {cur}:",inflow.get(cur,0)-outflow.get(cur,0))

if __name__=="__main__":
    main(".")
