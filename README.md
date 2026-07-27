# Tourgrid Studio

《明日方舟》“巡展像素”非官方在线编辑器。

用户可以导入图片并调整正方形裁切区域，由浏览器在本地将图片转换为固定 24×24 的像素画，并严格限制到版本化色板。图片不会上传；转换后仍可逐像素编辑、统计颜色并导出 PNG 或图纸。

## 当前状态

阶段五部署交付包已经建立：

- Python 转换程序已经模块化并保留 CLI。
- FastAPI 提供版本化色板和图片转换 API。
- 网页仅使用浏览器本地固定64色色板转换，图片不会上传。
- 后端 Pyxelate 转换 API 和 CLI 仍作为独立能力保留，不由当前网页调用。
- 右侧按固定顺序连续展示64色，提供最近色吸管、只读用色统计与画布高亮。
- 前端已拆分为 HTML、CSS 和多个 JavaScript 模块。
- 存档包含来源、色板版本和转换器版本，并兼容旧版 localStorage。
- 裁切区支持鼠标、单指移动和双指缩放。
- 支持原始尺寸 PNG、最近邻放大图和拼豆图纸导出。
- 固定视觉测试集覆盖合成头像、透明 PNG、横图、竖图和 4096×3072 大图。
- 真实转换结果使用 24×24 PNG、最近邻预览和像素 SHA-256 进行回归。
- API 并发槽位、排队超时和子进程处理超时均有自动测试。
- 桌面、平板、手机横屏和手机竖屏提示已完成浏览器回归。
- Docker Compose 同源部署 Caddy 静态前端与 FastAPI。
- 生产 API 容器以非 root 用户运行，并具备健康检查、上传限制和只读根文件系统。
- Caddy 负责反向代理、自动 HTTPS、请求体限制、安全响应头和 JSON 访问日志。
- API 提供请求 ID、转换接口限流和可选 Sentry 异常上报。
- GitHub Actions 自动执行完整测试、镜像构建和同源烟雾测试。
- Chromium 真实浏览器回归覆盖初始状态、绘制、撤销重做、导入、参考图持久化和 PNG 导出。
- 自动恢复存档与手动保存点相互独立，手动保存点可以恢复并支持再次撤销。

当前默认色板 `natural-64-v1` 是临时预测色板。未来正式色板必须使用新的 ID（例如 `official-v1`），不能覆盖旧版本。

## Docker 部署

```powershell
Copy-Item deploy/.env.example deploy/local.env
docker compose --env-file deploy/local.env up --detach --build --wait
```

本地访问 `http://localhost:8080/`。域名、HTTPS、测试环境、正式发布、灰度边界和回滚步骤见
[部署与发布](docs/deployment.md)。

## 仓库结构

```text
tourgrid-studio/
├─ backend/                 # 转换核心、CLI 与 FastAPI
│  └─ api/                  # 上传校验、转换调度、预览缓存
├─ frontend/
│  ├─ index.html
│  ├─ css/editor.css
│  └─ js/
│     ├─ storage.js         # 存档校验和版本迁移
│     ├─ state.js           # 编辑器状态和色板数据
│     ├─ editor.js          # Canvas 编辑、撤销和导航器
│     ├─ export.js          # PNG 与图纸导出
│     ├─ import.js          # 裁切、本地固定色板转换和参考图
│     └─ app.js             # 工具、色板和页面控制
├─ palettes/                # 版本化色板 JSON
├─ tests/                   # 后端和前端行为测试
├─ docs/                    # 架构、API 和阶段说明
├─ LICENSES/                # 第三方许可证
├─ convert_image.py         # 兼容的图片转换命令入口
└─ pyproject.toml
```

## 安装

需要 Python 3.11～3.13、Git，以及能够安装科学计算依赖的环境。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

若需要完全复现锁定环境：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

## 启动编辑器

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

然后访问：

- 编辑器：`http://127.0.0.1:8000/`
- API 文档：`http://127.0.0.1:8000/docs`

推荐始终通过 FastAPI 打开编辑器，不要直接双击 `frontend/index.html`。同源运行可确保静态资源和版本化色板使用同一个服务版本。

## 图片导入模式

网页仅提供浏览器本地转换。该模式直接将裁切后的像素映射到内置的
`natural-64-v1` 固定64色色板，可选 Floyd–Steinberg 或 Atkinson 误差扩散。
图片不会上传服务器，结果严格属于版本化色板。

后端 Pyxelate 转换 API 继续用于独立调用、自动测试和开发集成，但当前网页导入流程不会调用 `POST /api/v1/convert`。

## 命令行转换

