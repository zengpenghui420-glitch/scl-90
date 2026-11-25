// Phone-sized flow check. Needs Chrome plus puppeteer-core:
// PUPPETEER_CORE=/path/to/puppeteer-core.js node tools/browser-check.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = (await import(process.env.PUPPETEER_CORE || "puppeteer-core")).default;
const ORDER = "P738291046152837465";
const CODE = "SCAB23";
const outDir = process.env.SHOT_DIR || "/tmp/scl90-shots";
fs.mkdirSync(outDir, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(root, rel));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end("no");
      return;
    }
    const type = full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(fs.readFileSync(full));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function json(status, obj) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(obj),
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }
  };
}

const world = {
  uses: 0,
  posts: 0,
  gets: 0,
  mantleGets: 0,
  mantlePosts: 0,
  remaining: 3,
  orderUrls: [],
  mantleUrls: []
};

function resetWorld() {
  world.uses = 0;
  world.posts = 0;
  world.gets = 0;
  world.mantleGets = 0;
  world.mantlePosts = 0;
  world.remaining = 3;
  world.orderUrls = [];
  world.mantleUrls = [];
}

function orderBody() {
  if (world.uses <= 0) return { status: 404, body: { ok: false, error: "not_found" } };
  return {
    status: 200,
    body: { ok: true, uses: world.uses, remaining: 3 - world.uses, max: 3, quiz: "scl", paidVerified: false }
  };
}

async function handle(req) {
  const u = req.url();
  if (req.method() === "OPTIONS") {
    await req.respond({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-device-id,x-mantle-key",
        "access-control-max-age": "600"
      }
    });
    return;
  }
  if (u.includes("/order/get") || u.includes("/order/redeem")) {
    const parsed = new URL(u);
    world.orderUrls.push(u);
    if (req.method() === "GET") {
      world.gets += 1;
      assert(parsed.searchParams.get("quiz") === "scl", "peek quiz");
      const st = orderBody();
      await req.respond(json(st.status, st.body));
      return;
    }
    const body = JSON.parse(req.postData() || "{}");
    assert(body.quiz === "scl" && body.orderId === ORDER, "redeem body " + req.postData());
    world.posts += 1;
    if (world.uses >= 3) {
      await req.respond(json(403, { ok: false, error: "exhausted", remaining: 0, max: 3 }));
      return;
    }
    world.uses += 1;
    await req.respond(json(200, {
      ok: true,
      uses: world.uses,
      remaining: 3 - world.uses,
      max: 3,
      quiz: "scl",
      orderId: ORDER,
      paidVerified: false
    }));
    return;
  }
  if (u.includes("mantledb.sh")) {
    world.mantleUrls.push(u.split("?")[0]);
    if (req.method() === "GET") {
      world.mantleGets += 1;
      assert(u.includes("/sc/" + CODE), "mantle collection " + u);
      await req.respond(json(200, { remaining: world.remaining, max: 3 }));
      return;
    }
    const body = JSON.parse(req.postData() || "{}");
    assert(body.key === "remaining" && body.by === -1, "mantle decrement");
    assert(u.includes("/increment/") && u.includes("/sc/" + CODE), "mantle increment path");
    world.mantlePosts += 1;
    world.remaining -= 1;
    await req.respond(json(200, { remaining: world.remaining }));
    return;
  }
  if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) {
    await req.continue();
    return;
  }
  await req.abort();
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

