# Perler to Perfect：生产级拼豆图纸实施方案

> 评估日期：2026-08-06<br>
> 当前仓库状态：MVP `0.3.0` 已具备导入、生成、自适应选色、边缘感知清理、精修、工程保存、PNG/ZIP 导出和 RedInk 联动；浏览器端到端测试尚未实现<br>
> 参考项目评估基线：`Zippland/perler-beads`，提交 `2efee730f73dd4eb472ebde443a022d11f98bc21`（2026-05-14）

本文同时记录已落地的 MVP 和后续设计。未特别标为“当前 MVP”的内容均是目标或待实现项，不能据此认定功能已经上线。

## 1. 目标与验收定义

首版是桌面优先、纯浏览器本地运行的拼豆图纸工作台，主要处理插画、动漫图与 GPT-IMAGE 生成图。它不是“再生成一张看起来像拼豆的图片”，而是把图片转换为确定、可编辑、可统计、可复现的二维生产数据。

生产级结果必须同时满足：

1. 用户分别指定列数与行数，二者均为 `1–300`；最终矩阵尺寸必须与输入完全一致，不能因原图纵横比让另一边超过 300。
2. 每个格子只有两种状态：`EMPTY`（不放豆）或一个有效色板条目；不存在渐变、半透明或两个色号共占一格。
3. 导出时每个非空格都显示与矩阵一致的拼豆色号，文字必须被裁剪在本格内部，不能污染相邻格。
4. 图例中的每色数量及总数必须与矩阵逐格统计一致。
5. 同一输入、参数、色板版本和算法版本必须得到同一结果。
6. `300×300`、标准 221 色目录、16 个成图颜色的任务能在受支持的桌面 Chrome/Edge 中完成，不阻塞界面，也不因超大 Canvas 导致页面崩溃。

## 2. 外部项目与色卡评估

### 2.1 `Zippland/perler-beads` 的参考价值

该项目适合作为功能样板和算法原型，不适合直接作为本项目生产底座。

| 能力 | 可借鉴的思路 | 必须替换或加强的部分 |
| --- | --- | --- |
| 网格映射 | 每格取代表色，再映射到品牌色板 | 当前只限制横向 10–300，纵向按比例计算，竖图可能超过 300 |
| 色差 | 当前源码已使用 Oklab 距离，比直接 RGB 距离合理 | 生产版采用带参考测试的 CIEDE2000，并允许未来使用实测 Lab 数据 |
| 杂色处理 | 有颜色合并、连通区与洪水填充思路 | 当前主要按全图颜色频率合并低频色，可能错误吞并关键细节；改为受颜色上限约束的全局选色与小连通区清理 |
| 背景 | 边界连通背景去除对纯背景插画有效 | 必须先预览、可撤销，并把“空格”和白色拼豆彻底分开 |
| 编辑 | 已证明 Canvas 单格编辑和撤销可行 | 生产版使用差量历史、增量计数和可见区渲染，避免复制整个 300×300 矩阵 |
| 导出 | 带格线、坐标、色号和统计的 PNG 方向正确 | 固定 30px/格的整张 Canvas 在 300×300 时约为 9000px 见方，原始像素内存约 324MB；`toDataURL` 还会产生额外内存，需要 Worker、像素面积上限和分块导出 |
| 工程质量 | Next.js + React + TypeScript，结构易读 | 页面核心文件过大、没有自动化测试、图像处理在主线程，不能直接满足生产稳定性 |

许可证是硬边界：参考仓库采用 AGPL-3.0。首版选择独立重写，只借鉴公开的通用算法思想，不复制其源码、JSON/CSV 色板或品牌素材，以保留未来采用宽松许可证或闭源商业化的空间。

### 2.2 MARD 色板口径

