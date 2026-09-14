# Problem

Problem = `Current State → Desired State`。

Problem 不是“执行某个动作”的 Task。

核心字段：

```text
id
status
creator
current_holder
parent_problem
current_state
desired_state
acceptance
reward_offer
reward_source
route
contracts
offers
bids
evidence
```

## 可见性

Pixel 只能看见：
- 自己持有的 Problem
- Environment 明确 offer 给自己的 Problem
- 相邻 holder 向自己公开 OFFER 的 Problem
- 相邻 holder 向自己发出的 TRANSFER
- 自己当前 Problem 收到的邻居 BID

禁止 `all_open_problems` 直接进入 Local View。
