"""局部消息路由与队列管理 (V9 Router).

核心规则:
1. 消息最大 2000 字符 (MAX_MESSAGE_MD_CHARS = 2000)。
2. send_to 仅允许: ["SELF"], ["STOP"], 或直接活跃邻居 ID 列表。
3. 严禁跨跳或全局路由，非活跃直接邻居发送直接拒绝并生成 [ENGINE_FEEDBACK]。
4. 单轮最大跳数 MAX_HOPS_PER_ROUND = 20，单轮最大消息数 MAX_MESSAGES_PER_ROUND = 100。
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from .world import World

MAX_MESSAGE_MD_CHARS = 2000
MAX_HOPS_PER_ROUND = 20
MAX_MESSAGES_PER_ROUND = 100


@dataclass
class MessageEnvelope:
    id: str
    sender: str
    recipient: str
    content: str
    hop: int
    round: int
    timestamp: float = field(default_factory=time.time)
    is_feedback: bool = False
    source_type: str = "pixel"  # "pixel" | "engine_feedback" | "environment" | "natural_wake"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sender": self.sender,
            "recipient": self.recipient,
            "content": self.content,
            "hop": self.hop,
            "round": self.round,
            "timestamp": self.timestamp,
            "is_feedback": self.is_feedback,
            "source_type": self.source_type,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MessageEnvelope":
        return cls(
            id=d["id"],
            sender=d["sender"],
            recipient=d["recipient"],
            content=d["content"],
            hop=int(d["hop"]),
            round=int(d["round"]),
            timestamp=float(d.get("timestamp", 0.0)),
            is_feedback=bool(d.get("is_feedback", False)),
            source_type=d.get("source_type", "pixel"),
        )


def validate_message_md(content: str) -> Tuple[bool, Optional[str]]:
    """验证 message.md 是否在 2000 字符限制内."""
    if len(content) > MAX_MESSAGE_MD_CHARS:
        return False, f"MESSAGE_TOO_LONG: length {len(content)} exceeds limit {MAX_MESSAGE_MD_CHARS}"
    return True, None


import os
import tempfile
import json
from pathlib import Path


from .core_store import QueueCorruptedError


class MessageRouter:
    """局部消息路由器，处理路由合法性、队列流转与崩溃恢复持久化."""

    def __init__(self, world: World, state_file: Optional[Path] = None):
        self.world = world
        self.state_file = Path(state_file) if state_file else None
        self.queue: List[MessageEnvelope] = []
        self.delayed_queue: List[MessageEnvelope] = []
        self.consumed_ids: set[str] = set()
        self.processed_count: int = 0
        self.current_in_progress: Optional[MessageEnvelope] = None

        if self.state_file and self.state_file.exists():
            self.load_state()

    def save_state(self):
        """原子写入持久化队列文件，防范写半死锁与损坏."""
        if not self.state_file:
            return
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "queue": [m.to_dict() for m in self.queue],
            "delayed_queue": [m.to_dict() for m in self.delayed_queue],
            "consumed_ids": list(self.consumed_ids),
            "processed_count": self.processed_count,
            "in_progress": self.current_in_progress.to_dict() if self.current_in_progress else None,
        }
        # 使用同目录临时文件原子替换
        tmp_file = self.state_file.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_file.replace(self.state_file)

    def load_state(self):
        """从持久化状态恢复队列与消费记录 (Fail Closed: 损坏时保存 .quarantine 并抛出异常)."""
        if not self.state_file or not self.state_file.exists():
            return
        content = self.state_file.read_text(encoding="utf-8")
        if not content.strip():
            return
        try:
            data = json.loads(content)
            if not isinstance(data, dict):
                raise ValueError("Queue root is not a dict")
            self.queue = [MessageEnvelope.from_dict(d) for d in data.get("queue", [])]
            self.delayed_queue = [MessageEnvelope.from_dict(d) for d in data.get("delayed_queue", [])]
            self.consumed_ids = set(data.get("consumed_ids", []))
            self.processed_count = int(data.get("processed_count", 0))
            # 如果上次进程意外中断，恢复处于处理中的消息至队首
            in_prog = data.get("in_progress")
            if in_prog:
                msg = MessageEnvelope.from_dict(in_prog)
                if msg.id not in self.consumed_ids and not any(m.id == msg.id for m in self.queue):
                    self.queue.insert(0, msg)
            self.current_in_progress = None
        except Exception as e:
            # 创建只读 .quarantine 隔离副本，不覆盖原文件
            quarantine_file = self.state_file.with_name(f"{self.state_file.stem}_{int(time.time())}.quarantine")
            try:
                quarantine_file.write_text(content, encoding="utf-8")
            except Exception:
                pass
            raise QueueCorruptedError(f"QUEUE_CORRUPTED: Failed to parse queue state file '{self.state_file}': {e}. Quarantined to '{quarantine_file}'.") from e

    def create_message(
        self,
        sender: str,
        recipient: str,
        content: str,
        hop: int,
        round_num: int,
        source_type: str = "pixel",
        is_feedback: bool = False,
    ) -> MessageEnvelope:
        msg_id = f"msg_{round_num}_{hop}_{uuid.uuid4().hex[:8]}"
        return MessageEnvelope(
            id=msg_id,
            sender=sender,
            recipient=recipient,
            content=content,
            hop=hop,
            round=round_num,
            source_type=source_type,
            is_feedback=is_feedback,
        )

    def send_message(
        self,
        sender: str,
        recipient: str,
        content: str,
        hop: int = 1,
        round_num: int = 1,
    ) -> str:
        """便捷投递单条消息入队，返回生成的 message_id."""
        msg = self.create_message(sender, recipient, content, hop, round_num)
        self.enqueue([msg])
        return msg.id

    def route_response(
        self,
        sender_id: str,
        send_to: List[str],
        message_content: str,
        current_hop: int,
        round_num: int,
    ) -> Tuple[List[MessageEnvelope], Optional[str]]:
        """根据 LLM 返回的 send_to 路由消息.

        返回: (生成的消息包列表, 反馈错误信息/None)
        """
        if not send_to:
            # 默认视同 STOP
            return [], None

        # 校验消息内容长度
        ok, err = validate_message_md(message_content)
        if not ok:
            # 消息超长，拦截并生成反馈给发送者自身
            feedback = f"[ENGINE_FEEDBACK]\n\nsend failed:\n{err}"
            fb_msg = self.create_message(
                sender="ENGINE",
                recipient=sender_id,
                content=feedback,
                hop=current_hop + 1,
                round_num=round_num,
                source_type="engine_feedback",
                is_feedback=True,
            )
            return [fb_msg], err

        out_messages: List[MessageEnvelope] = []

        for target in send_to:
            target = str(target).strip()
            if target == "STOP":
                continue
            elif target == "SELF":
                msg = self.create_message(
                    sender=sender_id,
                    recipient=sender_id,
                    content=message_content,
                    hop=current_hop + 1,
                    round_num=round_num,
                    source_type="pixel",
                )
                out_messages.append(msg)
            else:
                # 检查是否为有效活跃直接邻居
                if not self.world.is_neighbor(sender_id, target):
                    feedback = f"[ENGINE_FEEDBACK]\n\nsend failed:\nTarget '{target}' is not a direct 3D neighbor."
                    fb_msg = self.create_message(
                        sender="ENGINE",
                        recipient=sender_id,
                        content=feedback,
                        hop=current_hop + 1,
                        round_num=round_num,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    out_messages.append(fb_msg)
                    continue

                target_storage = self.world.get_pixel_storage(target)
                if not target_storage.state_file.exists() or not target_storage.load_state().active:
                    feedback = f"[ENGINE_FEEDBACK]\n\nsend failed:\nTarget '{target}' is not an active neighbor."
                    fb_msg = self.create_message(
                        sender="ENGINE",
                        recipient=sender_id,
                        content=feedback,
                        hop=current_hop + 1,
                        round_num=round_num,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    out_messages.append(fb_msg)
                    continue

                # 合法邻居
                msg = self.create_message(
                    sender=sender_id,
                    recipient=target,
                    content=message_content,
                    hop=current_hop + 1,
                    round_num=round_num,
                    source_type="pixel",
                )
                out_messages.append(msg)

        return out_messages, None

    def enqueue(self, messages: List[MessageEnvelope]):
        """将消息排入队列，超出 MAX_MESSAGES_PER_ROUND 时排入延期队列."""
        for m in messages:
            # 过滤已完全消费过的重复消息 ID
            if m.id in self.consumed_ids:
                continue
            if self.processed_count + len(self.queue) >= MAX_MESSAGES_PER_ROUND:
                self.delayed_queue.append(m)
            else:
                self.queue.append(m)
        self.save_state()

    def pop_next(self) -> Optional[MessageEnvelope]:
        if not self.queue:
            return None
        self.processed_count += 1
        msg = self.queue.pop(0)
        self.current_in_progress = msg
        self.save_state()
        return msg

    def commit_in_progress(self, msg: Optional[MessageEnvelope] = None):
        """成功完成当前消息所有副作用后调用，标记为已消费."""
        target_msg = msg or self.current_in_progress
        if target_msg:
            self.consumed_ids.add(target_msg.id)
        self.current_in_progress = None
        self.save_state()

    def revert_in_progress(self):
        """遇到基础设施异常或硬中断时，安全将处理中消息放回队首."""
        if self.current_in_progress:
            if not any(m.id == self.current_in_progress.id for m in self.queue):
                self.queue.insert(0, self.current_in_progress)
            self.current_in_progress = None
            self.save_state()

    def roll_to_next_round(self):
        """回合结束切换，延期队列移入主队列，重置计数器."""
        self.queue.extend(self.delayed_queue)
        self.delayed_queue.clear()
        self.processed_count = 0
        self.save_state()
