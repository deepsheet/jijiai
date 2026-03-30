// 阿里云智能语音交互 ASR 工具 - 完整实现
// 参考官方文档：https://help.aliyun.com/zh/isi/developer-reference/api-reference-1

interface AliyunASROptions {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
  silenceTimeout?: number; // 语音识别静音秒数，默认60秒
}

export class AliyunASR {
  private options: AliyunASROptions;
  private ws: WebSocket | null = null;
  private onResult: (text: string, isFinal: boolean) => void;
  private onError: (error: string) => void;
  private onStatus: (status: string) => void;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isRecognitionStarted = false;
  private taskId: string | null = null;

  // 自动重连相关属性
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private isReconnecting = false;
  private lastAudioDataTime = 0; // 最后发送音频数据的时间戳
  private silenceCheckInterval: number | null = null;
  private silenceTimeout = 60; // 默认60秒静音超时，ASR后台会在静音超过此时间后自动关闭WebSocket
  private isManuallyStopped = false; // 标记是否手动停止，避免自动重连

  constructor(options: AliyunASROptions, onResult: (text: string, isFinal: boolean) => void, onError: (error: string) => void, onStatus: (status: string) => void) {
    this.options = options;
    this.onResult = onResult;
    this.onError = onError;
    this.onStatus = onStatus;

    // 设置静音超时，如果提供了则使用，否则使用默认值60秒
    this.silenceTimeout = options.silenceTimeout || 60;
  }

