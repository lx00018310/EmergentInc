import { createHash } from "node:crypto";
import { GACHA_ATTRIBUTE_KEYS, QianjiDraw, QianjiNarrativeSpec } from "@emergentinc/protocol";
import { topGachaAttributes } from "./gacha.js";

const STYLE = "Neo-Chinese fantasy with restrained holographic details, ink-wash full-body character portrait, cinematic lighting, detailed fabric and props";
const COLORS: Record<string, [string, string]> = {
  谋: ["玄青", "deep azure black"], 察: ["银白", "silver white"], 决: ["赤红", "crimson red"],
  行: ["赭金", "ochre gold"], 言: ["紫", "violet"], 创: ["青绿", "jade green"],
  韧: ["墨黑", "ink black"], 学: ["月白", "moon white"],
};
const ATTIRE: Record<string, string> = {
  军师: "羽纹长袍", 跑商: "行旅锦衣", 工匠: "机巧工装", 说客: "礼纹广袖", 账房: "素色算师袍",
  斥候: "轻甲斗篷", 医官: "药纹白袍", 司晨: "星历祭服",
};
const PROPS: Record<string, string> = {
  谋: "羽扇与棋盘", 察: "千里镜", 决: "赤印令牌", 行: "行军卷轴", 言: "玉简与惊堂木",
  创: "机关匣", 韧: "旧剑与灯", 学: "算筹书卷",
};
const MOTIFS: Record<string, string> = {
  谋察: "棋局星图", 谋决: "兵书赤印", 谋行: "行军沙盘", 谋言: "帷幕盟约", 谋创: "星轨机关", 谋韧: "残棋长夜", 谋学: "古卷天枢",
  察决: "夜镜断碑", 察行: "风铃驿道", 察言: "听雨密谈", 察创: "镜湖幻匣", 察韧: "雪地足迹", 察学: "藏书镜台",
  决行: "战旗疾风", 决言: "惊堂木与远方商队", 决创: "烈焰机关阵", 决韧: "断桥铁誓", 决学: "朱批兵书",
  行言: "商路铜铃", 行创: "工坊飞梭", 行韧: "栈道与孤灯", 行学: "远行书箱",
  言创: "百戏机关台", 言韧: "暮鼓誓词", 言学: "辩经书院",
  创韧: "荒原新芽", 创学: "书山与机关鸟", 韧学: "寒窗长灯",
};
const EXPRESSIONS: Record<string, string> = {
  谋: "略显迟疑，仍努力梳理思路", 察: "目光缓慢追随线索", 决: "眉头微蹙，反复掂量手中物", 行: "姿态尚未起身",
  言: "欲言又止，手指轻叩", 创: "谨慎观察旧有章法", 韧: "疲惫却仍站立", 学: "面对书卷若有所思",
};
const FRAMES: Record<string, string> = {
  N: "无边框素卡", R: "铜边卡", SR: "银边流光卡", SSR: "金边星屑环绕卡",
};

export function buildGachaPrompt(draw: QianjiDraw, narrative: QianjiNarrativeSpec, revision: number) {
  const [highest, second] = topGachaAttributes(draw.attributes);
  const pair = GACHA_ATTRIBUTE_KEYS.filter(key => key === highest || key === second).join("");
  const motif = MOTIFS[pair];
  if (!motif) throw new Error(`GACHA_MOTIF_MISSING:${pair}`);
  const lowest = [...GACHA_ATTRIBUTE_KEYS].sort((a, b) => draw.attributes[a] - draw.attributes[b])[0]!;
  const expression = draw.attributes[lowest] <= 0.6 ? EXPRESSIONS[lowest] : `眼神带有${highest}的锋芒`;
  const attire = ATTIRE[narrative.roleLabel ?? ""] ?? "新中式长袍";
  const experience = (narrative.shortBio ?? "初入天机阁").replace(/\s+/g, " ").slice(0, 250);
  const appearance = (narrative.appearanceSpec ?? "成年的古风人物").replace(/\s+/g, " ").slice(0, 500);
  const personality = (narrative.behaviorProfile[0] ?? narrative.flaw ?? "").replace(/\s+/g, " ").slice(0, 150);
  const [colorChinese, colorEnglish] = COLORS[highest];
  const chinese = `竖版单人全身人物卡，${narrative.displayName}${narrative.title ? `·${narrative.title}` : ""}，身份为${narrative.roleLabel ?? "千机"}。` +
    `人物外观：${appearance}；服饰参考${attire}，若与人物外观冲突，以人物外观为准。` +
    `动作与神情：手持${PROPS[highest]}，${expression}${personality ? `，体现${personality}` : ""}。` +
    `独有经历：${experience}。视觉主题：${highest}与${second}交织成${motif}，${lowest}的短板以克制的细节表现；${draw.traitTags.join("、") || "尚在成长"}。` +
    `场景为暗色天机阁，${colorChinese}主色，${FRAMES[draw.rarity]}。主体完整可见，面部清晰，背景不抢人物。` +
    `画布严格为竖版宽高比9:16，目标分辨率1080x1920像素。画面内不要文字、数字、Logo、水印、界面或第二个人。`;
  const english = `${STYLE}; unique appearance: ${appearance}; role: ${narrative.roleLabel ?? "Qianji"}; prop: ${PROPS[highest]}; scene motif: ${motif}; color palette: ${colorEnglish}; full body, face visible, one person, no text or watermark; vertical aspect ratio 9:16, target resolution 1080x1920 pixels, --ar 9:16`;
  const prompt = `${chinese}\n\n${english}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 2, qianjiId: draw.qianjiId,
    seed: draw.seed, revision, prompt })).digest("hex");
  return { prompt, fingerprint, version: 2, motif };
}

export function gachaMotifCount(): number { return Object.keys(MOTIFS).length; }
