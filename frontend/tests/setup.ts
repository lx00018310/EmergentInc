import { beforeEach } from 'vitest';
// Existing regression tests exercise the Chinese UI explicitly. V24 default-language tests opt out.
beforeEach(() => { localStorage.setItem('emergentinc.language', 'zh-CN'); });
