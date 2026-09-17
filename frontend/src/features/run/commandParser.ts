/**
 * 运行命令解析器
 * 解析前端控制台输入的指令，返回对应的动作及参数
 */

export type ParsedCommand =
  | { action: 'RUN'; rounds: number; raw: string }
  | { action: 'STOP'; raw: string }
  | { action: 'UNKNOWN'; raw: string };

/**
 * 解析用户输入的命令文本
 * 
 * 规则：
 * 1. 空命令：默认推进 1 轮
 * 2. 中文格式："跑10轮"、"跑 5 轮"、"跑3"、"5轮"
 * 3. 英文格式："run 5"、"run 10"（不区分大小写）
 * 4. 纯数字："5"、"10" -> 推进对应轮数
 * 5. 停止命令："停止"、"stop"（不区分大小写）
 * 6. 其他任何输入：返回 UNKNOWN，不应触发启动
 */
export function parseCommand(raw: string): ParsedCommand {
  const text = (raw || '').trim();
  if (!text) {
    return { action: 'RUN', rounds: 1, raw: '' };
  }

  // 停止命令判定
  if (text === '停止' || text.toLowerCase() === 'stop') {
    return { action: 'STOP', raw: text };
  }

  // 中文推进语法：跑 N 轮、跑 N
  const runMatchCn = text.match(/^跑\s*(\d+)\s*轮?$/i);
  if (runMatchCn && runMatchCn[1]) {
    const rounds = parseInt(runMatchCn[1], 10);
    return { action: 'RUN', rounds: rounds > 0 ? rounds : 1, raw: text };
  }

  // 英文推进语法：run N
  const runMatchEn = text.match(/^run\s*(\d+)$/i);
  if (runMatchEn && runMatchEn[1]) {
    const rounds = parseInt(runMatchEn[1], 10);
    return { action: 'RUN', rounds: rounds > 0 ? rounds : 1, raw: text };
  }

  // 纯数字或带“轮”字后缀：5、5轮、5 轮
  const roundOnly = text.match(/^(\d+)\s*轮?$/i);
  if (roundOnly && roundOnly[1]) {
    const rounds = parseInt(roundOnly[1], 10);
    return { action: 'RUN', rounds: rounds > 0 ? rounds : 1, raw: text };
  }

  return { action: 'UNKNOWN', raw: text };
}
