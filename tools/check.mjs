import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mint = fs.readFileSync(path.join(root, "tools/mint.sh"), "utf8");
const block = html.match(/\/\* __PURE_START__ \*\/([\s\S]*?)\/\* __PURE_END__ \*\//);
if (!block) throw new Error("missing pure block");
const api = new Function(block[1] + "\nreturn { ITEMS, FACTOR_DEFS, levelFromMean, scoreAnswers, shownMean };")();
const { ITEMS, FACTOR_DEFS, levelFromMean, scoreAnswers } = api;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const EXPECT = {
  som: [1, 4, 12, 27, 40, 42, 48, 49, 52, 53, 56, 58],
  oc: [3, 9, 10, 28, 38, 45, 46, 51, 55, 65],
  is: [6, 21, 34, 36, 37, 41, 61, 69, 73],
  dep: [5, 14, 15, 20, 22, 26, 29, 30, 31, 32, 54, 71, 79],
  anx: [2, 17, 23, 33, 39, 57, 72, 78, 80, 86],
  hos: [11, 24, 63, 67, 74, 81],
  phob: [13, 25, 47, 50, 70, 75, 82],
  par: [8, 18, 43, 68, 76, 83],
  psy: [7, 16, 35, 62, 77, 84, 85, 87, 88, 90],
  add: [19, 44, 59, 60, 64, 66, 89]
};

assert(ITEMS.length === 90, "item count " + ITEMS.length);
ITEMS.forEach((t, i) => assert(typeof t === "string" && t.trim().length > 0, "empty item " + (i + 1)));
assert(new Set(ITEMS).size === 90, "duplicate item text");
assert(ITEMS[14].includes("生命"), "item 15 wording");
assert(ITEMS[58].includes("死亡"), "item 59 wording");
assert(FACTOR_DEFS.length === 10, "factor count");

const seen = new Map();
for (const f of FACTOR_DEFS) {
  const exp = EXPECT[f.id];
  assert(exp, "unexpected factor " + f.id);
  assert(JSON.stringify(f.items) === JSON.stringify(exp), f.id + " items " + f.items.join(","));
  assert(f.items.length === exp.length, f.id + " length");
  for (const k of ["ok", "mild", "mod", "sev"]) {
    assert(f.tips[k] && f.tips[k].length > 8, "tip " + f.id + " " + k);
    assert(!/毫克|用药|处方|剂量/.test(f.tips[k]), "treatment language in " + f.id);
  }
  assert(f.meaning && f.meaning.length > 8, "meaning " + f.id);
  for (const n of f.items) {
    assert(!seen.has(n), "duplicate item number " + n);
    seen.set(n, f.id);
  }
}
for (let n = 1; n <= 90; n++) assert(seen.has(n), "missing item " + n);
assert(EXPECT.dep.includes(15) && !EXPECT.dep.includes(59), "item 15 in depression, 59 is additional");
assert(EXPECT.add.includes(59), "59 in additional");

assert(levelFromMean(179 / 90).name === "正常", "179");
assert(levelFromMean(180 / 90).name === "轻度", "180");
assert(levelFromMean(224 / 90).name === "轻度", "224");
assert(levelFromMean(225 / 90).name === "中度", "225");
assert(levelFromMean(232 / 90).name === "中度", "232 mean");
assert(levelFromMean(269 / 90).name === "中度", "269");
assert(levelFromMean(270 / 90).name === "重度", "270");
assert(levelFromMean(1.99).name === "正常", "1.99");
assert(levelFromMean(2).name === "轻度", "2.00");
assert(levelFromMean(2.49).name === "轻度", "2.49");
assert(levelFromMean(2.5).name === "中度", "2.50");
assert(levelFromMean(2.99).name === "中度", "2.99");
assert(levelFromMean(3).name === "重度", "3.00");

const calm = scoreAnswers(Array(90).fill(1));
assert(calm.total === 90 && calm.positive === 0 && calm.psdi === null, "all absent");
assert(calm.overall.name === "正常", "all absent level");
assert(calm.factors.every((f) => f.raw === f.n && f.level.name === "正常"), "factor floors");
assert(calm.care === false, "no care when item 15 is 1");

const severe = scoreAnswers(Array(90).fill(5));
assert(severe.total === 450 && severe.positive === 90, "all severe totals");
assert(severe.overall.name === "重度" && severe.psdi === 5, "all severe level");
assert(severe.factors.reduce((s, f) => s + f.raw, 0) === 450, "raw sum");

const profile = Array(90).fill(1);
for (let i = 0; i < 35; i++) profile[i] = 5;
profile[35] = 3;
const mid = scoreAnswers(profile);
assert(mid.total === 232, "total 232 got " + mid.total);
assert(Number(mid.gsi.toFixed(2)) === 2.58, "gsi " + mid.gsi);
assert(mid.overall.name === "中度", "232 should be 中度");
assert(mid.positive === 36, "positive " + mid.positive);
assert(mid.factors.reduce((s, f) => s + f.raw, 0) === 232, "232 raw sum");

const distress = profile.slice();
distress[14] = 2;
assert(scoreAnswers(distress).care === true, "item 15 >= 2 raises care");

const phrase = "本测试为心理症状筛查工具，结果仅供自我了解与参考，不能替代专业诊断或治疗；如持续困扰请寻求正规心理/医疗机构帮助";
assert(html.split(phrase).length - 1 >= 2, "disclaimer missing");
for (const label of ["从无", "很轻", "中等", "偏重", "严重"]) {
  assert(html.includes('"' + label + '"'), "missing choice " + label);
}
assert(html.includes("f60c0dae2088e5ccd5061a110aef0c0ff2a5b85f2658e78809c9123c9d82a22c"), "mantle key");
assert(html.includes("/sc/"), "collection path");
assert(/MANTLE_COL:-sc/.test(mint), "mint collection");
assert(/CODE_PREFIX:-SC/.test(mint), "mint prefix");
assert(mint.includes("ABCDEFGHJKMNPQRSTUVWXYZ23456789"), "mint alphabet");
assert(html.includes("查看上次结果"), "view last");
assert(html.includes("重新测试"), "retry");

console.log("ok", {
  items: ITEMS.length,
  factors: FACTOR_DEFS.map((f) => f.id + ":" + f.items.length).join(" "),
  example: "232 -> " + mid.overall.name + " gsi " + mid.gsi.toFixed(2)
});
