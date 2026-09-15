# Real Money V5

Resource 与真实货币严格分离。真实交易写入 external_transactions，并带 payer_role。

如果 Problem 要求真实外部客户，只有 payer_role=EXTERNAL_CUSTOMER 的合格 INFLOW 才能满足硬门槛。Owner 自付和测试支付只能用于支付链路测试，不能证明商业闭环。
