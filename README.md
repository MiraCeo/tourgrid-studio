# Tourgrid Studio

《明日方舟》“巡展像素”非官方在线编辑器。

当前仓库已完成阶段二：在保留原有单文件前端行为的同时，图片转换程序已经模块化，并提供带安全限制和处理超时的 FastAPI 服务。

## 当前结构

```text
tourgrid-studio/
├─ backend/                 # 可复用转换核心与 CLI
│  └─ api/                  # FastAPI、上传校验、子进程转换与预览缓存
├─ palettes/                # 版本化色板
├─ tests/                   # 自动测试
├─ LICENSES/                # 第三方许可证
├─ docs/                    # 设计和迁移说明
├─ convert_image.py         # 图片转换命令入口
└─ 像素画编辑器.html         # 原有单文件前端，阶段一保持不变
```

当前默认色板是临时预测色板 `natural-64-v1`。未来正式色板必须以新的 ID（例如 `official-v1`）加入，不得覆盖该文件。

## 安装

需要 Python 3.11～3.13、Git，以及能够安装科学计算依赖的环境。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

Pyxelate 尚未发布当前代码对应的 PyPI 包，因此依赖固定到其官方 GitHub 仓库的精确提交，避免安装结果随 `master` 漂移。

需要完全复现本次验证环境时，可以改用锁定文件：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

## 转换图片

原命令继续可用：

```powershell
python convert_image.py input.png
```

也可以使用模块入口：

```powershell
python -m backend input.png
```

默认行为：

- 输出尺寸：24×24
- 色板：`natural-64-v1`
- 映射：`direct`
- 抖动：`none`
- Sobel：3
- depth：1
- SVD：启用
- 适配：中心裁切

实验性的两阶段映射仍可显式选择：

```powershell
python -m backend input.png --mapping-mode two-stage
```

## 可复用接口

```python
from pathlib import Path

from backend.converter import ConversionOptions, convert_path

result = convert_path(
    Path("input.png"),
    options=ConversionOptions(width=24, height=24),
)

print(result.palette_id)
print(result.used_colors)
print(result.pixels)
print(result.hex_pixels)
```

转换结果直接携带颜色 ID 矩阵和十六进制矩阵，后续 FastAPI 可以直接序列化这些数据，无需重新分析输出 PNG。

## 启动 API

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

服务默认地址为 `http://127.0.0.1:8000`，接口文档位于 `http://127.0.0.1:8000/docs`。

已实现：

- `GET /api/v1/health`
- `GET /api/v1/palettes`
- `GET /api/v1/palettes/{palette_id}`
- `POST /api/v1/convert`
- `GET /api/v1/results/{result_id}/preview.png`

上传图片不会落盘保存。转换在可终止的独立子进程中执行，预览图只进入短期有界内存缓存。完整参数、限制和响应格式见 [API v1 文档](docs/api-v1.md)。

## 测试

```powershell
python -m pytest
```

测试覆盖色板格式、64 色唯一性、版本元数据、默认 CLI 参数、输出尺寸、色板约束、结果矩阵、稳定性和最近邻预览尺寸。

## 第三方项目

图片像素化使用 [Pyxelate](https://github.com/sedthh/pyxelate)，其 MIT 许可证和版权声明保存在 `LICENSES/Pyxelate-LICENSE.txt`。

Tourgrid Studio 与鹰角网络或《明日方舟》官方无隶属关系。
