// 阿里云智能语音交互 ASR 工具 - 完整实现
// 参考官方文档：https://help.aliyun.com/zh/isi/developer-reference/api-reference-1

interface AliyunASROptions {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
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
  private taskId: string = '';

  constructor(options: AliyunASROptions, onResult: (text: string, isFinal: boolean) => void, onError: (error: string) => void, onStatus: (status: string) => void) {
    this.options = options;
    this.onResult = onResult;
    this.onError = onError;
    this.onStatus = onStatus;
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
        this.onStatus('WebSocket 连接成功，发送开始指令...');
        this.startRecognition();
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
        this.onStatus(`WebSocket 连接已关闭 (代码：${event.code}, 原因：${event.reason})`);
      };
    } catch (error) {
      console.error('连接失败:', error);
      this.onError('连接失败：' + (error as Error).message);
    }
  }

  // 开始识别 - 使用一句话识别格式
  private startRecognition(): void {
    if (!this.ws) return;
    
    console.log('发送开始识别指令...');
    
    const messageId = this.generateUUID();
    this.taskId = this.generateUUID();
    
    // 使用一句话识别格式（SpeechRecognizer）
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
    
    // 开始录音并发送音频数据
    this.startRecording();
  }

  // 生成 UUID - 阿里云要求32位小写UUID，不带连字符
  private generateUUID(): string {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
      return (Math.random() * 16 | 0).toString(16);
    });
  }

  // 开始录音
  private async startRecording(): Promise<void> {
    try {
      console.log('开始录音...');
      this.onStatus('正在请求麦克风权限...');
      
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
      
      // 创建 ScriptProcessorNode 来处理音频数据
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessor = processor;
      
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const pcmData = this.float32ToPCM(inputData);
        
        // 只有在识别开始后才发送音频
        if (this.isRecognitionStarted && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(pcmData.buffer);
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
        this.onError('识别失败：' + error);
      }
    } catch (error) {
      console.error('处理消息失败:', error);
    }
  }

  // 停止识别
  public stop(): void {
    console.log('停止识别...');
    
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
    
    if (this.ws) {
      // 发送停止指令
      const stopMessage = {
        header: {
          namespace: 'SpeechRecognizer',
          name: 'StopRecognition',
          message_id: this.generateUUID(),
          task_id: this.taskId,
          appkey: this.options.appKey
        }
      };
      
      this.ws.send(JSON.stringify(stopMessage));
      this.ws.close();
      this.ws = null;
    }
    
    this.isRecognitionStarted = false;
    this.onStatus('已停止');
  }
}
