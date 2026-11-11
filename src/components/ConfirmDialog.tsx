interface Props {
  title: string;
  message: string;
  /** 每个选项：label + 可选说明；返回选中项的下标，取消（关闭）返回 null */
  options: { label: string; hint?: string; primary?: boolean }[];
  onPick: (index: number) => void;
  onCancel: () => void;
}

/** 自己实现的确认弹窗（不用 window.confirm：它只能「确定/取消」，没法给第三个选择） */
export default function ConfirmDialog({ title, message, options, onPick, onCancel }: Props) {
  return (
    <div className="dialog-mask" onClick={onCancel}>
      <div className="dialog dialog-small" onClick={(event) => event.stopPropagation()} role="dialog">
        <header className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="flat dialog-close" onClick={onCancel} title="关闭（Esc）">
            ×
          </button>
        </header>
        <p className="dialog-message">{message}</p>
        <div className="dialog-options">
          {options.map((option, index) => (
            <button
              key={option.label}
              type="button"
              className={option.primary ? "primary" : "flat opt-chip"}
              onClick={() => onPick(index)}
            >
              {option.label}
              {option.hint ? <em className="dialog-option-hint">{option.hint}</em> : null}
            </button>
          ))}
          <button type="button" className="ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
