/**
 * Unicode 码点计算与校验工具
 * 
 * 严格与 Python 的 `len(str)` 保持一致，统计 Unicode 码点数而非 UTF-16 代码单元数。
 */

export const MAX_PIXEL_MD_CODE_POINTS = 2000;
export const MAX_MESSAGE_MD_CODE_POINTS = 2000;
export const MAX_GENESIS_PROMPT_CODE_POINTS = 12000;

/**
 * 计算字符串的 Unicode 码点数量 (等价于 Python len(str))
 */
export function getUnicodeLength(str: string): number {
  if (!str) return 0;
  let count = 0;
  // JavaScript 的 for...of 遍历的是 UTF-32 / Unicode 码点，代理对会被作为一个完整码点处理
  for (const _ of str) {
    count++;
  }
  return count;
}

/**
 * 校验心智文件字符长度 (<= 2000 码点)
 */
export function isValidPixelMdLength(content: string): boolean {
  return getUnicodeLength(content) <= MAX_PIXEL_MD_CODE_POINTS;
}

/**
 * 校验消息内容字符长度 (<= 2000 码点)
 */
export function isValidMessageMdLength(content: string): boolean {
  return getUnicodeLength(content) <= MAX_MESSAGE_MD_CODE_POINTS;
}
