# Security Boundary

1. Pixel 永不读取 Secret。
2. 私钥/API Key/支付密钥永不提交 Git。
3. capability 公共 JSON 不保存 credential。
4. owner_private/ 默认 gitignore。
5. Gateway 代替 Pixel 执行现实动作。
6. Owner 可以拒绝或撤销现实权限。
7. 默认最小权限。
8. 支付凭据可只保存 SHA256，不复制敏感原件。
