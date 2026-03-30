import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import SettingsModal from './components/SettingsModal';
import KeywordDisplay from './components/KeywordDisplay';
import SuggestionModal from './components/SuggestionModal';
import { loadSettings, saveSettings, type Settings as AppSettings } from './utils/settings';
import { AliyunASR } from './utils/aliyun-asr';
import { LocalASR } from './utils/local-asr';
import { ruleEngine } from './utils/rule-engine';

// 规则引擎匹配结果类型 (复用 rule-engine.ts 的类型)
// type RuleMatchResult = MatchResult; // 未使用，已注释

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

// 规则引擎话术项
interface RuleSuggestion {
  id: string;
  tag: string;
  response: string;
  icon: string;
  keyword: string;
  displayText: string;
  isTyping: boolean;
}

// 选中的文本标签页
interface SelectedTextTab {
  id: string;
  text: string;
  selectedAction: 'explain' | 'suggestion' | 'next_step' | 'concise';
  aiResponse: string;
  isLoading: boolean;
  isStreaming: boolean;
  createdAt: number;
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
  const [ruleSuggestions, setRuleSuggestions] = useState<RuleSuggestion[]>([]);
  const [isSuggestionModalOpen, setIsSuggestionModalOpen] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<Keyword | null>(null);
  
  // 多标签页状态
  const [selectedTextTabs, setSelectedTextTabs] = useState<SelectedTextTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  
  const [settings, setSettings] = useState<AppSettings>({
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-170f4fc64eae430aaf111f8d1fb95d42',
      model: 'deepseek-chat'
    },
    asr: {
      provider: 'web'
    },
    theme: 'dark'
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
  const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const SILENCE_THRESHOLD = 2000; // 2秒停顿阈值

  // 加载保存的设置
  useEffect(() => {
    loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
      // 预连接到API域名以加快后续请求
      preconnectToAPI(loadedSettings.llm.baseUrl);
    });
  }, []);

  // 预连接到API域名函数
  const preconnectToAPI = (baseUrl: string) => {
    try {
      if (!baseUrl || baseUrl.startsWith('http://localhost') || baseUrl.startsWith('file://')) {
        return;
      }

      const url = new URL(baseUrl);
      const domain = url.origin;

      // 使用link元素预连接
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = domain;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);

      // 同时预DNS解析
      const dnsLink = document.createElement('link');
      dnsLink.rel = 'dns-prefetch';
      dnsLink.href = domain;
      document.head.appendChild(dnsLink);

      console.log(`预连接到API域名: ${domain}`);

      // 3秒后清理link元素，避免污染DOM
      setTimeout(() => {
        if (link.parentNode) link.parentNode.removeChild(link);
        if (dnsLink.parentNode) dnsLink.parentNode.removeChild(dnsLink);
      }, 3000);
    } catch (error) {
      console.warn('预连接API域名失败:', error);
    }
  };

  // 当API基础URL变化时预连接
  useEffect(() => {
    if (settings.llm.baseUrl) {
      preconnectToAPI(settings.llm.baseUrl);
    }
  }, [settings.llm.baseUrl]);

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

  // 监听文本选择事件 - 改为鼠标弹起时触发
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    // 监听鼠标弹起事件
    const handleMouseUp = () => {
      const selection = window.getSelection();

      if (!selection || selection.isCollapsed) {
        return;
      }

      // 检查选中是否在转录容器内
      const range = selection.getRangeAt(0);
      if (!container.contains(range.startContainer) && !container.contains(range.endContainer)) {
        return;
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length > 0) {
        // 检查是否已存在相同的文本标签页（去重）
        setSelectedTextTabs(prev => {
          const existingTab = prev.find(tab => tab.text === selectedText);
          if (existingTab) {
            // 如果已存在，切换到该标签页
            setActiveTabId(existingTab.id);
            return prev; // 不改变现有 tabs
          }
          
          // 创建新的标签页
          const newTab: SelectedTextTab = {
            id: Date.now().toString(),
            text: selectedText,
            selectedAction: 'explain',
            aiResponse: '',
            isLoading: false,
            isStreaming: false,
            createdAt: Date.now()
          };
          
          setActiveTabId(newTab.id);
          return [newTab, ...prev];
        });
      }
    };

    // 监听鼠标弹起
    document.addEventListener('mouseup', handleMouseUp);

    // 点击容器外部清除选中（但不删除标签页）
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // 检查是否点击了 action-selector 相关元素（下拉菜单）
      const isActionSelector = target.closest('.action-selector');
      const isAIResponse = target.closest('.ai-response-container');
      const isSelectedTextAnalysis = target.closest('.selected-text-analysis');
      const isTabBar = target.closest('.tab-bar');
      const isTranscriptContainer = target.closest('.call-transcript');

      // 如果点击了这些元素，不执行清除操作
      if (isActionSelector || isAIResponse || isSelectedTextAnalysis || isTabBar || isTranscriptContainer) {
        return;
      }

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // 处理话术打字机效果
  useEffect(() => {
    ruleSuggestions.forEach(suggestion => {
      if (suggestion.isTyping && suggestion.displayText.length < suggestion.response.length) {
        // 清除之前的定时器
        if (typingTimeoutsRef.current.has(suggestion.id)) {
          clearTimeout(typingTimeoutsRef.current.get(suggestion.id));
        }
        
        const timeout = setTimeout(() => {
          setRuleSuggestions(prev => prev.map(s => {
            if (s.id === suggestion.id) {
              const nextChar = suggestion.response[s.displayText.length];
              return {
                ...s,
                displayText: s.displayText + nextChar,
                isTyping: s.displayText.length + 1 < s.response.length
              };
            }
            return s;
          }));
        }, 30);
        
        typingTimeoutsRef.current.set(suggestion.id, timeout);
      }
    });

    return () => {
      typingTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    };
  }, [ruleSuggestions]);

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
    // 清空规则引擎话术
    setRuleSuggestions([]);

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
    recognitionRef.current.continuous = false;
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
          finalTranscript +=event.results[i][0].transcript;
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
        appKey: aliyunSettings.appKey,
        silenceTimeout: settings.asr.silenceTimeout || 60
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
      console.log('静音超时，重置段落状态');
      currentInterimLineIdRef.current = null;
      currentInterimTextRef.current = '';
      // 注意：不重置 lastFinalTextRef，我们需要用它来检测历史文本
    }
  };

  // 处理转录文本
  const handleTranscript = (text: string, isFinal: boolean = false) => {
    const now = Date.now();
    console.log('[handleTranscript] 输入:', { text, isFinal, now });

    // 清除之前的停顿检测定时器
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    // 计算距离上次活动的时间
    const timeSinceLastActivity = now - lastSpeechTimeRef.current;

    // 检查是否需要因为停顿而开始新句子
    let hadLongSilence = false;
    if (timeSinceLastActivity >= SILENCE_THRESHOLD) {
      hadLongSilence = true;
      console.log(`[停顿检测] 距离上次活动 ${timeSinceLastActivity}ms，超过阈值 ${SILENCE_THRESHOLD}ms，强制开始新句子`);
      currentInterimLineIdRef.current = null;
      currentInterimTextRef.current = '';
      // 注意：不重置 lastFinalTextRef，我们需要用它来检测是否包含历史文本
    }

    // 更新最后活动时间（任何语音活动，包括中间结果）
    lastSpeechTimeRef.current = now;

    // 设置新的停顿检测定时器（用于静音超时重置）
    silenceTimerRef.current = setTimeout(() => {
      checkSilenceAndReset();
    }, SILENCE_THRESHOLD + 100);

    // 处理文本：避免重复累积
    let processedText = text;
    console.log('[handleTranscript] 原始文本:', processedText);

    // 获取所有历史客户文本（用于检测重复）
    const allCustomerTexts = transcriptRef.current
      .filter(line => line.speaker === 'customer')
      .map(line => line.text)
      .filter(text => text && text.trim());

    // 特殊处理：尝试移除任何历史文本的重复
    // 阿里云ASR可能发送包含历史文本的完整结果
    let foundHistoricalText = false;

    // 首先检查上次最终文本
    if (lastFinalTextRef.current && lastFinalTextRef.current.trim()) {
      const lastFinal = lastFinalTextRef.current;
      console.log('[handleTranscript] 检查上次最终文本:', lastFinal);

      // 检查新文本是否以历史文本开头（最常见的情况）
      if (processedText.startsWith(lastFinal)) {
        const newPart = processedText.substring(lastFinal.length);
        console.log('[handleTranscript] 移除历史前缀，新内容:', newPart);
        if (newPart.trim()) {
          processedText = newPart;
          foundHistoricalText = true;
        } else {
          // 如果移除后为空，可能是完全相同的文本，跳过
          console.log('[handleTranscript] 移除历史前缀后为空，跳过');
          return;
        }
      }
    }

    // 如果没有找到历史文本，检查所有历史客户文本
    if (!foundHistoricalText && allCustomerTexts.length > 0) {
      // 按长度排序，先检查最长的文本
      const sortedTexts = [...allCustomerTexts].sort((a, b) => b.length - a.length);

      for (const historicalText of sortedTexts) {
        if (!historicalText || historicalText.length < 2) continue;

        // 检查新文本是否以这个历史文本开头
        if (processedText.startsWith(historicalText)) {
          const newPart = processedText.substring(historicalText.length);
          console.log('[handleTranscript] 移除历史文本前缀:', historicalText, '新内容:', newPart);
          if (newPart.trim()) {
            processedText = newPart;
            foundHistoricalText = true;
            break;
          }
        }
        // 检查新文本是否包含这个历史文本
        else if (processedText.includes(historicalText)) {
          console.log('[handleTranscript] 发现历史文本在中间:', historicalText);
          // 尝试移除它
          const index = processedText.indexOf(historicalText);
          const before = processedText.substring(0, index);
          const after = processedText.substring(index + historicalText.length);
          const combined = (before + after).trim();
          if (combined && combined !== processedText) {
            console.log('[handleTranscript] 移除中间历史文本，结果:', combined);
            processedText = combined;
            foundHistoricalText = true;
            break;
          }
        }
      }
    }
      const lastFinal = lastFinalTextRef.current;
      console.log('[handleTranscript] 上次最终文本:', lastFinal);

      // 检查新文本是否以历史文本开头（最常见的情况）
      if (processedText.startsWith(lastFinal)) {
        const newPart = processedText.substring(lastFinal.length);
        console.log('[handleTranscript] 移除历史前缀，新内容:', newPart);
        if (newPart.trim()) {
          processedText = newPart;
        } else {
          // 如果移除后为空，可能是完全相同的文本，跳过
          console.log('[handleTranscript] 移除历史前缀后为空，跳过');
          return;
        }
      }
      // 检查新文本是否包含历史文本（不一定在开头）
      else if (processedText.includes(lastFinal)) {
        console.log('[handleTranscript] 历史文本出现在中间:', lastFinal);

        // 尝试找到历史文本的位置
        const index = processedText.indexOf(lastFinal);
        if (index > 0) {
          // 历史文本在中间，取之前的部分 + 之后的部分
          const before = processedText.substring(0, index);
          const after = processedText.substring(index + lastFinal.length);
          const combined = (before + after).trim();
          if (combined) {
            console.log('[handleTranscript] 移除中间重复，结果:', combined);
            processedText = combined;
          }
        }
      }
    }

    // 对于中间结果，处理可能出现的文本重复或堆积问题
    if (!isFinal && currentInterimTextRef.current) {
      const currentText = currentInterimTextRef.current;
      console.log('[handleTranscript] 当前 interim 文本:', currentText);

      // 情况1：新文本以当前文本开头 - 正常增量更新
      if (processedText.startsWith(currentText)) {
        // 这是正常的增量更新，ASR 在不断完善同一句话
        // 保持 processedText 不变，将替换整行
        console.log('[handleTranscript] 正常增量更新，新增:', processedText.substring(currentText.length));
      }
      // 情况2：当前文本以新文本开头 - ASR 可能修正了识别，新文本更短但更准确
      else if (currentText.startsWith(processedText)) {
        // ASR 可能修正了之前的错误识别，新文本更准确但更短
        // 保持 processedText 不变
        console.log('[handleTranscript] ASR 修正识别，新文本更短但可能更准确');
      }
      // 情况3：堆积重复模式，如 "就是就就是美就是美国伊..."
      else {
        // 检查是否存在重叠部分
        // 简单启发式：查找最长公共前缀
        let commonPrefix = '';
        const minLength = Math.min(currentText.length, processedText.length);
        for (let i = 0; i < minLength; i++) {
          if (currentText[i] === processedText[i]) {
            commonPrefix += currentText[i];
          } else {
            break;
          }
        }

        if (commonPrefix.length > 0) {
          console.log('[handleTranscript] 检测到公共前缀:', commonPrefix);

          // 检查是否是堆积模式：新文本在公共前缀后添加了内容
          if (processedText.length > commonPrefix.length) {
            const newPart = processedText.substring(commonPrefix.length);
            console.log('[handleTranscript] 堆积模式，新增部分:', newPart);
            // 使用当前文本 + 新增部分，避免重复
            processedText = currentText + newPart;
          }
        } else {
          // 没有公共前缀，可能是全新的句子
          console.log('[handleTranscript] 没有公共前缀，可能是新句子');
        }
      }
    }

    // 对于最终结果，更新 lastFinalTextRef
    if (isFinal) {
      lastFinalTextRef.current = processedText;
    }

    // 如果处理后文本为空，跳过
    if (!processedText.trim()) {
      console.log('[handleTranscript] 处理后文本为空，跳过');
      return;
    }

    // 如果有当前正在进行的 interim 行且没有长停顿，更新它
    const currentInterimId = currentInterimLineIdRef.current;
    console.log('[handleTranscript] 当前 interim ID:', currentInterimId, 'hadLongSilence:', hadLongSilence);
    if (currentInterimId && !hadLongSilence) {
      // 先检查这一行是否存在于当前 transcript 中
      const lineExists = transcriptRef.current.some(line => line.id === currentInterimId);
      console.log('[handleTranscript] 行存在:', lineExists);
      if (lineExists) {
        console.log('[handleTranscript] 更新现有行:', currentInterimId, '文本:', processedText);
        // 更新对应的行
        setTranscript(prev => {
          const lineIndex = prev.findIndex(line => line.id === currentInterimId);
          if (lineIndex !== -1) {
            const updatedPrev = [...prev];
            updatedPrev[lineIndex] = {
              ...updatedPrev[lineIndex],
              text: processedText,
              timestamp: new Date().toLocaleTimeString()
            };
            // 更新 transcriptRef
            transcriptRef.current = updatedPrev;
            // 更新当前段落文本
            currentInterimTextRef.current = processedText;

            // 如果是最终结果，清除 interim 标记
            if (isFinal) {
              currentInterimLineIdRef.current = null;
              currentInterimTextRef.current = '';
            }
            return updatedPrev;
          }
          return prev;
        });

        // 每次文本更新时都进行关键词检测（包括中间结果）
        identifyKeywords(processedText);
        return;
      }
    }

    // 没有找到对应的行，或者有长停顿，创建新行
    const newId = now.toString();
    console.log('[handleTranscript] 创建新行，ID:', newId, 'isFinal:', isFinal);

    // 同步更新 ref
    if (!isFinal) {
      // 中间结果：记录 interim 行 ID
      currentInterimLineIdRef.current = newId;
      currentInterimTextRef.current = processedText;
    } else {
      // 最终结果：确保清除 interim 标记
      currentInterimLineIdRef.current = null;
      currentInterimTextRef.current = '';
    }

    const newTranscriptLine: TranscriptLine = {
      id: newId,
      speaker: 'customer',
      text: processedText,
      timestamp: new Date().toLocaleTimeString()
    };

    setTranscript(prev => [...prev, newTranscriptLine]);
    transcriptRef.current = [...transcriptRef.current, newTranscriptLine];

    // 每次文本更新时都进行关键词检测（包括中间结果）
    identifyKeywords(processedText);
  };

  // 调用前端规则引擎检测关键词
  const detectWithRuleEngine = (text: string) => {
    try {
      console.log('[规则引擎] 开始检测文本:', text);
      
      // 循环检测所有匹配的关键词
      let result;
      let matchCount = 0;
      
      do {
        result = ruleEngine.detect(text);
        if (result && result.matched) {
          matchCount++;
          console.log('[规则引擎] 匹配成功 #', matchCount, ':', result.tag, '-', result.keyword);
          
          // 保存当前结果到局部变量，避免闭包问题
          const currentResult = { ...result };
          
          // 检查是否已显示过这个标签（防重复）
          setRuleSuggestions(prev => {
            const exists = prev.find(s => s.tag === currentResult.tag);
            if (exists) {
              console.log('[规则引擎] 标签已存在，跳过:', currentResult.tag);
              return prev;
            }
            
            console.log('[规则引擎] 添加新建议:', currentResult.tag);
            const newSuggestion: RuleSuggestion = {
              id: `${currentResult.tag}-${currentResult.timestamp}`,
              tag: currentResult.tag,
              response: currentResult.response,
              icon: currentResult.icon,
              keyword: currentResult.keyword,
              displayText: '',
              isTyping: true
            };
            
            return [...prev, newSuggestion];
          });
        }
      } while (result && result.matched);
      
      if (matchCount === 0) {
        console.log('[规则引擎] 未检测到任何匹配');
      } else {
        console.log('[规则引擎] 共检测到', matchCount, '条规则');
      }
    } catch (error) {
      console.error('[规则引擎] 检测失败:', error);
      // 如果前端规则引擎失败，降级到关键词匹配
      identifyKeywordsFallback(text);
    }
  };

  // 前端备用关键词匹配（当 Rust 不可用时）
  const identifyKeywordsFallback = (text: string) => {
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

  // 识别关键词（优先使用规则引擎）
  const identifyKeywords = (text: string) => {
    // 优先使用 Rust 规则引擎
    detectWithRuleEngine(text);
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

    // 测试豆包 API 连接
    if (testSettings.llm.provider === 'doubao') {
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
            message: `豆包 API 测试失败: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
          });
        } else {
          results.push({
            success: true,
            message: `豆包 API 连接成功！模型: ${testSettings.llm.model}`
          });
        }
      } catch (error) {
        results.push({
          success: false,
          message: `豆包 API 测试失败: ${(error as Error).message}`
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

  // 获取 AI 对选中文本的响应（优化版流式）- 支持多 tab 异步
  const fetchAIResponse = async (tabId: string, text: string, action: 'explain' | 'suggestion' | 'next_step' | 'concise') => {
    if (!text.trim()) {
      updateTab(tabId, { aiResponse: '错误：文本为空', isLoading: false, isStreaming: false });
      return;
    }

    // 检查设置
    if (!settings.llm.apiKey || !settings.llm.baseUrl) {
      updateTab(tabId, { aiResponse: '错误：请先在设置中配置大模型 API 密钥和基础 URL', isLoading: false, isStreaming: false });
      return;
    }

    updateTab(tabId, { isLoading: true, isStreaming: true, aiResponse: '', selectedAction: action });

    // 用于累积的响应文本
    let fullResponse = '';
    
    try {
      // 根据动作类型构建提示词
      let systemPrompt = '';
      let userPrompt = '';

      switch (action) {
        case 'explain':
          systemPrompt = '销售专家解释销售术语：';
          userPrompt = `解释"${text}"`;
          break;
        case 'suggestion':
          systemPrompt = '销售员提供专业回复建议：';
          userPrompt = `客户："${text}"，我如何回复？`;
          break;
        case 'next_step':
          systemPrompt = '销售顾问分析后续策略：';
          userPrompt = `客户："${text}"，我后续注意什么？`;
          break;
        case 'concise':
          systemPrompt = '销售专家简短解释（10-30 字）：';
          userPrompt = `简短解释"${text}"`;
          break;
      }

      // 构建请求体，优化响应速度
      let maxTokens = 500;
      if (action === 'concise') {
        maxTokens = 50;
      } else if (action === 'explain') {
        maxTokens = 150;
      } else if (action === 'suggestion' || action === 'next_step') {
        maxTokens = 300;
      }

      const requestBody = {
        model: settings.llm.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.2,
        presence_penalty: 0,
        frequency_penalty: 0
      };

      // 记录请求开始时间，用于测量 TTFT (Time To First Token)
      (window as any).__requestStartTime = Date.now();
      console.log('发送 AI 请求:', { tabId, action, textLength: text.length });

      const response = await fetch(`${settings.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.llm.apiKey}`
        },
        body: JSON.stringify(requestBody),
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'omit'
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('AI API 错误:', response.status, errorData);
        updateTab(tabId, { 
          aiResponse: `错误：API 请求失败 (${response.status}) - ${errorData.substring(0, 100)}`,
          isLoading: false,
          isStreaming: false
        });
        return;
      }

      // 处理流式响应 - 核心优化：使用 flushSync 强制立即渲染
      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      // 标记是否首次渲染（用于流式开头）
      let isFirstChunk = true;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 解码数据
          buffer += decoder.decode(value, { stream: true });
          
          // 处理所有完整的行
          let lineEnd: number;
          while ((lineEnd = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);
            
            if (!line || !line.startsWith('data: ')) continue;
            
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                fullResponse += content;
                
                // 核心优化：使用 flushSync 强制同步渲染第一个字符
                // 这是 Open WebUI 等应用采用的技术
                if (isFirstChunk) {
                  isFirstChunk = false;
                  flushSync(() => {
                    updateTab(tabId, { aiResponse: fullResponse });
                  });
                } else {
                  // 后续字符使用正常的异步更新，保持响应性
                  updateTab(tabId, { aiResponse: fullResponse });
                }
              }
            } catch (e) {
              // 忽略解析错误（可能是 JSON 不完整）
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // 确保最终内容被设置
      updateTab(tabId, { aiResponse: fullResponse });
      console.log('AI 响应完成:', { tabId, length: fullResponse.length, action });
    } catch (error) {
      console.error('调用 AI API 失败:', error);
      updateTab(tabId, { aiResponse: `错误：${(error as Error).message}`, isLoading: false, isStreaming: false });
    } finally {
      updateTab(tabId, { isLoading: false, isStreaming: false });
    }
  };

  // 更新标签页状态的辅助函数
  const updateTab = (tabId: string, updates: Partial<SelectedTextTab>) => {
    setSelectedTextTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, ...updates } : tab
    ));
  };

  // 关闭标签页
  const closeTab = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // 防止触发其他点击事件

    setSelectedTextTabs(prev => {
      const newTabs = prev.filter(tab => tab.id !== tabId);
      // 如果关闭的是当前激活的标签页，切换到另一个
      if (activeTabId === tabId && newTabs.length > 0) {
        // 查找当前标签页在原始数组中的索引
        const currentIndex = prev.findIndex(tab => tab.id === tabId);
        // 在 newTabs 中找到对应位置的标签页
        // 因为删除了一个元素，所以如果删除的是当前元素，尝试切换到相同索引或下一个
        let targetIndex = currentIndex;
        // 如果目标索引超出了 newTabs 的范围，则使用最后一个
        if (targetIndex >= newTabs.length) {
          targetIndex = newTabs.length - 1;
        }
        // 如果 targetIndex 有效，切换到该标签页；否则切换到最后一个
        if (targetIndex >= 0 && targetIndex < newTabs.length) {
          setActiveTabId(newTabs[targetIndex].id);
        } else {
          setActiveTabId(newTabs[newTabs.length - 1].id);
        }
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  };

  // 切换标签页
  const switchTab = (tabId: string) => {
    setActiveTabId(tabId);
  };

  // 应用主题
  useEffect(() => {
    const theme = settings.theme || 'dark';
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
    }
  }, [settings.theme]);

  // 多标签页选中文本分析组件
  const MultiTabTextAnalysis = () => {
    if (selectedTextTabs.length === 0) {
      return null;
    }

    const activeTab = selectedTextTabs.find(tab => tab.id === activeTabId) || selectedTextTabs[0];

    const handleActionChange = (action: 'explain' | 'suggestion' | 'next_step' | 'concise') => {
      updateTab(activeTab.id, { selectedAction: action });
      fetchAIResponse(activeTab.id, activeTab.text, action);
    };

    return (
      <div className="multi-tab-analysis">
        {/* 标签页栏 */}
        <div className="tab-bar">
          {selectedTextTabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              <span className="tab-text">{tab.text.substring(0, 20)}{tab.text.length > 20 ? '...' : ''}</span>
              <button
                className="tab-close-btn"
                onClick={(e) => closeTab(tab.id, e)}
                title="关闭此标签"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* 当前激活标签页的内容 */}
        <div className="tab-content">
          <div className="action-selector">
            <div className="action-buttons">
              <button
                className={`action-button ${activeTab.selectedAction === 'explain' ? 'active' : ''}`}
                onClick={() => handleActionChange('explain')}
                title="解释当前字词"
                disabled={activeTab.isLoading || activeTab.isStreaming}
              >
                解释
              </button>
              <button
                className={`action-button ${activeTab.selectedAction === 'suggestion' ? 'active' : ''}`}
                onClick={() => handleActionChange('suggestion')}
                title="这是客户说的话，我该怎么回复？"
                disabled={activeTab.isLoading || activeTab.isStreaming}
              >
                话术
              </button>
              <button
                className={`action-button ${activeTab.selectedAction === 'next_step' ? 'active' : ''}`}
                onClick={() => handleActionChange('next_step')}
                title="鉴于这句话，我后面该注意什么？"
                disabled={activeTab.isLoading || activeTab.isStreaming}
              >
                建议
              </button>
              <button
                className={`action-button ${activeTab.selectedAction === 'concise' ? 'active' : ''}`}
                onClick={() => handleActionChange('concise')}
                title="用 10-30 个字完成解释"
                disabled={activeTab.isLoading || activeTab.isStreaming}
              >
                精简
              </button>
            </div>
          </div>

          <div className="ai-response-container">
            {activeTab.isLoading || activeTab.isStreaming ? (
              <div className="ai-loading">
                <div className="loading-spinner"></div>
                <span>AI 正在思考...</span>
              </div>
            ) : activeTab.aiResponse.length > 0 ? (
              <div className="ai-response">
                <div className="ai-response-header">
                  <span className="ai-response-title">AI 分析结果：</span>
                </div>
                <div className="ai-response-content">{activeTab.aiResponse}</div>
                {activeTab.isStreaming && <span className="typing-cursor">|</span>}
              </div>
            ) : (
              <div className="ai-prompt">
                <span>请选择分析类型开始 AI 分析</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
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
            {ruleSuggestions.length > 0 && (
              <span className="rule-badge">规则引擎</span>
            )}
          </div>
          <div className="suggestion-list">
            {/* 多标签页选中文本分析区域 - 始终显示在顶部（当有标签页时） */}
            {selectedTextTabs.length > 0 && <MultiTabTextAnalysis />}

            {/* 规则引擎匹配结果显示 */}
            {ruleSuggestions.length > 0 && (
              <div className="rule-suggestions">
                {ruleSuggestions.map(suggestion => (
                  <div key={suggestion.id} className="rule-item">
                    <div className="rule-header">
                      <span className="rule-tag">{suggestion.tag}</span>
                      <span className="rule-keyword">关键词：{suggestion.keyword}</span>
                    </div>
                    <div className="rule-response">
                      {suggestion.displayText}
                      {suggestion.isTyping && <span className="typing-cursor">|</span>}
                    </div>
                    <button
                      className="rule-copy-btn"
                      onClick={() => handleSelectSuggestion(suggestion.response)}
                    >
                      使用此话术
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 原有关键词匹配结果 */}
            {keywords.length === 0 && ruleSuggestions.length === 0 ? (
              <div className="suggestion-empty">
                <p>🔴 等待客户发言...</p>
                <p className="empty-hint">当检测到风险关键词时，将自动显示建议话术</p>
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