```powershell
.\.venv\Scripts\python.exe convert_image.py input.png
```

或：

```powershell
.\.venv\Scripts\python.exe -m backend input.png
```

实验性两阶段映射必须显式选择：

```powershell
.\.venv\Scripts\python.exe -m backend input.png --mapping-mode two-stage
```

## API

已实现：

- `GET /api/v1/health`
- `GET /api/v1/palettes`
- `GET /api/v1/palettes/{palette_id}`
- `POST /api/v1/convert`
- `GET /api/v1/results/{result_id}/preview.png`

完整参数、限制和响应格式见 [API v1](docs/api-v1.md)。
阶段四素材、基线更新规则和浏览器矩阵见
[阶段四测试报告](docs/stage-4-test-report.md)。
参考图本地持久化范围和撤销状态的后续事项见
[已知限制与后续提醒](docs/known-limitations.md)。

## 测试

开发依赖安装完成后，还需要安装 Chromium 测试运行时：

```powershell
.\.venv\Scripts\python.exe -m playwright install chromium
```

运行全部测试（包括真实浏览器回归）：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

只运行真实浏览器回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -m browser
```

只运行不需要浏览器的快速测试：

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not browser"
```

### 测试分层

- `tests/test_*.py`：转换核心、API、部署、静态前端契约和确定性视觉基线。
- `tests/browser/conftest.py`：自动启动临时 FastAPI 服务，并为每条用例创建隔离的 Chromium 上下文。
- `tests/browser/helpers.py`：绘制、导入、清空和状态读取等公共操作。
- `tests/browser/test_core_workflows.py`：用户可见核心流程的真实浏览器回归。
- `tests/fixtures/`：所有测试共享的确定性图片素材与转换基线。

浏览器用例通过 `?test=1` 启用只读的 `window.__TOURGRID_TEST__` 状态接口。普通访问不会暴露该接口；测试仍通过真实按钮、文件输入、Canvas 指针和下载事件执行操作，只使用接口读取断言所需状态。

### 浏览器回归条目

| 编号 | 当前条目 | 核心断言 |
| --- | --- | --- |
| BR-001 | 初始编辑器状态 | 24×24 全白画布、64色、撤销上限100、无参考图 |
| BR-002 | 连续绘制与撤销重做 | 一次连续笔画只产生一个历史步骤，像素可完整撤销和重做 |
| BR-003 | 统计模式只读 | 切换统计后画布内容不允许改变 |
| BR-004 | 浏览器本地导入 | 输出严格24×24、颜色全部属于固定64色、参考图为256×256 |
| BR-005 | 清空后的完整历史恢复 | 像素和参考图可一起撤销，重做后回到空白 |
| BR-006 | 两次导入的历史切换 | 撤销和重做分别恢复对应像素矩阵与独立参考图 |
| BR-007 | 刷新持久化 | 像素、参考图、开关和透明度可恢复；清空刷新后仍为空白 |
| BR-008 | 原始 PNG 导出 | 下载成功、尺寸24×24、像素颜色不超出固定色板 |
| BR-009 | 手动保存点 | 恢复对应像素和参考图，并可撤销恢复操作 |

维护规则：

1. 新增核心用户流程时，在上表分配新的 `BR-xxx` 编号，并在 `tests/browser/` 增加对应测试。
2. 删除或合并功能时，同步删除或合并测试，并在表中保留编号变更说明，避免条目含义悄然改变。
3. 图片导入测试优先复用 `tests/fixtures/` 的确定性素材；新增素材时应说明用途。
4. 业务矩阵、历史栈和版本信息使用只读测试接口精确断言；布局与视觉外观另设截图基线，不与功能断言混合。
5. 每条测试使用独立浏览器上下文，不得依赖其他测试留下的 localStorage、IndexedDB 或下载文件。

其他自动测试覆盖：

- 固定色板约束和 24×24 输出
- 相同输入和版本的稳定性
- API 上传类型、大小、尺寸、并发和超时限制
- 前端静态资源入口
- localStorage 历史 schema 到当前版本的迁移
- 网页仅使用浏览器本地固定色板转换，不发送转换 POST
- 旧版服务器转换来源存档兼容
- 原始 PNG 与最近邻预览导出契约
- 所有前端 JavaScript 文件的语法

## 许可证与声明

图片像素化使用 [Pyxelate](https://github.com/sedthh/pyxelate)。其 MIT 许可证和版权声明保存在 `LICENSES/Pyxelate-LICENSE.txt`。

Tourgrid Studio 是非官方项目，与鹰角网络或《明日方舟》官方无隶属关系。
