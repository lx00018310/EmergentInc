from pathlib import Path
from typing import Dict, Any, Optional, List, Union
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.storage import Storage
from emergentinc.cli import owner
from .world_reader import WorldReader
from .run_controller import RunController
from .loop_store import LoopStore
from .owner_bridge import OwnerBridge

# Models for request validation
class RunStartRequest(BaseModel):
    rounds: int = 1
    command: str = ""
    run_budget_tokens: int = Field(..., gt=0, description="Run budget in tokens, must be positive integer")
    global_budget_tokens: int = Field(..., gt=0, description="Global budget in tokens, must be positive integer")

class GenesisPromptUpdateRequest(BaseModel):
    content: str

class BranchRequest(BaseModel):
    branch_name: str

class CheckoutRequest(BaseModel):
    branch_name: Optional[str] = None

class ApproveRequest(BaseModel):
    profile_file: Optional[str] = None
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

def init_api(base_dir: Optional[Union[str, Path, ProjectPaths]] = None) -> APIRouter:
    if isinstance(base_dir, ProjectPaths):
        paths = base_dir
    else:
        paths = get_paths(base_dir)
    router = APIRouter(prefix="/api")
    storage = Storage(paths)
    world_reader = WorldReader(paths)
    loop_store = LoopStore(paths)
    run_controller = RunController(paths)
    owner_bridge = OwnerBridge(paths)

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
            return run_controller.start(
                rounds=req.rounds,
                command_text=req.command,
                run_budget_tokens=req.run_budget_tokens,
                global_budget_tokens=req.global_budget_tokens,
            )
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

    @router.get("/environment")
    def get_environment():
        return {"content": world_reader.env.read_content()}

    @router.post("/environment")
    def update_environment(req: Dict[str, Any] = Body(...)):
        content = req.get("content", "")
        world_reader.env.update_content(content)
        return {"status": "UPDATED", "length": len(content)}

    @router.post("/revenue/credit")
    def credit_revenue(req: Dict[str, Any] = Body(...)):
        from emergentinc.engine.energy import EnergyManager
        pixel_id = req.get("pixel_id")
        net_amount = float(req.get("net_amount", 0.0))
        tx_id = str(req.get("tx_id", "")).strip()
        if not pixel_id or net_amount <= 0 or not tx_id:
            raise HTTPException(status_code=400, detail="Invalid revenue credit parameters")

        ledger_file = paths.workspace_root / "ledger" / "energy_ledger.jsonl"
        mgr = EnergyManager(ledger_file)
        storage_p = world_reader.world.get_pixel_storage(pixel_id)
        if not storage_p.state_file.exists():
            raise HTTPException(status_code=404, detail="Pixel not found")

        res = mgr.credit_external_revenue(storage_p, net_amount, tx_id, req.get("details"))
        if not res.ok:
            if res.status == "CONFLICT_TX_MISMATCH":
                raise HTTPException(status_code=409, detail=f"Transaction '{tx_id}' exists with different parameters")
            raise HTTPException(status_code=400, detail=res.status)
        return {"status": res.status, "pixel_id": pixel_id, "tokens_added": res.tokens}

    @router.post("/revenue/refund")
    def refund_revenue(req: Dict[str, Any] = Body(...)):
        from emergentinc.engine.energy import EnergyManager
        pixel_id = req.get("pixel_id")
        tx_id = str(req.get("tx_id", "")).strip()
        refund_amount = req.get("refund_amount")
        if refund_amount is not None:
            refund_amount = float(refund_amount)
        reason = str(req.get("reason", "manual refund"))
        if not pixel_id or not tx_id:
            raise HTTPException(status_code=400, detail="Missing pixel_id or tx_id")

        ledger_file = paths.workspace_root / "ledger" / "energy_ledger.jsonl"
        mgr = EnergyManager(ledger_file)
        storage_p = world_reader.world.get_pixel_storage(pixel_id)
        if not storage_p.state_file.exists():
            raise HTTPException(status_code=404, detail="Pixel not found")

        ok, tokens_deducted, err = mgr.refund_external_revenue(storage_p, tx_id, refund_amount, reason)
        if not ok:
            raise HTTPException(status_code=400, detail=err or "Refund failed")
        return {"status": "REFUNDED", "pixel_id": pixel_id, "tokens_deducted": tokens_deducted, "tx_id": tx_id}

    @router.get("/pixels/{pixel_id}")
    def get_pixel(pixel_id: str):
        storage_p = world_reader.world.get_pixel_storage(pixel_id)
        if not storage_p.state_file.exists():
            raise HTTPException(status_code=404, detail="Pixel not found")
        return {
            "id": pixel_id,
            "state": storage_p.load_state().to_dict(),
            "pixel_md": storage_p.load_pixel_md()
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

    @router.get("/pixels/{pixel_id}/artifacts")
    def list_pixel_artifacts(pixel_id: str):
        try:
            items = world_reader.list_pixel_artifacts(pixel_id)
            return {"pixel_id": pixel_id, "artifacts": items}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/pixels/{pixel_id}/artifacts/{filename}")
    def get_pixel_artifact(pixel_id: str, filename: str):
        try:
            content = world_reader.get_pixel_artifact(pixel_id, filename)
            return {"pixel_id": pixel_id, "filename": filename, "content": content}
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

    from emergentinc.engine.genesis import GenesisPromptManager
    genesis_mgr = GenesisPromptManager(paths.runtime_root)

    @router.get("/genesis-prompt")
    def get_genesis_prompt():
        return genesis_mgr.get_prompt()

    @router.put("/genesis-prompt")
    def update_genesis_prompt(req: GenesisPromptUpdateRequest):
        if run_controller.status()['running']:
            raise HTTPException(status_code=409, detail="Cannot update genesis prompt while run is in progress.")
        if not isinstance(req.content, str):
            raise HTTPException(status_code=422, detail="Genesis prompt content must be a string.")
        try:
            return genesis_mgr.update_prompt(req.content)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/audit/workspace")
    def get_workspace_audit():
        from emergentinc.engine.audit import audit_workspace
        # Audit only a quiescent workspace. Holding the controller lock prevents
        # a new Run from starting between the status check and file/DB reads.
        with run_controller.lock:
            run_status = run_controller.status()
            if run_status.get("running"):
                return {"audit_status": "DEFERRED_RUNNING", "allowed_to_start": False,
                        "recovery_required": False, "block_reasons": ["RUN_IN_PROGRESS"]}
            rep = audit_workspace(paths.workspace_root, run_id=run_status.get("current_loop"))
            return rep.to_dict()

    return router
