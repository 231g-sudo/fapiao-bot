# 发票提取工具 · PDF/OFD → Excel

纯浏览器端电子发票提取工具。上传电子发票 PDF 或 OFD，自动提取关键字段，导出标准 Excel 报销表。

**所有文件仅在浏览器本地处理，不上传任何服务器。**

## 功能

- 支持 **PDF** 和 **OFD** 两种电子发票格式
- 自动提取 10 个字段：发票号码、开票日期、购买方名称/税号、销售方名称/税号、商品信息、金额、税额、价税合计
- 商品信息支持**逐行展开**模式，每件商品独立一行
- 导出标准 **Excel**（.xlsx），含合计行
- 双击单元格可直接编辑修正
- 批量上传多张发票

## 使用

### 免费版
打开 https://231g-sudo.github.io/fapiao-bot/，直接拖入发票文件即可。每台设备免费 3 张。

### 完整版
通过激活码解锁（`FP-XXXXX-XXXXX` 格式），不限发票份数。

- 方式一：访问 `https://231g-sudo.github.io/fapiao-bot/?code=FP-XXXXX-XXXXX` 自动激活
- 方式二：点击页面上的"升级"按钮，输入激活码

### 本地开发
```bash
git clone https://github.com/231g-sudo/fapiao-bot.git
# 纯静态页面，直接打开 index.html 或启动任意 HTTP 服务
python3 -m http.server 8080
```

## 技术栈

- **pdf.js** — PDF 解析，提取文字及坐标位置
- **ofd.js + JSZip** — OFD 格式解析
- **SheetJS (xlsx)** — Excel 导出
- **FingerprintJS** — 设备指纹（免费额度限制）
- **GitHub Pages** — 部署（纯静态，无后端）

## 项目结构

```
├── index.html      # 主页面（免费 + 激活）
├── pro.html        # 完整版入口（保持兼容）
├── admin.html      # 激活码生成器（密码: fapiao888）
├── app.js          # 核心引擎（解析 + 提取 + 表格 + 导出）
├── gen_codes.py    # 激活码批量生成 CLI
├── AGENTS.md       # AI 辅助开发指南
└── README.md       # 本文件
```

## 字段提取说明

提取引擎分两层：

1. **位置提取** — 基于 PDF/OFD 文字坐标 (x, y)，按行分组后通过标签-值邻接关系匹配字段（适用于标准版式发票）
2. **正则回退** — 当位置提取不足 4 个字段时，使用正则表达式从全文提取（适用于简单 PDF 或 OFD）

## License

MIT
