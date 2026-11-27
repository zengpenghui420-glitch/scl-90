// Mocked order-unlock checks for SCL-90. Synthetic ids only. Chrome is pinned to
// 127.0.0.1 for the API and Mantle hosts, so a missed mock cannot redeem a real
// order or code.
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadPuppeteer() {
  if (process.env.PUPPETEER_CORE) return createRequire(import.meta.url)(process.env.PUPPETEER_CORE);
  const pkg = "/tmp/ppt/package.json";
  if (fs.existsSync(pkg)) return createRequire(pkg)("puppeteer-core");
  return createRequire(import.meta.url)("puppeteer-core");
}
const puppeteer = loadPuppeteer();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_HOST = "snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app";
const API = "https://" + API_HOST;
const ORDER = "P738291046152837465";
const OTHER = "P847291038475610293";
const CODE = "SCABCD";
const ART = "/opt/cursor/artifacts";

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return "shape";
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return "repeat";
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return "sequence";
  }
  return "";
}
if (patternError(ORDER) || patternError(OTHER)) throw new Error("synthetic order is not a legal id");
if (!/^SC[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error("synthetic code shape");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json"
};

function freshState() {
  return {
    vaultMode: "ok",
    mantleRemaining: 3,
    mantleMissing: false,
    mantleDecrResult: null,
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: []
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleApi(req, u, state) {
  if (req.method() === "OPTIONS") {
    await req.respond({ status: 204, headers: CORS, body: "" });
    return;
  }
  state.urls.push(req.method() + " " + u.pathname + u.search);
  if (u.pathname === "/order/get" || u.pathname === "/order/redeem" || u.pathname.startsWith("/orders")) {
    state.unexpected.push("vercel-order " + req.method() + " " + u.pathname);
    await req.abort("failed");
    return;
  }
  if (u.pathname === "/redeem" && req.method() === "POST") {
    const body = JSON.parse(req.postData() || "{}");
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === "down") {
      await req.abort("failed");
      return;
    }
    if (state.vaultMode === "not_found") return send(req, 404, { ok: false, error: "not_found" });
    if (state.vaultMode === "exhausted") return send(req, 403, { ok: false, error: "exhausted" });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.pathname === "/get") {
    state.vaultGets++;
    if (u.searchParams.get("quiz") !== "scl") return send(req, 400, { ok: false, error: "invalid" });
    if (state.vaultMode === "not_found" || state.vaultMode === "down") return send(req, 404, { ok: false, error: "not_found" });
    if (state.vaultMode === "exhausted") return send(req, 403, { ok: false, error: "exhausted" });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push("api " + req.method() + " " + u.pathname);
  await req.abort("failed");
}

async function handleMantle(req, u, state) {
  if (req.method() === "OPTIONS") {
    await req.respond({ status: 204, headers: CORS, body: "" });
    return;
  }
  state.urls.push(req.method() + " mantle " + u.pathname);
  if (u.pathname.includes("/orders/")) {
    state.unexpected.push("mantle-order " + u.pathname);
    await req.abort("failed");
    return;
  }
  if (!u.pathname.includes("/sc/")) {
    state.unexpected.push("mantle-col " + u.pathname);
    await req.abort("failed");
    return;
  }
  if (req.method() === "GET") {
    state.mantleGets++;
    if (state.mantleMissing) return send(req, 404, { error: "not_found" });
    return send(req, 200, { remaining: state.mantleRemaining, max: 3 });
  }
  if (req.method() === "POST" && u.pathname.includes("/increment/")) {
    const body = JSON.parse(req.postData() || "{}");
    state.bodies.push(body);
    if (body.by === -1) {
      state.mantleDecr++;
      if (state.mantleDecrResult != null) return send(req, 200, { remaining: state.mantleDecrResult });
      state.mantleRemaining -= 1;
    } else if (body.by === 1) {
      state.mantleIncr++;
      state.mantleRemaining += 1;
    } else {
      state.unexpected.push("mantle by " + body.by);
    }
    return send(req, 200, { remaining: state.mantleRemaining });
  }
  state.unexpected.push("mantle " + req.method() + " " + u.pathname);
  await req.abort("failed");
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
        await req.continue();
        return;
      }
      if (u.hostname === API_HOST) return await handleApi(req, u, state);
      if (u.hostname === "mantledb.sh") return await handleMantle(req, u, state);
      state.unexpected.push(u.hostname + " " + req.url());
      await req.abort("failed");
    } catch (e) {
      state.unexpected.push("handler " + e.message);
      try { await req.abort("failed"); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? "\n" + JSON.stringify({
      vaultPosts: state.vaultPosts,
      vaultGets: state.vaultGets,
      mantleGets: state.mantleGets,
      mantleDecr: state.mantleDecr,
      mantleIncr: state.mantleIncr,
      bodies: state.bodies,
      urls: state.urls,
      unexpected: state.unexpected
    }, null, 2) : "";
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click("#btnStart");
  await page.waitForSelector("#codeMask:not([hidden])");
  await page.$eval("#codeInput", (el, v) => { el.value = v; }, value);
  await page.click("#btnCodeOk");
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById("quiz").classList.contains("active"), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForSelector("#result.active", { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    window.SCL90.setAnswers(Array(90).fill(1));
    window.SCL90.finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval("#quizProgress", (el) => el.textContent);
  await page.click("#options .opt");
  await page.waitForFunction((prev) => document.getElementById("quizProgress").textContent !== prev, { timeout: 3000 }, before);
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes("/orders/") || u.includes("/order/") || u.includes("vercel"));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, msg, state);
}

async function shot(page, name) {
  await mkdir(ART, { recursive: true });
  await page.screenshot({ path: path.join(ART, name), fullPage: false });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(ROOT, decodeURIComponent(rel)));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end("no");
      return;
    }
    res.writeHead(200, {
      "content-type": full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain",
      "cache-control": "no-store"
    });
    res.end(fs.readFileSync(full));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function newPage(browser, state, base, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem("__test_ready")) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("__test_ready", "1");
    } catch (e) {}
  });
  await page.setViewport(opts.viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(base + (opts.path || ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof redeemOrder === "function" && typeof redeemAccess === "function");
  return { page, errors };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("format helpers reject patterns and keep SC codes off the order path", async (browser, base) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state, base);
  const out = await page.evaluate((order) => ({
    good: orderFormatError(order),
    repeat: orderFormatError("P111111111111111111"),
    block: orderFormatError("P121212121212121212"),
    seq: orderFormatError("P123456789012345678"),
    minus: orderFormatError("P987654321098765432"),
    pasted: classifyInput(" 「p7382 9104-6152.837465」 "),
    code: classifyInput(" sc ab cd "),
    junk: classifyInput("hello"),
    shortP: classifyInput("P12345"),
    quiz: QUIZ_KEY,
    api: API_BASE,
    key: ORDER_USES_KEY,
    p19: orderFormatError("P9900000000000001378"),
    p19c: classifyInput("P9900000000000001378").type,
    copy: orderSuccessText({ ok: true, uses: 1, remaining: 2 }),
    second: orderSuccessText({ ok: true, uses: 2, remaining: 1 }),
    lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0 }),
    laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0 }),
    paid: redeemOrder(order).paidVerified
  }), ORDER);
  assert(out.good === "", "legal synthetic id rejected " + out.good);
  assert(out.repeat === "invalid" && out.block === "invalid" && out.seq === "invalid" && out.minus === "invalid", "pattern ids should be invalid");
  assert(out.pasted.type === "order" && out.pasted.orderId === ORDER, "paste normalize " + JSON.stringify(out.pasted));
  assert(out.code.type === "code" && out.code.code === CODE, "spaced SC code " + JSON.stringify(out.code));
  assert(out.junk.type === "code" && out.shortP.type === "code", "short input stays off the order path");
  assert(out.quiz === "scl" && out.api === API, "quiz/api constants");
  assert(out.key === "sc90_order_uses", "display key " + out.key);
  assert(out.p19 === "invalid" && out.p19c === "order-invalid", "19-digit id must stay invalid");
  assert(out.copy === "验证成功，还可以测 2 次", out.copy);
  assert(out.second === "验证成功，还可以测 1 次", out.second);
  assert(out.lastCopy === "验证成功，这是最后一次", out.lastCopy);
  assert(out.laterCopy === "验证成功", out.laterCopy);
  assert(out.paid === false, "paidVerified");
  assert(await shownUses(page) === 1, "a passing id records one display");
  const stored = await page.evaluate(() => localStorage.getItem("soft_persimmon_order_uses"));
  assert(stored == null, "reused the other quiz key");
  assertNoOrderNet(state, "format checks must not hit the network");
  assert(errors.length === 0, errors.join("\n"));
  await page.close();
});

