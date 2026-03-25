interface SuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  suggestions: string[];
  onSelect: (text: string) => void;
}

function SuggestionModal({ isOpen, onClose, title, suggestions, onSelect }: SuggestionModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="suggestion-list">
            {suggestions.map((suggestion, index) => (
              <div 
                key={index}
                className="suggestion-item"
                onClick={() => {
                  onSelect(suggestion);
                  onClose();
                }}
              >
                <p>{suggestion}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

export default SuggestionModal;
