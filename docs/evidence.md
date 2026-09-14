# Evidence v0.2

核心：

```text
No Evidence → No Completion
```

强度：
1. REAL_WORLD
2. TOOL_VERIFIED
3. INDEPENDENT_PIXEL_VERIFIED
4. CREATOR_VERIFIED
5. SELF_CLAIM

默认 SELF_CLAIM 不能 CLOSED。

禁止：
- “阶段1完成”
- “已生成验证数据”
- evidence_progress += 1
- 随机数达到阈值

Validator 输出：
```text
PASS
FAIL
INSUFFICIENT
```