test("first start, refresh, and continue leave the display at 1", async (browser, base) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state, base);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(!visible.includes("验证码") && !visible.includes("paidVerified"), "start copy");
  assert(visible.includes("SCL-90"), "product title");
  await openAndSubmit(page, " 「p7382 9104-6152.837465」 ");
  await waitQuiz(page);
  assert(await page.$eval("#codeTitle", (el) => el.textContent) === "输入订单号", "modal title");
  assert(await shownUses(page) === 1, "first start should display one use");
  assertNoOrderNet(state, "first start must not call the network");
  const toast = await page.$eval("#toast", (el) => el.textContent);
  assert(toast === "验证成功，还可以测 2 次", "success copy " + toast);
  const q1 = await page.$eval("#qText", (el) => el.textContent);
  assert(q1 === "头痛", "first question changed: " + q1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, "refresh at question 1 must not change the display count");
  assertNoOrderNet(state, "refresh must not call the network");
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval("#quizProgress", (el) => el.textContent);
  assert(prog === "3 / 90", "progress " + prog);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById("quizProgress").textContent,
    idx: window.SCL90.getAnswers().slice(0, 2)
  }));
  assert(resumed.prog === "3 / 90" && resumed.idx[0] === 1 && resumed.idx[1] === 1, "mid refresh " + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, "mid refresh must not change the display count");
  assertNoOrderNet(state, "mid refresh must not call the network");
  await page.click("#btnBack");
  await page.click("#btnBack");
  await page.click("#btnBack");
  await page.waitForSelector("#start.active");
  assert((await page.$eval("#btnStart", (el) => el.textContent)) === "继续测试", "continue label");
  await page.click("#btnStart");
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById("quizProgress").textContent,
    sel: document.querySelectorAll("#options .opt.selected").length,
    a0: window.SCL90.getAnswers()[0]
  }));
  assert(cont.prog === "1 / 90" && cont.sel === 1 && cont.a0 === 1, "continue reset the attempt " + JSON.stringify(cont));
  assert(await shownUses(page) === 1, "continue must not change the display count");
  assertNoOrderNet(state, "continue must not call the network");
  assert(errors.length === 0, errors.join("\n"));
  await page.close();
});