[PixelBeads MARD 色卡页](https://www.pixel-beads.com/zh/mard-bead-color-chart) 对规格口径很有帮助：页面将 MARD 分为 291 个完整参考色号，其中 221 个标准色属于 A–H 与 M 系列，另有 P/Q/R/T/Y/ZG 共 70 个扩展色。它同时明确指出 24、48、72、96、120、144、168、192、216、221、264 通常是商家套装数量，不同商家的同数量套装不一定包含同一组颜色。用户见到的 46 色也应视为具体商家版本，而不是通用标准。

因此首版采用以下确定策略：

- 数据模型支持完整 291 色和任意品牌，但默认内置目标是结构清晰的 **MARD 标准 221 色目录**。
- “成图最多 16 色”与“可选目录 221 色”是两个不同概念：前者控制一张作品实际使用多少色，后者是算法可选择的库存范围。
- 24–264 色套装不做无来源的通用预设。用户通过 CSV/JSON 导入自己实际拥有的色号，或在 221 色目录中勾选库存子集。
- 扩展 70 色作为后续可选目录；没有实物库存或明确颜色特性时默认禁用。
- HEX 只能视为屏幕近似值。数据结构同时支持 D65 Lab、测量设备、批次和来源版本；有实测 Lab 时优先使用，否则从 sRGB 推导。
- 根据 2026-08-06 的产品决策，首版直接采用 PixelBeads 2026 重新修订色卡中的 A–H 与 M 系列 221 色，并记录页面来源、获取日期和数据校验哈希。
- 页面 HEX 只作为屏幕近似值；实体制作仍需考虑环境光、拍摄白平衡和不同生产批次的色差。应用继续保留 CSV/JSON 导入能力，便于替换或校准具体库存色板。

## 3. 产品流程与界面

目标产品采用六步工作流：

1. **导入图片**：支持 PNG、JPEG、WebP；校正 EXIF 方向；图片只在本机处理。首版限制单文件 25MB、解码后 4000 万像素，超限时在解码前或读取尺寸后拒绝并给出压缩提示。
2. **设置构图**：分别输入列数和行数；当前 MVP 默认 `crop`，通过拖动、缩放和裁切框取景，不允许拉伸变形。`contain` 仍保留在工程兼容类型中，但当前界面不提供切换；若恢复该模式，补边应为 `EMPTY` 而不是白色拼豆。
3. **设置色板**：选择 MARD 标准目录或导入色板，勾选实际库存，设置实际用色上限（默认 16，范围 2–64），可锁定必须保留色号或禁用色号。
4. **生成图纸**：Worker 显示解码、采样、选色、映射、清理的分阶段进度；支持取消。
5. **检查与精修**：Canvas 支持缩放、平移、格号开关、原图/图纸对比；基础工具为画笔、橡皮、撤销和重做。自动背景去除先显示候选遮罩，用户确认后才应用。
6. **导出**：生成母版 PNG、图例 PNG 和分块 PNG ZIP；另行导出项目 JSON，便于继续编辑。

当前 MVP 使用整张 Canvas 编辑，而非“仅渲染当前视口”；对 300×300 网格的虚拟化渲染仍是性能优化项。导出始终逐格显示色号。

当前 MVP 的已知边界如下，后续任务不应把它们写成已交付能力：

- 色号当前支持启用/禁用和锁定；锁定色数量受实际用色上限约束。
- “细节优先”会加强格内高对比候选和原图边缘保护，但不会关闭低对比小连通区清理。
- 实际用色数是硬上限而非目标值；默认以 `ΔE 4` 抑制缺乏区域支撑的相近色，锁定色不受该自动规则影响。
- 分块尺寸当前是 `29 / 50 / 75 / 100` 四个选项，尚不是任意 `10–100` 的自由配置。
- 母版 PNG 单独下载；图例 PNG 收录在分块 ZIP 内，不会作为第三个独立下载文件。

## 4. 技术架构与公共接口

### 4.1 技术栈

- Vite + React + TypeScript，采用静态部署；不引入服务端和图片上传接口。
- Zustand 管理界面状态；领域算法保持为无 React 依赖的纯 TypeScript 模块。
- 主预览使用 Canvas 2D；生成和导出使用 Web Worker + OffscreenCanvas。
- `idb` 封装 IndexedDB 自动保存，`zod` 校验外部文件，`fflate` 生成分块 ZIP。
- Vitest 覆盖领域与 Worker 测试，React Testing Library 覆盖组件，Playwright 覆盖端到端流程与导出。

首版目录边界固定为：

```text
src/
  domain/       # 网格、色板、色差、选色、连通区、统计、项目迁移
  workers/      # generate.worker 与 export.worker、消息协议
  rendering/    # 交互 Canvas 和 PNG 绘制原语
  persistence/  # IndexedDB、项目 JSON、色板导入
  features/     # import / compose / palette / editor / export
  test-fixtures/
```

### 4.2 核心类型

```ts
type CellIndex = number;              // PaletteManifest.colors 的索引
const EMPTY_CELL = 0xffff;            // 运行时 Uint16Array 空格哨兵

interface GridSize {
  columns: number;                    // 1..300
  rows: number;                       // 1..300
}

interface BeadColor {
  id: string;                         // 目录内稳定 ID，例如 mard:A1
  code: string;                       // 导出显示值；首版为 1..4 位 ASCII 字母/数字/连字符
  name?: string;
  srgbHex: `#${string}`;
  labD65?: { l: number; a: number; b: number };
  series?: string;
  tags?: string[];                    // standard / extended / transparent / glitter...
}

