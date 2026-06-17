# 小说录音工作室 — 项目概况

## 项目定位

一款桌面端小说/有声书录制工具。用户导入 Word 文稿 → AI 自动分段 + 识别角色 → 人工校对 → 按角色逐段录音 → 导出 MP3。

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端框架 | Next.js (App Router) | 16.2.9 |
| UI 库 | React | 19.2.4 |
| CSS | Tailwind CSS | v4 |
| 桌面壳 | Electron | 31.7.7 |
| 打包 | electron-builder | 26.15.3 |
| 本地存储 | IndexedDB (idb) | 8.0.3 |
| 状态管理 | Zustand | 5.0.14 |
| 文档解析 | mammoth | 1.12.0 |
| 音频录制 | 浏览器 MediaRecorder API | — |
| 音频编码 | lamejs (浏览器端 WAV→MP3) | 1.2.1 |
| AI 角色识别 | DeepSeek Chat API | — |
| DOCX 解析 | mammoth | 1.12.0 |
| ZIP 导出 | jszip | 3.10.1 |
| TypeScript | | 5.x |

## 平台支持

- macOS (Apple Silicon) — `.app` 直接运行
- Windows (x64) — NSIS 一键安装包 + 便携版

## 源码结构

```
src/
├── app/
│   ├── page.tsx                          # 首页（项目列表 / 上传入口）
│   ├── layout.tsx                        # 根布局
│   ├── globals.css                       # Tailwind + 自定义样式
│   ├── studio/[id]/page.tsx              # 录音工作室主页面（~1060行，核心）
│   └── api/
│       ├── parse-docx/route.ts           # 上传 DOCX → 提取纯文本
│       ├── segment-text/route.ts         # 文本智能分段
│       └── identify-roles/route.ts       # AI 角色识别（DeepSeek + 规则回退）
├── components/
│   ├── upload/DocUploader.tsx            # 上传 + 审核界面（~600行）
│   ├── text/
│   │   ├── TextViewer.tsx                # 分段文本展示（最近增加角色切换）
│   │   ├── Teleprompter.tsx              # 提词器视图（大字滚动）
│   │   └── RoleEditor.tsx                # 角色增删改查
│   ├── recording/
│   │   ├── RecordControls.tsx            # 录音操作按钮
│   │   ├── SegmentRecorder.tsx           # 逐段录音面板
│   │   └── TrackWaveform.tsx             # 波形显示
│   ├── playback/
│   │   └── PlaybackBar.tsx               # 播放控制栏
│   ├── export/
│   │   └── ExportPanel.tsx               # 导出 MP3
│   ├── chapters/
│   │   └── ChapterList.tsx               # 章节列表
│   └── layout/
│       └── SettingsPanel.tsx             # API Key 配置
├── hooks/
│   ├── useIndexedDB.ts                   # 数据库操作 hooks
│   ├── useRecorder.ts                    # 录音状态管理
│   ├── useAudioPlayer.ts                 # 播放状态管理
│   ├── useTeleprompter.ts                # 提词器滚动逻辑
│   └── useShortcuts.ts                   # 键盘快捷键
├── lib/
│   ├── types.ts                          # 所有 TypeScript 类型定义
│   ├── db.ts                             # IndexedDB CRUD 操作（含批处理）
│   ├── text-parser.ts                    # 文本分段 + 引号提取 + 规则角色分配
│   ├── deepseek.ts                       # DeepSeek API 调用 + AI 提示词
│   ├── audio-utils.ts                    # 音频解码、WAV/MP3 转换、拼接
│   ├── export-import.ts                  # ZIP 格式项目导出/导入
│   └── electron.d.ts / lamejs.d.ts      # 类型声明
electron/
├── main.js                               # Electron 主进程（Next.js 程序化启动）
├── preload.js                            # contextBridge 安全桥接
└── entitlements.mac.plist                # macOS 权限声明（麦克风）
```

## 核心数据流

