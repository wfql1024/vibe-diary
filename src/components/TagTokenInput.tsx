import { useMemo, useRef, useState } from "react";
import type { Tag } from "../db";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** 候选来源（标签库） */
  tags?: Tag[];
  placeholder?: string;
}

/** 把 "名称; 名称2; 半截文本" 拆成标签数组（输入框与保存共用同一口径） */
export function parseTagText(text: string) {
  return text
    .split(";")
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/**
 * 标签 token 输入：回车确认、以分号结尾进框、退格一次删掉整个标签；
 * 输入时从标签库给候选（浮层，不占布局）。记录弹窗与批量修改共用这一个实现。
 */
export default function TagTokenInput({ value, onChange, tags = [], placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [suggestAt, setSuggestAt] = useState(0);

  const chosen = useMemo(() => parseTagText(value), [value]);
  const fragment = useMemo(() => {
    const parts = value.split(";");
    return (parts[parts.length - 1] ?? "").trim();
  }, [value]);

  const suggestions = useMemo(() => {
    const used = new Set(chosen);
    const keyword = fragment.toLowerCase();
    return tags
      .filter((tag) => !used.has(tag.name))
      .filter((tag) => (keyword ? tag.name.toLowerCase().includes(keyword) : true))
      .slice(0, 8);
  }, [tags, chosen, fragment]);

  function setChosen(next: string[]) {
    onChange(next.map((name) => name + "; ").join(""));
    setSuggestAt(0);
    inputRef.current?.focus();
  }

  function commit(name: string) {
    const target = name.trim();
    if (!target) return;
    if (chosen.includes(target)) {
      setChosen(chosen);
      return;
    }
    setChosen([...chosen, target]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(suggestions[suggestAt]?.name ?? fragment);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestAt((index) => Math.min(Math.max(0, suggestions.length - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestAt((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Backspace" && !fragment && chosen.length > 0) {
      event.preventDefault();
      setChosen(chosen.slice(0, -1));
    }
  }

  return (
    <div className="tag-field">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder ?? "输入关键字选已有标签，回车确认；每个标签以 ; 结尾，退格一次删掉整个"}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {fragment !== "" && suggestions.length > 0 && (
        <div className="tag-suggest" role="listbox">
          {suggestions.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              className={"tag-suggest-item" + (index === suggestAt ? " active" : "")}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(tag.name);
              }}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
