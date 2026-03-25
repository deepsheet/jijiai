# 阿里云智能语音交互 ASR 集成经验总结

## 项目背景
- **项目名称**: 急急话术AI
- **集成时间**: 2026-03-24
- **集成模块**: 阿里云智能语音交互 ASR (语音识别)

---

## 核心问题与解决方案

### 问题1: Token 获取失败
**错误现象**: 
- `404 Not Found` - API 接口不存在
- `No permission!` - 权限不足

**根本原因**:
1. 浏览器端无法直接调用阿里云 Token API (CORS 限制)
2. AccessKey 需要 `AliyunNLSFullAccess` 权限

**解决方案**:
1. **搭建 Node.js 代理服务器** (`server.cjs`)
   - 端口: 3001
   - 接口: `GET http://localhost:3001/token`
   - 使用阿里云官方 SDK 调用 `CreateToken` API

2. **RAM 权限配置**
   - 登录阿里云控制台
   - 访问 RAM 访问控制
   - 为 AccessKey 添加 `AliyunNLSFullAccess` 权限

---

### 问题2: WebSocket 连接后立即断开
**错误代码**: `40000002` (Invalid message)

**根本原因**: 
`message_id` 和 `task_id` 格式不符合阿里云要求

**错误示例**:
```json
{
  "message_id": "6c462f88-b462-47b3-8098-ba106f568ceb",  // ❌ 带连字符
  "task_id": "170b07d9-9116-46fd-af6e-6ef5167f5bcf"       // ❌ 带连字符
}
```

**正确格式**:
```json
{
  "message_id": "6c462f88b46247b38098ba106f568ceb",  // ✅ 32位小写，无连字符
  "task_id": "170b07d9911646fdaf6e6ef5167f5bcf"       // ✅ 32位小写，无连字符
}
```

**关键代码**:
```typescript
// 生成 UUID - 阿里云要求32位小写UUID，不带连字符
private generateUUID(): string {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
    return (Math.random() * 16 | 0).toString(16);
  });
}
```

---

### 问题3: 命名空间选择错误
**错误选择**: `SpeechTranscriber` (实时语音识别)

**正确选择**: `SpeechRecognizer` (一句话识别)

**区别**:
- `SpeechRecognizer`: 一句话识别，适合 60 秒以内的短语音
- `SpeechTranscriber`: 实时语音识别，适合长时间的连续识别

**本项目使用**: `SpeechRecognizer` (一句话识别)

---

## 成功的消息格式

### 开始识别
```json
{
  "header": {
    "namespace": "SpeechRecognizer",
    "name": "StartRecognition",
    "appkey": "IJy2Oaj6mozryBZo",
    "message_id": "6c462f88b46247b38098ba106f568ceb",
    "task_id": "170b07d9911646fdaf6e6ef5167f5bcf"
  },
  "payload": {
    "format": "pcm",
    "sample_rate": 16000,
    "enable_intermediate_result": true,
    "enable_punctuation_prediction": true,
    "enable_inverse_text_normalization": true
  }
}
```

### 停止识别
```json
{
  "header": {
    "namespace": "SpeechRecognizer",
    "name": "StopRecognition",
    "message_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "task_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "appkey": "IJy2Oaj6mozryBZo"
  }
}
```

---

## 技术架构

### 前端 (浏览器)
- **WebSocket 连接**: `wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token={token}`
- **音频采集**: Web Audio API + ScriptProcessorNode
- **音频格式**: PCM, 16kHz, 单声道, 16bit

### 后端 (Node.js 代理)
- **服务**: `server.cjs`
- **端口**: 3001
- **功能**: Token 获取和缓存
- **阿里云 SDK**: `@alicloud/nls-2019-02-28`

### 数据流
```
浏览器 → 代理服务器 → 阿里云 Token API
   ↓
WebSocket → 阿里云 ASR 服务
   ↓
实时识别结果 → 浏览器显示
```

---

## 关键配置

### 阿里云项目配置
- **AppKey**: `IJy2Oaj6mozryBZo`
- **服务类型**: 智能语音交互 - 一句话识别
- **模型**: 中文普通话（识音石 V1 - 端到端模型）
- **采样率**: 16K

### 权限配置
- **AccessKey ID**: `YOUR_ALIYUN_ACCESS_KEY_ID`
- **AccessKey Secret**: `YOUR_ALIYUN_ACCESS_KEY_SECRET`
- **RAM 权限**: `AliyunNLSFullAccess`

---

## 调试技巧

### 1. 查看详细日志
```typescript
// 打印发送的消息
console.log('发送消息:', JSON.stringify(message, null, 2));

// 打印收到的原始消息
console.log('收到原始消息:', event.data);

// 打印 WebSocket 关闭原因
console.log('WebSocket 连接已关闭:', {
  code: event.code,
  reason: event.reason,
  wasClean: event.wasClean
});
```

### 2. 错误代码对照
- `40000002`: 消息格式错误 (通常是 message_id 格式不对)
- `40020105`: AppKey 不存在
- `40020503`: RAM 子账号没有语音接口权限
- `403`: Token 过期或无效

### 3. 测试 Token 获取
```bash
curl http://localhost:3001/token
```

---

## 经验总结

### 时间投入
- **总耗时**: 约 4-5 小时
- **主要问题**: message_id 格式 (占 60% 时间)
- **次要问题**: Token 获取和权限配置 (占 30% 时间)
- **其他**: 命名空间选择、音频格式等 (占 10% 时间)

### 关键教训
1. **仔细阅读官方文档**: 阿里云对 message_id 格式有严格要求
2. **查看详细错误信息**: 不要只看错误代码，要看完整的错误消息
3. **使用代理服务器**: 浏览器端无法直接调用阿里云 API
4. **权限配置很重要**: AccessKey 必须有正确的 RAM 权限

### 最佳实践
1. 始终使用 32 位小写 UUID，不带连字符
2. 使用 Node.js 代理服务器处理 Token 获取
3. 添加详细的日志输出，方便调试
4. 测试时先验证 Token 获取是否成功

---

## 参考文档

- [阿里云智能语音交互官方文档](https://help.aliyun.com/zh/isi/developer-reference/api-reference-1)
- [阿里云一句话识别接口文档](https://help.aliyun.com/zh/isi/developer-reference/api-reference-1)
- [阿里云 Token 获取文档](https://help.aliyun.com/zh/isi/getting-started/overview-of-obtaining-an-access-token)

---

## 相关文件

- `/src/utils/aliyun-asr.ts` - 阿里云 ASR 工具类
- `/server.cjs` - Token 代理服务器
- `/public/config.json` - 配置文件

---

**记录时间**: 2026-03-24  
**记录人**: AI Assistant  
**项目**: 急急话术AI
