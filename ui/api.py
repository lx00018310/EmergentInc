from pathlib import Path
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel

from scripts.storage import Storage
from scripts import owner
from .world_reader import WorldReader
from .run_controller import RunController
from .loop_store import LoopStore
from .owner_bridge import OwnerBridge

router = APIRouter(prefix="/api")

# Models for request validation
class RunStartRequest(BaseModel):
    rounds: int = 1
    command: str = ""

class BranchRequest(BaseModel):
    branch_name: str

class CheckoutRequest(BaseModel):
    branch_name: Optional[str] = None

class ApproveRequest(BaseModel):
    profile_file: str
    capability_id: Optional[str] = None
    reason: str = "approved"

class RejectRequest(BaseModel):
    reason: str = "rejected"

class EnvironmentProblemRequest(BaseModel):
    description: str
    current_state: str = ""
    desired_state: str = ""
    acceptance_criteria: List[str] = []
    reward_budget: float = 0.0

class EnvironmentEventRequest(BaseModel):
    target_pixel: str
    problem_id: Optional[str] = None
    kind: str
    note: str

def init_api(base_dir: str | Path = '.') -> APIRouter:
    base = Path(base_dir)
    storage = Storage(str(base))
    world_reader = WorldReader(base)
    loop_store = LoopStore(base)
    run_controller = RunController(base)
    owner_bridge = OwnerBridge(base)

    @router.get("/world")
    def get_world():
        try:
            return world_reader.get_world_dto()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/run/status")
    def get_run_status():
        return run_controller.status()

    @router.post("/run/start")
    def start_run(req: RunStartRequest):
        try:
            return run_controller.start(rounds=req.rounds, command_text=req.command)
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/run/stop")
    def stop_run():
        return run_controller.request_stop()

    @router.get("/loops")
    def list_loops():
        return {
            "loops": loop_store.list_loops(),
            "branches": loop_store.list_branches(),
            "manifest": loop_store.get_manifest()
        }

    @router.post("/loops/{loop_id}/checkout")
    def checkout_loop(loop_id: str, req: CheckoutRequest = Body(default=CheckoutRequest())):
        if run_controller.status()['running']:
            raise HTTPException(status_code=409, detail="Cannot checkout while running.")
        try:
            return loop_store.checkout_loop(loop_id, new_branch_name=req.branch_name)
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/loops/{loop_id}/branch")
    def branch_loop(loop_id: str, req: BranchRequest):
        if run_controller.status()['running']:
            raise HTTPException(status_code=409, detail="Cannot branch while running.")
        try:
            return loop_store.branch_from(loop_id, branch_name=req.branch_name)
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/loops/{loop_id}")
    def delete_loop(loop_id: str):
        if run_controller.status()['running']:
            raise HTTPException(status_code=409, detail="Cannot delete loop while running.")
        try:
            loop_store.delete_loop(loop_id)
            return {"status": "DELETED", "loop_id": loop_id}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/branches/{branch_name}")
    def delete_branch(branch_name: str):
        if run_controller.status()['running']:
            raise HTTPException(status_code=409, detail="Cannot delete branch while running.")
        try:
            loop_store.delete_branch(branch_name)
            return {"status": "DELETED", "branch": branch_name}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/pixels/{pixel_id}")
    def get_pixel(pixel_id: str):
        if pixel_id not in storage.pixel_ids():
            raise HTTPException(status_code=404, detail="Pixel not found")
        return {
            "id": pixel_id,
            "state": storage.pixel_state(pixel_id),
            "genome": storage.pixel_genome(pixel_id),
            "memory": storage.pixel_memory(pixel_id)
        }

    @router.get("/pixels/{pixel_id}/document/{doc_name}")
    def get_pixel_document(pixel_id: str, doc_name: str):
        try:
            content = world_reader.get_pixel_document(pixel_id, doc_name)
            return {"pixel_id": pixel_id, "document": doc_name, "content": content}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/owner/requests")
    def get_owner_requests():
        return owner_bridge.list_requests(pending_only=False)

    @router.post("/owner/requests/{request_id}/approve")
    def approve_owner_request(request_id: str, req: ApproveRequest):
        try:
            return owner_bridge.approve_request(
                request_id=request_id,
                capability_id=req.capability_id,
                profile_file=req.profile_file,
                reason=req.reason
            )
        except (RuntimeError, ValueError, FileNotFoundError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/owner/requests/{request_id}/reject")
    def reject_owner_request(request_id: str, req: RejectRequest):
        try:
            return owner_bridge.reject_request(
                request_id=request_id,
                reason=req.reason
            )
        except (RuntimeError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/environment/problem")
    def create_environment_problem(req: EnvironmentProblemRequest):
        try:
            storage.ensure_v5_defaults()
            pid = storage.next_problem_id()
            rn = int(storage.world().get('round', 0))
            p = {
                "id": pid,
                "status": "OPEN",
                "creator": "ENVIRONMENT_OWNER",
                "current_holder": None,
                "created_round": rn,
                "description": req.description,
                "current_state": req.current_state,
                "desired_state": req.desired_state,
                "acceptance_criteria": req.acceptance_criteria,
                "reward_budget": float(req.reward_budget),
                "evidence": [],
                "history": []
            }
            storage.save_problem(p)
            w = storage.world()
            w['counters']['problems_created'] += 1
            storage.save_world(w)
            return {"status": "CREATED", "problem": p}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/environment/event")
    def create_environment_event(req: EnvironmentEventRequest):
        try:
            storage.ensure_v5_defaults()
            owner.record_observation(
                storage,
                target_pixel=req.target_pixel,
                problem_id=req.problem_id,
                kind=req.kind,
                note=req.note
            )
            return {"status": "RECORDED", "target_pixel": req.target_pixel}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
