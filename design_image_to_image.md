# 参考图生图（Image-to-Image）架构设计方案

## 1. 业务目标

为 FlowAuto 扩展增加「多提示词 + 各自独立参考图」的批量生成能力。
核心诉求是**操作极简**和**实现轻量**，避免让用户学习复杂的提示词语法，也避免开发庞大的图片池管理 UI。

## 2. 最终方案：隐式同名匹配 + IndexedDB 本地缓存

### 2.1 核心体验与工作流 (Zero-Config)

用户侧只需保持最自然的本地操作习惯：
1. **组织素材**：用户在本地新建一个文件夹。里面放入一个 `prompts.txt`（包含多行 `filename, prompt`）。
2. **准备参考图**：对于需要参考图的提示词，用户将对应的图片放入同一文件夹，并命名为 `[filename].png` 或 `[filename].jpg`。
3. **一键导入**：在 SidePanel 界面上，用户点击「导入项目文件夹」按钮（基于 `<input type="file" webkitdirectory />`），选择该文件夹。
4. **生成队列**：扩展自动将**同名**的图片与提示词绑定在一起，压入任务队列等待自动执行。无图的提示词照常执行纯文本生成。

### 2.2 架构设计与数据流

#### 步骤 1: 文件夹读取与绑定 (SidePanel)
- 使用 `<input type="file" webkitdirectory multiple />` 读取用户选择的整个文件夹内容（返回一个平铺的 `File[]` 数组）。
- **解析文本**：找到 `.txt` 结尾的文件（通常是 `prompts.txt`），使用已有的 `parsePromptText` 提取出 `ParsedPromptItem` 数组。
- **查找图片**：遍历剩余的 `File` 对象，筛出所有 `.png` / `.jpg` / `.jpeg` / `.webp` 的图片文件。
- **同名匹配**：对于每一个 `ParsedPromptItem`，拿着它的 `filename` 去图片列表里查找是否存在 `filename.xxx`。如果存在，则配对成功。

#### 步骤 2: 存储策略 (IndexedDB)
**关键问题**：Chrome Storage (`chrome.storage.local`) 有配额限制（默认 10MB），如果将几十张图片的 base64 存入，扩展必定会崩溃。
**解决方案**：引入 `localforage` (或直接使用原生 IndexedDB API)。
- 匹配到的参考图 `File` 对象，通过 `URL.createObjectURL` 或直接读取为 ArrayBuffer，连同生成的 UUID 一起存入 IndexedDB。
- `queue-engine` 内的 `TaskItem` 中的 `assets` 字段，**不存储图片真实数据**，只存储其索引 ID。
```typescript
interface TaskAsset {
  type: 'start' | 'end' | 'ingredient';
  refId: string;         // IndexedDB 中图片的唯一主键
  filename: string;      // 原始文件名，用于调试显示
}
```

#### 步骤 3: 队列调度与注入 (Content Script)
- Content Script 在执行 `executeTask` 时，发现该任务包含 `assets`。
- **Just-In-Time 获取**：通过 Background Service Worker 暴露的接口（基于 `chrome.runtime.sendMessage` 和 IndexedDB 查询），实时提取出被选中的那张图片的 Blob 数据，传至 Content Script 环境。
- **DOM 注入**：将 Blob 转回 `File` 对象，构造基于 `DataTransfer` 的合成 `DragEvent` 或劫持隐藏的 `<input type="file">`，模拟用户手动拖放/选择动作，完成图片上传操作。然后再像往常一样填充文本 Prompt 并点击 Create。

---

## 3. 分阶段实施计划

为了规避最大技术风险并平滑落地，开发工作将拆分为四个阶段（Phase 0 - 3）：

### Phase 0: 核心阻塞点验证 (DOM 注入可行性)
**目标**：验证能否通过纯前端代码（合成拖拽事件或劫持 Input）将 `File` 对象成功注入给 Flow 的网页。
**方法**：
- 在 Flow 生成页面的 DevTools Console 中，编写一段简短的脚本：在内存构建一个红色的 Canvas Blob `File`，挂载到 `DataTransfer` 上，向疑似的上传容器派发 `dragenter`、`dragover`、`drop` 事件流。
- 如果成功，Flow 会在界面上展示这张红色小图。
- 如果此路不通，则需要寻找 `ClipboardEvent` (粘帖模拟) 或劫持 React 的内部状态。这决定了整个方案的生死。

### Phase 1: IndexedDB 基座建设与单图联调
**目标**：建立非易失性大体积数据的存储能力，打通 "SidePanel -> IndexedDB -> Content Script -> 网页" 的单据完整链路。
**任务**：
1. 引入轻量级 IndexedDB Helper（建议自己封装极简的 get/set，或 npm 安装 `localforage` 构建入 sidepanel/background）。
2. 在 SidePanel 临时加一个普通的 `<input type="file" />` 选单张图。
3. 存入 IDB，发消息让 Content Script 借由 Background 取出 Blob。
4. 调用 Phase 0 验证过的 DOM 注入逻辑。测试跑通一次生成。

### Phase 2: WebkitDirectory 批量读取与隐式绑定
**目标**：实现核心业务逻辑，完成“同名匹配”。
**任务**：
1. 在 UI 增加「导入项目文件夹」按钮：`<input type="file" webkitdirectory multiple />`。
2. 剥离并读取 `prompts.txt`，将其转为 `ParsedPromptItem[]`。
3. 建立 `Map<string, File>` 方便快速查找图片。
4. 执行遍历与匹配。将绑定成功的 `File` 存入 IndexedDB 并获取对应的 ID 集合。
5. 将组装好的任务列表批量分派给 `queue-engine` 的 `addPrompts`（需要修改协议与函数签名为允许传入 assets 信息）。

### Phase 3: 队列清理与体验优化
**目标**：防止本地数据库无限膨胀，优化长排队体验。
**任务**：
- **垃圾回收机制**：当 `clearQueue`、`clearHistory` 被触发，或者某个含有 reference_image 的 task 走向终态（被移除）时，通知 IndexedDB 清理对应的 blob。
- **UI 反馈**：在任务列表卡片里，用一个微小的 `🖼️` 图标或「有图」字样标记该任务携带了参考图。

---

## 4. 技术优势总结
1. **Zero-Config (零解析负担)**：不需要魔改已有的 prompt 解析器去兼容复杂的行内标记正则，复用了现有的 `filename` 设计。
2. **极简 UI**：不维护巨大的 Vue/Svelte 照片墙组件。原生 input directory 一步到位。
3. **架构健壮**：利用 JIT (即时拉取) + IndexedDB 突破了 Chrome 插件默认的小存储瓶颈，100 个任务也不会爆内存。
