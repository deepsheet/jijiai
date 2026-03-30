import { pipeline, env } from '@xenova/transformers';

interface LocalASROptions {
  onResult: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onStatus: (status: string) => void;
  onProgress?: (progress: number) => void;
}

export class LocalASR {
  private options: LocalASROptions;
  private transcriber: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private isProcessing = false;
  private chunkInterval: number = 3000; // 3 秒一个录音片段
  private chunkTimer: any = null;

  constructor(options: LocalASROptions) {
    this.options = options;
    
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    
    // 使用国内镜像源 - 设置环境变量
    if (typeof window !== 'undefined') {
      (window as any).HF_ENDPOINT = 'https://hf-mirror.com';
      console.log('已设置 HF_ENDPOINT:', (window as any).HF_ENDPOINT);
    }
  }

  public async init(): Promise<void> {
    this.options.onStatus('正在加载语音识别模型...');
    console.log('正在加载语音识别模型...');
    console.log('当前 HF_ENDPOINT:', (window as any).HF_ENDPOINT);

    try {
      console.log('开始加载模型 Xenova/whisper-tiny (量化版)...');
      
      this.transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        quantized: true,
        progress_callback: (progress: any) => {
          console.log('模型加载进度:', progress);
          if (this.options.onProgress && progress.status === 'downloading') {
            this.options.onProgress(progress.progress);
          }
        }
      });
      
      this.options.onStatus('模型加载完成，准备录音');
      console.log('模型加载完成');
    } catch (error) {
      console.error('加载模型失败:', error);
      const errorMsg = '加载模型失败：' + (error as Error).message;
      this.options.onError(errorMsg);
      throw new Error(errorMsg);
    }
  }

  public async start(): Promise<void> {
    if (!this.transcriber) {
      this.options.onError('模型未初始化');
      return;
    }

    this.options.onStatus('正在请求麦克风权限...');
    console.log('正在请求麦克风权限...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.options.onStatus('麦克风权限已授予，开始录音...');
      console.log('麦克风权限已授予');

      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.isRecording = true;

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100);
      
      // 设置定时器，每隔一段时间处理一次音频
      this.startChunkTimer();
      
      this.options.onStatus('正在录音，请说话...');
      console.log('开始录音');
    } catch (error) {
      console.error('获取麦克风权限失败:', error);
      this.options.onError('获取麦克风权限失败：' + (error as Error).message);
    }
  }

  private startChunkTimer(): void {
    this.chunkTimer = setInterval(() => {
      if (this.isRecording && !this.isProcessing && this.audioChunks.length > 0) {
        this.processCurrentChunk();
      }
    }, this.chunkInterval);
  }

  private async processCurrentChunk(): Promise<void> {
    if (this.audioChunks.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const chunks = [...this.audioChunks];
    this.audioChunks = [];

    try {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      await this.processAudio(audioBlob);
    } catch (error) {
      console.error('处理音频片段失败:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  public stop(): void {
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.mediaRecorder && this.isRecording) {
      this.isRecording = false;
      this.mediaRecorder.stop();
      
      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }

      if (this.audioChunks.length > 0) {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.processAudio(audioBlob).catch(console.error);
      }
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    try {
      this.options.onStatus('正在识别语音...');
      console.log('正在识别语音...');

      const result = await this.transcriber(audioBlob, {
        language: 'chinese',
        task: 'transcribe',
        return_timestamps: false,
      });

      const text = result.text;
      console.log('识别结果:', text);
      
      if (text && text.trim()) {
        this.options.onResult(text, true);
        this.options.onStatus('识别完成');
      } else {
        this.options.onStatus('未识别到语音');
      }
    } catch (error) {
      console.error('识别失败:', error);
      this.options.onError('识别失败：' + (error as Error).message);
    }
  }

  public destroy(): void {
    this.stop();
    this.transcriber = null;
  }
}
