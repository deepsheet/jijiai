/**
 * 纯前端规则引擎
 * 基于 Aho-Corasick 多模式匹配算法
 * 支持防抖动（60秒内同一关键词只触发一次）
 */

import rulesData from '../../scripts/rules.json';

export interface Rule {
  keywords: string[];
  tag: string;
  response: string;
  icon: string;
}

export interface RulesConfig {
  version: string;
  description: string;
  debounce_seconds: number;
  rules: Rule[];
}

export interface MatchResult {
  matched: boolean;
  tag: string;
  response: string;
  icon: string;
  keyword: string;
  timestamp: number;
}

// Aho-Corasick 节点
interface ACNode {
  children: Map<string, ACNode>;
  fail: ACNode | null;
  output: number[]; // 匹配的规则索引列表
  patternIndex: number; // 如果是模式串的结尾，存储模式串索引
}

// Aho-Corasick 自动机
class AhoCorasick {
  private root: ACNode;
  private ruleIndexByPattern: number[]; // pattern index -> rule index

  constructor(patterns: string[], ruleIndexByPattern: number[]) {
    this.ruleIndexByPattern = ruleIndexByPattern;
    this.root = this.createNode();

    // 构建 Trie
    for (let i = 0; i < patterns.length; i++) {
      this.insert(patterns[i], i);
    }

    // 构建失败指针
    this.buildFail();
  }

  private createNode(): ACNode {
    return {
      children: new Map(),
      fail: null,
      output: [],
      patternIndex: -1
    };
  }

  private insert(pattern: string, patternIndex: number): void {
    let node = this.root;
    for (const char of pattern) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createNode());
      }
      node = node.children.get(char)!;
    }
    node.patternIndex = patternIndex;
  }

  private buildFail(): void {
    const queue: ACNode[] = [];
    
    // 第一层节点的失败指针指向根节点
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    // BFS 构建失败指针
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      for (const [char, child] of current.children) {
        queue.push(child);
        
        // 找到最长后缀匹配
        let fail = current.fail;
        while (fail && !fail.children.has(char)) {
          fail = fail.fail;
        }
        
        if (fail) {
          child.fail = fail.children.get(char)!;
          // 合并输出
          child.output = [...child.fail.output];
          if (child.fail.patternIndex !== -1) {
            child.output.push(child.fail.patternIndex);
          }
        } else {
          child.fail = this.root;
        }
        
        if (child.patternIndex !== -1) {
          child.output.push(child.patternIndex);
        }
      }
    }
  }

  // 查找所有匹配
  public findMatches(text: string): number[] {
    const matches: number[] = [];
    let node = this.root;
    
    for (const char of text) {
      // 沿着失败指针找到匹配
      while (node !== this.root && !node.children.has(char)) {
        node = node.fail!;
      }
      
      if (node.children.has(char)) {
        node = node.children.get(char)!;
      }
      
      // 收集所有匹配
      if (node.patternIndex !== -1) {
        matches.push(this.ruleIndexByPattern[node.patternIndex]);
      }
      for (const idx of node.output) {
        matches.push(this.ruleIndexByPattern[idx]);
      }
    }
    
    // 去重
    return [...new Set(matches)];
  }
}

// 规则引擎类
export class RuleEngine {
  private ac: AhoCorasick | null = null;
  private rules: Rule[] = [];
  private lastTriggered: Map<string, number> = new Map();
  private debounceMs: number = 60000; // 默认 60 秒

  constructor() {
    this.loadRules(rulesData as RulesConfig);
  }

  private loadRules(config: RulesConfig): void {
    this.rules = config.rules;
    this.debounceMs = (config.debounce_seconds || 60) * 1000;

    // 构建所有模式串和映射
    const patterns: string[] = [];
    const ruleIndexByPattern: number[] = [];

    for (let ruleIdx = 0; ruleIdx < this.rules.length; ruleIdx++) {
      const rule = this.rules[ruleIdx];
      for (const keyword of rule.keywords) {
        patterns.push(keyword);
        ruleIndexByPattern.push(ruleIdx);
      }
    }

    if (patterns.length > 0) {
      this.ac = new AhoCorasick(patterns, ruleIndexByPattern);
    }
    
    console.log('[RuleEngine] 规则引擎初始化完成，共', this.rules.length, '条规则');
  }

  /**
   * 检测文本中的关键词
   * 每次调用返回并移除一个匹配，支持循环调用检测所有关键词
   * @param text 待检测文本
   * @returns 匹配结果，如果没有匹配返回 null
   */
  public detect(text: string): MatchResult | null {
    if (!this.ac) {
      console.warn('[RuleEngine] Aho-Corasick 自动机未初始化');
      return null;
    }

    console.log('[RuleEngine] 检测文本:', text);
    const matchedRuleIndices = this.ac.findMatches(text);
    
    console.log('[RuleEngine] 匹配到的规则索引:', matchedRuleIndices);
    
    if (matchedRuleIndices.length === 0) {
      return null;
    }

    // 获取第一个匹配的规则
    const ruleIdx = matchedRuleIndices[0];
    const rule = this.rules[ruleIdx];
    
    console.log('[RuleEngine] 匹配规则:', rule.tag, '关键词:', rule.keywords);

    // 检查防抖动（按标签去重）
    const lastTime = this.lastTriggered.get(rule.tag);
    const now = Date.now();
    
    if (lastTime && (now - lastTime) < this.debounceMs) {
      console.log('[RuleEngine] 防抖动拦截:', rule.tag, '将在', Math.ceil((this.debounceMs - (now - lastTime)) / 1000), '秒后可用');
      return null;
    }

    // 更新触发时间
    this.lastTriggered.set(rule.tag, now);

    // 找到实际匹配的关键词
    let matchedKeyword = '';
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        matchedKeyword = kw;
        break;
      }
    }
    if (!matchedKeyword) {
      matchedKeyword = rule.keywords[0];
    }

    const result: MatchResult = {
      matched: true,
      tag: rule.tag,
      response: rule.response,
      icon: rule.icon,
      keyword: matchedKeyword,
      timestamp: now
    };
    
    console.log('[RuleEngine] 返回匹配结果:', result);
    return result;
  }

  /**
   * 重置防抖动状态
   */
  public resetDebounce(): void {
    this.lastTriggered.clear();
  }

  /**
   * 获取所有规则
   */
  public getRules(): Rule[] {
    return this.rules;
  }
}

// 导出单例
export const ruleEngine = new RuleEngine();
