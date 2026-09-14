# World Rules V3

1. 每个整数三维坐标最多一个 Pixel。
2. Pixel 出生后不能移动。
3. 直接邻域固定为 6-neighborhood。
4. Pixel 同时最多持有一个 Problem。
5. Environment 与任意 active Pixel 都可以创造 Problem。
6. Problem 不能全局广播，只能通过环境入口、邻接 OFFER、TRANSFER、子 Problem 局部传播。
7. 需要选择的商业行为由 Pixel LLM 决策。
8. RuleValidator 只能判定动作是否合法。
9. active Pixel 每轮支付 maintenance。
10. WORK 必须产生非空结构化产物。
11. Pixel 产生的工作只能被引擎标为 `MODEL_ARTIFACT`，不能自封真实证据。
12. REQUEST_CLOSE 必须通过 Evidence Gate。
13. Resource 在 Problem 闭合后按 reward/contract 反向结算。
14. Spawn 只能进入邻接空格，且子代仅发生一次微变异。
15. 决策顺序每轮 seeded shuffle。
16. 模型失败 Fail Fast。
17. 世界状态以 JSON 为机器真值。
18. Markdown 仅作人类观察，不允许作为状态解析源。
