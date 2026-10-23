# 限次验证码说明

- 验证码格式：`SC` + 4 位（如 `SCAB23`），字符集与历史人物测试相同：`ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去掉 I、L、O、0、1）
- 每个码最多使用 **3 次**（跨设备共享计数）
- 首页点「开始测试」或结果页点「重新测试」，在弹窗里确认后扣 **1 次**
- 「查看上次结果」和「继续测试」不扣次；同一次作答中途刷新也不再扣
- 支持链接自动填码：`https://zengpenghui420-glitch.github.io/scl-90/?code=SCXXXX`
- 后端：MantleDB（namespace `catquiz-zph420-codes`，集合 `sc/`，与猫咪 `c/`、八字 `bz/`、历史 `hq/` 互不通用）
- 继续造码：

```bash
MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh 10
```