test("result refresh and view-last do not advance; retest does; later entry still starts", async (browser, base) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state, base);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstTotal = await page.$eval(".score-num", (el) => el.textContent);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitResult(page);
  const peeked = await page.$eval(".score-num", (el) => el.textContent);
  assert(peeked === firstTotal, "result refresh changed the result");
  assert(await shownUses(page) === 1, "result refresh changed the display count");
  assertNoOrderNet(state, "result refresh must not call the network");

  await page.click("#btnViewLast");
  await page.waitForSelector("#result.active");
  assert(await shownUses(page) === 1, "view last on the result changed the display count");
  await page.click("#btnHome");
  await page.waitForSelector("#start.active");
  await page.click("#btnLast");
  await page.waitForSelector("#result.active");
  assert(await shownUses(page) === 1, "查看上次结果 changed the display count");
  assertNoOrderNet(state, "view last must not call the network for an order");

  await page.click("#btnRetry");
  await page.waitForSelector("#codeMask:not([hidden])");
  assert(await shownUses(page) === 1, "opening 重新测试 changed the display");
  await page.click("#btnCodeOk");
  await waitQuiz(page);
  assert(await shownUses(page) === 2, "retest should display the second use");
  const secondToast = await page.$eval("#toast", (el) => el.textContent);
  assert(secondToast.includes("还可以测 1 次"), secondToast);
  const restarted = await page.evaluate(() => ({
    prog: document.getElementById("quizProgress").textContent,
    filled: window.SCL90.getAnswers().filter((n) => n >= 1).length
  }));
  assert(restarted.prog === "1 / 90" && restarted.filled === 0, "retest should open a new attempt " + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click("#btnRetry");
  await page.waitForSelector("#codeMask:not([hidden])");
  await page.click("#btnCodeOk");
  await waitQuiz(page);
  assert(await shownUses(page) === 3, "third displayed use");
  const thirdToast = await page.$eval("#toast", (el) => el.textContent);
  assert(thirdToast.includes("这是最后一次"), thirdToast);
  await fastFinish(page);
  await page.click("#btnRetry");
  await page.waitForSelector("#codeMask:not([hidden])");
  await page.click("#btnCodeOk");
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById("toast").textContent === "验证成功");
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById("quiz").classList.contains("active"),
    toast: document.getElementById("toast").textContent,
    uses: shownOrderUses(id)
  }), ORDER);
  assert(after.quiz, "a later entry must still open the quiz");
  assert(after.toast === "验证成功" && !after.toast.includes("用完") && !after.toast.includes("暂时验证不了"), after.toast);
  assert(after.uses === 4, "later entry still records a display count");
  assertNoOrderNet(state, "later entry must not call the network");
  const separate = await page.evaluate((id, first) => {
    const res = redeemOrder(id);
    return { uses: shownOrderUses(id), first: shownOrderUses(first), text: orderSuccessText(res) };
  }, OTHER, ORDER);
  assert(separate.uses === 1 && separate.first === 4 && separate.text === "验证成功，还可以测 2 次", "a different id keeps its own display count " + JSON.stringify(separate));
  assertNoOrderNet(state, "another id must not call the network");
  assert(errors.length === 0, errors.join("\n"));
  await page.close();
});

