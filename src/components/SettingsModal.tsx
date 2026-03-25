import { useState, useEffect } from 'react';

interface Settings {
  llm: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  asr: {
    provider: string;
    apiKey?: string;
    appKey?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    appId?: string;
    iflytekApiKey?: string;
    iflytekApiSecret?: string;
    aliyun?: {
      accessKeyId: string;
      accessKeySecret: string;
      appKey: string;
    };
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  initialSettings?: Settings;
  onTestConnection?: (settings: Settings) => Promise<{ success: boolean; message: string }>;
}

const defaultSettings: Settings = {
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-170f4fc64eae430aaf111f8d1fb95d42',
    model: 'deepseek-chat'
  },
  asr: {
    provider: 'local'
  }
};

function SettingsModal({ isOpen, onClose, onSave, initialSettings = defaultSettings, onTestConnection }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings);
      setTestResult(null);
    }
  }, [isOpen, initialSettings]);

  if (!isOpen) return null;

  const handleLlmChange = (field: keyof Settings['llm'], value: string) => {
    setSettings(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        [field]: value
      }
    }));
  };

  const handleAsrChange = (field: keyof Settings['asr'], value: string) => {
    setSettings(prev => {
      const newAsr = { ...prev.asr };
      
      // 如果字段是 aliyun 的子字段，需要创建 aliyun 对象
      if (field === 'accessKeyId' || field === 'accessKeySecret' || field === 'appKey') {
        if (!newAsr.aliyun) {
          newAsr.aliyun = {
            accessKeyId: '',
            accessKeySecret: '',
            appKey: ''
          };
        }
        // 使用类型断言来绕过类型检查
        (newAsr.aliyun as any)[field] = value;
      } else {
        newAsr[field] = value as any;
      }
      
      return {
        ...prev,
        asr: newAsr
      };
    });
  };

  const handleTestConnection = async () => {
    if (!onTestConnection) return;
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      const result = await onTestConnection(settings);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        message: '测试失败: ' + (error as Error).message
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    console.log('准备保存的设置:', settings);
    onSave(settings);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="section">
            <h3>大模型 API 设置</h3>
            
            <div className="form-group">
              <label>提供商</label>
              <select
                value={settings.llm.provider}
                onChange={e => handleLlmChange('provider', e.target.value)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={settings.llm.apiKey}
                onChange={e => handleLlmChange('apiKey', e.target.value)}
                placeholder="sk-..."
              />
            </div>

            <div className="form-group">
              <label>基础 URL</label>
              <input
                type="text"
                value={settings.llm.baseUrl}
                onChange={e => handleLlmChange('baseUrl', e.target.value)}
                placeholder="https://api.deepseek.com/v1"
              />
            </div>

            <div className="form-group">
              <label>模型</label>
              <select
                value={settings.llm.model}
                onChange={e => handleLlmChange('model', e.target.value)}
              >
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
              </select>
            </div>
          </div>

          <div className="section">
            <h3>语音识别 (ASR) 设置</h3>
            
            <div className="form-group">
              <label>提供商</label>
              <select
                value={settings.asr.provider}
                onChange={e => handleAsrChange('provider', e.target.value)}
              >
                <option value="web">浏览器 Web Speech API (推荐)</option>
                <option value="local">本地 Whisper 模型 (需下载)</option>
                <option value="aliyun">阿里云 ASR API</option>
                <option value="iflytek">讯飞 ASR API</option>
              </select>
            </div>

            {settings.asr.provider === 'aliyun' && (
              <div className="form-group">
                <label>AppKey</label>
                <input
                  type="text"
                  value={settings.asr.appKey || ''}
                  onChange={e => handleAsrChange('appKey', e.target.value)}
                  placeholder="IJy2Oaj6mozryBZo"
                />
              </div>
            )}

            {settings.asr.provider === 'aliyun' && (
              <div className="form-group">
                <label>Access Key ID</label>
                <input
                  type="password"
                  value={settings.asr.accessKeyId || ''}
                  onChange={e => handleAsrChange('accessKeyId', e.target.value)}
                  placeholder="您的阿里云 Access Key ID"
                />
              </div>
            )}

            {settings.asr.provider === 'aliyun' && (
              <div className="form-group">
                <label>Access Key Secret</label>
                <input
                  type="password"
                  value={settings.asr.accessKeySecret || ''}
                  onChange={e => handleAsrChange('accessKeySecret', e.target.value)}
                  placeholder="您的阿里云 Access Key Secret"
                />
              </div>
            )}

            {settings.asr.provider === 'iflytek' && (
              <div className="form-group">
                <label>AppID</label>
                <input
                  type="text"
                  value={settings.asr.appId || ''}
                  onChange={e => handleAsrChange('appId', e.target.value)}
                  placeholder="您的讯飞 AppID"
                />
              </div>
            )}

            {settings.asr.provider === 'iflytek' && (
              <div className="form-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={settings.asr.iflytekApiKey || ''}
                  onChange={e => handleAsrChange('iflytekApiKey', e.target.value)}
                  placeholder="您的讯飞 API Key"
                />
              </div>
            )}

            {settings.asr.provider === 'iflytek' && (
              <div className="form-group">
                <label>API Secret</label>
                <input
                  type="password"
                  value={settings.asr.iflytekApiSecret || ''}
                  onChange={e => handleAsrChange('iflytekApiSecret', e.target.value)}
                  placeholder="您的讯飞 API Secret"
                />
              </div>
            )}
          </div>

          {testResult && (
            <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? '✓ ' : '✗ '}
              {testResult.message}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            className="test-btn" 
            onClick={handleTestConnection}
            disabled={isTesting}
          >
            {isTesting ? '测试中...' : '测试链接'}
          </button>
          <button className="cancel-btn" onClick={onClose}>取消</button>
          <button className="save-btn" onClick={handleSave}>保存设置</button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
