# World Rules v0.2

1. 每个整数三维坐标最多一个 Pixel。
2. Pixel 出生后坐标永久固定。
3. Pixel 只能直接感知 6 邻域。
4. Pixel 同时最多持有一个 Problem。
5. 任意 active Pixel 或 Environment 可创建 Problem。
6. Problem 只能逐邻居传播。
7. 需要选择的商业行为必须由 Pixel LLM 决策。
8. Problem 只有通过独立验收才 CLOSED。
9. Resource 由行为消耗，并沿闭合价值链反向结算。
10. Spawn 只能在邻接空位生成“父代 + 单次微变异”后代。
11. active Pixel 必须承担持续生存成本。
12. 长期 Resource 不足的 Pixel 死亡。
13. 世界引擎不得通过全局信息替局部 Pixel 优化。
14. 决策顺序每轮打乱，禁止固定坐标先手优势。
15. 所有 LLM 决策、Evidence 和 Resource 流必须可审计。
