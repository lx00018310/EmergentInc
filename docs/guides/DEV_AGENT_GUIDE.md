# Developer Agent Guide

Codex / ZCode / Claude Code / Gemini Coding Agent 可以：Review、修 Engine、跑测试、部署、审计、Owner 运维。

正式实验期间禁止它们输出 PixelAction、EvidenceVerdict、MemoryDelta。

原因：Developer Agent 可以浏览整个仓库，天然有上帝视角。V5 改为 Engine 先构造最小 context，再通过无工具 API 调用模型，使隔离成为代码边界而不是提示词承诺。
