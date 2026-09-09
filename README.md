# QDII 海外指数申购监控（纳斯达克100 / 标普500）

一个**本地版**场外 QDII 指数基金申购状态监控站。覆盖所有场外跟踪
**纳斯达克100** 与 **标普500** 的 QDII 指数基金，实时刷新申购/赎回状态、
净值、涨跌与区间收益。

视觉与交互参考 lianban.net 的暗/浅双主题、等宽数字、状态色块与卡片式表格。

---

## 快速开始

双击 `start.bat`（自动打开浏览器）：会先用 Python 起一个本地服务器，
访问 `http://localhost:8000`。

或在命令行：

```bash
python -m http.server 8000
```

然后浏览器打开 `http://localhost:8000`。

> 若直接双击 `index.html`（file:// 方式），浏览器会因安全策略拦截
> fetch 加载 `data/data.json`，所以请务必用上面的本地服务器方式打开。

## 刷新数据

数据由 `collect.py` 抓取公开基金接口生成，写入 `data/data.json`。

```bash
python collect.py             # 全量抓取（覆盖纳指100+标普500 全部场外指数基金）
python collect.py --limit 5   # 只抓前 5 只，调试用
python collect.py --no-cache  # 忽略缓存，强制重新抓取
python collect.py --test-email # 用当前配置发送一封测试邮件（用于验证邮箱订阅）
```

抓取完成后，在页面点击右上角「刷新」按钮即可看到最新数据。

## 定时自动更新

Linux/macOS 用 cron，Windows 用任务计划程序即可。示例（每 6 小时刷新一次）：

```cron
30 */6 * * * cd /path/to/qdii-monitor && python collect.py
```

每次抓取会自动更新 `data/data.json`，页面「刷新」即可拿到最新。

## 数据说明

- 数据来源：公开的基金数据接口（东方财富/天天基金），无需登录。
- 指标：申购状态（开放/限大额/暂停）、赎回状态、最新净值、日涨跌、
  近1月/近6月/近1年/近3年收益、成立以来收益、最新规模、
  代销平台每日限购金额、费用合计（申购费+管理费+托管费+销售服务费）、
  年化跟踪误差。
- 自动更新：更新时间由 `.github/workflows/update.yml` 的 `cron` 决定（当前每 6 小时）；
  `collect.py` 会从该 `cron` 推导出 `refresh_ms` / `refresh_label` 写入 `data.json`，
  页面据此自动同步刷新频率与显示文案。**只需修改 `update.yml` 的 `cron` 一处即可改更新时间。**
- 状态历史：每只基金最近约 20 个交易日的申购/赎回状态，用于判断「近期变更」。
- 注意：QDII 基金净值有 T+1 左右滞后；本工具仅供研究参考，不构成投资建议。

## 邮箱订阅提醒（额度变化时邮件通知）

当基金的「申购/赎回状态」或「单日限购额度」发生变化时，`collect.py` 会自动发送一封邮件提醒。
有两种配置方式（优先读取 `config.json`，环境变量可覆盖）。

### 方式一：本地 config.json（推荐本地运行）

把 `config.example.json` 复制为 `config.json` 并填写：

```json
{
  "notify": {
    "enabled": true,
    "emails": ["you@example.com"],
    "smtp_host": "smtp.example.com",
    "smtp_port": 465,
    "smtp_user": "you@example.com",
    "smtp_password": "授权码或密码",
    "smtp_security": "ssl"
  }
}
```

- `smtp_security` 可选 `ssl` / `starttls` / `none`。
- 用你的邮箱 SMTP 授权码填 `smtp_password`（QQ 邮箱 / 163 / Gmail 等在设置里生成授权码）。
- 之后每次运行 `collect.py`，若上次到本次之间存在状态/额度变化，就会发送邮件。
- 可用 `python collect.py --test-email` 发送一封测试邮件验证配置。

> 注意：`config.json` 已在 `.gitignore` 中，不会被提交到仓库。

### 方式二：GitHub Actions Secrets（部署到 GitHub Pages 时）

在仓库 `Settings → Secrets and variables → Actions` 中添加以下 Secrets：

- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_SECURITY`、`NOTIFY_EMAILS`（多个邮箱用逗号分隔）

工作流 `update.yml` 已自动读取这些 Secrets，每当数据变化时发送提醒。

> 页面顶栏的「✉ 订阅」按钮可输入邮箱并生成对应的 `config.json`，便于快速配置；
> 订阅状态（是否启用、上次发送时间、最近变化数）会显示在弹窗里。

## 依赖

仅需 Python 3（标准库，无需第三方包）。

---

## 部署到公网（免费）

该站点是纯静态前端 + `data/data.json`，任何静态托管都能跑；配合定时任务即可自动更新。

### 方案一：GitHub Pages + Actions（推荐，完全免费且稳定）

**自动更新**：仓库里的 `.github/workflows/update.yml` 每 6 小时定时用 GitHub Actions
运行 `collect.py` 抓最新数据并提交到 `main`，GitHub Pages 会自动重新发布；
页面的刷新频率与显示文案会随 `data.json` 里的 `refresh_ms` / `refresh_label` 自动同步（与 `cron` 一致）。

步骤：
```bash
# 在本目录初始化并推送（需你的 GitHub 账号）
git init
git add .
git commit -m "init qdii-monitor"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```
然后在 GitHub 仓库 `Settings → Pages` → `Source` 选 **Deploy from a branch**，
分支 `main`、目录 `/(root)`，保存即可。

访问地址：`https://<你的用户名>.github.io/<仓库名>/`

> 站点全部用相对路径，放在子路径下也能正常加载。

### 方案二：Cloudflare Pages / Netlify / Vercel

- **Cloudflare Pages**：连接 Git 仓库导入即可，免费、稳定、CDN 快；同样可用它的
  Cron 触发器定时更新。
- **Netlify / Vercel**：可直接拖拽 `index.html/app.css/app.js/data` 上传，或用其 CLI。
  免费档访问量有限，但用于个人监控足够。

> 注意：纯静态托管不会“每隔几分钟重新跑抓取脚本”，数据是否更新取决于是否有
> 定时任务（GitHub Actions 或平台 Cron）。本仓库已配好每 6 小时自动更新的 Actions。
