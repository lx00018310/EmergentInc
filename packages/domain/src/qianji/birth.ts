import { randomBytes } from "node:crypto";

// A trigram's first, second and third lines occupy bits 0, 1 and 2.
const TRIGRAMS = ["地", "雷", "水", "泽", "山", "火", "风", "天"] as const;
const NAMES: Record<string, string> = {
  "天:天": "乾", "天:泽": "履", "天:火": "同人", "天:雷": "无妄", "天:风": "姤", "天:水": "讼", "天:山": "遁", "天:地": "否",
  "泽:天": "夬", "泽:泽": "兑", "泽:火": "革", "泽:雷": "随", "泽:风": "大过", "泽:水": "困", "泽:山": "咸", "泽:地": "萃",
  "火:天": "大有", "火:泽": "睽", "火:火": "离", "火:雷": "噬嗑", "火:风": "鼎", "火:水": "未济", "火:山": "旅", "火:地": "晋",
  "雷:天": "大壮", "雷:泽": "归妹", "雷:火": "丰", "雷:雷": "震", "雷:风": "恒", "雷:水": "解", "雷:山": "小过", "雷:地": "豫",
  "风:天": "小畜", "风:泽": "中孚", "风:火": "家人", "风:雷": "益", "风:风": "巽", "风:水": "涣", "风:山": "渐", "风:地": "观",
  "水:天": "需", "水:泽": "节", "水:火": "既济", "水:雷": "屯", "水:风": "井", "水:水": "坎", "水:山": "蹇", "水:地": "比",
  "山:天": "大畜", "山:泽": "损", "山:火": "贲", "山:雷": "颐", "山:风": "蛊", "山:水": "蒙", "山:山": "艮", "山:地": "剥",
  "地:天": "泰", "地:泽": "临", "地:火": "明夷", "地:雷": "复", "地:风": "升", "地:水": "师", "地:山": "谦", "地:地": "坤",
};
const TENSION = [
  "先留意周围的承受与容纳，再决定是否向前推进",
  "面对停滞时可能倾向启动变化，也会顾及变化带来的震荡",
  "遇到不明朗的局面，可能先辨认风险与深处的线索",
  "在表达与交换之间寻找入口，同时留意共识的边界",
  "更容易看见止步和蓄势的时机，却也可能错过眼前的窗口",
  "看见明确线索时愿意靠近，但会衡量照亮之后的代价",
  "倾向从细微处寻找可进入的路径，并留心方向是否偏移",
  "面对阻力可能选择主动开路，同时需要衡量持续的力量",
];

export interface DerivedBirth {
  birthSeed: string;
  birthAlgorithmVersion: 1;
  primaryHexagram: string;
  movingLine: number;
  changedHexagram: string;
  birthText: string;
  primaryBits: number;
  changedBits: number;
}

export function createBirthSeed(): string {
  return (process.hrtime.bigint() ^ randomBytes(8).readBigUInt64LE()).toString();
}

function hexagram(bits: number): string {
  const lower = TRIGRAMS[bits & 7];
  const upper = TRIGRAMS[(bits >> 3) & 7];
  return `${upper}${lower}${NAMES[`${upper}:${lower}`]}`;
}

export function deriveBirthIdentity(seedText: string): DerivedBirth {
  if (!/^\d+$/.test(seedText)) throw new Error("BIRTH_SEED_INVALID");
  const seed = BigInt(seedText);
  const primaryBits = Number(seed & 63n);
  const movingLine = Number((seed >> 6n) % 6n) + 1;
  const changedBits = primaryBits ^ (1 << (movingLine - 1));
  const primaryHexagram = hexagram(primaryBits);
  const changedHexagram = hexagram(changedBits);
  const birthText = `从${primaryHexagram}走向${changedHexagram}，转折落在第${movingLine}爻。面对尚未定形的事情，或会${TENSION[(primaryBits >> 3) & 7]}；另一种选择也始终存在。究竟如何取舍，仍要由之后的相遇、行动和结果慢慢写成。`;
  return { birthSeed: seedText, birthAlgorithmVersion: 1, primaryHexagram, movingLine,
    changedHexagram, birthText, primaryBits, changedBits };
}
