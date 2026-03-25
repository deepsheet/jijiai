import { useState, useRef, useEffect } from 'react';
import SettingsModal from './components/SettingsModal';
import KeywordDisplay from './components/KeywordDisplay';
import SuggestionModal from './components/SuggestionModal';
import { loadSettings, saveSettings, type Settings as AppSettings } from './utils/settings';
import { AliyunASR } from './utils/aliyun-asr';
import { LocalASR } from './utils/local-asr';

// 定义类型
interface TranscriptLine {
  id: string;
  speaker: 'customer' | 'agent' | 'system';
  text: string;
  timestamp: string;
}

interface Keyword {
  id: string;
  text: string;
  category: string;
  suggestions: string[];
}

// 模拟关键词数据库
const keywordDatabase: Keyword[] = [
  {
    id: '1',
    text: '价格',
    category: '产品',
    suggestions: [
      '我们的基础版是99元/人/月，包含实时话术和100MB知识库；专业版是199元/人/月，包含无限知识库、云端备份和通话小结功能。',
      '我们现在正在做促销活动，首月可以享受50%的折扣，非常划算。',
      '您可以先免费试用30天，体验一下产品的效果，再决定是否购买。'
    ]
  },
  {
    id: '2',
    text: '优势',
    category: '产品',
    suggestions: [
      '我们产品的核心优势是实时响应速度快、本地化部署安全、支持定制化开发。',
      '相比其他同类产品，我们的系统稳定性更高，错误率低于0.5%。',
      '我们提供7×24小时技术支持，确保您在使用过程中无后顾之忧。'
    ]
  },
  {
    id: '3',
    text: '试用',
    category: '销售策略',
    suggestions: [
      '您可以先免费试用30天，体验一下产品的效果，再决定是否购买。',
      '试用期间您将享有完整功能，让我们用实际效果来说话。',
      '很多客户在试用后都表示非常满意，建议您不要错过这个机会。'
    ]
  },
  {
    id: '4',
    text: '案例',
    category: '客户证明',
    suggestions: [
      '我们已经服务了500+企业客户，包括XX集团、YY公司等行业领先者。',
      'XX公司使用我们的产品后，销售转化率提升了300%。',
      '您可以访问我们的官网查看更多的成功案例和客户评价。'
    ]
  }
];

