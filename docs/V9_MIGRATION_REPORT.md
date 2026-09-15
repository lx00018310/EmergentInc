# EmergentInc V9 — 架构迁移报告 (V9 Migration Report)

## 1. 迁移概述
根据 V9 商业元胞自动机架构规范，系统从 V8 的混合认知架构迁移为严格的纯局部元胞架构。所有中心化或多文件复杂预设已被彻底剥离。

## 2. 废除与迁移机制清单

| V8 旧文件 / 机制 | V9 处理方案 | 迁移说明 |
| :--- | :--- | :--- |
| `pixels/<id>/self.md` | 废除并合并 | 提取内容合并入 `pixel.md` |
| `pixels/<id>/memory.md` & `memory.json` | 废除并合并 | 提取内容合并入 `pixel.md`，删除冗余 json |
| `pixels/<id>/public.md` | 废除并合并 | 提取内容合并入 `pixel.md` |
| `pixels/<id>/inheritance.md` | 废除并合并 | 提取内容合并入 `pixel.md` |
| `pixels/<id>/genome.json` & `genome.md` | 彻底删除 | V9 彻底去除任何预定义基因组/角色偏好 |
| `pixels/<id>/inbox.md` & `state.md` | 彻底删除 | 消息改由 Engine 队列与信封流转，状态收敛至 `state.json` |
| `pixels/<id>/workspace/` | 物理隔离归档 | 重命名移动至 `pixels/<id>/legacy_v8_workspace/`，脱离运行时 |
| `live/market/` & `live/problems/` | 彻底废除 | 外部需求与目标收敛至单文件 `environment.md` |
| 固定虚拟代谢费 / 虚拟调用费 | 彻底废除 | 仅按实际调用 token 消耗及工具使用扣除真实预算 |

## 3. 元胞目录结构对比

### 迁移前 (V8)
```text
pixels/0_0_0/
├── genome.json
├── genome.md
├── history.md
├── inbox.md
├── llm_log.md
├── memory.json
├── memory.md
├── state.json
├── state.md
└── workspace/
```

### 迁移后 (V9)
```text
pixels/0_0_0/
├── state.json                     # 纯机器物理参数
├── pixel.md                       # 唯一心智历史 (<=2000字)
└── legacy_v8_workspace/           # 归档的历史工作区 (不参与 V9 运行)
```

## 4. 迁移脚本与执行验证
提供了全自动迁移模块：
- `emergentinc/engine/migration.py`
- `emergentinc/cli/migrate_v9.py`

执行结果：
- 成功对已有工作区 `workspace/live` 下的元胞（`0_0_0`, `1_0_0`）完成状态净化与心智合并。
- 旧 `workspace` 归档为 `legacy_v8_workspace`。
- 自动生成了单文件 `environment.md`。
