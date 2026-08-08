# Tourgrid Studio（旅行「像」框）

Tourgrid Studio 是项目名、仓库名及英文品牌名称；网站中文名称为
“旅行「像」框”。它是一款非官方的 24×24 像素画编辑器。

用户可以在浏览器中导入并裁切图片，将其转换为严格 24×24、限定
`official-40-v1` 官方色板的像素画。色板包含40种颜色，其中 `#FFFFFF`
同时作为白色和橡皮颜色。原图和裁切参考图只保存在浏览器本地；
服务器只负责静态页面、版本化色板查询，以及不可变作品的保存与凭码读取。

## 当前能力

- 浏览器本地图片读取、正方形裁切、亮度/对比度/饱和度与颜色滤镜实时预览；
  提供照片平滑平均和像素画中心代表色两种采样方式；主预览在处理后原图与
  最终色板结果之间切换，另可明确标识地参考非最终的24×24真彩中间采样；
  像素画模式可叠加24×24对齐网格。预览模式切换复用转换结果，移动或缩放后
  可一键复位初始裁切；手机旋转、地址栏伸缩或桌面窗口变化时会保持同一来源
  裁切区域，不会因预览框尺寸变化跳到图片的其他位置。
- PNG、JPEG和WebP会先读取文件头尺寸；超过600万像素或任一边超过4096像素时，
  浏览器在解码阶段直接降采样到安全范围，避免完整大图与Data URL副本叠加导致
  移动端内存压力。降采样仍完全发生在本地。
- 可限制最终使用的色板颜色数量；缩减颜色时按全画面加权误差逐步选择候选色，
  并轻度提高高对比边缘格子的权重。最终色板匹配以加权RGB为主，仅在高饱和
  像素的候选误差接近时使用保守色相保护。
- 导入状态行根据真彩采样到当前目标色板的归一化加权RGB误差，提示色板适配
  “较好”“一般”或“偏差较大”，不增加额外设置项。
- 无抖动、蛇形 Floyd–Steinberg、蛇形 Atkinson、Bayer 2×2 和 Bayer 4×4
  五种本地转换方式；非“无抖动”模式支持强度调整。
- 24×24 Canvas 逐像素绘制、白色橡皮、撤销重做、本地自动保存状态和手动保存点。
- 20%～400%缩放、画布移动、导航器、参考图透明度和辅助线开关。
- 上色、替换、复刻三面板；替换支持三种用色排序、加权RGB相关颜色推荐、
  吸管多选和批量替换为官方颜色，复刻支持单格点击、连续拖动和整色批量切换进度。
- 原始24×24 PNG、16倍最近邻放大图和拼豆图纸导出。
- 裁切参考图以256×256 WebP保存到浏览器 IndexedDB。
- PostgreSQL以432字节色板索引保存不可变作品。
- 发布前二次确认不可变画面和署名；相同像素内容返回同一个12位Base58分享码。
- 支持复制完整分享链接，并可从纯分享码或包含 `work=` 的链接读取作品。
- Caddy、FastAPI、PostgreSQL和Redis组成同源Docker Compose部署。

当前默认色板是 `official-40-v1`：40种颜色来自正式活动资源中的色板数据，
`#FFFFFF` 同时用于白色绘制、空白画布和橡皮。图片转换会在全部40色中匹配。
`natural-64-v2` 暂时保留为旧作品迁移所需的
只读色板定义；`natural-64-v1` 仅作为早期探索记录保存在归档目录。

## 架构边界

```text
浏览器
├─ 图片裁切与官方40色转换
├─ Canvas编辑与本地工程状态
├─ 参考图IndexedDB存储
└─ 导出PNG/图纸

Caddy
├─ 静态前端
└─ /api、/docs、/openapi.json -> FastAPI

FastAPI
├─ 健康检查
├─ 版本化色板查询
├─ 不可变作品保存、读取与管理员软删除 -> PostgreSQL
└─ 浏览去重、共享限流与临时封禁 -> Redis
```

服务器不再接收用户图片，也不提供服务器图片转换或临时预览接口。

## 仓库结构

```text
tourgrid-studio/
├─ backend/
│  ├─ palette.py            # 版本化色板读取与校验
│  └─ api/                  # FastAPI、作品仓库、限流与监控
├─ frontend/
│  ├─ index.html
│  ├─ css/editor.css
│  └─ js/
│     ├─ official-40-v1.js  # 浏览器当前官方40色色板
│     ├─ natural-64-v2.js   # 旧64色色板迁移定义
│     ├─ import.js          # 裁切与浏览器本地转换
│     ├─ editor.js          # Canvas、历史与导航器
│     ├─ app.js             # 工具、上色、替换与复刻面板
│     ├─ export.js          # PNG与图纸导出
│     ├─ storage.js         # 本地存档与迁移
│     ├─ reference-storage.js
│     ├─ work-codec.js
│     └─ works.js
├─ palettes/                # 运行时版本化色板JSON（archive/不参与读取）
├─ tests/                   # API、存储、前端契约与浏览器回归
├─ docs/                    # API、部署与阶段文档
├─ docker/
├─ deploy/
└─ pyproject.toml
```

## 本地安装

