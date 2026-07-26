# 阶段一架构与兼容性说明

## 基线

项目初始版本由两个文件组成：

- `1.py`：内嵌色板、转换算法、文件输出与命令行参数。
- `像素画编辑器.html`：包含全部 HTML、CSS、JavaScript 和 MARD 色板数据。

原始文件已在 Git 根提交中保存。阶段一不改造前端页面。

## 转换模块边界

`backend.converter` 现在提供三层入口：

1. `convert_array`：接收 NumPy RGB/RGBA 数组。
2. `convert_pillow_image`：接收 Pillow 图片并处理 EXIF 和裁切。
3. `convert_path`：接收本地图片路径。

三者都返回 `ConversionResult`，其中包含：

- 宽高；
- 色板 ID 和版本；
- 转换器版本；
- 使用的颜色 ID；
- 颜色 ID 矩阵；
- 十六进制颜色矩阵；
- 可直接保存的 NumPy 图像；
- 映射方式及实验模式统计。

文件写入被分离到 `save_conversion`，方便后续 FastAPI 在内存中转换而不保存用户原图。

## 兼容策略

- `python 1.py ...` 仍然调用新 CLI。
- 原默认参数保持不变。
- `direct` 继续是默认映射。
- `two-stage` 仅在显式选择时启用。
- 默认输出文件名仍为 `<输入名>_24x24.png` 和 `<输入名>_24x24_preview.png`。
- 新增的宽高参数默认均为 24，不影响原命令。

## 色板版本策略

`palettes/natural-64-v1.json` 是不可变的已发布色板版本。其元数据明确标记为 `provisional`。

新增正式色板时：

1. 创建新 JSON 文件；
2. 使用新的稳定 ID；
3. 从版本 1 开始；
4. 不修改已有色板的 RGB、颜色 ID 或含义；
5. 只有修正文档性错误时才允许修改已有文件，并必须记录兼容性影响。

## 透明像素

转换输出中的可见像素必须属于所选色板。完全透明的像素在 `pixels` 和 `hex_pixels` 中表示为 `null`，其隐藏 RGB 值不参与色板验证。正式 API 接入前仍需确定前端是保留透明还是统一合成白底。