async function setCode(page, value) {
  await page.$eval("#codeInput", (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function openModal(page) {
  await page.click("#btnStart");
  await page.waitForSelector("#codeMask:not([hidden])");
}

async function confirm(page) {
  await page.click("#btnCodeOk");
}

const server = await startServer();
const base = "http://127.0.0.1:" + server.address().port + "/";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert(await page.$eval("h1", (el) => el.textContent.includes("SCL-90")), "title");
  assert(await page.$eval(".disclaimer", (el) => el.textContent.includes("不能替代专业诊断")), "disclaimer");
  assert(await overflow(page), "cover overflow 390");
  await shot(page, "cover-390.png");

  const postsAtCover = world.posts;
  await openModal(page);
  assert(world.posts === postsAtCover, "opening the dialog redeems");
  assert(await page.$eval("#codeTitle", (el) => el.textContent) === "输入订单号", "modal title");
  assert((await page.$eval("#codeHint", (el) => el.textContent)).includes("我的订单"), "xhs copy");
  assert((await page.$eval("#codeHint", (el) => el.textContent)).includes("3 次"), "three uses");
  assert(!(await page.$eval("#codeMask", (el) => el.innerText)).includes("验证码"), "modal advertises codes");
  const fit = await page.$eval("#codeInput", (el) => {
    const panel = el.closest(".panel").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    el.value = "P738291046152837465";
    return {
      inside: box.left >= panel.left - 1 && box.right <= panel.right + 1,
      fits: el.scrollWidth <= el.clientWidth + 2,
      hint: true
    };
  });
  assert(fit.inside, "input outside panel");
  assert(fit.fits, "order id does not fit the field");
  assert(await overflow(page), "modal overflow 390");
  await shot(page, "modal-390.png");

  await page.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  assert(await overflow(page), "modal overflow 320");
  const fit320 = await page.$eval("#codeInput", (el) => el.scrollWidth <= el.clientWidth + 2);
  assert(fit320, "order id does not fit at 320");
  await shot(page, "modal-320.png");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  await setCode(page, "P111111111111111111");
  await confirm(page);
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  assert(world.posts === 0 && world.gets === 0, "invalid order hit the api");
  assert(!(await page.$("#quiz.active")), "invalid order started the quiz");

  await setCode(page, ORDER);
  await new Promise((r) => setTimeout(r, 400));
  assert(world.posts === 0, "preview redeemed");
  assert(world.gets >= 1, "preview did not peek");
  const getsBeforeConfirm = world.gets;
  await confirm(page);
  await page.waitForSelector("#quiz.active");
  assert(world.posts === 1 && world.uses === 1, "first unlock posts " + world.posts + " uses " + world.uses);
  assert(world.gets >= getsBeforeConfirm, "confirm peek");
  assert(await page.$eval("#qText", (el) => el.textContent) === "头痛", "first question");
  assert(await overflow(page), "quiz overflow");
  await shot(page, "quiz-390.png");

  const postsMid = world.posts;
  const getsMid = world.gets;
  await page.click("#btnBack");
  await page.waitForSelector("#start.active");
  assert((await page.$eval("#btnStart", (el) => el.textContent)) === "继续测试", "continue label");
  await page.click("#btnStart");
  await page.waitForSelector("#quiz.active");
  assert(world.posts === postsMid && world.gets === getsMid, "continue consumed");

  await page.click("#btnBack");
  await page.waitForSelector("#start.active");
  await page.click("#btnRestart");
  await page.waitForSelector("#codeMask:not([hidden])");
  assert(world.posts === postsMid, "opening retry redeemed");
  await page.click("#codeClose");

  await page.evaluate(() => {
    window.SCL90.setAnswers(Array(90).fill(1));
    window.SCL90.finish();
  });
  await page.waitForSelector("#result.active", { timeout: 4000 });
  assert(await page.$eval("#resultInner", (el) => el.textContent.includes("不能替代专业诊断")), "result disclaimer");
  assert(await overflow(page), "result overflow");
  await shot(page, "result-390.png");

  const postsBeforeReload = world.posts;
  const getsBeforeReload = world.gets;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#result.active", { timeout: 4000 });
  assert(world.posts === postsBeforeReload, "refresh redeemed");
  assert(world.gets === getsBeforeReload + 1, "refresh did not peek once: " + world.gets + " vs " + getsBeforeReload);
  assert(world.uses === 1, "refresh changed uses");

  await page.click("#btnHome");
  await page.waitForSelector("#start.active");
  const postsBeforeLast = world.posts;
  const getsBeforeLast = world.gets;
  await page.click("#btnLast");
  await page.waitForSelector("#result.active");
  assert(world.posts === postsBeforeLast && world.gets === getsBeforeLast, "view last consumed");

  async function retest() {
    const posts = world.posts;
    await page.click("#btnRetry");
    await page.waitForSelector("#codeMask:not([hidden])");
    await confirm(page);
    await page.waitForSelector("#quiz.active");
    assert(world.posts === posts + 1, "retest did not post");
    await page.evaluate(() => {
      window.SCL90.setAnswers(Array(90).fill(1));
      window.SCL90.finish();
    });
    await page.waitForSelector("#result.active", { timeout: 4000 });
  }
  await retest();
  assert(world.uses === 2, "second use");
  await retest();
  assert(world.uses === 3 && world.posts === 3, "third use");
  const postsAtEnd = world.posts;
  await page.click("#btnRetry");
  await page.waitForSelector("#codeMask:not([hidden])");
  await confirm(page);
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("用完"));
  assert(!(await page.$("#quiz.active")), "fourth attempt entered the quiz");
  assert(world.posts === postsAtEnd && world.uses === 3, "fourth posted or incremented");

  await page.close();
  resetWorld();
  const legacyContext = await browser.createBrowserContext();
  const legacy = await legacyContext.newPage();
  await legacy.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await legacy.setRequestInterception(true);
  legacy.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });
  await legacy.goto(base, { waitUntil: "domcontentloaded" });
  await openModal(legacy);
  await setCode(legacy, CODE);
  await new Promise((r) => setTimeout(r, 400));
  assert(world.posts === 0 && world.gets === 0, "legacy preview hit order api");
  assert(world.mantleGets >= 1 && world.mantlePosts === 0, "legacy preview did not read mantle");
  await confirm(legacy);
  await legacy.waitForSelector("#quiz.active");
  assert(world.mantlePosts === 1 && world.remaining === 2, "legacy confirm decremented");
  assert(world.posts === 0 && world.gets === 0, "legacy confirm hit order api");
  const mantlePosts = world.mantlePosts;
  const mantleGets = world.mantleGets;
  await legacy.reload({ waitUntil: "domcontentloaded" });
  await legacy.waitForSelector("#quiz.active");
  assert(world.mantlePosts === mantlePosts && world.mantleGets === mantleGets, "legacy refresh hit mantle");
  assert(world.posts === 0, "legacy refresh hit order api");
  await legacy.evaluate(() => {
    window.SCL90.setAnswers(Array(90).fill(1));
    window.SCL90.finish();
  });
  await legacy.waitForSelector("#result.active", { timeout: 4000 });
  const afterFinishGets = world.mantleGets;
  const afterFinishPosts = world.mantlePosts;
  await legacy.reload({ waitUntil: "domcontentloaded" });
  await legacy.waitForSelector("#result.active", { timeout: 4000 });
  assert(world.mantleGets === afterFinishGets && world.mantlePosts === afterFinishPosts, "legacy result refresh hit mantle");
  assert(world.posts === 0 && world.gets === 0, "legacy result refresh hit order api");
  await legacy.click("#btnHome");
  await legacy.waitForSelector("#start.active");
  await legacy.click("#btnLast");
  await legacy.waitForSelector("#result.active");
  assert(world.mantleGets === afterFinishGets && world.posts === 0, "view last hit the network");
  await legacy.close();
  await legacyContext.close();

  resetWorld();
  const linkContext = await browser.createBrowserContext();
  const linked = await linkContext.newPage();
  await linked.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await linked.setRequestInterception(true);
  linked.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });
  await linked.goto(base + "?code=" + ORDER, { waitUntil: "domcontentloaded" });
  assert(await linked.$eval("#urlHint", (el) => !el.hidden), "link hint hidden");
  assert(world.posts === 0 && world.gets === 0, "link redeemed before confirm");
  await openModal(linked);
  assert(await linked.$eval("#codeInput", (el) => el.value) === ORDER, "link did not fill the order");
  await new Promise((r) => setTimeout(r, 400));
  assert(world.posts === 0, "link preview redeemed");
  await confirm(linked);
  await linked.waitForSelector("#quiz.active");
  assert(world.posts === 1 && world.uses === 1, "link confirm did not redeem once");
  await linked.close();
  await linkContext.close();

  console.log("browser ok", {
    orderUses: 3,
    shots: fs.readdirSync(outDir)
  });
} finally {
  await browser.close();
  server.close();
}