需要Python 3.11～3.13。项目只支持从完整的源码仓库运行，不发布或支持独立
wheel/PyPI安装包；运行时需要仓库中的 `backend/`、`frontend/`、`palettes/`
和数据库迁移文件保持相对目录结构不变。Pillow仅用于开发测试，不会进入生产依赖。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock
.\.venv\Scripts\python.exe -m playwright install chromium
```

## 本地启动

必须在仓库根目录执行：

```powershell
.\.venv\Scripts\python.exe -m backend
```

- 编辑器：`http://127.0.0.1:8000/`
- API文档：`http://127.0.0.1:8000/docs`

直接启动但未配置 `TOURGRID_DATABASE_URL` 时，编辑、导入和导出仍可使用；作品
保存接口会返回 `503 work_storage_unavailable`，依赖就绪检查
`GET /api/v1/ready` 也会返回503。基础存活检查 `GET /api/v1/health`
仍会返回200。

## Docker部署

```powershell
Copy-Item deploy/.env.example deploy/local.env
docker compose --env-file deploy/local.env up --detach --build --wait
```

本地示例通过 `TOURGRID_BIND_ADDRESS=127.0.0.1` 只允许当前电脑访问。访问
`http://localhost:8080/`。正式模板同样只绑定回环地址，由宿主机Nginx代理到
8081；测试环境可让Caddy直接接受外部流量。正式域名、HTTPS、备份和回滚见
[部署与发布](docs/deployment.md)。

## API

- `GET /api/v1/health`
- `GET /api/v1/ready`
- `GET /api/v1/palettes`
- `GET /api/v1/palettes/{palette_id}`
- `POST /api/v1/works`
- `GET /api/v1/works/{code}`
- `GET /api/v1/admin/works`
- `GET /api/v1/admin/works/{code}`
- `POST /api/v1/admin/works/{code}/hide`
- `POST /api/v1/admin/works/{code}/restore`
- `POST /api/v1/admin/works/{code}/purge`
- `POST /api/v1/admin/bans`
- `DELETE /api/v1/admin/bans`

管理员后台位于 `/admin/`，支持分页查看全部作品、直接预览24×24画面、状态筛选、
分享码查询、隐藏、恢复、永久清除和管理操作审计。管理员令牌只保存在页面内存中。

完整契约见 [API v1](docs/api-v1.md)。

## 测试

运行全部测试：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

只运行浏览器回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -m browser
```

测试分层：

- `tests/test_api.py`：健康、色板、作品接口和已删除路由契约。
- `tests/test_work_store.py`：内存作品仓库、Base58短码和内容去重。
- `tests/test_postgres_work_store.py`：可选的真实PostgreSQL集成测试。
- `tests/test_frontend.py`：前端静态结构、脚本语法和状态契约。
- `tests/browser/`：真实Chromium中的导入、绘制、复刻、持久化和导出流程。
- `tests/fixtures/`：浏览器本地转换使用的确定性源图片。

PostgreSQL集成测试需要设置 `TOURGRID_TEST_DATABASE_URL`，未设置时会跳过。
CI中的 `postgres-store` 作业会启动一次性PostgreSQL，并且只直接测试
`PostgresWorkStore` 的SQL读写和迁移，不经过HTTP、Caddy、Redis或浏览器。

浏览器回归主要覆盖：

1. 24×24全白初始画布与固定官方40色色板。
2. 连续绘制、撤销重做和手动保存点。
3. 复刻模式逐格点击与连续拖动、整色完成状态、旧进度迁移和本地持久化。
4. 透明图、横图和竖图的浏览器本地导入。
5. 256×256 WebP参考图持久化与完整历史恢复。
6. 24×24 PNG和最近邻放大图导出。
7. 432字节作品发布、12位分享码和凭码读取。
8. 640～900px窄屏顶部与导出菜单边界。

新增或删除核心用户流程时，应同步更新测试和
[阶段四测试报告](docs/stage-4-test-report.md)。

## 隐私与保存

- 原始导入图片不会上传服务器。
- 裁切参考图只保存到当前浏览器IndexedDB。
- 分享接口只接收432字节像素索引、色板版本及可选标题和作者。
- 浏览次数使用随机匿名Cookie，并在Redis中保存30分钟去重键。
- 被管理员永久封禁的客户端IP会保存在PostgreSQL；临时封禁仅保存在Redis。
- “永久保存”依赖PostgreSQL数据卷和可恢复备份，不代表无需运维。

## 声明

Tourgrid Studio 是非官方项目，与相关游戏、活动及其权利人不存在隶属、合作、
授权、赞助或背书关系。相关名称、活动名称、商标、美术和其他官方内容的权利归
各自权利人所有。

## 许可证

除特别说明外，Tourgrid Studio 中由 MiraCeo 原创的程序代码和原创文档自
`v0.3.1` 起采用 Apache License 2.0。

具体色板数据、官方来源内容、第三方素材和用户提交作品不属于 Apache-2.0
授权范围。正式英文说明及中文参考说明见：

- [Apache License 2.0](LICENSE)
- [License Scope / 许可范围](LICENSE_SCOPE.md)
- [Third-Party and Excluded Materials / 第三方与排除内容](THIRD_PARTY_NOTICES.md)
- [Palette Provenance / 色板来源](docs/legal/palette-provenance.md)

构建过程中下载的 Python 依赖和容器基础镜像继续适用其各自许可条款。
