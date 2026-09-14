from .storage import Storage

def main(base="."):
    s=Storage(base); w=s.world()
    print("Round:",w["round"])
    print("Active pixels:",len(s.pixel_ids(active_only=True)))
    print("Problems:",len(s.problem_ids()))
    print("Closed:",sum(1 for p in s.problem_ids() if s.problem(p)["status"]=="CLOSED"))
    print("LLM accounting:",w["llm_accounting"])
    print("Resource accounting:",w["accounting"])

if __name__=="__main__": main(".")
