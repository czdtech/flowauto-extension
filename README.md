# FlowAuto Extension

Google Flow（VideoFX / Labs）批量自动化 Chrome 扩展。通过 Side Panel 管理任务队列，自动操作 Flow 页面完成图片/视频的批量生成与下载。

---

## 目录

- [功能概览](#功能概览)
- [安装与构建](#安装与构建)
- [使用指南](#使用指南)
  - [连接 Flow 页面](#连接-flow-页面)
  - [输入提示词](#输入提示词)
  - [从文件导入](#从文件导入)
  - [设置参数](#设置参数)
  - [执行与控制](#执行与控制)
  - [任务队列与日志](#任务队列与日志)
  - [下载管理](#下载管理)
- [提示词格式](#提示词格式)
- [支持的模型与模式](#支持的模型与模式)
- [兼容性矩阵](#兼容性矩阵)
- [架构设计](#架构设计)
  - [项目结构](#项目结构)
  - [组件通信](#组件通信)
  - [自动化流程](#自动化流程)
  - [完成检测](#完成检测)
  - [下载流程](#下载流程)
- [技术栈](#技术栈)
- [常见问题](#常见问题)

---

## 功能概览

| 功能 | 说明 |
|------|------|
| **批量生成** | 输入多行提示词一键批量生成图片或视频 |
| **任务队列** | 持久化队列管理（开始 / 停止 / 重试 / 跳过 / 删除） |
| **智能 Tab 检测** | 自动识别 Flow 页面当前视频/图片标签，展示对应 UI |
| **模型选择** | 支持 Veo 2/3.1（视频）和 Nano Banana / Imagen 4（图片） |
| **自动下载** | 生成完成后自动下载到 `下载目录/FlowAuto/项目名/` |
| **下载确认** | 轮询 Chrome 下载 API 确认文件写入完成后才继续 |
| **执行日志** | 每个任务的执行步骤记录在任务卡片中，可展开查看 |
| **文件导入** | 从 `.txt` 文件导入提示词 |
| **兼容性守卫** | 自动检查模型 × 模式 × 画幅兼容性，不兼容时自动纠正 |

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

### 从文件导入

1. 点击输入框右上角的「导入」按钮
2. 选择一个 `.txt` 文件
3. 文件内容会追加到输入框中（不覆盖已有内容）

文件格式：
- 每行一个提示词
- `#` 开头的行会被忽略（注释）
- 空行会被自动过滤

### 设置参数

Side Panel 会根据当前 Flow 页面的标签（视频/图片）自动切换显示：

**图片标签下：**

| 参数 | 选项 |
|------|------|
| 画幅 | 9:16、16:9 |
| outputs | 1、2、3、4 |
| 图片模型 | Nano Banana Pro、Nano Banana、Imagen 4 |
| 间隔(ms) | 任务间等待时间，默认 500ms |

**视频标签下：**

| 参数 | 选项 |
|------|------|
| 画幅 | 9:16、16:9 |
| outputs | 1、2、3、4 |
| 视频模型 | Veo 3.1 - Fast、Veo 3.1 - Quality、Veo 2 - Fast、Veo 2 - Quality |
| 间隔(ms) | 任务间等待时间，默认 500ms |

设置修改后立即生效，会影响后续加入队列的任务。

### 执行与控制

| 按钮 | 功能 | 说明 |
|------|------|------|
| **开始生成** | 加入队列 + 启动执行 | 如果输入框有提示词，先加入队列再开始；如果没有，继续执行队列中的等待任务 |
| **停止生成** | 暂停队列执行 | 当前正在执行的任务会继续完成，但不会开始下一个 |
| **重试失败** | 重试所有失败任务 | 将所有 `error` 状态的任务重置为 `waiting` |
| **清空历史** | 清除已完成任务 | 删除所有 `success` / `error` / `skipped` 状态的任务，保留等待中和运行中的 |

### 任务队列与日志

每个任务显示为一张卡片，包含：
- **状态标签**：waiting / running / success / error / skipped
- **模型名称**
- **提示词内容**
- **错误信息**（仅失败任务）
- **执行日志**（可展开）

**查看执行日志：** 点击有日志的任务卡片，展开后可以看到每一步的时间戳和操作内容：

```
00:15:23  开始执行任务
00:15:23  切换到 图片 标签页
00:15:24  设置画幅 9:16, 数量 4, 模型 nano-banana
00:15:24  输入提示词
00:15:25  点击创建，等待生成...
00:15:52  生成完成，下载 4 个文件...
00:15:58  任务完成
```

**筛选**：可以按状态筛选任务（全部 / waiting / running / success / error / skipped）。

**Tab 过滤**：图片标签下只显示图片任务，视频标签下只显示视频任务。

### 下载管理

生成完成后，文件自动下载到：

```
Chrome 下载目录/
└── FlowAuto/
    └── 项目名/
        ├── 提示词摘要__o01__任务ID.png
        ├── 提示词摘要__o02__任务ID.png
        ├── 提示词摘要__o03__任务ID.png
        └── 提示词摘要__o04__任务ID.png
```

命名规则：
- **目录**：`FlowAuto/` + 当前 Flow 项目名
- **文件名**：`{提示词前40字或自定义文件名}__o{序号}__{任务ID后6位}.{扩展名}`
- 文件名中的非法字符自动替换为 `_`
- 同名文件自动添加 `(1)` `(2)` 后缀

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
cat_white, 一只白猫在花园里追蝴蝶
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

| 模型 ID | 显示名称 | 说明 |
|---------|---------|------|
| `nano-banana-pro` | Nano Banana Pro | 默认图片模型 |
| `nano-banana` | Nano Banana | 轻量版 |
| `imagen4` | Imagen 4 | Google Imagen 模型 |

### 视频模型

| 模型 ID | 显示名称 | 说明 |
|---------|---------|------|
| `veo3.1-fast` | Veo 3.1 - Fast | 快速生成，默认视频模型 |
| `veo3.1-quality` | Veo 3.1 - Quality | 高质量生成 |
| `veo2-fast` | Veo 2 - Fast | Veo 2 快速版 |
| `veo2-quality` | Veo 2 - Quality | Veo 2 高质量版 |

### 生成模式

| 模式 | 说明 | 标签 |
|------|------|------|
| `create-image` | 制作图片 | 图片 |
| `text-to-video` | 文生视频 | 视频 |
| `frames-first` | 首帧生视频 | 视频 |
| `frames-first-last` | 首+尾帧生视频 | 视频 |
| `ingredients` | 素材生视频 | 视频 |

---

## 兼容性矩阵

扩展内置了兼容性守卫（Capability Guard），在任务加入队列时自动检查并纠正不兼容的参数组合：

| 规则 | 处理 |
|------|------|
| Veo 2 + 9:16 | 自动切换到 Veo 3.1 - Fast |
| Ingredients + 非 Veo 3.1 Fast | 自动切换到 Veo 3.1 - Fast |
| Jump To + 9:16 | 自动切换到 16:9 |
| Jump To + Veo 3.1 Fast | 自动切换到 Veo 3.1 - Quality |
| Extend + 9:16 | 自动切换到 16:9 |
| Extend + Veo 2 Quality | 自动切换到 Veo 2 - Fast |
| 首+尾帧 + Veo 2 Quality | 自动切换为可用模型 |
| Camera Control + 非 Veo 2 Fast | 自动切换到 Veo 2 - Fast |
| 视频模式 + 图片模型 | 标记为 skipped，提示用户切换 |

---

## 架构设计

### 项目结构

```
flowauto-extension/
├── manifest.json                    # Chrome MV3 清单
├── package.json
├── vite.config.ts                   # Vite + CRXJS + Svelte 配置
├── tsconfig.json
├── svelte.config.js
├── sidepanel/
│   └── index.html                   # Side Panel 入口 HTML
└── src/
    ├── background/                  # Service Worker（后台服务）
    │   ├── index.ts                 # 消息路由、Side Panel 行为
    │   ├── queue-engine.ts          # 队列状态管理（CRUD + 持久化）
    │   ├── runner.ts                # 任务执行循环
    │   ├── download-manager.ts      # 下载重命名（onDeterminingFilename）
    │   ├── content-injection.ts     # 内容脚本按需注入
    │   └── storage.ts               # chrome.storage.local 封装
    ├── content/                     # Content Script（页面自动化）
    │   ├── index.ts                 # 消息监听、任务分发
    │   ├── finders.ts               # DOM 元素查找（按钮、输入框等）
    │   ├── selectors.ts             # CSS 选择器和关键词常量
    │   ├── page-state.ts            # 页面状态检测（项目名、URL）
    │   ├── actions/
    │   │   ├── execute-task.ts      # 任务编排（6步流程）
    │   │   ├── navigate.ts          # 视频/图片标签切换
    │   │   ├── settings.ts          # 设置面板（模式/画幅/数量/模型）
    │   │   ├── prompt.ts            # 提示词注入
    │   │   ├── generate.ts          # 点击创建 + 等待完成
    │   │   └── download.ts          # 下载逻辑（URL 提取 + 消息发送）
    │   └── utils/
    │       ├── dom.ts               # DOM 工具（forceClick, waitFor, sleep）
    │       └── aria.ts              # ARIA 属性匹配工具
    ├── sidepanel/                   # Side Panel UI
    │   ├── main.ts                  # Svelte 应用入口
    │   └── App.svelte               # 主界面组件
    └── shared/                      # 跨组件共享
        ├── constants.ts             # 消息类型常量
        ├── types.ts                 # TypeScript 类型定义
        ├── protocol.ts              # 消息协议类型
        ├── prompt-parser.ts         # 提示词文本解析
        ├── filename-utils.ts        # 文件名生成与清理
        ├── capability-guard.ts      # 兼容性检查
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
      └────────────────────────────┴────────────────────────────┘
```

**消息类型：**

| 消息 | 方向 | 用途 |
|------|------|------|
| `PING` / `PONG` | Panel → BG → Content | 连接状态检测 |
| `GET_PAGE_STATE` | Panel → BG → Content | 获取页面状态（URL、Tab） |
| `QUEUE_ADD_TASKS` | Panel → BG | 添加任务到队列 |
| `QUEUE_START` / `QUEUE_PAUSE` | Panel → BG | 启动/暂停队列 |
| `QUEUE_GET_STATE` | Panel → BG | 获取队列状态 |
| `QUEUE_CLEAR` / `QUEUE_CLEAR_HISTORY` | Panel → BG | 清空全部/历史任务 |
| `QUEUE_REMOVE_TASK` / `QUEUE_SKIP_TASK` | Panel → BG | 删除/跳过任务 |
| `QUEUE_RETRY_ERRORS` | Panel → BG | 重试所有失败任务 |
| `SETTINGS_UPDATE` | Panel → BG | 更新默认设置 |
| `EXECUTE_TASK` | BG → Content | 发送任务给内容脚本执行 |
| `TASK_RESULT` | Content → BG | 任务执行结果 |
| `TASK_LOG` | Content → BG | 任务执行日志 |
| `DOWNLOAD_BY_URL` | Content → BG | 请求下载文件 |

### 自动化流程

每个任务的执行遵循以下 6 步流程：

```
1. 切换标签页        selectTab('image' | 'video')
       ↓
2. 设置生成模式      setMode('create-image' | 'text-to-video' | ...)
       ↓
3. 设置参数          setAspectRatio() → setOutputCount() → setModel()
       ↓
4. 输入提示词        setPromptText() — 通过 React 原生 setter 注入
       ↓
5. 点击创建+等待     clickCreate() → waitForGenerationComplete()
       ↓
6. 下载文件          downloadImagesDirectly() — 提取 img.src 发送到后台下载
```

每一步都通过 `TASK_LOG` 消息记录到任务日志中。

### 完成检测

采用双信号策略，任意一个触发即视为生成完成：

**信号 A — 按钮恢复（主信号）：**
- 每 2 秒重新查询创建按钮（避免 React DOM 替换导致引用过期）
- 检测 `disabled` 属性和 `aria-disabled` 属性
- 按钮恢复可用即完成

**信号 B — URL 稳定性（备用信号）：**
- 记录点击创建前所有结果图片的 URL 集合（基线）
- 每 2 秒统计新增 URL 数量
- 当新增数量 ≥ 期望数量，且连续 3 次轮询（约 6 秒）数量不变，视为完成
- 防止 Flow 在某些情况下按钮不恢复导致超时

**超时：** 图片 120 秒，视频 900 秒。

### 下载流程

```
Content Script                    Background
     │                                │
     │  1. 收集基线 URL               │
     │  2. 找出新生成的图片           │
     │  3. 提取 img.src               │
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
- 使用 `chrome.downloads.onDeterminingFilename` 监听器拦截下载文件名，应用 `FlowAuto/项目名/文件名` 路径
- 下载发起后轮询 `chrome.downloads.search`（每秒一次），确认文件状态为 `complete` 后才返回
- 如果下载中断（`interrupted`）返回失败

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | 5.9 | 类型安全 |
| **Svelte** | 5 | Side Panel UI |
| **Vite** | 7 | 构建工具 |
| **@crxjs/vite-plugin** | 2.3 | Chrome 扩展打包 |
| **Chrome MV3** | - | 扩展清单 |
| **chrome.sidePanel** | - | 侧边栏 API |
| **chrome.downloads** | - | 下载管理 |
| **chrome.storage.local** | - | 队列和设置持久化 |

---

## 常见问题

### Side Panel 打不开

确保 Chrome 版本 ≥ 116。点击扩展图标应自动打开 Side Panel。如果无反应，尝试：
1. 到 `chrome://extensions/` 禁用再启用扩展
2. 重新加载扩展

### 显示「未检测到内容脚本」

扩展会在打开 Side Panel 和执行任务时自动注入内容脚本。如果仍然提示：
1. 刷新 Flow 页面
2. 确认扩展有访问 `labs.google` 的权限（扩展详情 → 网站访问权限）

### 生成了图片但没下载

检查 Chrome 下载设置：
- 确认没有被浏览器拦截
- 确认 `chrome://downloads/` 中没有下载被阻止
- 查看控制台 (F12) 中是否有 `[FlowAuto]` 相关错误

### 生成超时

- 图片超时为 120 秒，视频为 900 秒
- 如果 Flow 服务器负载高可能需要更长时间
- 可以重试失败的任务

### 队列停了不动

- 确认当前标签页是 Flow 项目页
- 确认连接状态显示「已连接」
- 检查是否有错误任务阻塞（查看任务卡片的错误信息和日志）

### 如何清空所有数据

1. 「清空历史」只清除已完成任务
2. 如需完全重置，到 `chrome://extensions/` 点击扩展的「清除数据」按钮
