# 限次验证码说明

- 验证码格式：`SC` + 4 位（如 `SCAB23`），字符集与历史人物测试相同：`ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去掉 I、L、O、0、1）
- 每个码最多使用 **3 次**（跨设备共享计数）
- 订单号不是访问码，不会写入 `sc/`，也不会记到 Mantle 的 `orders/`。格式为 `P` + 18 位，通过后确认即可开始。显示次数按订单号记在这台浏览器（键 `sc90_order_uses`）。刷新、继续测试、查看上次结果不改这次显示。显示满 3 次后，格式正确的订单号仍然可以进入，提示「验证成功」
- 已经发出的访问码先请求 vault `POST /redeem`（quiz 键 `scl`）。vault 没有这枚码时才用 Mantle 集合 `sc/`，按真实剩余次数扣 1 次。vault 明确用尽则不再落到 Mantle
- 首页点「开始测试」或结果页点「重新测试」，在弹窗里确认后扣 **1 次**
- 「查看上次结果」和「继续测试」不扣次；同一次作答中途刷新也不再扣
- 支持链接自动填码：`https://zengpenghui420-glitch.github.io/scl-90/?code=SCXXXX`
- 后端：MantleDB（namespace `catquiz-zph420-codes`，集合 `sc/`，与猫咪 `c/`、八字 `bz/`、历史 `hq/` 互不通用）
- 继续造码：

```bash
MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh 10
```
