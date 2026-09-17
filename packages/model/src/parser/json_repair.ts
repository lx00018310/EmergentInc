/**
 * 确定性 JSON 括号补全修复工具 (复刻 Python repair_missing_json_closers)
 * 
 * 仅闭合结构上强制缺失的 `]` 或 `}`，绝不发明任何新键值、引号或逗号。
 */
export function repairMissingJsonClosers(raw: string): string | null {
  const matchingOpen: Record<string, string> = { "}": "{", "]": "[" };
  const matchingClose: Record<string, string> = { "{": "}", "[": "]" };
  const stack: string[] = [];
  const output: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inString) {
      output.push(char);
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output.push(char);
    } else if (matchingClose[char]) {
      stack.push(char);
      output.push(char);
    } else if (matchingOpen[char]) {
      const required = matchingOpen[char];
      if (!stack.includes(required)) {
        return null;
      }
      while (stack.length > 0 && stack[stack.length - 1] !== required) {
        const top = stack.pop()!;
        output.push(matchingClose[top]);
      }
      stack.pop();
      output.push(char);
    } else {
      output.push(char);
    }
  }

  if (inString) {
    return null;
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    output.push(matchingClose[top]);
  }

  const repaired = output.join("");
  return repaired !== raw ? repaired : null;
}

export function parseJsonWithRepair(raw: string): { data: any; repaired: boolean } {
  try {
    return { data: JSON.parse(raw), repaired: false };
  } catch (originalErr) {
    const repaired = repairMissingJsonClosers(raw);
    if (repaired !== null) {
      try {
        return { data: JSON.parse(repaired), repaired: true };
      } catch {
        // 修复后仍无法解析，抛出原始异常
      }
    }
    throw originalErr;
  }
}
