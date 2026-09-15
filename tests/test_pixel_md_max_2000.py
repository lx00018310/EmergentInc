import pytest
from emergentinc.engine.pixel import validate_pixel_md, MAX_PIXEL_MD_CHARS, PixelStorage


def test_pixel_md_length_limit(tmp_path):
    storage = PixelStorage(tmp_path)

    # 1. 2000 字符以内应成功
    valid_content = "A" * MAX_PIXEL_MD_CHARS
    ok, err = validate_pixel_md(valid_content)
    assert ok is True
    assert err is None
    assert storage.save_pixel_md(valid_content) is True
    assert len(storage.load_pixel_md()) == MAX_PIXEL_MD_CHARS

    # 2. 超过 2000 字符应失败
    invalid_content = "A" * (MAX_PIXEL_MD_CHARS + 1)
    ok, err = validate_pixel_md(invalid_content)
    assert ok is False
    assert "PIXEL_MD_TOO_LONG" in err
    assert storage.save_pixel_md(invalid_content) is False
    # 仍保留旧内容
    assert len(storage.load_pixel_md()) == MAX_PIXEL_MD_CHARS
