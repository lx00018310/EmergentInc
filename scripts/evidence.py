class EvidenceService:
    def __init__(self,storage,llm):
        self.s=storage; self.llm=llm

    def add_model_artifact(self,problem_id,pixel_id,round_num,work_output):
        p=self.s.problem(problem_id)
        p["evidence"].append({"source":"MODEL_ARTIFACT","producer":pixel_id,"round":round_num,"content":work_output})
        self.s.save_problem(p)

    def add_tool_verified(self,problem_id,pixel_id,round_num,content):
        p=self.s.problem(problem_id)
        p["evidence"].append({"source":"TOOL_VERIFIED","producer":pixel_id,"round":round_num,"content":content})
        self.s.save_problem(p)

    def request_close(self,problem_id,round_num):
        p=self.s.problem(problem_id)
        policy=p.get("evidence_policy",{})
        allowed=set(policy.get("allowed_sources",[]))
        min_items=int(policy.get("min_items",1))
        eligible=[e for e in p.get("evidence",[]) if e.get("source") in allowed]
        if len(eligible)<min_items:
            return {
              "verdict":"INSUFFICIENT","matched_acceptance":[],
              "missing_acceptance":p["acceptance"],"reason":"evidence source gate not satisfied"
            },None
        return self.llm.validate_evidence_semantics(p,eligible,round_num)