interface PaletteManifest {
  schemaVersion: 1;
  id: string;
  brand: string;
  edition: string;
  version: string;
  source: { label: string; url?: string; license?: string; retrievedAt?: string };
  colors: BeadColor[];                // 2..512，code 唯一且匹配 /^[A-Za-z0-9-]{1,4}$/
}

interface GenerationSettings {
  grid: GridSize;
  fit: 'contain' | 'crop';           // 当前默认 crop；contain 仅保留兼容能力
  transform: { scale: number; offsetX: number; offsetY: number };
  cropBox?: { x: number; y: number; width: number; height: number };
  maxUsedColors: number;              // 2..64
  enabledColorIds: string[];
  lockedColorIds: string[];
  cleanupRegionSize: 0 | 1 | 2 | 3 | 4;
  detailPriority: boolean;            // 当前默认 true；启用时关闭小区域清理
}

interface PatternProjectV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  algorithmVersion: string;
  palette: PaletteManifest;           // 快照，避免目录升级改变旧工程
  settings: GenerationSettings;
  cellsRle: Array<[cellIndex: number, runLength: number]>;
  source: { fileName: string; mimeType: string; sha256: string; thumbnailDataUrl?: string };
}
```

运行时矩阵使用行优先 `Uint16Array(rows * columns)`。项目 JSON 使用 RLE，必须包含色板快照和算法版本；导入旧版本时先迁移再校验。项目 JSON 不嵌入完整原图，以控制体积：重新打开后可以继续改单格并再次导出；若要重新取景或重新生成，提示用户重新选择哈希匹配的原图。IndexedDB 自动保存则保留原始 Blob，可完整恢复本机项目。

### 4.3 Worker 协议

生成 Worker 使用可判别联合类型：

```ts
type GenerateRequest =
  | { type: 'GENERATE'; jobId: string; bitmap: ImageBitmap; palette: PaletteManifest; settings: GenerationSettings }
  | { type: 'CANCEL'; jobId: string };

type GenerateResponse =
  | { type: 'PROGRESS'; jobId: string; stage: string; completed: number; total: number }
  | { type: 'RESULT'; jobId: string; cells: ArrayBuffer; counts: Array<{ colorId: string; count: number }> }
  | { type: 'ERROR'; jobId: string; code: string; message: string };
