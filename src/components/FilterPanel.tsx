interface Item {
  key: string;
  label: string;
  count: number | string;
  color?: string | null;
}

interface Props {
  hint: string;
  items: Item[];
  includes: string[];
  excludes: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}

/**
 * 标签/主题共用的筛选面板：三态（未选 → 选中 → 排除）。
 * 两个筛选器只用这一个实现，样式与行为不会再各自漂移。
 */
export default function FilterPanel({ hint, items, includes, excludes, onToggle, onClear }: Props) {
  return (
    <div className="filter-pop" role="dialog">
      <header>
        <span className="muted">{hint}</span>
        <button type="button" className="linkish" onClick={onClear}>
          清空
        </button>
      </header>
      <div className="filter-list">
        {items.map((item) => {
          const state = includes.includes(item.key) ? " include" : excludes.includes(item.key) ? " exclude" : "";
          return (
            <button
              key={item.key}
              type="button"
              className={"filter-item" + state}
              style={item.color ? { borderColor: item.color } : undefined}
              onClick={() => onToggle(item.key)}
            >
              {item.label} <em>{item.count}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