test("invalid ids are rejected locally and do not start the quiz", async (browser, base) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state, base);
  await openAndSubmit(page, "P123456789012345678");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  assert(!(await page.$("#quiz.active")), "sequence id started the quiz");
  await page.$eval("#codeInput", (el) => { el.value = "P111111111111111111"; });
  await page.click("#btnCodeOk");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  await page.$eval("#codeInput", (el) => { el.value = "P9900000000000001378"; });
  await page.click("#btnCodeOk");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  await page.$eval("#codeInput", (el) => { el.value = "hello"; });
  await page.click("#btnCodeOk");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("订单号不对"));
  assert(!(await page.$("#quiz.active")), "invalid input started the quiz");
  assertNoOrderNet(state, "invalid input reached the network");
  assert(errors.length === 0, errors.join("\n"));
  await page.close();
});

test("legacy vault hit does not fall through to Mantle", async (browser, base) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state, base);
  await openAndSubmit(page, "sc ab cd");
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === "scl" && state.bodies[0].code === CODE, "vault body", state);
  assert(!state.bodies[0].orderId, "legacy redeem must not send orderId", state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0, "vault hit must not touch Mantle", state);
  assert(state.urls.some((u) => u.startsWith("POST /redeem")), "vault url", state);
  assert(state.unexpected.length === 0, "unexpected", state);
  assert(errors.length === 0, errors.join("\n"));
  await page.close();
});

test("legacy vault miss falls back to Mantle, exhausted vault does not", async (browser, base) => {
  const miss = freshState();
  miss.vaultMode = "not_found";
  const opened = await newPage(browser, miss, base);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(miss.vaultPosts === 1 && miss.mantleGets === 1 && miss.mantleDecr === 1 && miss.mantleIncr === 0, "mantle fallback", miss);
  assert(miss.mantleRemaining === 2, "remaining after decr", miss);
  assert(miss.urls.some((u) => u.includes("/sc/" + CODE)), "mantle collection", miss);
  assert(!miss.urls.some((u) => u.includes("/orders/")), "mantle orders", miss);
  await opened.page.close();

  const done = freshState();
  done.vaultMode = "exhausted";
  const second = await newPage(browser, done, base);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById("toast").textContent.includes("次数已经用完"));
  const onQuiz = await second.page.$eval("#quiz", (el) => el.classList.contains("active"));
  assert(!onQuiz && done.mantleGets === 0 && done.mantleDecr === 0, "exhausted vault fell through", done);
  await second.page.close();
});