```

`ImageBitmap` 和结果 `ArrayBuffer` 必须通过 transferable 传递。新任务开始时取消旧任务；Worker 每处理固定批次检查取消标记，任何错误都返回稳定错误码，不把浏览器异常直接显示给用户。

## 5. 图像与颜色算法

### 5.1 取样和单格代表色

1. 当前 MVP 以 `crop` 将原图绘制到透明的 `4×` 采样画布；未覆盖区域保留透明度，并在生成矩阵中转为 `EMPTY`，不会被误判为白色拼豆。
2. 每个目标格采用固定 4×4 超采样；透明度低于 0.5 的样本忽略，有效覆盖率低于 25% 的格子为 `EMPTY`。
3. 当前 MVP 按 RGB 高 4 位分桶，选择格内样本最多的颜色桶并取其 RGB 均值；细节优先模式会在有足够覆盖时提升高对比次要颜色桶的得分。按 Lab 小色差聚类并使用加权中位色仍是待实现的精度优化，不应写成已实现算法。
4. 不在首版启用 Floyd–Steinberg 等抖动；插画模式要优先得到可制作的连续色块，而不是人为制造散点。

### 5.2 有限色板选色

色差统一使用 CIEDE2000，D65 白点。若色板提供实测 `labD65` 则直接使用，否则从 `srgbHex` 线性化后转换。

为保证“最多 K 色”是硬约束，先把所有非空格的代表色量化为带权 Lab 直方图，再在用户启用的拼豆色中执行确定性的固定候选 k-medoids：

1. 第一个色号选择使全图加权总色差最小的候选。
2. 逐个加入能最大幅度降低总误差的候选；新增颜色的全图加权平均色差收益至少为 `0.1`，或在至少 `max(1, 0.05% 加权样本)` 的原图边缘上带来 `ΔE ≥ 8` 的改善，因此 K 是上限而不是强制用满的配额。
3. 当前 MVP 不做候选交换优化；锁定色不可移除，禁用色永不进入候选。候选交换属于后续精度优化。
4. 每格映射到所选色号中 CIEDE2000 距离最近者；完全相同时按色板顺序稳定决胜。
5. 自动候选默认要求与已选颜色至少相距 `ΔE 4`；若相近色覆盖至少 8% 的加权样本且能显著降低误差，仍允许作为真实的大面积明暗层次保留。用户可把阈值调为 `0–12`，锁定色始终优先。

提交生成任务前必须验证：启用色不少于 2 个、`maxUsedColors` 不大于启用色数量、锁定色全部处于启用状态且锁定色数量不超过 `maxUsedColors`。不满足时直接阻止生成并定位到具体设置，不做隐式修正。

这比“先映射全部颜色，再按出现频率吞并低频色”更能保留小面积但视觉关键的眼睛、轮廓和高光。

### 5.3 杂色与背景

- 对 4 邻接连通区做可配置的低对比小区域清理，默认阈值为 2 格。当前 MVP 结合共享边界、原始采样色对候选色的拟合度、拼豆色差和原图边缘对比选择是否替换；只合并 `ΔE ≤ 10` 且缺乏原图边缘支撑的区域。细节优先时原图边缘保护阈值为 `ΔE 9`，关闭时为 `ΔE 15`，不会再完全跳过清理。锁定色不会被自动清理，人工编辑只发生在生成后，因此不会被同一次生成覆盖。
- 自动背景检测在当前 MVP 中是可预览、可取消的边缘连通清理，不属于 `GenerationSettings.background` 配置；确认后转为 `EMPTY`，并产生一条可撤销历史。
- `EMPTY` 永远不出现在色板、图例和采购计数中。白色拼豆是普通颜色，可与空格并存。

## 6. 编辑、持久化与导出

### 6.1 基础精修

- 画笔：从当前色板选择色号，点击或拖动修改格子；一次连续拖动合并为一条历史。
- 橡皮：把格子改为 `EMPTY`。
- 撤销/重做：保存格子索引及前后值的差量，最多 200 条；不复制整个矩阵。
- 每次修改增量更新颜色计数与总数，并将自动生成的格子和人工修改的格子分别标记，避免后续自动清理覆盖人工结果。
- 自动保存采用 1 秒防抖；页面关闭前刷新最近变更。启动时列出本机项目，损坏记录隔离而不是覆盖。

### 6.2 PNG 规范

母版和分块都使用同一组绘制原语，确保显示一致：

- 单元格填充以整数像素边界绘制，关闭图像平滑；色号文字在每格独立 `clip()` 后绘制。
- 色号字体使用内置等宽字体栈并按 1–4 字符自适应；依据 WCAG 对比度在黑字和白字之间选择。
- 基础格线 1px，每 10 格绘制加粗定位线；四边显示全局行列坐标。
- 非空格必须显示色号；空格保持白底并不显示文字。旧工程或异常数据中若出现不符合 1–4 位规则的色号，导出前报错并指出具体色号，不能静默截断。

母版默认从 24px/格开始，主 Canvas 总像素面积硬限制为 6400 万像素；必要时自动降到最低 16px/格。当前 MVP 不提供用户自定义母版格子像素。导出在 Worker 的 OffscreenCanvas 中执行，使用 `convertToBlob('image/png')`，不使用 `toDataURL`。当前还支持默认开启的可选水印，编辑画布、最终效果和导出会保持一致。

ZIP 内容固定为：

```text
<项目名>-png/
  <项目名>-master.png
  <项目名>-legend.png
  tiles/
    r001-050_c001-050.png
    r001-050_c051-100.png
    ...
