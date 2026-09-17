import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/features/run/commandParser';

describe('commandParser', () => {
  it('空输入解析为默认推进 1 轮', () => {
    expect(parseCommand('')).toEqual({ action: 'RUN', rounds: 1, raw: '' });
    expect(parseCommand('   ')).toEqual({ action: 'RUN', rounds: 1, raw: '' });
  });

  it('正确解析中文推进命令', () => {
    expect(parseCommand('跑1轮')).toEqual({ action: 'RUN', rounds: 1, raw: '跑1轮' });
    expect(parseCommand('跑 5 轮')).toEqual({ action: 'RUN', rounds: 5, raw: '跑 5 轮' });
    expect(parseCommand('跑10轮')).toEqual({ action: 'RUN', rounds: 10, raw: '跑10轮' });
    expect(parseCommand('跑3')).toEqual({ action: 'RUN', rounds: 3, raw: '跑3' });
    expect(parseCommand('5轮')).toEqual({ action: 'RUN', rounds: 5, raw: '5轮' });
    expect(parseCommand('10 轮')).toEqual({ action: 'RUN', rounds: 10, raw: '10 轮' });
  });

  it('正确解析英文推进命令', () => {
    expect(parseCommand('run 1')).toEqual({ action: 'RUN', rounds: 1, raw: 'run 1' });
    expect(parseCommand('run 5')).toEqual({ action: 'RUN', rounds: 5, raw: 'run 5' });
    expect(parseCommand('RUN 10')).toEqual({ action: 'RUN', rounds: 10, raw: 'RUN 10' });
    expect(parseCommand('run  20')).toEqual({ action: 'RUN', rounds: 20, raw: 'run  20' });
  });

  it('正确解析纯数字输入', () => {
    expect(parseCommand('1')).toEqual({ action: 'RUN', rounds: 1, raw: '1' });
    expect(parseCommand('5')).toEqual({ action: 'RUN', rounds: 5, raw: '5' });
    expect(parseCommand('10')).toEqual({ action: 'RUN', rounds: 10, raw: '10' });
  });

  it('正确解析停止命令', () => {
    expect(parseCommand('停止')).toEqual({ action: 'STOP', raw: '停止' });
    expect(parseCommand('stop')).toEqual({ action: 'STOP', raw: 'stop' });
    expect(parseCommand('STOP')).toEqual({ action: 'STOP', raw: 'STOP' });
    expect(parseCommand(' Stop ')).toEqual({ action: 'STOP', raw: 'Stop' });
  });

  it('未知命令返回 UNKNOWN', () => {
    expect(parseCommand('hello')).toEqual({ action: 'UNKNOWN', raw: 'hello' });
    expect(parseCommand('启动')).toEqual({ action: 'UNKNOWN', raw: '启动' });
    expect(parseCommand('跑负数 -1')).toEqual({ action: 'UNKNOWN', raw: '跑负数 -1' });
    expect(parseCommand('跑几轮')).toEqual({ action: 'UNKNOWN', raw: '跑几轮' });
  });
});
