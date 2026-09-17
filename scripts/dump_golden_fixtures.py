#!/usr/bin/env python3
"""导出 V9.14 Golden Fixtures 用于 V10 Small Runtime 等价性验证与基线比对."""

import os
import json
import sqlite3
import hashlib
import sys
from pathlib import Path

# 项目根路径
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
FIXTURES_DIR = ROOT_DIR / "tests" / "fixtures" / "golden"
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

# 1. 导出 12 项工具的规范清单
from emergentinc.tools.registry_manifest import BUILTIN_SPECS

tools_data = []
for spec in BUILTIN_SPECS:
    tools_data.append({
        "name": spec.name,
        "description": spec.description,
        "input_schema": spec.input_schema,
        "effect": spec.effect,
        "timeout_seconds": spec.timeout_seconds,
        "enabled": spec.enabled
    })

tools_manifest_file = FIXTURES_DIR / "tools_manifest.json"
tools_manifest_file.write_text(json.dumps(tools_data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Exported tools manifest ({len(tools_data)} tools) to {tools_manifest_file}")

# 2. 导出 SQLite DDL 结构
from emergentinc.engine.core_store import CoreStore
import tempfile

with tempfile.TemporaryDirectory() as tmpdir:
    tmp_db = Path(tmpdir) / "test_schema.sqlite3"
    store = CoreStore(tmp_db)
    with store.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name;")
        tables = [row[0] for row in cursor.fetchall()]
        schema_sql = "\n\n".join(tables) + "\n"

schema_file = FIXTURES_DIR / "core_store_schema.sql"
schema_file.write_text(schema_sql, encoding="utf-8")
print(f"Exported CoreStore SQLite DDL to {schema_file}")

# 3. 导出模型定价与世界配置基准
pricing_src = ROOT_DIR / "resources" / "config" / "model_pricing.json"
if pricing_src.exists():
    pricing_dst = FIXTURES_DIR / "model_pricing.json"
    pricing_dst.write_text(pricing_src.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Exported model pricing to {pricing_dst}")

world_config_src = ROOT_DIR / "resources" / "config" / "world_config.json"
if world_config_src.exists():
    world_config_dst = FIXTURES_DIR / "world_config.json"
    world_config_dst.write_text(world_config_src.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Exported world config to {world_config_dst}")

# 4. 生成 Unicode 码点长度边界测试向量 (Python len(str) 码点计数)
unicode_vectors = {
    "ascii_exact_2000": "a" * 2000,
    "ascii_2001": "a" * 2001,
    "chinese_exact_2000": "元" * 2000,
    "chinese_2001": "元" * 2001,
    # 复杂 emoji 包含代理对和组合，验证码点数量
    "emoji_surrogate_samples": [
        {"char": "😀", "python_len": len("😀"), "utf16_units": 2},
        {"char": "👨‍👩‍👧‍👦", "python_len": len("👨‍👩‍👧‍👦"), "utf16_units": 11},
    ],
    "boundary_test": {
        "text_1999_mixed": ("测" * 1000) + ("a" * 999),
        "text_1999_len": len(("测" * 1000) + ("a" * 999)),
        "text_2000_mixed": ("测" * 1000) + ("a" * 1000),
        "text_2000_len": len(("测" * 1000) + ("a" * 1000)),
        "text_2001_mixed": ("测" * 1000) + ("a" * 1001),
        "text_2001_len": len(("测" * 1000) + ("a" * 1001)),
    }
}
unicode_file = FIXTURES_DIR / "unicode_length_vector.json"
unicode_file.write_text(json.dumps(unicode_vectors, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Exported Unicode length test vectors to {unicode_file}")

# 5. 提示词哈希固定向量
from emergentinc.engine.genesis import INITIAL_GENESIS_PROMPT
sample_text = INITIAL_GENESIS_PROMPT.replace("\r\n", "\n").replace("\r", "\n")
hash_vectors = {
    "genesis_initial_content": sample_text,
    "genesis_initial_sha256": hashlib.sha256(sample_text.encode("utf-8")).hexdigest(),
    "empty_string_sha256": hashlib.sha256("".encode("utf-8")).hexdigest(),
    "test_message_sha256": hashlib.sha256("Hello, EmergentInc V10!".encode("utf-8")).hexdigest(),
}
hash_file = FIXTURES_DIR / "prompt_hash_vector.json"
hash_file.write_text(json.dumps(hash_vectors, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Exported prompt hash vectors to {hash_file}")

print("\nPhase 0 Golden Fixtures export complete.")
