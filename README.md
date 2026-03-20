# FlowAuto Extension

Google Flow（Labs）批量自动化 Chrome 扩展。通过 Side Panel 管理任务队列，自动操作 Flow 页面完成图片/视频的批量生成与下载。支持参考图智能复用、链式生成、AI 提示词引擎、多项目管理、Telegram/Discord 通知等高级功能。

---

## 目录

- [功能概览](#功能概览)
- [订阅方案](#订阅方案)
- [安装与构建](#安装与构建)
- [使用指南](#使用指南)
  - [连接 Flow 页面](#连接-flow-页面)
  - [输入提示词](#输入提示词)
  - [从文件/文件夹导入](#从文件文件夹导入)
  - [参考图生图](#参考图生图)
  - [设置参数](#设置参数)
  - [Chain Mode（链式生成）](#chain-mode链式生成)
  - [Stealth Mode（隐身模式）](#stealth-mode隐身模式)
  - [多项目管理](#多项目管理)
  - [AI 提示词引擎](#ai-提示词引擎)
  - [通知推送](#通知推送)
  - [许可证激活](#许可证激活)
  - [执行与控制](#执行与控制)
  - [任务队列](#任务队列)
  - [下载管理](#下载管理)
- [提示词格式](#提示词格式)
- [支持的模型与模式](#支持的模型与模式)
- [兼容性矩阵](#兼容性矩阵)
- [架构设计](#架构设计)
  - [项目结构](#项目结构)
  - [组件通信](#组件通信)
  - [任务执行流程](#任务执行流程)
  - [参考图注入策略](#参考图注入策略)
  - [参考图复用机制](#参考图复用机制)
  - [生成完成检测](#生成完成检测)
  - [部分失败自动重试](#部分失败自动重试)
  - [下载流程](#下载流程)
  - [AI Proxy 后端](#ai-proxy-后端)
- [技术栈](#技术栈)
- [常见问题](#常见问题)

---

## 功能概览

### 核心功能

| 功能                 | 说明                                                         |
| -------------------- | ------------------------------------------------------------ |
| **批量生成**         | 输入多行提示词一键批量生成图片或视频                         |
| **参考图生图**       | 支持多提示词 × 多参考图的灵活组合（M×N）                     |
| **参考图智能复用**   | 基于 SHA-256 内容哈希，同一参考图不再重复上传                |
| **任务队列**         | 持久化队列管理（开始 / 停止 / 重试 / 跳过 / 删除）           |
| **部分失败自动重试** | 生成结果不足时自动补生成（最多 3 轮）                        |
| **智能 Tab 检测**    | 自动识别 Flow 页面当前视频/图片标签，展示对应 UI             |
| **模型选择**         | 支持 Veo 2/3.1（视频）和 Nano Banana 2/Pro、Imagen 4（图片） |
| **自动下载**         | 生成完成后自动下载到 `下载目录/FlowAuto/项目名/`             |
| **下载确认**         | 轮询 Chrome 下载 API 确认文件写入完成后才继续                |
| **文件/文件夹导入**  | 从 `.txt` 文件或项目文件夹批量导入提示词与参考图             |
| **兼容性守卫**       | 自动检查模型 × 模式 × 画幅兼容性，不兼容时自动纠正           |

### 高级功能

| 功能                   | 说明                                                           | 订阅要求 |
| ---------------------- | -------------------------------------------------------------- | -------- |
| **Chain Mode**         | 将前一个任务的生成结果自动作为下一个任务的参考图               | Pro      |
| **Stealth Mode**       | 随机化操作延迟（1.5x–3.0x），降低被 Flow 限速的风险            | Pro+     |
| **多项目管理**         | 每个项目独立的队列和设置，支持创建/切换/重命名/删除            | Pro (3个) / Pro+ (无限) |
| **AI 提示词引擎**      | AI 增强、改写、生成变体，支持 OpenAI / Gemini / FlowAuto 代理  | Pro (自有密钥) / Pro+ (代理) |
| **通知推送**           | 队列完成和任务失败时推送 Telegram / Discord 消息               | Pro+     |
| **4K 下载**            | 支持 4K 分辨率下载                                             | Pro      |
| **每日用量**           | Free 每日 30 次，Pro/Pro+ 无限制                               | -        |

---

## 订阅方案

| 功能                   | Free         | Pro              | Pro+             |
| ---------------------- | ------------ | ---------------- | ---------------- |
| 每日生成次数           | 30 次        | 无限制           | 无限制           |
| 项目数量               | 1 个         | 3 个             | 无限制           |
| 基础图片/视频生成      | ✅           | ✅               | ✅               |
| 所有生成模式           | -            | ✅               | ✅               |
| M×N 参考图组合         | -            | ✅               | ✅               |
| 文件/文件夹导入        | -            | ✅               | ✅               |
| Chain Mode（链式生成） | -            | ✅               | ✅               |
| 4K 下载                | -            | ✅               | ✅               |
| AI 引擎（自有 API Key）| -            | ✅               | ✅               |
| AI 代理（无需 Key）    | -            | -                | ✅ (500次/月)    |
| Stealth Mode           | -            | -                | ✅               |
| Telegram/Discord 通知  | -            | -                | ✅               |
| 优先客服               | -            | -                | ✅               |

通过 LemonSqueezy 购买许可证密钥，在扩展 Side Panel 中激活。详见 [许可证激活](#许可证激活)。

---

## 安装与构建

### 环境要求

- Node.js 18+
- npm 9+
- Chrome 116+（支持 Side Panel API）

### 构建步骤

```bash
cd flowauto-extension
npm install
npm run build
```

构建产物输出到 `dist/` 目录。

### 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `flowauto-extension/dist` 目录
5. 点击扩展图标打开 Side Panel

### 开发模式

```bash
npm run dev
```

使用 Vite HMR 实时热更新（Side Panel 页面需手动刷新）。

---

## 使用指南

### 连接 Flow 页面

1. 在 Chrome 中打开 Google Flow 项目页面：`https://labs.google/fx/zh/tools/flow/project/...`
2. 点击扩展图标打开 Side Panel
3. 连接状态显示「已连接：Flow 项目页」即可使用

Side Panel 每 2.5 秒自动检测连接状态。如果显示「未连接」：

- 确认当前标签页是 Flow 项目页
- 尝试点击「刷新连接」按钮
- 或刷新 Flow 页面后重试

### 输入提示词

在文本框中输入提示词，每行一个：

```
一只橘猫在窗台上晒太阳
一只黑猫在夜晚的屋顶
一只白猫在花园里追蝴蝶
```

支持多种格式，详见 [提示词格式](#提示词格式)。

### 从文件/文件夹导入

**从 `.txt` 文件导入：**

1. 点击输入框右上角的「导入」按钮
2. 选择一个 `.txt` 文件
3. 文件内容会追加到输入框中

**从项目文件夹导入（含参考图）：**

1. 在本地准备一个文件夹，包含：
   - 一个 `.txt` 提示词文件（如 `prompts.txt`），每行格式 `文件名, 提示词`
   - 对应的参考图文件（如 `cat_01.jpg`, `cat_02.png`）
2. 点击「导入 txt + 图片」按钮，选择该文件夹中的 txt 和图片文件
3. 扩展自动按文件名匹配提示词与参考图，并显示匹配摘要

### 参考图生图

扩展支持灵活的参考图 × 提示词组合：

| 场景               | 行为                                      |
| ------------------ | ----------------------------------------- |
| **1 图 × N 词**    | 同一参考图应用于所有提示词                |
| **N 图 × 1 词**    | 同一提示词扩展为 N 个任务，每个使用不同图 |
| **M 图 × N 词**    | 笛卡尔积，生成 M×N 个任务                 |
| **显式文件名匹配** | 提示词中引用的文件名自动匹配对应参考图    |
| **提示词内联引用** | 提示词文本中包含的图片文件名自动扫描匹配  |

每个任务卡片上会显示关联的参考图文件名标签，方便确认。

### 设置参数

Side Panel 会根据当前 Flow 页面的标签（视频/图片）自动切换显示：

**基础设置：**

| 参数     | 选项                                     |
| -------- | ---------------------------------------- |
| 画幅     | 9:16、16:9                               |
| outputs  | 1、2、3、4                               |
| 图片模型 | Nano Banana Pro、Nano Banana 2、Imagen 4 |
| 视频模型 | Veo 3.1 - Fast、Veo 3.1 - Quality、Veo 2 - Fast、Veo 2 - Quality |
| 下载分辨率 | 1K/720p、2K/1080p、4K（Pro/Pro+） |
| 间隔(ms) | 任务间等待时间，默认 5000ms              |
| Chain Mode | 开启/关闭链式生成（Pro） |
| Stealth Mode | 开启/关闭隐身延迟（Pro+） |

**AI 设置（Pro/Pro+）：**

| 参数     | 选项                                     |
| -------- | ---------------------------------------- |
| AI 服务商 | OpenAI、Gemini、FlowAuto Proxy（Pro+） |
| 模型     | 取决于服务商选择                         |
| API Key  | 自有密钥（Proxy 模式无需填写）           |

**通知设置（Pro+）：**

| 参数       | 选项                                   |
| ---------- | -------------------------------------- |
| 通知方式   | 无、Telegram、Discord                  |
| Telegram   | Bot Token + Chat ID                    |
| Discord    | Webhook URL                            |
| 触发时机   | 队列完成通知 / 任务失败通知（可分别开关）|
| 测试通知   | 发送测试消息验证配置是否正确           |

### Chain Mode（链式生成）

Chain Mode 将当前任务的生成结果自动传递为下一个任务的参考图，实现连续迭代式创作：

```
任务 1: "一座雪山" → 生成图片 A
     ↓ 图片 A 作为参考图
任务 2: "在雪山上加一座小木屋" → 生成图片 B
     ↓ 图片 B 作为参考图
任务 3: "木屋里透出温暖的灯光" → 生成图片 C
```

**启用方式：** 在设置面板中打开「Chain Mode」开关。

**工作原理：**

1. 前一个任务执行完成后，存储其生成结果的 assetHash
2. 下一个任务启动时，通过 `chainPreviousRefId` 引用该 assetHash
3. 自动将前一任务的输出作为当前任务的参考图注入

### Stealth Mode（隐身模式）

Stealth Mode 通过随机化操作间隔来模拟更自然的人类操作节奏：

- **延迟倍率**：所有操作延迟乘以 1.5x–3.0x 的随机系数
- **步骤间暂停**：每个自动化步骤之间插入 500–2000ms 的随机等待
- **最大减速**：不超过原始延迟的 4 倍

**启用方式：** 在设置面板中打开「Stealth Mode」开关。

### 多项目管理

通过 Side Panel 顶部的项目选择器管理多个独立项目：

- **创建项目**：在下拉菜单中选择「新建项目」并输入名称
- **切换项目**：从下拉菜单选择目标项目，队列和设置自动切换
- **重命名/删除**：点击项目选择器旁的菜单按钮（···）

每个项目拥有独立的：
- 任务队列（待执行、已完成、失败的任务互不影响）
- 默认设置（模型、画幅、输出数量等）
- 下载目录（`FlowAuto/项目名/`）

项目数量限制：Free 1 个 / Pro 3 个 / Pro+ 无限制。

### AI 提示词引擎

AI 引擎提供三种提示词优化操作：

| 操作     | 说明                                          | 适用场景                   |
| -------- | --------------------------------------------- | -------------------------- |
| **增强** | 将简短提示词扩展为详细、生动的描述            | 草稿提示词需要丰富细节     |
| **改写** | 将可能违反政策的提示词改写为合规替代方案      | 提示词被 Flow 拒绝时       |
| **变体** | 从一个提示词生成 N 个创意变体                 | 需要同一主题的多种表达     |

**支持的 AI 服务商：**

| 服务商          | 模型                        | 说明                       |
| --------------- | --------------------------- | -------------------------- |
| **OpenAI**      | GPT-4o-mini、GPT-4o         | 需自备 API Key（Pro）     |
| **Gemini**      | Gemini 2.0 Flash、Gemini 2.5 Pro | 需自备 API Key（Pro） |
| **FlowAuto Proxy** | GPT-4o-mini（托管）     | 无需 Key，500 次/月（Pro+）|

**使用方式：**

1. 在设置面板配置 AI 服务商和 API Key
2. 在提示词输入框中输入内容
3. 点击「AI 增强」或「生成变体」按钮
4. 优化后的提示词自动替换/追加到输入框

### 通知推送

当队列完成或任务失败时，自动推送通知到 Telegram 或 Discord：

**Telegram 配置：**

1. 通过 @BotFather 创建一个 Telegram Bot，获取 Bot Token
2. 获取目标 Chat ID
3. 在设置面板中填入 Bot Token 和 Chat ID
4. 点击「测试通知」验证配置

**Discord 配置：**

1. 在 Discord 频道设置中创建 Webhook，获取 Webhook URL
2. 在设置面板中填入 Webhook URL
3. 点击「测试通知」验证配置

**通知内容示例：**

- 队列完成：「FlowAuto - 猫咪项目：队列完成！成功 8 / 失败 2，耗时 12 分钟」
- 任务失败：「FlowAuto - 猫咪项目：任务失败 — "一只橘猫..." — 生成超时」

### 许可证激活

1. 从 LemonSqueezy 购买许可证密钥
2. 在 Side Panel 底部的「许可证」区域，输入密钥
3. 点击「激活」按钮
4. 激活成功后显示当前订阅等级和每日用量

**自动验证周期：**
- Pro：每 7 天重新验证一次
- Pro+：每 30 天重新验证一次
- 验证失败时自动降级为 Free

### 执行与控制

| 按钮         | 功能                | 说明                                                               |
| ------------ | ------------------- | ------------------------------------------------------------------ |
| **开始生成** | 加入队列 + 启动执行 | 如果输入框有提示词，先加入队列再开始；否则继续执行队列中的等待任务 |
| **停止生成** | 暂停队列执行        | 当前正在执行的任务会继续完成，但不会开始下一个                     |
| **重试失败** | 重试所有失败任务    | 将所有 `error` 状态的任务重置为 `waiting`                          |
| **清空历史** | 清除已完成任务      | 删除所有 `success` / `error` / `skipped` 状态的任务                |

### 任务队列

每个任务显示为一张卡片，包含：

- **状态标签**：waiting / running / downloading / success / error / skipped
- **模型名称**
- **提示词内容**
- **自定义文件名**（如有设置）
- **参考图标签**（关联的参考图文件名）
- **错误信息**（仅失败任务）

队列顶部显示统计摘要（总数 / 成功 / 失败 / 跳过），支持按状态筛选。图片标签下只显示图片任务，视频标签下只显示视频任务。

### 下载管理

生成完成后，文件自动下载到：

```
Chrome 下载目录/
└── FlowAuto/
    └── 项目名/
        ├── 提示词摘要__o01__任务ID.png
        ├── 提示词摘要__o02__任务ID.png
        └── ...
```

命名规则：

- **目录**：`FlowAuto/` + 当前 Flow 项目名
- **文件名**：`{提示词前40字或自定义文件名}__o{序号}__{任务ID后6位}.{扩展名}`
- 文件名中的非法字符自动替换为 `_`

**下载分辨率**：默认 2K/1080p，Pro 用户可选 4K。

---

## 提示词格式

### 基本格式：每行一个

```
一只橘猫
一只黑猫
一只白猫
```

### 自定义文件名

使用 `文件名, 提示词` 格式（英文或中文逗号均可）：

```
cat_orange, 一只橘猫在窗台上晒太阳
cat_black, 一只黑猫在夜晚的屋顶上行走
```

下载的文件会以 `cat_orange__o01__xxx.png` 命名。

### 多行提示词

用空行分隔不同的提示词组。空行之间的多行内容会合并为一个提示词：

```
vi_001, 一只橘猫坐在窗台上
阳光透过玻璃窗照射进来
猫咪眯着眼睛享受温暖

vi_002, 一只黑猫在月光下
优雅地走过屋顶的瓦片
```

### 注释

`#` 开头的行会被忽略：

```
# 猫咪系列
cat_01, 橘猫
cat_02, 黑猫
# cat_03, 白猫  ← 这行会被跳过
```

---

## 支持的模型与模式

### 图片模型

| 模型 ID           | 显示名称        | 说明               |
| ----------------- | --------------- | ------------------ |
| `nano-banana-pro` | Nano Banana Pro | 高质量图片模型     |
| `nano-banana-2`   | Nano Banana 2   | 标准图片模型       |
| `imagen4`         | Imagen 4        | Google Imagen 模型 |

### 视频模型

| 模型 ID          | 显示名称          | 说明           |
| ---------------- | ----------------- | -------------- |
| `veo3.1-fast`    | Veo 3.1 - Fast    | 快速生成       |
| `veo3.1-quality` | Veo 3.1 - Quality | 高质量生成     |
| `veo2-fast`      | Veo 2 - Fast      | Veo 2 快速版   |
| `veo2-quality`   | Veo 2 - Quality   | Veo 2 高质量版 |

### 生成模式

| 模式                | 说明          | 标签 |
| ------------------- | ------------- | ---- |
| `create-image`      | 制作图片      | 图片 |
| `text-to-video`     | 文生视频      | 视频 |
| `frames-first`      | 首帧生视频    | 视频 |
| `frames-first-last` | 首+尾帧生视频 | 视频 |
| `ingredients`       | 素材生视频    | 视频 |

---

## 兼容性矩阵

扩展内置了兼容性守卫（Capability Guard），在任务加入队列时自动检查并纠正不兼容的参数组合：

| 规则                           | 处理                         |
| ------------------------------ | ---------------------------- |
| Veo 2 + 9:16                   | 自动切换到 Veo 3.1 - Fast    |
| Ingredients + 非 Veo 3.1 Fast  | 自动切换到 Veo 3.1 - Fast    |
| Jump To + 9:16                 | 自动切换到 16:9              |
| Jump To + Veo 3.1 Fast         | 自动切换到 Veo 3.1 - Quality |
| Extend + 9:16                  | 自动切换到 16:9              |
| Extend + Veo 2 Quality         | 自动切换到 Veo 2 - Fast      |
| 首+尾帧 + Veo 2 Quality        | 自动切换为可用模型           |
| Camera Control + 非 Veo 2 Fast | 自动切换到 Veo 2 - Fast      |
| 视频模式 + 图片模型            | 标记为 skipped，提示用户切换 |

---

## 架构设计

### 项目结构

```
flowauto-extension/
├── manifest.json                    # Chrome MV3 清单
├── package.json
├── vite.config.ts                   # Vite + CRXJS + Svelte 配置
├── tsconfig.json
├── vitest.config.ts                 # 测试配置
├── svelte.config.js
├── sidepanel/
│   └── index.html                   # Side Panel 入口 HTML
├── landing/                         # 落地页（CWS 上架用）
├── api/                             # 后端服务
│   └── src/
│       └── index.ts                 # Cloudflare Workers AI Proxy
└── src/
    ├── __tests__/                   # 单元测试（14 个测试文件）
    │   ├── ai-provider.test.ts      # AI 服务商工厂
    │   ├── capability-guard.test.ts  # 兼容性检查
    │   ├── chain-mode.test.ts       # 链式生成
    │   ├── daily-counter.test.ts    # 每日计数
    │   ├── feature-gate.test.ts     # 功能门控
    │   ├── filename-utils.test.ts   # 文件名生成
    │   ├── license.test.ts          # 许可证验证
    │   ├── notification.test.ts     # 通知格式化
    │   ├── project-management.test.ts # 项目管理
    │   ├── prompt-parser.test.ts    # 提示词解析
    │   ├── proxy-provider.test.ts   # 代理服务商
    │   ├── queue-engine.test.ts     # 队列引擎
    │   ├── stealth-mode.test.ts     # 隐身模式
    │   └── chrome-mock.ts           # Chrome API 模拟
    ├── background/                  # Service Worker（后台服务）
    │   ├── index.ts                 # 消息路由、Side Panel 行为
    │   ├── queue-engine.ts          # 队列状态管理（CRUD + 持久化）
    │   ├── runner.ts                # 任务执行循环 + 每日限制
    │   ├── download-manager.ts      # 下载重命名（onDeterminingFilename）
    │   ├── content-injection.ts     # 内容脚本按需注入
    │   ├── storage.ts               # chrome.storage.local 封装
    │   ├── daily-counter.ts         # 每日用量跟踪
    │   ├── license.ts               # LemonSqueezy 许可证激活与验证
    │   ├── notifier.ts              # Telegram/Discord 通知格式化与发送
    │   └── ai-providers/            # AI 服务商集成
    │       ├── index.ts             # Provider 工厂模式
    │       ├── openai-provider.ts   # OpenAI API 集成
    │       ├── gemini-provider.ts   # Google Gemini API 集成
    │       └── proxy-provider.ts    # FlowAuto 代理（Cloudflare Workers）
    ├── content/                     # Content Script（页面自动化）
    │   ├── index.ts                 # 消息监听、任务分发
    │   ├── finders.ts               # DOM 元素查找（按钮、输入框等）
    │   ├── selectors.ts             # CSS 选择器和关键词常量
    │   ├── page-state.ts            # 页面状态检测（项目名、URL）
    │   ├── actions/
    │   │   ├── execute-task.ts      # 任务编排 + 参考图复用逻辑
    │   │   ├── navigate.ts          # 视频/图片标签切换
    │   │   ├── settings.ts          # 设置面板（模式/画幅/数量/模型）
    │   │   ├── prompt.ts            # 提示词注入
    │   │   ├── inject-image.ts      # 参考图注入（面板选择 / 剪贴板上传）
    │   │   ├── generate.ts          # 点击创建 + 等待完成
    │   │   └── download.ts          # 下载逻辑（菜单操作 + URL 提取）
    │   └── utils/
    │       ├── dom.ts               # DOM 工具（forceClick, waitFor, sleep）
    │       └── aria.ts              # ARIA 属性匹配工具
    ├── sidepanel/                   # Side Panel UI（Svelte）
    │   ├── main.ts                  # Svelte 应用入口
    │   ├── App.svelte               # 主容器组件
    │   └── components/
    │       ├── StatusHeader.svelte   # 连接状态显示
    │       ├── ProjectSelector.svelte # 项目选择与管理
    │       ├── TaskInput.svelte      # 提示词输入 + AI 增强 + 文件导入
    │       ├── SettingsPanel.svelte   # 模型/画幅/AI/通知等全部设置
    │       ├── TaskList.svelte        # 队列展示与状态筛选
    │       └── LicensePanel.svelte    # 许可证激活与用量显示
    └── shared/                      # 跨组件共享
        ├── constants.ts             # 消息类型常量
        ├── types.ts                 # TypeScript 类型定义
        ├── protocol.ts              # 消息协议类型（47+ 消息类型）
        ├── config.ts                # 全局配置（延迟/超时/限制）
        ├── feature-gate.ts          # 订阅等级功能矩阵
        ├── capability-guard.ts      # 兼容性检查（12+ 规则）
        ├── ai-provider.ts           # AI 服务商接口定义
        ├── prompt-parser.ts         # 提示词文本解析
        ├── filename-utils.ts        # 文件名生成与清理
        ├── image-store.ts           # IndexedDB 图片 Blob 存储
        ├── reference-media-store.ts # IndexedDB 参考图映射持久化
        ├── messaging.ts             # chrome.runtime.sendMessage 封装
        ├── logger.ts                # 结构化日志（带前缀）
        └── sleep.ts                 # sleep 工具
```

### 组件通信

扩展由三个独立运行的组件组成，通过 `chrome.runtime.sendMessage` 通信：

```
┌─────────────┐     消息      ┌──────────────┐     消息      ┌──────────────┐
│  Side Panel  │ ◄──────────► │  Background   │ ◄──────────► │   Content    │
│  (Svelte UI) │              │  (Service     │              │   Script     │
│              │              │   Worker)     │              │  (DOM 自动化) │
└─────────────┘              └──────────────┘              └──────────────┘
      │                            │                            │
      │  PING / PONG               │  EXECUTE_TASK              │  操作 Flow
      │  QUEUE_*                   │  TASK_RESULT               │  页面 DOM
      │  SETTINGS_UPDATE           │  TASK_LOG                  │
      │  GET_PAGE_STATE            │  DOWNLOAD_BY_URL           │
      │  PROJECT_*                 │  REF_MEDIA_LOOKUP/UPSERT   │
      │  LICENSE_*                 │                            │
      │  AI_*                      │                            │
      │  TEST_NOTIFICATION         │                            │
      └────────────────────────────┴────────────────────────────┘
                                   │
                            ┌──────┴──────┐
                            │  外部服务    │
                            ├─────────────┤
                            │ LemonSqueezy │ 许可证验证
                            │ OpenAI API   │ AI 增强/改写/变体
                            │ Gemini API   │ AI 增强/改写/变体
                            │ CF Workers   │ AI 代理（ProxyProvider）
                            │ Telegram API │ 通知推送
                            │ Discord API  │ 通知推送
                            └─────────────┘
```

**消息类型：**

| 消息                                    | 方向                 | 用途                   |
| --------------------------------------- | -------------------- | ---------------------- |
| `PING` / `PONG`                         | Panel → BG → Content | 连接状态检测           |
| `GET_PAGE_STATE`                        | Panel → BG → Content | 获取页面状态           |
| `QUEUE_ADD_TASKS`                       | Panel → BG           | 添加任务到队列         |
| `QUEUE_START` / `QUEUE_PAUSE`           | Panel → BG           | 启动/暂停队列          |
| `QUEUE_GET_STATE`                       | Panel → BG           | 获取队列状态           |
| `QUEUE_CLEAR` / `QUEUE_CLEAR_HISTORY`   | Panel → BG           | 清空全部/历史任务      |
| `QUEUE_REMOVE_TASK` / `QUEUE_SKIP_TASK` | Panel → BG           | 删除/跳过任务          |
| `QUEUE_RETRY_ERRORS`                    | Panel → BG           | 重试所有失败任务       |
| `SETTINGS_UPDATE`                       | Panel → BG           | 更新默认设置           |
| `PROJECT_LIST` / `PROJECT_CREATE`       | Panel → BG           | 项目列表/创建          |
| `PROJECT_SWITCH` / `PROJECT_RENAME`     | Panel → BG           | 切换/重命名项目        |
| `PROJECT_DELETE`                        | Panel → BG           | 删除项目               |
| `LICENSE_ACTIVATE` / `LICENSE_VALIDATE` | Panel → BG           | 激活/验证许可证        |
| `LICENSE_GET_STATUS`                    | Panel → BG           | 获取许可证状态         |
| `AI_ENHANCE` / `AI_REWRITE`            | Panel → BG           | AI 增强/改写提示词     |
| `AI_VARIANTS`                           | Panel → BG           | AI 生成提示词变体      |
| `TEST_NOTIFICATION`                     | Panel → BG           | 发送测试通知           |
| `EXECUTE_TASK`                          | BG → Content         | 发送任务给内容脚本执行 |
| `TASK_RESULT`                           | Content → BG         | 任务执行结果           |
| `TASK_LOG`                              | Content → BG         | 任务执行日志           |
| `DOWNLOAD_BY_URL`                       | Content → BG         | 请求下载文件           |
| `RESET_EXECUTION_SESSION`               | BG → Content         | 重置内容脚本会话缓存   |
| `REF_MEDIA_LOOKUP`                      | Content → BG         | 查询参考图映射         |
| `REF_MEDIA_UPSERT`                      | Content → BG         | 写入/更新参考图映射    |

### 任务执行流程

每个任务的执行流程：

```
1. 清理上一任务的参考图     clearAttachedReferences()
       ↓
2. 切换标签页               selectTab('image' | 'video')
       ↓
3. 设置参数                 setMode() → setAspectRatio() → setOutputCount() → setModel()
       ↓
4. 输入提示词               setPromptText()
       ↓
5. 注入参考图（如有）        injectImageToFlow() × N（逐张注入）
       ↓
6. 点击创建 + 等待完成      clickCreate() → waitForGenerationComplete()
       ↓
7. 下载结果                 downloadTopNLatestWithNaming()
       ↓
8. 检查是否需要补生成       若结果不足，重复步骤 6-7（最多 3 轮）
```

### 参考图注入策略

参考图注入采用多级策略，按优先级依次尝试：

```
1. 资源面板复用（最快）
   ├─ 计算图片 SHA-256 哈希
   ├─ 查询持久化映射（IndexedDB）和会话缓存
   ├─ 命中 → 点击 + 展开面板 → 按 UUID 定位缩略图 → 点击选择
   └─ 面板自动关闭 = 选择成功

2. 剪贴板粘贴上传（主路径）
   ├─ 构造 File 对象 → 派发 ClipboardEvent('paste')
   ├─ 等待上传进度指示器出现并消失
   └─ 捕获新的 media UUID → 更新映射缓存

3. 资源面板 + 文件输入拦截（回退路径）
   ├─ 打开资源面板 → 找到上传按钮
   ├─ 拦截 <input type="file"> 的 click() 方法注入文件
   └─ 等待上传完成

4. 拖放注入（最终回退）
   └─ 构造 DragEvent 派发到提示词区域
```

### 参考图复用机制

为避免重复上传相同的参考图，扩展实现了两级缓存：

**会话级缓存（内存）：**

- `assetHash → mediaUuid` 映射，随页面刷新清空
- 同一轮任务中，相同图片的第二次使用直接走面板选择

**持久化缓存（IndexedDB）：**

- `(projectId + assetHash) → mediaUuid` 映射
- 跨会话/跨任务有效
- 三层数据增长控制：
  - **TTL**：超过 45 天未使用自动淘汰
  - **全局上限**：最多 1200 条，超出按 LRU 删除
  - **项目上限**：每项目最多 250 条，超出按 LRU 删除
- 仅存储哈希和 UUID 等轻量元数据，不存储图片本体

**复用流程：**

```
执行任务 → 读取参考图 Blob → 计算/缓存 SHA-256
  ↓
查询持久化映射 + 会话缓存
  ├─ 命中 UUID → 尝试从面板选择 → 成功则跳过上传
  └─ 未命中 → 走上传流程 → 成功后回写映射
```

### 生成完成检测

采用多信号策略，任意一个触发即视为生成完成：

**信号 A — 按钮恢复：**

- 每 2 秒重新查询创建按钮
- 检测 `disabled` 和 `aria-disabled` 属性
- 按钮从 disabled 恢复为可用即完成

**信号 B — URL 稳定性：**

- 记录点击创建前所有结果图片的 URL 集合（基线）
- 当新增数量 ≥ 期望数量，且连续 3 次轮询不变，视为完成

**信号 C — 无加载指示器：**

- 页面无进度/加载指示器，且有新图片出现
- 对于部分生成（如请求 2 张只出 1 张），连续 2 次稳定后视为本轮结束

**超时：** 图片 120 秒，视频 900 秒。

### 部分失败自动重试

当 Flow 生成结果不足（如请求 2 张只产出 1 张）时，扩展会自动处理：

1. 检测到实际生成数 < 期望数 → 先下载已生成的图片
2. 在提示词末尾追加空格，触发 Flow 接受新的提交
3. 重新点击「创建」按钮，只请求缺少的数量
4. 最多重试 3 轮，每轮只补齐差额

### 下载流程

```
Content Script                    Background
     │                                │
     │  1. 收集基线 URL               │
     │  2. 找出新生成的图片           │
     │  3. 点击菜单下载按钮           │
     │     或提取 img.src             │
     │                                │
     ├─── DOWNLOAD_BY_URL ──────────► │
     │    { url, dir, baseName }      │
     │                                │  4. expectDownload() 注册命名
     │                                │  5. chrome.downloads.download()
     │                                │  6. onDeterminingFilename → 重命名
     │                                │  7. 轮询 downloads.search 等 complete
     │                                │
     │ ◄─── { ok: true/false } ───── │
     │                                │
     │  8. 继续下一张                 │
```

**关键设计：**

- 使用 `chrome.downloads.onDeterminingFilename` 拦截下载文件名，应用 `FlowAuto/项目名/文件名` 路径
- 下载发起后轮询 `chrome.downloads.search`（每秒一次），确认状态为 `complete` 后才返回
- 优先通过 Flow 原生菜单下载（支持多分辨率），回退到直接 URL 下载

### AI Proxy 后端

FlowAuto 提供基于 Cloudflare Workers 的 AI 代理后端，Pro+ 用户无需自备 API Key 即可使用 AI 功能。

**架构：**

```
Chrome Extension (ProxyProvider)
     │
     ├─── POST /api/ai/enhance ──────► Cloudflare Workers
     ├─── POST /api/ai/rewrite ─────►   ├─ 验证许可证密钥
     └─── POST /api/ai/variants ────►   ├─ 检查月度配额（500次/月）
                                         ├─ 转发到 OpenAI GPT-4o-mini
                                         └─ 返回结果
```

**特性：**

- **认证**：通过 `X-License-Key` Header 验证 Pro+ 许可证
- **配额**：每个许可证每月 500 次请求，通过 KV Store 追踪
- **CORS**：允许来自 `chrome-extension://` 的请求
- **模型**：后端使用 OpenAI GPT-4o-mini

---

## 技术栈

| 技术                     | 版本 | 用途                              |
| ------------------------ | ---- | --------------------------------- |
| **TypeScript**           | 5.9  | 类型安全                          |
| **Svelte**               | 5    | Side Panel UI                     |
| **Vite**                 | 7    | 构建工具                          |
| **Vitest**               | 4    | 单元测试框架                      |
| **@crxjs/vite-plugin**   | 2.3  | Chrome 扩展打包                   |
| **Chrome MV3**           | -    | 扩展清单                          |
| **chrome.sidePanel**     | -    | 侧边栏 API                        |
| **chrome.downloads**     | -    | 下载管理                          |
| **chrome.storage.local** | -    | 队列、设置、许可证持久化           |
| **IndexedDB**            | -    | 图片 Blob 存储 + 参考图映射持久化 |
| **Cloudflare Workers**   | -    | AI Proxy 后端（边缘函数）         |
| **LemonSqueezy API**     | -    | 许可证激活与验证                  |
| **OpenAI API**           | -    | AI 提示词增强/改写/变体           |
| **Gemini API**           | -    | AI 提示词增强/改写/变体           |
| **Telegram Bot API**     | -    | 通知推送                          |
| **Discord Webhooks**     | -    | 通知推送                          |

---

## 常见问题

### Side Panel 打不开

确保 Chrome 版本 ≥ 116。点击扩展图标应自动打开 Side Panel。如果无反应：

1. 到 `chrome://extensions/` 禁用再启用扩展
2. 重新加载扩展

### 显示「未检测到内容脚本」

扩展会在打开 Side Panel 和执行任务时自动注入内容脚本。如果仍然提示：

1. 刷新 Flow 页面
2. 确认扩展有访问 `labs.google` 的权限

### 生成了图片但没下载

检查 Chrome 下载设置：

- 确认没有被浏览器拦截
- 确认 `chrome://downloads/` 中没有下载被阻止
- 查看控制台 (F12) 中是否有 `[FlowAuto]` 相关错误

### 生成超时

- 图片超时为 120 秒，视频为 900 秒
- 如果 Flow 服务器负载高可能需要更长时间
- 扩展会自动重试部分生成失败的任务

### 参考图没有被复用（仍然重复上传）

- 确保是在同一个 Flow 项目页面中操作
- 首次上传的参考图会在 Flow 画廊中出现，后续复用时不会再出现
- 复用依赖 Flow 资源面板中的缩略图 UUID 匹配

### 队列停了不动

- 确认当前标签页是 Flow 项目页
- 确认连接状态显示「已连接」
- 检查是否有错误任务阻塞

### 如何清空所有数据

1. 「清空历史」清除已完成/失败/跳过的任务
2. 参考图映射缓存会自动过期清理（45 天 TTL）
3. 如需完全重置，到 `chrome://extensions/` 点击扩展的「清除数据」按钮

### AI 功能不可用

- **Pro 用户**：需在设置面板中配置自有 OpenAI 或 Gemini API Key
- **Pro+ 用户**：可使用 FlowAuto Proxy（无需 Key），每月 500 次配额
- 检查 API Key 是否正确、是否有余额

### 通知收不到

- 确认 Telegram Bot Token 和 Chat ID 正确（先用「测试通知」按钮验证）
- 确认 Discord Webhook URL 有效
- 通知为 best-effort 模式，不会阻塞队列执行

### 每日用量已达上限

- Free 用户每日限 30 次生成，次日自动重置
- 升级到 Pro/Pro+ 可解除限制

### 功能显示锁定图标

部分功能需要更高订阅等级才能使用。锁定图标表示当前等级不支持该功能，升级后自动解锁。