```
Word 文档 (.docx)
  │
  ▼
[1] mammoth 提取纯文本                 → POST /api/parse-docx
  │
  ▼
[2] 智能分段（双引号独立成段）          → POST /api/segment-text
  │   引号内 → dialogue, 引号外 → narration
  ▼
[3] AI 角色识别                        → POST /api/identify-roles
  │   DeepSeek API（主） / 规则匹配（回退）
  │   narration 段一律归「旁白」
  ▼
[4] 人工校对（审核界面）               → DocUploader 审核模式
  │   支持：批量选择、批量改角色、新建/重命名/删除角色
  │   默认显示「⚠未标注」对话段
  ▼
[5] 逐段录音                           → 工作室页面
  │   MediaRecorder → WebM (Opus)
  │   提词器 / 波形显示 / 角色筛选
  ▼
[6] 导出 MP3                           → ExportPanel
      WebM → 解码 → WAV → lamejs → MP3
```

## 数据模型 (IndexedDB)

```
Project ──┬── Chapter[] ──┬── Segment[]
           │               │    id, text, roleId, roleName, index, recordingId
           │               │
           │               └── RecordingData (Blob)
           │                    id, segmentId, audioBlob, duration
           │
           └── Role[]
                id, projectId, name, color
```

## 关键实现细节

### 文本分段 (`text-parser.ts`)
- 逐字符栈扫描引号配对 `"" '' 「」 『』`，精确提取引号内内容为 dialogue 段
- 引号外文字全部为 narration 段
- 支持 Shift+点击连续选择、批量改角色
- 融合短碎片（<3字）

### AI 角色识别 (`deepseek.ts`)
- 模型：`deepseek-chat`，temperature=0.1，response_format=json
- 分块策略：≤25段单次调用，>25段两遍（采样→全角色→逐块标注）
- 兜底：`forceNarrationToNarrator()` 强制 narration→旁白
- 规则回退：`extractCharacterNames()` + `ruleBasedRoleAssign()`

### Electron 打包
- macOS: `dir` 目标，输出 `.app`
- Windows: `nsis`（一键安装）+ `portable`（便携版）
- Next.js 通过程序化 API 启动（`require("next")`），避免 ASAR 内 spawn 失败
- 需 `env -u ELECTRON_RUN_AS_NODE` 避免 VSCode 终端环境变量冲突

### 审核界面（最近改进）
- 统计栏：总段数 / 旁白数 / 对话数 / ⚠未标注数
- 「⚠未标注」标签筛选 AI 漏掉的所有对话段
- 「+新建角色」手动补建 AI 没识别出的角色
- 批量操作：勾选 → 批量改角色
- 双击角色名内联重命名，× 删除（段落归旁白）

## 已知限制与潜在优化点

1. **AI 角色识别准确率低** — 中文小说人物称呼多样（别名、代词），DeepSeek 经常漏识别或错识别
2. **规则回退质量差** — `extractCharacterNames` 会把副词（"轻声"、"微笑"）误判为角色名
3. **无增量保存** — 录音过程中如果崩溃，未导出的录音会丢失
4. **单章录音** — 每次只能录一章，无法跨章节管理
5. **无音频后处理** — 无降噪、无音量归一化、无静音裁剪
6. **提词器体验** — 大字滚动但无自动翻页、无语速提示
7. **无项目管理** — 无法删除/归档项目，无搜索功能
8. **录音格式** — 录制 WebM (Opus)，导出转 MP3，中间 WAV 转换浪费内存
9. **无自动保存录音进度** — 没有标记哪些段已录、哪些未录的持久化状态
10. **角色审核界面** — 对话段按顺序排列但无法看到"某角色所有台词"的聚合视图
11. **章节内缺少导航** — 段落多时只能手动滚动，无跳转到指定段的功能
12. **代码组织** — `studio/[id]/page.tsx` 超 1000 行，职责过多
13. **无测试** — 0% 测试覆盖率
14. **错误处理** — 多处 `console.error` 但无用户提示或重试机制
15. **Electron 版本锁定** — 因 `require("electron")` 在 VSCode 终端下的问题，从 v42 降级到 v31
