interface Keyword {
  id: string;
  text: string;
  category: string;
  suggestions: string[];
}

interface KeywordDisplayProps {
  keywords: Keyword[];
  onKeywordClick: (keyword: Keyword) => void;
}

function KeywordDisplay({ keywords, onKeywordClick }: KeywordDisplayProps) {
  if (keywords.length === 0) {
    return (
      <div className="keyword-display">
        <div className="keyword-empty">
          <p>正在监听中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="keyword-display">
      {keywords.map(keyword => (
        <div 
          key={keyword.id} 
          className="keyword-item"
          onClick={() => onKeywordClick(keyword)}
        >
          <div className="keyword-header">
            <span className="keyword-text">{keyword.text}</span>
            <span className="keyword-category">{keyword.category}</span>
          </div>
          <div className="keyword-hint">
            点击获取 {keyword.suggestions.length} 条话术建议 →
          </div>
        </div>
      ))}
    </div>
  );
}

export default KeywordDisplay;
