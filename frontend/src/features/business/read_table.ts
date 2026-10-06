import { t as tr } from '../../i18n';
/** Parse quoted CSV without running formulas or silently accepting malformed records. */
export function readTable(text: string, filename: string): Record<string, unknown>[] {
  if (filename.toLowerCase().endsWith('.json')) {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error((tr("JSON 资料需要是表格行数组。")));
    return rows;
  }
  const source = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === '"' && value === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { if (c === '\r' && source[i + 1] === '\n') i++; records.push(row); row = []; }
    } else {
      if (closed || c === '"') throw new Error((tr("CSV 引号格式不正确，请重新导出为 UTF-8 CSV。")));
      value += c;
    }
  }
  if (quoted) throw new Error((tr("CSV 存在未闭合的引号。")));
  if (value || row.length || closed) { row.push(value); records.push(row); }
  const headers = records.shift()?.map(h => h.trim());
  if (!headers?.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error((tr("CSV 第一行需要非空且不重复的列名。")));
  return records.filter(r => !(r.length === 1 && r[0] === '')).map((r, i) => {
    if (r.length !== headers.length) throw new Error(tr("CSV 第 {0} 行的列数与表头不一致。", [i + 2]));
    return Object.fromEntries(headers.map((h, j) => {
      const cell = r[j]!;
      // Preserve leading zero identifiers, long account numbers and formulas as text.
      const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cell) && cell.replace(/\D/g, '').length <= 12;
      return [h, numeric ? Number(cell) : cell];
    }));
  });
}