function App() {
  const [isCallActive, setIsCallActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [isSuggestionModalOpen, setIsSuggestionModalOpen] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<Keyword | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-170f4fc64eae430aaf111f8d1fb95d42',
      model: 'deepseek-chat'
    },
    asr: {
      provider: 'web'
    }
  });
  const [callStatus, setCallStatus] = useState<'idle' | 'waiting' | 'no_speech' | 'speech_detected' | 'transcribing' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('点击"开始通话"开始识别');
  const recognitionRef = useRef<any>(null);
  const asrRef = useRef<AliyunASR | LocalASR | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const currentInterimLineIdRef = useRef<string | null>(null);
  const lastSpeechTimeRef = useRef<number>(Date.now());
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFinalTextRef = useRef<string>('');
  const currentInterimTextRef = useRef<string>('');
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const SILENCE_THRESHOLD = 2000; // 2秒停顿阈值

  // 加载保存的设置
  useEffect(() => {
    loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
    });
  }, []);

  // 监听转录容器滚动事件
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // 判断是否滚动到底部（允许10px误差）
      const atBottom = scrollHeight - scrollTop - clientHeight < 10;
      isAtBottomRef.current = atBottom;
      isUserScrollingRef.current = !atBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // 自动滚动到底部（当用户在底部时）
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;
    
    if (isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [transcript]);

  // 同步 transcript 和 transcriptRef
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // 开始通话
  const startCall = () => {
    setIsCallActive(true);
    // 重置所有状态
    currentInterimLineIdRef.current = null;
    lastSpeechTimeRef.current = Date.now();
    lastFinalTextRef.current = '';
    currentInterimTextRef.current = '';
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const initialTranscript: TranscriptLine[] = [
      {
        id: '1',
        speaker: 'system',
        text: '通话开始',
        timestamp: new Date().toLocaleTimeString()
      }
    ];
    setTranscript(initialTranscript);
    // 初始化 transcriptRef
    transcriptRef.current = initialTranscript;

    // 启动语音识别
    startSpeechRecognition();
  };

  // 停止通话
  const stopCall = () => {
    setIsCallActive(false);
    setTranscript(prev => {
      const newTranscript: TranscriptLine[] = [...prev, {
        id: Date.now().toString(),
        speaker: 'system' as const,
        text: '通话结束',
        timestamp: new Date().toLocaleTimeString()
      }];
      // 更新 transcriptRef
      transcriptRef.current = newTranscript;
      return newTranscript;
    });
    
    // 重置所有状态
    currentInterimLineIdRef.current = null;
    lastSpeechTimeRef.current = Date.now();
    lastFinalTextRef.current = '';
    currentInterimTextRef.current = '';
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // 停止语音识别
    stopSpeechRecognition();
  };

  // 启动语音识别
  const startSpeechRecognition = async () => {
    console.log('开始启动语音识别...');

    // 根据设置选择 ASR 提供商
    if (settings.asr.provider === 'aliyun') {
      startAliyunASR();
      return;
    } else if (settings.asr.provider === 'xf') {
      startXunFeiASR();
      return;
    } else if (settings.asr.provider === 'local') {
      startLocalASR();
      return;
    }
    
    // 默认使用 Web Speech API（web 选项）

    // 检查浏览器支持
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('浏览器不支持语音识别 API');
      setCallStatus('error');
      setStatusMessage('错误：浏览器不支持语音识别 API（建议使用 Chrome/Edge）');
      return;
    }
    
    // 请求麦克风权限
    try {
      // 检查当前权限状态
      if (navigator.permissions) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' as any });

          if (permissionStatus.state === 'denied') {
            setCallStatus('error');
            setStatusMessage('错误：麦克风权限已被拒绝，请在浏览器设置中允许访问麦克风');
            return;
          }
          
          if (permissionStatus.state === 'granted') {
            // 麦克风权限已自动授予
          }
        } catch (e) {
          // 无法查询权限状态
        }
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 检查流是否有效
      if (stream.getAudioTracks().length === 0) {
        console.error('没有音频轨道');
        setCallStatus('error');
        setStatusMessage('错误：未检测到音频输入设备');
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      console.log('音频轨道数量:', stream.getAudioTracks().length);
      
      // 停止流
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.error('获取麦克风权限失败:', error);
      setCallStatus('error');
      setStatusMessage(`错误：未授权麦克风权限，请在浏览器设置中允许访问麦克风。详细信息: ${(error as Error).message}`);
      return;
    }
    
    console.log('开始初始化语音识别...');
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false; // 尝试不连续模式，Mac 上可能有问题
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'zh-CN';
    console.log('语音识别配置:', {
      continuous: recognitionRef.current.continuous,
      interimResults: recognitionRef.current.interimResults,
      lang: recognitionRef.current.lang
    });

    recognitionRef.current.onstart = () => {
      setCallStatus('waiting');
      setStatusMessage('正在等待声音...');
    };

    recognitionRef.current.onend = () => {
      console.log('语音识别 onend 事件触发');
      if (isCallActive) {
        setCallStatus('waiting');
        setStatusMessage('语音识别已停止，正在重新启动...');
        setTimeout(() => {
          if (recognitionRef.current && isCallActive) {
            try {
              console.log('尝试重新启动语音识别...');
              recognitionRef.current.start();
            } catch (e) {
              console.error('重新启动识别失败:', e);
            }
          }
        }, 500);
      }
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error('语音识别错误:', event.error);
      
      // no-speech 不是致命错误，只是当前没检测到语音，不要设置为 error
      if (event.error === 'no-speech') {
        setStatusMessage('尚未接收到任何说话声...');
        setCallStatus('no_speech');
      } else {
        setCallStatus('error');
        switch (event.error) {
          case 'not-allowed':
            setStatusMessage('错误：未授权麦克风权限，请在浏览器设置中允许访问麦克风');
            break;
          case 'audio-capture':
            setStatusMessage('错误：未找到音频捕获设备');
            break;
          case 'network':
            setStatusMessage('错误：网络连接失败');
            break;
          default:
            setStatusMessage(`错误：${event.error}`);
        }
      }
    };

    recognitionRef.current.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setCallStatus('success');
        setStatusMessage(`已接收到说话声，转录成功：${finalTranscript.substring(0, 30)}...`);
        handleTranscript(finalTranscript, true);
      } else if (interimTranscript) {
        setCallStatus('transcribing');
        setStatusMessage(`正在转录：${interimTranscript.substring(0, 30)}...`);
        handleTranscript(interimTranscript, false);
      } else {
        setCallStatus('no_speech');
        setStatusMessage('尚未接收到任何说话声...');
      }
    };

    try {
      console.log('尝试启动语音识别...');
      recognitionRef.current.start();
      setCallStatus('waiting');
      setStatusMessage('正在等待声音...');
    } catch (e) {
      console.error('启动识别失败:', e);
      setCallStatus('error');
      setStatusMessage('启动语音识别失败，请重试');
    }
  };

  // 启动阿里云 ASR
  const startAliyunASR = () => {
    console.log('启动阿里云 ASR...');
    console.log('设置:', settings);
    
    // 兼容两种数据结构：直接在 asr 下或在 asr.aliyun 下
    const aliyunSettings = settings.asr.aliyun || settings.asr;
    
    if (!aliyunSettings.accessKeyId || !aliyunSettings.accessKeySecret || !aliyunSettings.appKey) {
      setStatusMessage('错误：请在设置中配置阿里云 ASR 的 AccessKeyId、AccessKeySecret 和 AppKey');
      setCallStatus('error');
      return;
    }
    
    setCallStatus('waiting');
    setStatusMessage('正在连接阿里云 ASR 服务...');
    
    // 创建阿里云 ASR 实例
    asrRef.current = new AliyunASR(
      {
        accessKeyId: aliyunSettings.accessKeyId,
        accessKeySecret: aliyunSettings.accessKeySecret,
        appKey: aliyunSettings.appKey
      },
      (text, isFinal) => {
        console.log('[ASR回调] 识别结果:', text, 'isFinal:', isFinal);
        setCallStatus('success');
        setStatusMessage(`识别成功：${text.substring(0, 30)}...`);
        handleTranscript(text, isFinal);
      },
      (error) => {
        console.error('ASR 错误:', error);
        setStatusMessage(`错误：${error}`);
        setCallStatus('error');
      },
      (status) => {
        console.log('ASR 状态:', status);
        setStatusMessage(status);
      }
    );
    
    // 连接
    asrRef.current.connect();
  };

  // 启动讯飞 ASR
  const startXunFeiASR = () => {
    console.log('启动讯飞 ASR...');
    setCallStatus('waiting');
    setStatusMessage('正在连接讯飞 ASR 服务...');
    
    // TODO: 实现讯飞 ASR 连接逻辑
    setStatusMessage('警告：讯飞 ASR 功能尚未实现');
  };

  // 启动本地 ASR
  const startLocalASR = async () => {
    console.log('启动本地 ASR...');
    
    setCallStatus('waiting');
    setStatusMessage('正在初始化本地 ASR...');
    
    try {
      // 创建本地 ASR 实例
      console.log('创建 LocalASR 实例...');
      const localASR = new LocalASR(
        {
          onResult: (text, isFinal) => {
            console.log('识别结果:', text, 'isFinal:', isFinal);
            setCallStatus('success');
            setStatusMessage(`识别成功：${text.substring(0, 30)}...`);
            handleTranscript(text, isFinal);
          },
          onError: (error) => {
            console.error('ASR 错误:', error);
            setStatusMessage(`错误：${error}`);
            setCallStatus('error');
          },
          onStatus: (status) => {
            console.log('ASR 状态:', status);
            setStatusMessage(status);
          }
        }
      );
      
      asrRef.current = localASR;
      
      // 初始化模型
      console.log('开始初始化模型...');
      await localASR.init();
      
      // 开始录音
      console.log('开始录音...');
      await localASR.start();
    } catch (error) {
      console.error('初始化本地 ASR 失败:', error);
      setStatusMessage(`错误：初始化本地 ASR 失败 - ${(error as Error).message}`);
      setCallStatus('error');
    }
  };

  // 停止语音识别
  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    // 停止阿里云 ASR
    if (asrRef.current) {
      asrRef.current.stop();
      asrRef.current = null;
    }
  };

  // 检查是否需要因为停顿而开始新句子
  const checkSilenceAndReset = () => {
    const now = Date.now();
    const timeSinceLastSpeech = now - lastSpeechTimeRef.current;

    if (timeSinceLastSpeech >= SILENCE_THRESHOLD) {
      // 停顿超过阈值，清除段落状态，准备开始新段落
      // 注意：不在这里清除 currentInterimLineIdRef.current，让 handleTranscript 处理
    }
  };

  // 处理转录文本
  const handleTranscript = (text: string, isFinal: boolean = false) => {
    const now = Date.now();

    // 清除之前的停顿检测定时器
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    // 检查是否需要开始新段落：距离上次语音活动超过阈值
    const timeSinceLastSpeech = now - lastSpeechTimeRef.current;
    const shouldStartNewParagraph = timeSinceLastSpeech >= SILENCE_THRESHOLD;

    // 更新最后语音活动时间
    lastSpeechTimeRef.current = now;

    // 设置新的停顿检测定时器
    silenceTimerRef.current = setTimeout(() => {
      checkSilenceAndReset();
    }, SILENCE_THRESHOLD + 100);

    // 如果需要开始新段落，重置状态
    if (shouldStartNewParagraph) {
      currentInterimLineIdRef.current = null;
      currentInterimTextRef.current = '';
    }

    // 获取所有客户行，用于检查文本是否包含历史内容
    const customerLines = transcriptRef.current.filter(line => line.speaker === 'customer');

    // 从文本中移除所有历史段落内容（避免ASR返回累积文本）
    let processedText = text;

    if (customerLines.length > 0) {
      let workingText = text;

      // 从最新到最旧检查，移除所有匹配的历史段落
      for (let i = customerLines.length - 1; i >= 0; i--) {
        const customerLine = customerLines[i];
        if (workingText.includes(customerLine.text)) {
          processedText = workingText.replace(new RegExp(customerLine.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
          workingText = processedText; // 继续检查处理后的文本
        }
      }
    }

    // 如果处理后文本为空，跳过
    if (!processedText.trim()) {
      return;
    }

    // 如果没有当前段落ID，创建新段落
    if (!currentInterimLineIdRef.current) {
      const newId = Date.now().toString();
      currentInterimLineIdRef.current = newId;
      currentInterimTextRef.current = processedText;

      const newTranscriptLine: TranscriptLine = {
        id: newId,
        speaker: 'customer',
        text: processedText,
        timestamp: new Date().toLocaleTimeString()
      };

      setTranscript(prev => [...prev, newTranscriptLine]);
      transcriptRef.current = [...transcriptRef.current, newTranscriptLine];
    } else {
      // 已有当前段落，更新它
      const currentParagraphId = currentInterimLineIdRef.current;

      // 处理同一段落内的文本累加
      let textToAdd = processedText;
      if (currentInterimTextRef.current && processedText.startsWith(currentInterimTextRef.current)) {
        textToAdd = processedText.substring(currentInterimTextRef.current.length);
      }

      // 如果新增文本为空，跳过
      if (!textToAdd.trim()) {
        return;
      }

      // 更新段落文本
      const newText = currentInterimTextRef.current + textToAdd;

      // 更新对应的行
      setTranscript(prev => {
        const lineIndex = prev.findIndex(line => line.id === currentParagraphId);
        if (lineIndex !== -1) {
          const updatedPrev = [...prev];
          updatedPrev[lineIndex] = {
            ...updatedPrev[lineIndex],
            text: newText,
            timestamp: new Date().toLocaleTimeString()
          };
          // 更新 transcriptRef
          transcriptRef.current = updatedPrev;
          // 更新当前段落文本
          currentInterimTextRef.current = newText;
          return updatedPrev;
        }
        return prev;
      });
    }

    // 如果是最终结果，更新最终文本状态并识别关键词
    if (isFinal) {
      lastFinalTextRef.current = currentInterimTextRef.current;
      identifyKeywords(currentInterimTextRef.current);

      // 最终结果后重置当前段落状态，等待下一段落
      currentInterimLineIdRef.current = null;
      currentInterimTextRef.current = '';
    }
  };

  // 识别关键词
  const identifyKeywords = (text: string) => {
    const foundKeywords: Keyword[] = [];
    
    keywordDatabase.forEach(keyword => {
      if (text.includes(keyword.text)) {
        foundKeywords.push(keyword);
      }
    });

    if (foundKeywords.length > 0) {
      setKeywords(prev => {
        const newKeywords = [...prev];
        foundKeywords.forEach(keyword => {
          if (!newKeywords.find(k => k.id === keyword.id)) {
            newKeywords.push(keyword);
          }
        });
        return newKeywords;
      });
    }
  };

  // 选择关键词
  const handleKeywordClick = (keyword: Keyword) => {
    setSelectedKeyword(keyword);
    setIsSuggestionModalOpen(true);
  };

  // 选择话术
  const handleSelectSuggestion = (text: string) => {
    const newTranscriptLine: TranscriptLine = {
      id: Date.now().toString(),
      speaker: 'agent',
      text: text,
      timestamp: new Date().toLocaleTimeString()
    };
    setTranscript(prev => [...prev, newTranscriptLine]);
  };

  // 保存设置
  const handleSaveSettings = (newSettings: AppSettings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
    console.log('设置已保存:', newSettings);
  };

  // 测试连接
  const handleTestConnection = async (testSettings: AppSettings): Promise<{ success: boolean; message: string }> => {
    const results: { success: boolean; message: string }[] = [];
    
    // 测试大模型 API 连接
    if (testSettings.llm.provider === 'deepseek') {
      try {
        const response = await fetch(`${testSettings.llm.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${testSettings.llm.apiKey}`
          },
          body: JSON.stringify({
            model: testSettings.llm.model,
            messages: [{ role: 'user', content: '你好' }],
            max_tokens: 10
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          results.push({
            success: false,
            message: `大模型 API 测试失败: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
          });
        } else {
          results.push({
            success: true,
            message: `大模型 API 连接成功！模型: ${testSettings.llm.model}`
          });
        }
      } catch (error) {
        results.push({
          success: false,
          message: `大模型 API 测试失败: ${(error as Error).message}`
        });
      }
    }

    // 测试本地 ASR
    if (testSettings.asr.provider === 'local') {
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        results.push({
          success: true,
          message: '本地 ASR 支持正常（浏览器原生 Web Speech API）'
        });
      } else {
        results.push({
          success: false,
          message: '本地 ASR 测试失败: 浏览器不支持 Web Speech API（建议使用 Chrome/Edge）'
        });
      }
    }

    // 测试阿里云 ASR 连接
    if (testSettings.asr.provider === 'aliyun') {
      if (!testSettings.asr.accessKeyId || !testSettings.asr.accessKeySecret) {
        results.push({
          success: false,
          message: '阿里云 ASR 测试失败: 缺少 Access Key ID 或 Access Key Secret'
        });
      } else {
        results.push({
          success: true,
          message: '阿里云 ASR 凭证格式正确（AppKey: ' + (testSettings.asr.appKey || '未设置') + '）'
        });
      }
    }

    // 测试讯飞 ASR 连接
    if (testSettings.asr.provider === 'iflytek') {
      if (!testSettings.asr.appId || !testSettings.asr.iflytekApiKey) {
        results.push({
          success: false,
          message: '讯飞 ASR 测试失败: 缺少 AppID 或 API Key'
        });
      } else {
        results.push({
          success: true,
          message: '讯飞 ASR 凭证格式正确（AppID: ' + testSettings.asr.appId + '）'
        });
      }
    }

    // 如果没有结果，返回默认成功
    if (results.length === 0) {
      return {
        success: true,
        message: '设置参数格式正确'
      };
    }

    // 检查是否有失败的测试
    const failedTests = results.filter(r => !r.success);
    if (failedTests.length > 0) {
      return {
        success: false,
        message: failedTests.map(r => r.message).join('；')
      };
    }

    // 所有测试都成功
    return {
      success: true,
      message: '所有测试通过！' + results.map(r => r.message).join('；')
    };
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>急急话术AI</h1>
          <p>销售通话实时 AI 话术辅助工具</p>
        </div>
        <div className="controls">
          <button 
            onClick={startCall} 
            disabled={isCallActive}
            className={isCallActive ? '' : 'active'}
          >
            {isCallActive ? '通话中' : '开始通话'}
          </button>
          <button onClick={stopCall} disabled={!isCallActive}>
            停止
          </button>
          <button onClick={() => setIsSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      <main className="main">
        <section className="call-section">
          <div className="call-section-header">
            <h2>通话转录</h2>
            <div className="call-status-compact">
              <span className={`status-indicator ${callStatus}`}></span>
              <span>{statusMessage}</span>
            </div>
          </div>
          
          <div className="call-transcript" ref={transcriptContainerRef}>
            {transcript.map(line => (
              <div key={line.id} className={`transcript-line ${line.speaker}`}>
                <span className={`transcript-speaker ${line.speaker}`}>
                  {line.speaker === 'customer' ? '客户' : line.speaker === 'agent' ? '销售' : '系统'}
                </span>
                {line.text}
                <span className="transcript-time">{line.timestamp}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ai-suggestions">
          <div className="ai-suggestions-header">
            <h2>AI 话术建议</h2>
          </div>
          <div className="suggestion-list">
            {keywords.length === 0 ? (
              <div className="suggestion-empty">
                <p>正在监听中，当客户提到关键词时会显示建议...</p>
              </div>
            ) : (
              <KeywordDisplay 
                keywords={keywords} 
                onKeywordClick={handleKeywordClick} 
              />
            )}
          </div>
        </section>
      </main>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onSave={handleSaveSettings}
        initialSettings={settings}
        onTestConnection={handleTestConnection}
      />

      <SuggestionModal 
        isOpen={isSuggestionModalOpen}
        onClose={() => setIsSuggestionModalOpen(false)}
        title={selectedKeyword?.text || '话术建议'}
        suggestions={selectedKeyword?.suggestions || []}
        onSelect={handleSelectSuggestion}
      />
    </div>
  );
}

export default App;
