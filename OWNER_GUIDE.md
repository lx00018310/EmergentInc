# Owner / 老板操作指南

Owner 只负责现实世界权限，不负责商业策略。

## 查看 Pixel 的现实能力申请

```bash
python -m scripts.owner list-requests
```

---

## 批准 VPS / SSH

先在本地创建（不要提交 Git）：

`owner_vps_profile.json`

```json
{
  "driver": "ssh",
  "host": "YOUR_VPS_IP",
  "port": 22,
  "username": "ubuntu",
  "key_path_env": "MCL_CAP_CAP0001_KEY_PATH",
  "public_metadata": {
    "description": "Linux VPS"
  }
}
```

批准：

```bash
python -m scripts.owner approve ER0001 --capability-id CAP0001 --profile-file owner_vps_profile.json
```

然后只在本机设置私钥路径：

```bash
set MCL_CAP_CAP0001_KEY_PATH=C:\private\id_ed25519
```

私钥本身不会进入 Pixel 或 Git。

---

## 拒绝

```bash
python -m scripts.owner reject ER0001 --reason "成本过高"
```

---

## 真实收款

真实用户确实支付后：

```bash
python -m scripts.owner record-payment ^
  --problem P0005 ^
  --amount 1 ^
  --currency CNY ^
  --note "真实用户自愿支付" ^
  --receipt-file C:\private\receipt.png
```

系统会：
- 写 external transaction
- 保存 receipt SHA256
- 给 P0005 注入 HUMAN_VERIFIED Evidence
- 产生 REAL_PAYMENT event
- 唤醒持有 P0005 的 Pixel

---

## 真实成本

例如 VPS 花费 ¥20：

```bash
python -m scripts.owner record-expense ^
  --problem P0005 ^
  --amount 20 ^
  --currency CNY ^
  --note "VPS 月费"
```

V4 会分别统计真实 Revenue、Cost 和 P&L。
