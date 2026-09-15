# API Runtime V5

正式实验唯一 LLM Runtime 是 api_sandbox。每一次推理都是新的 OpenAI-compatible API 请求，不带工具、不带历史线程。环境变量：MCL_API_KEY / MCL_BASE_URL / MCL_MODEL，或分别 MCL_DECISION_MODEL / MCL_VALIDATOR_MODEL / MCL_MEMORY_MODEL。API 失败必须 FAIL FAST，无 agent/random/heuristic fallback。