test("legacy vault outage falls back to Mantle and rolls a negative decrement back", async (browser, base) => {
  const down = freshState();
  down.vaultMode = "down";
  const opened = await newPage(browser, down, base);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(down.vaultPosts === 1 && down.mantleDecr === 1 && down.mantleRemaining === 2, "outage fallback", down);
  await opened.page.close();

  const rollback = freshState();
  rollback.vaultMode = "not_found";
  rollback.mantleRemaining = 1;
  rollback.mantleDecrResult = -1;
  const page2 = await newPage(browser, rollback, base);
  await openAndSubmit(page2.page, CODE);
  await page2.page.waitForFunction(() => document.getElementById("toast").textContent.includes("次数已经用完"));
  const onQuiz = await page2.page.$eval("#quiz", (el) => el.classList.contains("active"));
  assert(!onQuiz && rollback.mantleDecr === 1 && rollback.mantleIncr === 1, "rollback", rollback);
  await page2.page.close();

  const both = freshState();
  both.vaultMode = "down";
  both.mantleMissing = true;
  const page3 = await newPage(browser, both, base);
  await openAndSubmit(page3.page, CODE);
  await page3.page.waitForFunction(() => document.getElementById("toast").textContent.includes("网络异常"));
  const started = await page3.page.$eval("#quiz", (el) => el.classList.contains("active"));
  assert(!started, "network failure unlocked");
  await page3.page.close();
});

test("query string fills an order or a code and counts only after confirm", async (browser, base) => {
  const order = freshState();
  const p1 = await newPage(browser, order, base, { path: "?code=" + ORDER });
  assert(!(await p1.page.$("#quiz.active")), "query order started before confirm");
  assert(await shownUses(p1.page) === 0, "query order counted before confirm");
  await p1.page.click("#btnStart");
  await p1.page.waitForSelector("#codeMask:not([hidden])");
  assert(await p1.page.$eval("#codeInput", (el) => el.value) === ORDER, "query order prefill");
  await p1.page.click("#btnCodeOk");
  await waitQuiz(p1.page);
  assert(await shownUses(p1.page) === 1, "query order should display one use");
  assert((await p1.page.$eval("#toast", (el) => el.textContent)) === "验证成功，还可以测 2 次", "query toast");
  assertNoOrderNet(order, "query order must not call the network");
  await p1.page.close();

  const code = freshState();
  const p2 = await newPage(browser, code, base, { path: "?code=" + CODE });
  assert(code.vaultPosts === 0, "query code redeemed before confirm", code);
  await p2.page.click("#btnStart");
  await p2.page.waitForSelector("#codeMask:not([hidden])");
  assert(await p2.page.$eval("#codeInput", (el) => el.value) === CODE, "query code prefill");
  await p2.page.click("#btnCodeOk");
  await waitQuiz(p2.page);
  assert(code.vaultPosts === 1 && code.bodies[0].code === CODE && code.mantleDecr === 0, "query code", code);
  await p2.page.close();
});

test("layout at 320 and 390", async (browser, base) => {
  for (const width of [320, 390]) {
    const state = freshState();
    const { page, errors } = await newPage(browser, state, base, { viewport: { width, height: 780, isMobile: true, hasTouch: true } });
    await page.click("#btnStart");
    await page.waitForSelector("#codeMask:not([hidden])");
    await page.$eval("#codeInput", (el, v) => { el.value = v; }, ORDER);
    const fit = await page.$eval("#codeInput", (el) => el.scrollWidth <= el.clientWidth + 2);
    assert(fit, width + " order id clipped");
    const hint = await page.$eval("#codeHint", (el) => el.innerText);
    assert(hint.includes("我的订单") && hint.includes("3 次"), hint);
    assert(!hint.includes("本地") && !hint.includes("假"), "hint describes the display as local-only");
    const title = await page.$eval("#codeTitle", (el) => el.textContent);
    assert(title === "输入订单号", title);
    await shot(page, "scl90-" + width + "-order.png");
    assert(errors.length === 0, errors.join("\n"));
    await page.close();
  }
});

const server = await startServer();
const base = "http://127.0.0.1:" + server.address().port + "/";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--host-resolver-rules=MAP ${API_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`
  ]
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser, base);
      console.log("ok  " + c.name);
    } catch (e) {
      failed++;
      console.error("FAIL " + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log(cases.length + " passed");
