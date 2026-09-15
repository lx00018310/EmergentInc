import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional
from .utils import neighbors6, coord_to_id
from .workspace_jail import WorkspaceJail
from .market import MarketService

class ActionExecutor:
    def __init__(self, storage, validator, ledger, spawn, capability=None, market=None):
        self.s = storage
        self.v = validator
        self.ledger = ledger
        self.spawn = spawn
        self.capability = capability
        self.market = market or MarketService(self.s, self.ledger)
        self.jail = WorkspaceJail(self.s)

    def execute(self, pixel_id: str, decision: Dict[str, Any], round_num: int, local_view: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        act = decision.get("action")
        if act != "REPRODUCE":
            cost = self.v.action_cost(act)
            self.ledger.charge_action(pixel_id, cost)

        result = {
            "status": "APPLIED",
            "action": act,
            "success": True,
            "events": []
        }

        # Update last active round
        st = self.s.pixel_state(pixel_id)
        st["last_active_round"] = round_num
        self.s.save_pixel_state(pixel_id, st)

        # 1. WAIT
        if act == "WAIT":
            w_params = decision.get("wait") or decision
            wake_after = int(w_params.get("wake_after", 1))
            st = self.s.pixel_state(pixel_id)
            st["sleep_until_round"] = round_num + max(1, wake_after)
            self.s.save_pixel_state(pixel_id, st)
            result["events"].append(f"pixel sleeping until round {st['sleep_until_round']}")
            return result

        # 2. ASK_OWNER
        elif act == "ASK_OWNER":
            req_params = decision.get("owner_request") or decision
            rid = self.s.next_external_request_id()
            req = {
                "id": rid,
                "requester": pixel_id,
                "capability_type": req_params.get("needed_resource", "PHYSICAL_RESOURCE"),
                "purpose": req_params.get("question", req_params.get("purpose", "")),
                "requested_operations": req_params.get("requested_operations", []),
                "estimated_external_cost": req_params.get("estimated_cost", {}),
                "created_round": round_num,
                "status": "PENDING"
            }
            self.s.save_external_request(req)
            result.update({
                "external_request_id": rid,
                "owner_action_required": True,
                "owner_request": req
            })
            result["events"].append(f"owner request {rid} submitted: {req['purpose']}")
            return result

        # 3. MESSAGE
        elif act == "MESSAGE":
            msg_params = decision.get("message") or decision
            target = msg_params.get("to") or msg_params.get("target_pixel")
            content = msg_params.get("content", "")
            energy_xfer = float(msg_params.get("energy", 0.0) or 0.0)
            attachments = msg_params.get("attachments", []) or []

            # Check neighbor constraint
            if target not in neighbors6(pixel_id):
                raise ValueError(f"Target {target} is not a 6-neighbor of {pixel_id}")

            # Check target existence
            if target not in self.s.pixel_ids():
                raise ValueError(f"Target pixel {target} does not exist")

            # Transfer energy if requested
            if energy_xfer > 0:
                ok, msg = self.ledger.transfer_energy(pixel_id, target, energy_xfer)
                if not ok:
                    raise ValueError(f"Energy transfer failed: {msg}")
                result["events"].append(f"energy transfer: {energy_xfer} -> {target}")

            # Snapshot attachments into receiver inbox
            copied_attachments = []
            receiver_attach_dir = self.s.live / f"pixels/{target}/inbox/attachments"
            receiver_attach_dir.mkdir(parents=True, exist_ok=True)
            sender_ws = self.jail.get_workspace_dir(pixel_id)

            msg_id = f"MSG_{round_num}_{self.s.world().get('round', 0)}"
            for att in attachments:
                src_path = (sender_ws / att).resolve()
                if src_path.exists() and src_path.is_file():
                    safe_name = f"{msg_id}_{src_path.name}"
                    dst_path = receiver_attach_dir / safe_name
                    shutil.copyfile(str(src_path), str(dst_path))
                    copied_attachments.append(safe_name)

            # Deliver message JSON to receiver inbox
            msg_record = {
                "id": msg_id,
                "from": pixel_id,
                "to": target,
                "round": round_num,
                "content": content,
                "energy": energy_xfer,
                "attachments": copied_attachments
            }
            mid = self.s.save_inbox_message(target, msg_record)
            result["events"].append(f"message {mid} delivered to {target}")
            result["message_id"] = mid
            return result

        # 4. REPRODUCE
        elif act == "REPRODUCE":
            rep_params = decision.get("reproduce") or decision
            target_pos = rep_params.get("target")
            if isinstance(target_pos, str):
                from .utils import id_to_coord
                target_pos = id_to_coord(target_pos)
            energy_to_child = float(rep_params.get("energy_to_child", 40.0))
            inheritance = rep_params.get("inheritance", "")
            child_info = self.spawn.spawn_v8(pixel_id, target_pos, energy_to_child, inheritance, round_num)
            result.update({
                "child": child_info,
                "significant_event": "REPRODUCTION"
            })
            result["events"].append(f"spawned child {child_info['child_id']} with {energy_to_child} energy")
            return result

        # 5. WORK
        elif act == "WORK":
            work_params = decision.get("work") or decision
            ops = work_params.get("operations")
            if not ops and "tool" in work_params:
                ops = [{"tool": work_params["tool"], "args": work_params.get("args", {})}]
            if not ops:
                ops = []

            # Cap at 3 operations per turn
            executed_ops = []
            for op in ops[:3]:
                tool_name = op.get("tool")
                args = op.get("args", {})
                op_res = self._execute_tool(pixel_id, tool_name, args, round_num)
                executed_ops.append(op_res)
                if op_res.get("success"):
                    result["events"].append(f"{tool_name}: {op_res.get('summary', 'OK')}")
                else:
                    result["events"].append(f"{tool_name} FAILED: {op_res.get('error')}")

            if not executed_ops:
                result["events"].append("WORK_NO_EFFECT")

            result["operations_result"] = executed_ops
            return result

        # Legacy actions fallback for backward compatibility
        elif act == "IDLE":
            result["events"].append("idle")
            return result

        else:
            result["events"].append(f"unknown action {act}")
            return result

    def _execute_tool(self, pixel_id: str, tool_name: str, args: Dict[str, Any], round_num: int) -> Dict[str, Any]:
        try:
            if tool_name == "READ_SELF_FILE":
                content = self.jail.read_self_file(pixel_id, args.get("file_name", ""))
                return {"tool": tool_name, "success": True, "content": content, "summary": f"Read {args.get('file_name')}"}

            elif tool_name == "WRITE_SELF_FILE":
                self.jail.write_self_file(pixel_id, args.get("file_name", ""), args.get("content", ""))
                return {"tool": tool_name, "success": True, "summary": f"Wrote {args.get('file_name')}"}

            elif tool_name == "DELETE_SELF_FILE":
                deleted = self.jail.delete_self_file(pixel_id, args.get("file_name", ""))
                return {"tool": tool_name, "success": True, "deleted": deleted, "summary": f"Deleted {args.get('file_name')}"}

            elif tool_name == "LIST_WORKSPACE":
                entries = self.jail.list_workspace(pixel_id, args.get("rel_path", ""))
                return {"tool": tool_name, "success": True, "entries": entries, "summary": f"Listed {len(entries)} items"}

            elif tool_name == "READ_WORKSPACE_FILE":
                content = self.jail.read_workspace_file(pixel_id, args.get("rel_path", ""))
                return {"tool": tool_name, "success": True, "content": content, "summary": f"Read {args.get('rel_path')}"}

            elif tool_name == "WRITE_WORKSPACE_FILE":
                self.jail.write_workspace_file(pixel_id, args.get("rel_path", ""), args.get("content", ""))
                return {"tool": tool_name, "success": True, "summary": f"Wrote {args.get('rel_path')}"}

            elif tool_name == "DELETE_WORKSPACE_FILE":
                deleted = self.jail.delete_workspace_file(pixel_id, args.get("rel_path", ""))
                return {"tool": tool_name, "success": True, "deleted": deleted, "summary": f"Deleted {args.get('rel_path')}"}

            elif tool_name == "MOVE_WORKSPACE_FILE":
                self.jail.move_workspace_file(pixel_id, args.get("src_rel", ""), args.get("dst_rel", ""))
                return {"tool": tool_name, "success": True, "summary": f"Moved {args.get('src_rel')} to {args.get('dst_rel')}"}

            elif tool_name == "RUN_WORKSPACE_COMMAND":
                cmd_res = self.jail.run_workspace_command(pixel_id, args.get("command", ""))
                return {"tool": tool_name, "success": cmd_res["exit_code"] == 0, **cmd_res, "summary": f"Executed command (exit {cmd_res['exit_code']})"}

            elif tool_name == "READ_MARKET":
                opps = self.market.list_open_opportunities()
                return {"tool": tool_name, "success": True, "opportunities": opps, "summary": f"Found {len(opps)} open opportunities"}

            elif tool_name == "CLAIM_MARKET_OPPORTUNITY":
                res = self.market.claim_opportunity(pixel_id, args.get("opportunity_id", ""))
                return {"tool": tool_name, **res, "summary": res.get("message", "Claimed")}

            elif tool_name == "SUBMIT_MARKET_RESULT":
                res = self.market.submit_result(
                    pixel_id=pixel_id,
                    mid=args.get("opportunity_id", ""),
                    summary=args.get("summary", ""),
                    artifacts=args.get("artifacts", []),
                    verified_external=args.get("verified_external", False)
                )
                return {"tool": tool_name, **res, "summary": res.get("message", "Submitted")}

            elif tool_name == "READ_INBOX":
                msgs = self.s.inbox_messages(pixel_id)
                return {"tool": tool_name, "success": True, "messages": msgs, "summary": f"Read {len(msgs)} inbox messages"}

            elif tool_name == "USE_CAPABILITY":
                if self.capability:
                    tool_res = self.capability.use(pixel_id, args.get("problem_id"), round_num, args)
                    return {"tool": tool_name, "success": True, **tool_res, "summary": "Used capability"}
                return {"tool": tool_name, "success": False, "error": "Capability gateway not available"}

            else:
                return {"tool": tool_name, "success": False, "error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"tool": tool_name, "success": False, "error": str(e)}
