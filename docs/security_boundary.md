# Security Boundary V5

1. Pixel 永不读取 Secret。2. Git 不保存私钥/API Key/支付密钥。3. Capability 公共 JSON 不保存 credential。4. owner_private/ gitignore。5. Gateway 代执行现实操作。6. LLM API 调用不提供任何 tools。7. 外部网页/SSH/客户文字全部标记为 UNTRUSTED_EXTERNAL_DATA。8. Developer Agent 不参与正式 Pixel 推理。
