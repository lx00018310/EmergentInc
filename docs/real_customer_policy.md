# Real Customer Policy

Problem 可声明 real_world_policy: require_external_customer=true, min_inflow=1.0, currency=CNY。Evidence Gate 会在 LLM Validator 前硬校验真实 INFLOW、金额、币种与 payer_role=EXTERNAL_CUSTOMER。Owner 自己扫码、测试转账和模型自述都不能完成闭环。