```

当前分块格数可选 29、50、75 或 100，默认 50；边缘块允许不足设定值。分块使用 32px/格，文件名和图片标题均使用全局坐标，块之间不复制或重叠格子。图例 PNG 按色号列出色块、数量、总豆数、网格尺寸、目录 ID/版本；当前图例包含在 ZIP 中。

## 7. 测试与发布门槛

### 7.1 自动化测试

**领域单元测试**

- `1×1`、`300×300`、越界、空图、全透明、极端横竖图的尺寸与 `contain/crop` 行为。
- 25MB/4000 万像素输入上限、解码失败、无效 MIME、已损坏图片和 EXIF 方向。
- sRGB→Lab 与 CIEDE2000 使用公开标准样例验证误差；缓存不能改变结果。
- 有限色板选色始终满足颜色上限、锁定色、禁用色和稳定决胜规则。
- 白色与 `EMPTY` 分离，边界背景只删除连通区域，封闭白色区域不被误删。
- 小区域清理不修改人工编辑格；计数和总数始终等于矩阵事实。
- RLE 往返、损坏 JSON、未知 schema、迁移、重复色号和非法 HEX。

**渲染与导出测试**

- 使用合成图验证 1–4 字符色号、深浅底色对比、坐标、10 格加粗线和边缘分块。
- 对相邻格逐像素检查，确认填充和文字裁剪不越过格子边界。
- 解压 ZIP 后验证母版、图例和全部分块的文件名、尺寸、覆盖范围；每个全局坐标恰好出现一次。
- `300×300` 导出不得创建超过 6400 万像素的单个 Canvas；失败时释放 Bitmap、Canvas 和 Object URL。

**端到端测试**

- 当前仓库只有领域、持久化和 Worker 客户端的 Vitest 测试；Playwright 依赖已安装，但尚无 Playwright 配置或端到端用例。
- 导入合成插画，设置 `58×66 / 15 色`，生成、背景预览、改单格、撤销重做、刷新恢复、导出并验证数量。
- 导入 `300×300 / 16 色` 压力样例，任务可取消，界面仍可操作，最终得到母版与默认 50×50 分块 ZIP。
- 导入自定义 CSV/JSON 色板，重新打开项目后仍使用工程内的色板快照，不受目录更新影响。

### 7.2 性能与兼容目标

支持当前稳定版 Chrome 和 Edge 的桌面环境，基准机为 8GB 内存、现代 8 线程 CPU：

- `300×300`、221 候选色、16 输出色的生成目标不超过 10 秒。
- Worker 运行期间主线程不得出现超过 100ms 的算法长任务；普通画笔反馈目标低于 50ms。
- 300×300 母版及默认分块导出目标不超过 30 秒，且页面不崩溃；任何阶段均可取消并释放资源。
- Safari 和移动端不作为首版发布门槛；能力检测失败时明确说明缺少 OffscreenCanvas/Worker 支持。

## 8. 实施顺序

1. **补齐质量基线**：为现有 Vitest 用例接入 lint、format、Playwright 配置和 CI，新增真实浏览器的导入、生成、编辑、导出回归用例。
2. **提升转换精度**：保留透明补边已落地；后续实现 Lab 格内聚类、候选交换优化和可复现黄金样例，优先验证 104×104、40 色的角色图。
3. **完善工作台能力**：补上可见区 Canvas 渲染，以及明确的主体/文字清理预览与撤销边界。
4. **完善生产导出**：补足图例元数据、任意合法分块尺寸和像素边界/文件覆盖测试；保持母版、图例与分块使用同一份矩阵事实源。
5. **接入 RedInk 系列合集**：已完成安全交接、图纸回传、用户确认追加和发布链路兼容；剩余浏览器端到端验收。
6. **发布验收**：跑完整测试矩阵，核对内置色板来源与版本，记录基准性能，用至少三张自有插画人工复核轮廓、色号、计数和实体库存可用性。

首版不包含：照片模式、颜色抖动、移动端/PWA、服务端处理、多人协作、区域填充/框选替换、PDF/SVG、跨品牌自动换算和电商采购接口。这些能力只能在上述生产不变量和 300×300 稳定性通过后进入后续版本。

## 9. RedInk 系列合集联动实现方案

### 9.1 范围与用户流程

联动只针对系列合集的单张角色图片。RedInk 在图片操作区提供“生成拼豆图纸”按钮；默认流程先填写行数、列数和最大用色数，再通过离屏 iframe 打开携带 `requestId` 的 Perler 自动入口。自动入口返回就绪消息后，RedInk 把原图二进制交给 Perler，并在本页展示生成进度和母版预览，不需要用户切换窗口。预览页仍保留“进入 Perler 精修”，该操作才会打开原有完整工作台。

RedInk 生成阶段新增“拼豆源图”约束：单主体、主体占画面主要区域、无文字/标题/水印/边框/拼贴、轮廓清晰、有限色、大色块和干净背景。它是供转换使用的源图，不替代正常发布图；用户仍可在 Perler 中裁切、清理背景、保留主体和手动精修。

自动入口收到源图后使用 RedInk 传入的网格与用色上限，首次默认 `104×104`、最多 40 色，并固定启用细节优先、`ΔE 4` 相近色抑制和 2 格低对比清理。最多 40 色仍只是上限，算法会在边际收益不足时提前停止。生成后仅清除一次与边缘连通的主背景色，只渲染并回传母版 PNG，不读写工作台自动保存，也不生成图例、分块 ZIP 或本地下载。进入完整工作台精修后，原有编辑、工程保存和 PNG/ZIP 导出行为保持不变。

回传后 RedInk 必须显示确认弹窗：“将这张拼豆图纸追加到该子主题的最后一张图片吗？”只有点击确认才持久化。取消、关闭弹窗、Perler 页面关闭、超时或回传校验失败都不能改动历史记录或发布序列。

### 9.2 浏览器交接与线上配置

本地默认 origin 为 RedInk `http://localhost:5173`、Perler `http://localhost:5174`。线上部署分别通过 `VITE_PERLER_ORIGIN` 和 Perler 的允许 RedInk origin 配置注入实际 HTTPS origin；Perler 的响应头还必须通过 CSP `frame-ancestors` 精确允许 RedInk origin。每次 `postMessage` 都使用精确 `targetOrigin`，接收端也严格比较 `event.origin`，禁止使用 `*`。

