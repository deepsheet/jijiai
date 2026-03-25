# 文档三：软件需求文档 (PRD for AI IDE)

**目标读者**：Cursor, Windsurf, Devin 等 AI 编程助手
**版本**：v1.1
**更新日期**：2026-03-23

## 1. 项目概述

构建一个跨平台 (Windows/macOS) 桌面应用，核心功能是监听系统音频 → 实时语音转文字 (ASR) → 检索增强生成 (RAG) → 悬浮窗展示话术。

- **项目名称**：急急话术 AI
- **技术栈**：Tauri v2 + Rust + React + TypeScript
- **开发环境**：macOS (M 系列)
- **目标平台**：Windows 10/11 (优先), macOS 12+

## 2. 用户故事 (User Stories)

| ID | 用户故事 | 优先级 | 验收标准 |
|----|----------|--------|----------|
| US-01 | 用户上传 PDF/Word/Txt 知识库文件，系统自动切片、向量化并存储 | P0 | 支持批量上传，显示处理进度，完成后可搜索 |
| US-02 | 引导用户选择/安装虚拟声卡 (VB-Cable/BlackHole)，并设置为默认录音源 | P0 | 首次启动自动检测，提供一键安装和配置向导 |
| US-03 | 应用启动后，自动监听选定音频源，实时转写并匹配知识库，在悬浮窗显示结果 | P0 | 延迟<1.5 秒，准确率>85%，悬浮窗始终置顶 |
| US-04 | 悬浮窗支持一键复制话术、最小化到托盘、鼠标穿透 (可选) | P1 | 点击复制有 Toast 提示，托盘菜单功能完整 |
| US-05 | 提供设置页（选择模型、知识库路径、音频设备），显示当前运行状态 | P1 | 设置可保存，状态实时刷新 |
| US-05-1 | 用户可以配置大模型 API（DeepSeek/通义千问/OpenAI）和语音识别服务（本地ASR/阿里云ASR/讯飞ASR） | P1 | 设置可测试连接，保存后立即生效 |
| US-06 | 通话结束后自动生成结构化小结 (客户意向、痛点、下一步计划) | P2 | 小结可编辑、可复制、可导出 |
| US-07 | 用户订阅验证，按人头和使用量计费 | P1 | 支持激活码验证，用量统计，到期提醒 |

## 3. 功能模块详细需求

### Module A: 知识库引擎 (Knowledge Engine)

| 属性 | 详情 |
|------|------|
| 输入 | 文件路径列表 (.pdf, .docx, .txt, .md) |
| 处理 | 1. 使用 langchain 进行文本加载和清洗<br>2. 使用 RecursiveCharacterTextSplitter 切片 (Chunk: 500 字，Overlap: 50 字)<br>3. 调用本地 Embedding 模型 (BGE-M3 ONNX) 生成向量<br>4. 存入本地向量数据库 (LanceDB)，持久化路径 `./data/vectors/{user_id}` |
| 输出 | 索引完成提示，片段数量统计，支持增量更新 |
| 性能要求 | 100MB 文档处理时间 < 5 分钟 |

### Module B: 音频输入与 ASR (Audio Input & ASR)

| 属性 | 详情 |
|------|------|
| **使用场景模式** | 应用提供三种预设场景模式，用户根据实际场景选择，而非手动配置技术参数 |
| **模式 A：在线会议/电话辅助 (默认推荐 🌟)** | **用户场景**：使用腾讯会议、钉钉、Zoom 或软电话进行销售通话<br>**技术实现**：<br>- **输入源**：仅监听虚拟声卡 (VB-Cable/BlackHole)<br>- **前置引导**：首次启动时检测虚拟声卡驱动，若未安装则引导安装；若已安装，引导用户将"会议软件"的扬声器/输出设备设置为该虚拟声卡<br>- **声音透传**：提供图文教程，教用户如何在系统声音设置中开启"侦听此设备"(Win) 或创建"多输出设备"(Mac)，确保用户自己能听到会议声音<br>- **优势**：声音纯净，无环境噪音，无回声，ASR 识别率最高，专为实时话术推荐设计 |
| **模式 B：线下面谈/个人演练** | **用户场景**：线下与客户面对面交谈，或独自对着电脑模拟演练<br>**技术实现**：<br>- **输入源**：仅监听系统默认物理麦克风<br>- **处理逻辑**：开启 VAD，不区分说话人（或尝试简单的说话人分离），将所有听到的声音转为文字并分析<br>- **UI 提示**：提示用户"请保持环境安静，靠近麦克风" |
| **模式 C：全双工纪要模式 (高级/实验性)** | **用户场景**：需要同时记录"客户声音"和"我自己的回答"，生成完整对话纪要<br>**技术实现**：<br>- **输入源**：同时监听虚拟声卡 (客户) + 物理麦克风 (自己)<br>- **强制约束**：<br>&nbsp;&nbsp;1. UI 强提示用户"请务必佩戴耳机"，否则会产生严重回声<br>&nbsp;&nbsp;2. **回声抑制策略**：当虚拟声卡检测到语音时，暂时降低麦克风的灵敏度或忽略麦克风输入<br>&nbsp;&nbsp;3. **说话人标记**：输出的文本需标记 `[客户]` 或 `[我]`<br>- **性能警告**：此模式 CPU 占用较高，若检测到性能不足，自动降级为模式 A |
| **处理逻辑** | 1. **流管理**：使用 Rust `cpal` 独立管理输入流（模式 A/C 支持多路并行）<br>2. **VAD 仲裁**：根据场景模式动态调整 VAD 策略<br>3. **缓冲与推理**：累积 1-2 秒有效语音片段，送入 Whisper.cpp<br>4. **动态降级**：若 CPU > 80%，自动关闭非核心功能（如模式 C 降级为模式 A） |
| **输出** | 带说话人标签的文本流：<br>- 模式 A：`{speaker: "client", text: "..."}`<br>- 模式 B：`{speaker: "unknown", text: "..."}`<br>- 模式 C：`{speaker: "client" | "user", text: "..."}` |
| **性能要求** | 模式 A：端到端延迟 < 0.8 秒；模式 B/C：延迟 < 1.5 秒；总内存 < 120MB |

