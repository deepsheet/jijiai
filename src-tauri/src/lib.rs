use aho_corasick::AhoCorasick;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// 规则配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub keywords: Vec<String>,
    pub tag: String,
    pub response: String,
    #[serde(default)]
    pub icon: String,
}

/// 规则库配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RulesConfig {
    pub version: String,
    pub description: String,
    #[serde(default = "default_debounce")]
    pub debounce_seconds: u64,
    pub rules: Vec<Rule>,
}

fn default_debounce() -> u64 {
    60
}

/// 匹配结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub matched: bool,
    pub tag: String,
    pub response: String,
    pub icon: String,
    pub keyword: String,
    pub timestamp: i64,
}

/// 规则引擎状态
pub struct RulesEngine {
    /// 模式名称列表（按索引存储，用于获取匹配的关键词）
    patterns: Vec<String>,
    /// Aho-Corasick 自动机
    ac: Option<AhoCorasick>,
    /// 关键词到规则的映射
    keyword_to_rule: HashMap<String, usize>,
    /// 规则列表（按索引访问）
    rules: Vec<Rule>,
    /// 防抖动：关键词最后触发时间
    last_triggered: HashMap<String, Instant>,
    /// 防抖动时间窗口（秒）
    debounce_seconds: u64,
}

impl RulesEngine {
    /// 从 JSON 字符串初始化规则引擎
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        let config: RulesConfig = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse rules JSON: {}", e))?;

        let mut patterns: Vec<String> = Vec::new();
        let mut keyword_to_rule: HashMap<String, usize> = HashMap::new();
        let mut rules: Vec<Rule> = Vec::new();

        for (rule_idx, rule) in config.rules.iter().enumerate() {
            for keyword in &rule.keywords {
                patterns.push(keyword.clone());
                keyword_to_rule.insert(keyword.clone(), rule_idx);
            }
            rules.push(rule.clone());
        }

        // 构建 Aho-Corasick 自动机
        let ac = AhoCorasick::new(&patterns)
            .map_err(|e| format!("Failed to build AC automaton: {}", e))?;

        Ok(Self {
            patterns,
            ac: Some(ac),
            keyword_to_rule,
            rules,
            last_triggered: HashMap::new(),
            debounce_seconds: config.debounce_seconds,
        })
    }

    /// 检测文本中的关键词
    pub fn detect(&mut self, text: &str) -> Option<MatchResult> {
        let ac = self.ac.as_ref()?;

        // 使用 AC 自动机查找所有匹配
        let matches: Vec<(usize, usize)> = ac
            .find_iter(text)
            .map(|m| (m.pattern().as_usize(), m.end()))
            .collect();

        if matches.is_empty() {
            return None;
        }

        // 获取第一个匹配（按出现位置排序）
        let (pattern_idx, _) = matches[0];
        
        // 通过索引获取模式名称（关键词）
        let pattern_name = self.patterns.get(pattern_idx)?;

        // 检查防抖动
        if let Some(last_time) = self.last_triggered.get(pattern_name) {
            let elapsed = last_time.elapsed();
            if elapsed < Duration::from_secs(self.debounce_seconds) {
                log::debug!("Keyword '{}' debounced (elapsed: {:?})", pattern_name, elapsed);
                return None;
            }
        }

        // 获取规则索引
        let rule_idx = self.keyword_to_rule.get(pattern_name)?;
        let rule = &self.rules[*rule_idx];

        // 更新触发时间
        self.last_triggered.insert(pattern_name.to_string(), Instant::now());

        Some(MatchResult {
            matched: true,
            tag: rule.tag.clone(),
            response: rule.response.clone(),
            icon: rule.icon.clone(),
            keyword: pattern_name.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// 重置防抖动状态
    pub fn reset_debounce(&mut self) {
        self.last_triggered.clear();
    }
}

/// 初始化规则引擎状态
pub fn init_rules_engine() -> Result<RulesEngine, String> {
    // 尝试从多个位置加载规则文件
    let possible_paths = [
        // 开发环境：项目根目录
        "../scripts/rules.json",
        // 发布环境：应用程序所在目录
        "scripts/rules.json",
        // 备用路径
        "./scripts/rules.json",
        // src-tauri 目录下的 scripts
        "../scripts/rules.json",
    ];

    for path in &possible_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            log::info!("Loading rules from: {}", path);
            return RulesEngine::from_json(&content);
        }
    }

    // 如果找不到规则文件，返回错误
    Err("No rules file found".to_string())
}
