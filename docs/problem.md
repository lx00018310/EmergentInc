# Problem v0.2

Problem 是：

```text
Current State → Desired State
```

不是 Task。

必须字段：

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
created_round
deadline_round
route
contracts
evidence
```

## 可见性

只有：
1. 当前 Holder
2. Holder 主动 OFFER 后的直接邻居
3. Environment 指定入口 Pixel
4. 子 Problem creator 与其直接邻居

禁止全局自动可见。

## 拆解

Pixel 可以 CREATE_PROBLEM 产生子问题，但不能同时亲自持有两个 Problem。

## Competition

邻居可以 BID。
由 Holder 的 LLM 决定接受谁。
引擎不得使用最低价、第一个、坐标最小等规则自动选择。
