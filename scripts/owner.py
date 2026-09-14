import argparse,json,hashlib
from pathlib import Path
from datetime import datetime, timezone
from .storage import Storage

def add_event(s,target,etype,problem_id,payload):
    eid=s.next_event_id()
    e={
      "id":eid,"type":etype,"target_pixel":target,"problem_id":problem_id,
      "round_created":s.world()["round"],"payload":payload,"consumed":False
    }
    s.save_event(e)
    w=s.world(); w["counters"]["external_events"]+=1; s.save_world(w)
    return e

def list_requests(s):
    for rid in s.external_request_ids():
        r=s.external_request(rid)
        print(rid,r["status"],"requester=",r["requester"],
              "type=",r["capability_type"],"purpose=",r["purpose"])

def approve(s,rid,cid,profile_file,reason="approved"):
    r=s.external_request(rid)
    if r["status"]!="PENDING_OWNER":
        raise RuntimeError("request not pending")
    profile=json.loads(Path(profile_file).read_text(encoding="utf-8"))
    public_meta={"driver":profile.get("driver","unknown")}
    public_meta.update(profile.get("public_metadata",{}))
    cap={
      "id":cid,"status":"ACTIVE","type":r["capability_type"],
      "granted_to":r["requester"],"problem_scope":r.get("problem_id"),
      "request_id":rid,"allowed_operations":r["requested_operations"],
      "public_metadata":public_meta,"created_round":s.world()["round"],
      "expires_round":None
    }
    s.save_capability(cap)
    private_dir=s.base/"owner_private/capabilities"
    private_dir.mkdir(parents=True,exist_ok=True)
    (private_dir/f"{cid}.json").write_text(
      json.dumps(profile,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

    r.update({
      "status":"APPROVED","resolved_round":s.world()["round"],
      "owner_reason":reason,"capability_id":cid
    })
    s.save_external_request(r)

    st=s.pixel_state(r["requester"])
    st.setdefault("capability_ids",[])
    if cid not in st["capability_ids"]:
        st["capability_ids"].append(cid)
    st["waiting_external_request"]=None
    st["waiting_for"]=[]
    s.save_pixel_state(r["requester"],st)

    if r.get("problem_id"):
        p=s.problem(r["problem_id"])
        p["status"]="WORKING"
        s.save_problem(p)

    add_event(s,r["requester"],"CAPABILITY_GRANTED",r.get("problem_id"),{
      "request_id":rid,"capability_id":cid,"type":r["capability_type"]
    })

    w=s.world()
    w["counters"]["capabilities_granted"]+=1
    s.save_world(w)
    print("APPROVED",rid,"->",cid)

def reject(s,rid,reason):
    r=s.external_request(rid)
    if r["status"]!="PENDING_OWNER":
        raise RuntimeError("request not pending")
    r.update({
      "status":"REJECTED","resolved_round":s.world()["round"],
      "owner_reason":reason
    })
    s.save_external_request(r)

    st=s.pixel_state(r["requester"])
    st["waiting_external_request"]=None
    st["waiting_for"]=[]
    s.save_pixel_state(r["requester"],st)

    if r.get("problem_id"):
        p=s.problem(r["problem_id"])
        p["status"]="WORKING"
        s.save_problem(p)

    add_event(s,r["requester"],"CAPABILITY_REJECTED",r.get("problem_id"),{
      "request_id":rid,"reason":reason
    })
    print("REJECTED",rid)

def record_transaction(s,direction,problem_id,amount,currency,note,receipt_file=None):
    tid=s.next_transaction_id()
    sha=None
    if receipt_file:
        sha=hashlib.sha256(Path(receipt_file).read_bytes()).hexdigest()
    tx={
      "id":tid,"direction":direction,"amount":float(amount),
      "currency":currency.upper(),"problem_id":problem_id,
      "source":"HUMAN_VERIFIED","note":note,
      "receipt_sha256":sha,
      "created_at":datetime.now(timezone.utc).isoformat()
    }
    s.save_transaction(tx)

    w=s.world()
    key=f"{currency.upper()}_{'in' if direction=='INFLOW' else 'out'}"
    w["external_accounting"][key]=w["external_accounting"].get(key,0.0)+float(amount)
    s.save_world(w)
    return tx

def record_payment(s,problem_id,amount,currency,note,receipt_file=None):
    tx=record_transaction(s,"INFLOW",problem_id,amount,currency,note,receipt_file)
    p=s.problem(problem_id)
    p["evidence"].append({
      "source":"HUMAN_VERIFIED","producer":"OWNER","round":s.world()["round"],
      "content":{
        "transaction_id":tx["id"],"direction":"INFLOW",
        "amount":float(amount),"currency":currency.upper(),
        "note":note,"receipt_sha256":tx["receipt_sha256"]
      }
    })
    if p.get("status")=="WAITING_EXTERNAL":
        p["status"]="WORKING"
    s.save_problem(p)

    holder=p.get("current_holder")
    if holder:
        st=s.pixel_state(holder)
        st["waiting_for"]=[]
        st["waiting_external_request"]=None
        s.save_pixel_state(holder,st)
        add_event(s,holder,"REAL_PAYMENT",problem_id,{
          "transaction_id":tx["id"],"amount":float(amount),
          "currency":currency.upper()
        })
    print("RECORDED PAYMENT",tx["id"])

def record_expense(s,problem_id,amount,currency,note,receipt_file=None):
    tx=record_transaction(s,"OUTFLOW",problem_id,amount,currency,note,receipt_file)
    if problem_id and problem_id in s.problem_ids():
        holder=s.problem(problem_id).get("current_holder")
        if holder:
            add_event(s,holder,"REAL_EXPENSE",problem_id,{
              "transaction_id":tx["id"],"amount":float(amount),
              "currency":currency.upper(),"note":note
            })
    print("RECORDED EXPENSE",tx["id"])

def main():
    ap=argparse.ArgumentParser()
    sub=ap.add_subparsers(dest="cmd",required=True)

    sub.add_parser("list-requests")

    a=sub.add_parser("approve")
    a.add_argument("request_id")
    a.add_argument("--capability-id",required=True)
    a.add_argument("--profile-file",required=True)
    a.add_argument("--reason",default="approved")

    r=sub.add_parser("reject")
    r.add_argument("request_id")
    r.add_argument("--reason",required=True)

    p=sub.add_parser("record-payment")
    p.add_argument("--problem",required=True)
    p.add_argument("--amount",type=float,required=True)
    p.add_argument("--currency",default="CNY")
    p.add_argument("--note",default="")
    p.add_argument("--receipt-file")

    e=sub.add_parser("record-expense")
    e.add_argument("--problem")
    e.add_argument("--amount",type=float,required=True)
    e.add_argument("--currency",default="CNY")
    e.add_argument("--note",default="")
    e.add_argument("--receipt-file")

    args=ap.parse_args()
    s=Storage(".")
    s.ensure_v4_defaults()

    if args.cmd=="list-requests":
        list_requests(s)
    elif args.cmd=="approve":
        approve(s,args.request_id,args.capability_id,args.profile_file,args.reason)
    elif args.cmd=="reject":
        reject(s,args.request_id,args.reason)
    elif args.cmd=="record-payment":
        record_payment(s,args.problem,args.amount,args.currency,args.note,args.receipt_file)
    elif args.cmd=="record-expense":
        record_expense(s,args.problem,args.amount,args.currency,args.note,args.receipt_file)

if __name__=="__main__":
    main()
