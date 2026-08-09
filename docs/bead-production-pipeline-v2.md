# 拼豆生产管线 V2

本版本不再把“用色上限”和“杂色清理”当成互相替代的总开关。Perler 的最终矩阵仍是唯一生产事实源，但输入会被标记为普通原图或 `bead-source`，并使用结构感知的格级优化。

## 成图策略

- `shape`：强区域一致性，适合轮廓和大色块。
- `balanced`：默认，兼顾主体识别与画面干净度。
- `detail`：最低结构平滑，保留眼睛、饰品等高对比细节。

所有策略都遵守用户设置的 2–64 色硬上限。结构正则化只会修改弱边缘、且被至少三个相邻格包围的孤立格；高对比轮廓和锁定色不会被它吞并。

## Rednote 交接

Rednote 可先生成低纹理的拼豆源图，再通过 `redink-perler-auto` 自动交接。消息仍使用严格的 origin、window source 和 requestId 校验；V2 扩展字段为 `profile`、`sourceKind` 与 `sourceImageIndex`，旧调用方不发送这些字段时仍保持原有行为。

回传的 PNG 只在 Rednote 用户确认后才会保存。Perler 图纸最终仍由 MARD 221 色矩阵和导出 Worker 生成，Rednote 不复制或维护色卡。
