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


class MessageRouter:
    """局部消息路由器，处理路由合法性与队列流转."""

    def __init__(self, world: World):
        self.world = world
        self.queue: List[MessageEnvelope] = []
        self.delayed_queue: List[MessageEnvelope] = []
        self.processed_count: int = 0

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
            if self.processed_count + len(self.queue) >= MAX_MESSAGES_PER_ROUND:
                self.delayed_queue.append(m)
            else:
                self.queue.append(m)

    def pop_next(self) -> Optional[MessageEnvelope]:
        if not self.queue:
            return None
        self.processed_count += 1
        return self.queue.pop(0)

    def roll_to_next_round(self):
        """回合结束切换，延期队列移入主队列，重置计数器."""
        self.queue.extend(self.delayed_queue)
        self.delayed_queue.clear()
        self.processed_count = 0