消息使用版本化、可判别的协议。`requestId` 由 RedInk 生成并贯穿整次会话，消息中不携带 API Key、Cookie、完整历史记录或可猜测的本地文件路径：

```ts
type PerlerHandoffMessage =
  | { channel: 'redink-perler'; version: 1; type: 'PERLER_READY'; requestId: string }
  | {
      channel: 'redink-perler'; version: 1; type: 'IMPORT_IMAGE'; requestId: string;
      context: { recordId: string; imageIndex: number; fileName: string };
      image: ArrayBuffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    }
  | {
      channel: 'redink-perler'; version: 1; type: 'PATTERN_READY'; requestId: string;
      pattern: ArrayBuffer; mimeType: 'image/png';
      metadata: { columns: number; rows: number; usedColors: number };
    };
```

自动入口使用独立的 `redink-perler-auto`、版本 `1` 协议，消息依次为 `AUTO_READY`、`AUTO_GENERATE`、`AUTO_PROGRESS`、`AUTO_PATTERN_READY` 或 `AUTO_ERROR`。`AUTO_GENERATE` 除原图和来源上下文外，还携带 `columns`、`rows`、`maxUsedColors` 与固定为 `true` 的 `removeBorderBackground`；原有 `redink-perler` 手动协议保持兼容，只为 `IMPORT_IMAGE` 增加可选规格字段。