  // 开始静音检测
  private startSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    // 每秒检查一次静音
    this.silenceCheckInterval = window.setInterval(() => {
      const now = Date.now();
      const timeSinceLastAudio = now - this.lastAudioDataTime;

      // 如果超过静音超时时间，记录日志（但不主动关闭）
      if (timeSinceLastAudio > this.silenceTimeout * 1000 && this.lastAudioDataTime > 0) {
        console.log(`静音超过 ${this.silenceTimeout} 秒，等待ASR后台自动关闭...`);
      }
    }, 1000);
  }

  // 停止静音检测
  private stopSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }

  // 更新最后音频数据时间（每次发送音频数据时调用）
  private updateLastAudioTime(): void {
    this.lastAudioDataTime = Date.now();
  }

  // 自动重连
  private async reconnect(): Promise<void> {
    if (this.isReconnecting || this.isManuallyStopped) {
      return;
    }

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`已达到最大重连次数 ${this.maxReconnectAttempts}，停止重连`);
      this.onError(`ASR 连接已断开，重连失败（已达最大重连次数）`);
      return;
    }

    console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    this.isReconnecting = true;
    this.onStatus(`ASR 连接断开，正在尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    // 清理现有连接和音频流
    this.cleanupWebSocket();
    this.stopAudioProcessing();

    // 等待一段时间后重连
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000); // 指数退避
    console.log(`等待 ${delay}ms 后重连...`);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // 重置状态，确保 connect 会重新初始化
      this.isRecognitionStarted = false;
      this.taskId = null;
      
      await this.connect();
      this.isReconnecting = false;
      console.log('重连成功');
      this.onStatus('ASR 重连成功，正在重新开始识别...');
    } catch (error) {
      console.error('重连失败:', error);
      this.isReconnecting = false;
      // 继续尝试重连
      this.reconnect();
    }
  }

  // 清理WebSocket连接
  private cleanupWebSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  // 停止音频处理
  private stopAudioProcessing(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.isRecognitionStarted = false;
  }

  // 通过代理服务器获取 Token
  private async getToken(): Promise<string> {
    console.log('正在通过代理服务器获取 Token...');
    const response = await fetch('http://localhost:3001/token');
    const data = await response.json();
    
    if (data.success && data.token) {
      console.log('Token 获取成功:', data.token.substring(0, 20) + '...');
      return data.token;
    } else {
      throw new Error('获取 Token 失败：' + (data.error || '未知错误'));
    }
  }

  // 连接 WebSocket
  public async connect(): Promise<void> {
    try {
      this.onStatus('正在获取 Token...');
      console.log('正在获取 Token...');
      
      // 获取 Token
      const token = await this.getToken();
      this.onStatus('正在连接阿里云 ASR 服务...');
      console.log('Token 获取成功');
      
      // WebSocket URL（上海地域）
      const wsUrl = `wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token=${token}`;
      console.log('WebSocket URL:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket 连接成功');
        this.onStatus('WebSocket 连接成功，准备录音...');

        // 重置重连计数器
        this.reconnectAttempts = 0;
        this.isManuallyStopped = false;

        // 重置最后音频时间，避免立即触发静音检测
        this.lastAudioDataTime = Date.now();

        // 开始静音检测
        this.startSilenceDetection();

        // 开始识别
        console.log('准备调用 startRecognition...');
        this.startRecognition().then(() => {
          console.log('startRecognition 调用完成');
        }).catch(error => {
          console.error('startRecognition 失败:', error);
          this.onError('启动识别失败：' + (error as Error).message);
        });
      };
      
      this.ws.onmessage = (event) => {
        console.log('收到原始消息:', event.data);
        this.handleMessage(event);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        this.onError('WebSocket 连接错误：' + error.type);
      };
      
      this.ws.onclose = (event) => {
        console.log('WebSocket 连接已关闭:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        // 停止静音检测
        this.stopSilenceDetection();

        // 检查关闭原因
        const isSilenceTimeout = event.reason?.includes('silence') || event.reason?.includes('timeout') ||
                               (event.code === 1000 && event.reason === 'Normal closure');
        const isNormalClosure = event.code === 1000 && event.wasClean;

        // 记录状态
        if (isSilenceTimeout) {
          console.log('ASR 静音超时自动关闭');
          this.onStatus(`WebSocket 已关闭（静音超时 ${this.silenceTimeout} 秒）`);
        } else {
          this.onStatus(`WebSocket 连接已关闭 (代码：${event.code}, 原因：${event.reason})`);
        }

        // 如果不是手动停止，则尝试自动重连
        if (!this.isManuallyStopped && !isNormalClosure) {
          console.log('尝试自动重连...');
          this.reconnect();
        } else {
          console.log('连接正常关闭，不进行重连');
        }
      };
    } catch (error) {
      console.error('连接失败:', error);
      this.onError('连接失败：' + (error as Error).message);
    }
  }

  // 开始识别 - 使用一句话识别格式
  private async startRecognition(): Promise<void> {
    if (!this.ws) {
      console.error('startRecognition: WebSocket 不存在');
      return;
    }
    
    console.log('准备录音...');
    this.onStatus('正在请求麦克风权限...');
    
    try {
      // 如果已有媒体流，先清理
      if (this.mediaStream) {
        this.stopAudioProcessing();
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      this.mediaStream = stream;
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      const source = this.audioContext.createMediaStreamSource(stream);
      
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessor = processor;
      
      console.log('发送开始识别指令...');
      this.onStatus('正在发送识别指令...');
      
      const messageId = this.generateUUID();
      this.taskId = this.generateUUID();
      
      const message = {
        header: {
          namespace: 'SpeechRecognizer',
          name: 'StartRecognition',
          appkey: this.options.appKey,
          message_id: messageId,
          task_id: this.taskId
        },
        payload: {
          format: 'pcm',
          sample_rate: 16000,
          enable_intermediate_result: true,
          enable_punctuation_prediction: true,
          enable_inverse_text_normalization: true
        }
      };
      
      console.log('发送消息:', JSON.stringify(message, null, 2));
      this.ws.send(JSON.stringify(message));
      this.isRecognitionStarted = true;
      
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const pcmData = this.float32ToPCM(inputData);

        if (this.isRecognitionStarted && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(pcmData.buffer);
          // 更新最后音频数据时间
          this.updateLastAudioTime();
        }
      };
      
      source.connect(processor);
      processor.connect(this.audioContext.destination);
      
      console.log('录音已开始，正在发送音频数据...');
      this.onStatus('正在录音，请说话...');
    } catch (error) {
      console.error('录音失败:', error);
      this.onError('录音失败：' + (error as Error).message);
    }
  }

  // 生成 UUID - 阿里云要求32位小写UUID，不带连字符
  private generateUUID(): string {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
      return (Math.random() * 16 | 0).toString(16);
    });
  }

  // Float32Array 转 PCM (Int16)
  private float32ToPCM(float32Array: Float32Array): Int16Array {
    const pcmData = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcmData;
  }

  // 处理消息
  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('收到消息:', JSON.stringify(data, null, 2));
      
      if (data.header.name === 'RecognitionResultChanged') {
        // 中间识别结果
        const result = data.payload.result;
        if (result) {
          console.log('中间结果:', result);
          this.onResult(result, false);
        }
      } else if (data.header.name === 'RecognitionCompleted') {
        // 最终识别结果
        const result = data.payload.result;
        console.log('最终结果:', result);
        if (result) {
          this.onResult(result, true);
        }
        this.onStatus('识别完成');
      } else if (data.header.name === 'TaskFailed') {
        // 任务失败
        const error = data.header.status_text;
        console.error('任务失败:', error);
        
        // 检查是否是空闲超时错误
        if (error.includes('IDLE_TIMEOUT')) {
          console.log('检测到空闲超时，将触发重连...');
          this.onError('识别超时，正在重新连接...');
          // 关闭当前连接，触发 onclose 中的重连逻辑
          if (this.ws) {
            this.ws.close(1000, 'Idle timeout - will reconnect');
          }
        } else {
          this.onError('识别失败：' + error);
        }
      }
    } catch (error) {
      console.error('处理消息失败:', error);
    }
  }

  // 停止识别
  public stop(): void {
    console.log('停止识别...');

    // 标记为手动停止，避免自动重连
    this.isManuallyStopped = true;

    // 停止静音检测
    this.stopSilenceDetection();

    // 停止音频处理
    this.stopAudioProcessing();

    if (this.ws) {
      // 发送停止指令
      const stopMessage = {
        header: {
          namespace: 'SpeechRecognizer',
          name: 'StopRecognition',
          message_id: this.generateUUID(),
          task_id: this.taskId || '',
          appkey: this.options.appKey
        }
      };

      this.ws.send(JSON.stringify(stopMessage));
      this.ws.close();
      this.ws = null;
    }

    this.onStatus('已停止');
  }
}
