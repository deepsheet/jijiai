export interface Settings {
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
  theme?: 'dark' | 'light';
}

const SETTINGS_KEY = 'jijihuashu_settings';

const defaultSettings: Settings = {
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
};

export async function loadSettings(): Promise<Settings> {
  try {
    // 1. 先尝试从配置文件加载
    try {
      const response = await fetch('/config.json');
      if (response.ok) {
        const configSettings = await response.json();
        console.log('从配置文件加载设置:', configSettings);
        return configSettings;
      }
    } catch (e) {
      console.log('配置文件不存在或加载失败，尝试从 localStorage 加载');
    }
    
    // 2. 从 localStorage 加载
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      console.log('从 localStorage 加载设置');
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
  
  // 3. 返回默认设置
  console.log('使用默认设置');
  return defaultSettings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.log('设置已保存到 localStorage:', settings);
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}