二进制通过 transferable `ArrayBuffer` 传递，避免 Data URL 额外复制。Perler 仅接受来自允许 RedInk origin、与当前窗口会话匹配且 `requestId` 有效的消息；RedInk 仅接受来自配置 Perler origin、`event.source` 等于其刚打开窗口且 `requestId` 匹配的回传。双方限制 MIME、字节大小、解码像素和超时，并在窗口关闭时清理监听器和待处理请求。交接无需让 Perler 跨域下载 RedInk 的图片，也不需要开放图片目录。

### 9.3 确认追加与历史/发布兼容

确认后的上传必须由 RedInk 后端处理：校验目标历史记录归属、PNG MIME 和实际解码结果、尺寸及大小上限，再以新文件名写入该记录已有的 `history/<task_id>/` 图片目录。不得信任前端传来的目标路径、文件名或页面序号。

后端在单次持久化中完成以下更新，并返回完整、已同步的历史记录：

1. 在 `outline.pages` 尾部增加 `{ type: 'pattern', ... }` 页面，并保存来源图片索引和网格元数据。
2. 在同一索引的 `images.generated` 尾部追加已保存的图纸文件名，使“页面数 = 图片槽位数”的现有不变量继续成立。
3. 结果页显式识别 `pattern` 页面类型并关闭普通重生成；历史图库、下载与发布沿用按索引排列的图片槽位，因此会保留图纸在末位且不触发文案生成。
4. 发布时按原图顺序后附图纸，确保图纸自动成为该子主题的最后一张；未确认的图纸不能出现在历史、下载或发布中。

接口应采用一个专用、经校验的“确认追加图纸”端点，而不是复用通用图片生成或让前端直接改写 `outline`。该端点应当幂等：相同 `recordId + requestId` 的重复提交只返回第一次创建的图纸页，避免网络重试产生两张尾页。

### 9.4 联动验收

- 本地和线上配置均能成功交接，非允许 origin、错误版本、错误 requestId、超限文件和非 PNG 回传均被拒绝。
- Perler 在 104×104、40 色初值下可生成可编辑图纸；无文字/边框的拼豆源图不因空白补边额外产生白色边框。
- 回传后未点击确认时历史 JSON、图片目录、页面数量和发布序列均保持不变。
- 确认一次恰好新增一个 `pattern` 页面和同索引图片；重复回传或重复确认不产生重复页。
- 追加后刷新历史、下载、重新打开结果页和小红书发布校验均能看到图纸在末位；图例和 ZIP 不会被误写入 RedInk 历史。

## 10. 最终建议

`Zippland/perler-beads` 值得参考其产品流程、矩阵数据思路、背景洪水填充和色号导出表现，但应保持“看思路、独立实现”的边界。项目真正的生产价值不在于生成更像拼豆的预览，而在于：以版本化色板和严格矩阵作为唯一事实源，把算法、人工校正、数量统计和 PNG 导出全部绑定到同一份数据上。

MARD 规格不应在 168 与 264 之间二选一。首版以标准 221 色目录作为可追溯的基础能力，再让用户用库存子集和 2–64 的实际用色上限控制成本；商家套装通过明确版本的导入文件表达。这样既不会输出用户买不到的颜色，也不会因套装名称相同而错误假定其内容一致。
