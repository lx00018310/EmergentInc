import { GACHA_ATTRIBUTE_KEYS, GachaAttributes, GachaChannel, GachaRarity, QianjiNarrativeSpec } from "@emergentinc/protocol";

const SURNAMES = ["顾", "沈", "谢", "陆", "闻", "宁", "苏", "萧"];
const GIVEN = ["观星", "无咎", "知微", "明烛", "玄策", "长庚", "见山", "听澜"];
const ROLES = ["军师", "跑商", "工匠", "说客", "账房", "斥候", "医官", "司晨"];
const PAST = ["边城行商", "山中学徒", "旧书楼守卷人", "远道旅人"];
const NOW = ["于千机阁重寻方向", "在观星台领命", "为新纪元效力", "从一张空白命书开始"];
const FACE = ["清瘦的青年", "眉眼凌厉的青年", "面容温和的中年人", "神情沉稳的中年人",
  "带风霜痕迹的旅人", "眼角有细纹的学者", "轮廓分明的青年", "面容冷峻的成年人"];
const HAIR = ["乌发高束", "银灰长发半束", "短发以铜簪固定", "长发编入细辫",
  "墨发披肩", "发髻插木簪", "黑发束成低马尾", "额前垂一缕白发"];
const MARK = ["左眉有浅疤", "腕上系旧红绳", "戴单片青玉耳坠", "肩披磨旧的短斗篷",
  "袖口绣星轨", "指节留有墨痕", "腰间悬铜铃", "颈边有一枚墨色小痣"];
const POSE = ["侧身回望", "俯身检视手中物", "立于风中抬眼", "倚栏沉思",
  "向前迈步", "双手拢袖静立", "抬手指向远处", "坐在灯下低头思索"];

function seededChoice<T>(values: T[], seed: number, shift: number): T {
  return values[(seed >>> shift) % values.length]!;
}

export function randomQianjiNarrative(seed: number, role?: string): QianjiNarrativeSpec {
  return { displayName: seededChoice(SURNAMES, seed, 0) + seededChoice(GIVEN, seed, 3),
    title: null, roleLabel: role ?? seededChoice(ROLES, seed, 6), traits: {}, behaviorProfile: [],
    flaw: null, shortBio: `曾是${seededChoice(PAST, seed, 9)}，如今${seededChoice(NOW, seed, 12)}。`,
    appearanceSpec: `${seededChoice(FACE, seed, 15)}，${seededChoice(HAIR, seed, 18)}，${seededChoice(MARK, seed, 21)}，${seededChoice(POSE, seed, 24)}`,
    portraitAsset: null, contentRevision: null };
}

export interface RolledGacha {
  algorithmVersion: 1;
  seed: number;
  channel: GachaChannel;
  pityBefore: number | null;
  guaranteed: boolean;
  attributes: GachaAttributes;
  rarity: GachaRarity;
  traitTags: string[];
}

const SUM_RANGES: Record<GachaRarity, [number, number]> = {
  N: [72, 83], R: [88, 107], SR: [112, 131], SSR: [136, 148],
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function rarityFromAttributes(attributes: GachaAttributes): GachaRarity {
  const sum = GACHA_ATTRIBUTE_KEYS.reduce((total, key) => total + Math.round(attributes[key] * 10), 0);
  if (sum >= 132) return "SSR";
  if (sum >= 108) return "SR";
  if (sum >= 84) return "R";
  return "N";
}

export function topGachaAttributes(attributes: GachaAttributes): [typeof GACHA_ATTRIBUTE_KEYS[number], typeof GACHA_ATTRIBUTE_KEYS[number]] {
  const sorted = [...GACHA_ATTRIBUTE_KEYS].sort((a, b) => attributes[b] - attributes[a]);
  return [sorted[0]!, sorted[1]!];
}

export function rollGacha(seed: number, channel: GachaChannel, pityBefore: number | null = null): RolledGacha {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("GACHA_SEED_INVALID");
  if (channel === "owner" ? !Number.isSafeInteger(pityBefore) || pityBefore! < 0 || pityBefore! > 9 : pityBefore !== null) {
    throw new Error("GACHA_PITY_INVALID");
  }
  const random = seededRandom(seed);
  const tierRoll = random();
  const natural: GachaRarity = tierRoll < 0.35 ? "N" : tierRoll < 0.8 ? "R" : tierRoll < 0.95 ? "SR" : "SSR";
  const guaranteed = channel === "owner" && pityBefore === 9 && (natural === "N" || natural === "R");
  const rarity: GachaRarity = guaranteed ? "SR" : natural;
  const [minimum, maximum] = SUM_RANGES[rarity];
  const targetSum = minimum + Math.floor(random() * (maximum - minimum + 1));
  const targetMean = targetSum / 80;
  const scores = GACHA_ATTRIBUTE_KEYS.map(() => Math.max(5, Math.min(20, Math.round((targetMean + 0.28 * normal(random)) * 10))));
  const order = GACHA_ATTRIBUTE_KEYS.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  let remainder = targetSum - scores.reduce((total, score) => total + score, 0);
  while (remainder !== 0) {
    for (const index of order) {
      if (remainder === 0) break;
      const direction = Math.sign(remainder);
      const next = scores[index]! + direction;
      if (next >= 5 && next <= 20) {
        scores[index] = next;
        remainder -= direction;
      }
    }
  }
  const attributes = Object.fromEntries(GACHA_ATTRIBUTE_KEYS.map((key, index) => [key, scores[index]! / 10])) as GachaAttributes;
  const traitTags = GACHA_ATTRIBUTE_KEYS.flatMap(key => attributes[key] >= 1.8 ? [`天赋·${key}`] : attributes[key] <= 0.6 ? [`短板·${key}`] : []);
  return { algorithmVersion: 1, seed, channel, pityBefore, guaranteed, attributes, rarity, traitTags };
}

export function nextGachaPity(previous: number, rarity: GachaRarity): number {
  if (!Number.isSafeInteger(previous) || previous < 0 || previous > 9) throw new Error("GACHA_PITY_INVALID");
  return rarity === "SR" || rarity === "SSR" ? 0 : previous + 1;
}
