# Resource

V3 仍只保留一种底层 Resource。

### 成本
- maintenance：所有 active Pixel 每轮必付
- WORK / BID / OFFER / TRANSFER / CREATE_PROBLEM / SPAWN：额外动作成本
- Spawn 还要支付 child birth grant

### Environment Reward
来自外部，不计为系统内部创造。

### Pixel-created child Problem
创建者必须立即 escrow `reward_offer`，避免无担保承诺。

### Transfer Contract
Problem 沿路线转交时，用未来 reward 做局部合约：

```text
Environment reward 100
A → B contract 30
B → C contract 10

close 后:
A 70
B 20
C 10
```

### Death
Resource <= 0 后进入有限 grace；grace 用完则 active=0。
