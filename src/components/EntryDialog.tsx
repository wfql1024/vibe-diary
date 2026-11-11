import { useEffect, useMemo, useState } from "react";
import { createEntry, deleteEntry, momentKey, tagsForEntries, updateEntry, type EntryRow, type Tag } from "../db";
import TagTokenInput, { parseTagText } from "./TagTokenInput";

interface Props {
  /** 预填日期（YYYY-MM-DD） */
  date: string;
  /** 传入则是编辑这条记录，否则是新建 */
  entry?: EntryRow | null;
  /** 库里已有标签，用来做输入候选 */
  tags?: Tag[];
  onClose: () => void;
  onSaved: () => void;
}

const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "workday", label: "每个工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
  { value: "custom", label: "自定义…" },
];

const DUE_QUICK: { kind: string; label: string }[] = [
  { kind: "today", label: "今天" },
  { kind: "tomorrow", label: "明天" },
  { kind: "saturday", label: "本周六" },
  { kind: "monday", label: "下周一" },
  { kind: "monthEnd", label: "本月末" },
  { kind: "nextMonth", label: "下月初" },
];

const REMIND_QUICK: { kind: string; label: string }[] = [
  { kind: "same", label: "同截止" },
  { kind: "hour", label: "提前 1 小时" },
  { kind: "day", label: "提前 1 天" },
  { kind: "today9", label: "今天 09:00" },
  { kind: "tomorrow9", label: "明天 09:00" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function keyOf(date: Date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export default function EntryDialog({ date, entry = null, tags = [], onClose, onSaved }: Props) {
  const [day, setDay] = useState((entry?.date ?? date).split("T")[0]);
  const [title, setTitle] = useState(entry?.title ?? "");
  const [content, setContent] = useState(entry?.content ?? "");
  const [tagsText, setTagsText] = useState("");
  const [pinned, setPinned] = useState(Boolean(entry?.pinned));
  const [repeat, setRepeat] = useState(entry?.repeat_rule ?? "");
  const [customRepeat, setCustomRepeat] = useState("");
  const [dueDate, setDueDate] = useState((entry?.due_at ?? "").split("T")[0] ?? "");
  const [dueTime, setDueTime] = useState((entry?.due_at ?? "").split("T")[1] ?? "");
  const [remindDate, setRemindDate] = useState((entry?.remind_at ?? "").split("T")[0] ?? "");
  const [remindTime, setRemindTime] = useState((entry?.remind_at ?? "").split("T")[1] ?? "");
  const [doneTime, setDoneTime] = useState((entry?.date ?? "").split("T")[1] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setDay((entry?.date ?? date).split("T")[0]);
  }, [date, entry]);

  // 编辑模式：把已有标签读进来（变成 "名称; 名称;" 的 token 文本）
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    void (async () => {
      const map = await tagsForEntries([entry.id]);
      if (cancelled) return;
      const names = (map.get(entry.id) ?? []).map((tag) => tag.name);
      setTagsText(names.map((name) => name + "; ").join(""));
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = useMemo(() => parseTagText(tagsText), [tagsText]);
  function quickDue(kind: string) {
    const now = new Date();
    if (kind === "today") setDueDate(keyOf(now));
    if (kind === "tomorrow") setDueDate(keyOf(addDays(now, 1)));
    if (kind === "saturday") {
      const delta = (6 - now.getDay() + 7) % 7;
      setDueDate(keyOf(addDays(now, delta === 0 ? 7 : delta)));
    }
    if (kind === "monday") {
      const delta = (1 - now.getDay() + 7) % 7;
      setDueDate(keyOf(addDays(now, delta === 0 ? 7 : delta)));
    }
    if (kind === "monthEnd") setDueDate(keyOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    if (kind === "nextMonth") setDueDate(keyOf(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  }

  function quickRemind(kind: string) {
    if (kind === "same") {
      setRemindDate(dueDate);
      setRemindTime(dueTime);
      return;
    }
    const base = dueDate ? new Date(dueDate + "T" + (dueTime || "09:00")) : new Date();
    if (kind === "hour" || kind === "day") {
      const at = new Date(base.getTime() - (kind === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
      setRemindDate(keyOf(at));
      setRemindTime(pad(at.getHours()) + ":" + pad(at.getMinutes()));
      return;
    }
    const now = new Date();
    setRemindDate(keyOf(kind === "today9" ? now : addDays(now, 1)));
    setRemindTime("09:00");
  }

  async function save() {
    if (!content.trim()) {
      setError("内容不能为空");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: day ? (doneTime ? day + "T" + doneTime : day) : null,
        title,
        content,
        tags: chosen,
        pinned,
        repeatRule: repeat === "custom" ? customRepeat.trim() : repeat,
        dueAt: dueDate ? (dueTime ? dueDate + "T" + dueTime : dueDate) : null,
        remindAt: remindDate ? (remindTime ? remindDate + "T" + remindTime : remindDate) : null,
      };
      if (entry) await updateEntry(entry.id, payload);
      else await createEntry(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="dialog-head">
          <h2>{entry ? "编辑记录" : "新建记录"}</h2>
          <button type="button" className="flat dialog-close" onClick={onClose} title="关闭（Esc）">
            ×
          </button>
        </header>

        <div className="dialog-field">
          <span>完成时间</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={day} onChange={(event) => setDay(event.currentTarget.value)} />
              <input type="time" value={doneTime} onChange={(event) => setDoneTime(event.currentTarget.value)} />
              <button
                type="button"
                className="opt-chip"
                onClick={() => {
                  const now = momentKey();
                  setDay(now.split("T")[0]);
                  setDoneTime(now.split("T")[1]);
                }}
              >
                现在
              </button>
              <button
                type="button"
                className="opt-chip"
                onClick={() => {
                  setDay("");
                  setDoneTime("");
                }}
              >
                未完成
              </button>
            </div>
            <p className="dialog-hint">这个时间既是日记日期，也是完成时间；留空表示未完成（会进待办）</p>
          </div>
        </div>

        <div className="dialog-field">
          <span>标题</span>
          <div className="dialog-field-body">
            <input
              value={title}
              placeholder="要记什么？（留空时取内容第一行）"
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
        </div>

        <div className="dialog-field">
          <span>描述</span>
          <div className="dialog-field-body">
            <textarea
              rows={7}
              autoFocus
              value={content}
              placeholder="今天的详细内容…"
              onChange={(event) => setContent(event.currentTarget.value)}
            />
          </div>
        </div>

        <div className="dialog-field">
          <span>标签</span>
          <div className="dialog-field-body">
            <TagTokenInput value={tagsText} onChange={setTagsText} tags={tags} />
          </div>
        </div>

        <div className="dialog-field">
          <span>置顶</span>
          <div className="dialog-field-body">
            <label className="dialog-check">
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.currentTarget.checked)} />
              <span>与日期无关，固定在列表最顶部</span>
            </label>
          </div>
        </div>

        <div className="dialog-field">
          <span>周期</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              {REPEAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={"opt-chip" + (repeat === option.value ? " active" : "")}
                  onClick={() => setRepeat(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {repeat === "custom" && (
              <input
                className="opt-custom"
                value={customRepeat}
                placeholder="自定义规则，如：每两周的周三"
                onChange={(event) => setCustomRepeat(event.currentTarget.value)}
              />
            )}
          </div>
        </div>

        <div className="dialog-field">
          <span>截止</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.currentTarget.value)} />
              <input type="time" value={dueTime} onChange={(event) => setDueTime(event.currentTarget.value)} />
            </div>
            <div className="dialog-quick">
              {DUE_QUICK.map((item) => (
                <button key={item.kind} type="button" className="opt-chip" onClick={() => quickDue(item.kind)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="dialog-field">
          <span>提醒</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={remindDate} onChange={(event) => setRemindDate(event.currentTarget.value)} />
              <input type="time" value={remindTime} onChange={(event) => setRemindTime(event.currentTarget.value)} />
            </div>
            <div className="dialog-quick">
              {REMIND_QUICK.map((item) => (
                <button key={item.kind} type="button" className="opt-chip" onClick={() => quickRemind(item.kind)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="dialog-hint">不设提醒即不通知；提醒时间目前只做记录，桌面通知尚未接入。</p>

        {error && <p className="dialog-error">{error}</p>}

        {entry && confirmDelete && (
          <p className="dialog-error">删除后无法恢复，确定要删掉这条记录吗？</p>
        )}

        <footer className="dialog-foot">
          {entry && (
            <button
              type="button"
              className={confirmDelete ? "danger" : "ghost danger-text"}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void (async () => {
                  await deleteEntry(entry.id);
                  onSaved();
                  onClose();
                })();
              }}
            >
              {confirmDelete ? "确认删除" : "删除"}
            </button>
          )}
          {confirmDelete && (
            <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>
              再想想
            </button>
          )}
          <span className="dialog-foot-gap" />
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
