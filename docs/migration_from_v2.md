# 从 V2_TEST_001 到 V3

V2_TEST_001 建议保留为历史里程碑，不直接原地覆盖。

V3 重要变化：

- Markdown state → JSON canonical state
- 单 Round 写死 Runner → 动态多 Round
- 单 Pixel → 动态扫描
- 手工 visible_problems → VisibilityService
- `current_holder` 字符串替换 → Problem JSON 更新
- Evidence strength 自报 → Engine-origin evidence
- Round 1 demo → 连续世界
