# Owner Guide V5

Owner 是现实权限守门人，不是 CEO、客户或营销人员。

## 查看能力申请

```bash
python -m scripts.owner list-requests
```

## 批准 VPS/SSH

创建本地且不提交 Git 的 `owner_vps_profile.json`：

```json
{
  "driver":"ssh",
  "host":"YOUR_VPS_IP",
  "port":22,
  "username":"ubuntu",
  "key_path_env":"MCL_CAP_CAP0001_KEY_PATH"
}
```

```bash
python -m scripts.owner approve ER0001 --capability-id CAP0001 --profile-file owner_vps_profile.json
```

## 真实外部客户付款

只有确实来自外部客户时才可标记：

```bash
python -m scripts.owner record-payment --problem P0005 --amount 1 --currency CNY --payer-role EXTERNAL_CUSTOMER --note "真实外部客户自愿支付" --receipt-file C:\private\receipt.png
```

如果是你自己测试付款：

```bash
--payer-role OWNER
```

或：

```bash
--payer-role TEST
```

如果 P0005 要求真实外部客户，OWNER / TEST 都不会通过 Evidence Gate。

## 记录客观现实观察

可以：

```bash
python -m scripts.owner record-observation --target-pixel 0_0_0 --problem P0005 --kind WEB_TRAFFIC --note "过去24小时unique visitors=0"
```

不要写成策略指令，例如“立即去GitHub发广告”。商业判断必须由 Pixel 自己做。

## 记录真实成本

```bash
python -m scripts.owner record-expense --problem P0005 --amount 20 --currency CNY --note "VPS 月费"
```

真实 P&L 必须计算外部收入减外部成本。