### Module C: 语义检索与生成 (RAG Core)

| 属性 | 详情 |
|------|------|
| 输入 | 实时文本字符串 (最近 3 句对话) |
| 处理 | 1. 将输入文本向量化<br>2. 在向量库中执行相似度搜索 (Top-K=3, Threshold=0.6)<br>3. 构建 Prompt: `Context: {retrieved_chunks}. User Question: {input_text}. Generate a short, professional sales response in Chinese.`<br>4. 调用本地小模型 (Qwen2.5-1.5B-Instruct GGUF) 或云端 API (可配置) 生成回复 |
| 输出 | 推荐话术文本 (限 200 字以内) |
| 性能要求 | 检索 + 生成总时间 < 1.5 秒 |

### Module D: UI 与交互 (Frontend)

| 属性 | 详情 |
|------|------|
| 框架 | Tauri v2 + React + TypeScript + Tailwind CSS |
| 组件 | 1. FloatingWindow: 无边框、透明背景、always_on_top=true。显示实时字幕和推荐话术卡片<br>2. SettingsPanel: 常规设置窗口<br>3. TrayIcon: 系统托盘图标，支持右键菜单 (启动/停止/退出/设置)<br>4. KnowledgeManager: 知识库管理界面 (上传/删除/搜索) |
| 交互 | 点击话术卡片自动复制到剪贴板并 Toast 提示；支持拖拽移动悬浮窗位置 |
| 性能要求 | UI 渲染帧率 > 30fps，启动时间 < 3 秒 |

### Module D-1: 设置与配置 (Settings & Configuration)

| 属性 | 详情 |
|------|------|
| **设置入口** | 主界面点击"设置"按钮打开设置弹窗 |
| **大模型 API 设置** | - **DeepSeek**（默认）：baseUrl=https://api.deepseek.com/v1，model=deepseek-chat<br>- **通义千问**：支持配置自定义 API<br>- **OpenAI**：支持配置自定义 API 和模型 |
| **语音识别 (ASR) 设置** | - **本地内置 ASR**（默认）：使用浏览器 Web Speech API，免费<br>- **阿里云 ASR API**：需要配置 Access Key ID/Secret 和 AppKey<br>- **讯飞 ASR API**：需要配置 AppID、API Key 和 Secret |
| **测试链接功能** | 点击"测试链接"按钮测试所有配置的连接：<br>- 大模型 API：发送测试请求验证 API Key 和网络连接<br>- 本地 ASR：检查浏览器是否支持 Web Speech API<br>- 云端 ASR：验证凭证格式和必填项 |
| **持久化存储** | 设置保存到浏览器 localStorage，刷新页面后设置依然存在 |
| **默认配置** | - 大模型：DeepSeek Chat<br>- ASR：本地内置 ASR |

### Module E: 订阅与计费 (Subscription)

| 属性 | 详情 |
|------|------|
| 验证方式 | 激活码验证 (初期)，后期接入支付 API |
| 用量统计 | 本地记录每日使用时长、知识库大小、API 调用次数 |
| 到期处理 | 到期前 7 天提醒，到期后降级为基础功能或停用 |

## 4. 非功能性需求

| 类别 | 要求 |
|------|------|
| 性能 | 端到端延迟 (声音→文字→话术) < 1.5 秒；内存占用 < 150MB；CPU 占用 < 20% |
| 兼容性 | Windows 10/11 (优先), macOS 12+；支持 Intel 和 M 系列芯片 |
| 隐私 | 默认所有处理在本地完成，不上传音频原始文件；用户数据加密存储 |
| 稳定性 | 连续运行 8 小时无崩溃；异常自动恢复 (如音频设备断开) |
| 安装包 | Windows < 50MB, macOS < 60MB；支持静默安装虚拟声卡驱动 |
| 可维护性 | 代码注释完整，AI 生成代码需人工审核；关键模块有单元测试 |

## 5. 数据模型

```typescript
// 知识库片段
interface KnowledgeChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    sourceFile: string;
    fileHash: string;
    createdAt: number;
  };
}

// 通话记录
interface CallSession {
  id: string;
  startTime: number;
  endTime: number;
  transcript: TranscriptionSegment[];
  summary?: string;
  actionItems?: string[];
}

// 用户订阅
interface Subscription {
  userId: string;
  plan: 'basic' | 'pro' | 'enterprise';
  startDate: number;
  endDate: number;
  usage: {
    hoursUsed: number;
    knowledgeBaseSize: number; // MB
    apiCalls: number;
  };
}
```

## 6. 验收标准 (Acceptance Criteria)

1. **功能完整性**：所有 P0 优先级用户故事可正常演示
2. **性能达标**：延迟、内存、CPU 占用符合非功能性需求
3. **跨平台兼容**：Windows 和 Mac 版本均可正常安装和运行
4. **用户体验**：悬浮窗不干扰腾讯会议操作，话术复制流畅
5. **隐私安全**：本地数据加密，无未经授权的 network 请求