# 电库图鉴 · Powerdex

充电宝、充电器与充电配件的规格、功率和曲线档案。覆盖 CUKTECH、Anker 等品牌。

## 功能

- 型号库：容量、能量、输入 / 输出、接口与协议
- 全部曲线：功率虚线、电量实线，可叠加查看
- 单款档案：测试条件、充电曲线、恒流放电、来源
- 最多 3 款并排对比
- 纯静态 HTML / CSS / JS，无构建步骤、无 CDN

## 目录

```text
index.html               型号库 + 全部曲线
compare.html             对比
device.html              单款档案，?id=型号ID
assets/css               样式
assets/js                数据加载与 SVG 曲线
assets/img               产品图与图标
data/powerbanks.json     站点数据
data/device.template.json 录入模板
data/powerbanks.schema.json 数据格式
.github/workflows         GitHub Pages 部署
```

## 数据

在 `data/powerbanks.json` 中添加品牌、型号和曲线，字段参考
`data/powerbanks.schema.json`。

- `t`：分钟
- `pct`：电量百分比
- `w`：功率（W）；没有实测功率时写 `null`
- `summary`：可选，记录测试摘要的峰值 / 平均功率

没有实测数据就不补造曲线点。

## 本地预览

不要直接双击 `index.html`，浏览器会拦截 `fetch()`。在项目根目录启动任意静态服务器，然后通过 `http://localhost` 访问。

## 部署

推送到 GitHub 后，在 **Settings → Pages → Source** 选择 **GitHub Actions**。仓库内的 `pages.yml` 会自动发布。

站点地址：`https://<用户名>.github.io/powerdex/`

## 数据说明

数据来自公开评测与用户提供的测试点，属于待复核档案。发现错误可直接修改 JSON，并在 `notes` / `sources` 中记录依据。

## 许可证

GPL-3.0，完整条款见 [LICENSE](LICENSE)。
