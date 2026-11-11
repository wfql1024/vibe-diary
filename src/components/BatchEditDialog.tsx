import { useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { momentKey, momentLabel, type BatchPatch, type EntryRow, type Tag } from "../db";
import TagTokenInput, { parseTagText } from "./TagTokenInput";

interface Props {
  selected: EntryRow[];
  tags: Tag[];
  onClose: () => void;
  onApply: (patch: BatchPatch) => void;
}

/** 三态：全部相同 → 预填该值；有差异 → 留空表示"不改" */
function commonValue<T>(rows: EntryRow[], pick: (row: EntryRow) => T): T | "" {
  if (rows.length === 0) return "";
  const first = pick(rows[0]);
  return rows.every((row) => pick(row) === first) ? first : "";
}

export default function BatchEditDialog({ selected, tags, onClose, onApply }: Props) {
  const count = selected.length;

  const commonDate = useMemo(() => commonValue(selected, (row) => row.date ?? ""), [selected]);
  const commonDue = useMemo(() => commonValue(selected, (row) => row.due_at ?? ""), [selected]);
  const commonRemind = useMemo(() => commonValue(selected, (row) => row.remind_at ?? ""), [selected]);
  const commonPinned = useMemo(() => commonValue(selected, (row) => Boolean(row.pinned)), [selected]);

  const [doneDate, setDoneDate] = useState(commonDate ? commonDate.split("T")[0] : "");
  const [doneTime, setDoneTime] = useState(commonDate ? commonDate.split("T")[1] ?? "" : "");
  const [dueDate, setDueDate] = useState(commonDue ? commonDue.split("T")[0] : "");
  const [remindDate, setRemindDate] = useState(commonRemind ? commonRemind.split("T")[0] : "");
  const [tagText, setTagText] = useState("");
  const [pinnedChoice, setPinnedChoice] = useState<"keep" | "on" | "off">(
    commonPinned === "" ? "keep" : commonPinned ? "on" : "off",
  );
  const [confirming, setConfirming] = useState(false);

  function buildPatch(): BatchPatch {
    const patch: BatchPatch = {};
    if (doneDate) patch.date = doneTime ? doneDate + "T" + doneTime : doneDate;
    else if (commonDate) patch.date = null; // 全部相同且被清空 → 改成未完成
    if (dueDate) patch.dueAt = dueDate;
    if (remindDate) patch.remindAt = remindDate;
    if (pinnedChoice !== "keep") patch.pinned = pinnedChoice === "on";
    const names = parseTagText(tagText);
    if (names.length > 0) patch.addTags = names;
    return patch;
  }

  function describe(patch: BatchPatch): string[] {
    const lines: string[] = [];
    if (patch.date !== undefined) lines.push("完成时间 → " + (patch.date ? momentLabel(patch.date) : "未完成"));
    if (patch.dueAt !== undefined) lines.push("截止 → " + momentLabel(patch.dueAt));
    if (patch.remindAt !== undefined) lines.push("提醒 → " + momentLabel(patch.remindAt));
    if (patch.pinned !== undefined) lines.push("置顶 → " + (patch.pinned ? "是" : "否"));
    if (patch.addTags) lines.push("追加标签 → " + patch.addTags.join("、"));
    return lines;
  }

  const patch = buildPatch();
  const changes = describe(patch);

  return (
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()} role="dialog">
        <header className="dialog-head">
          <h2>{count + " 条记录批量修改"}</h2>
          <button type="button" className="flat dialog-close" onClick={onClose} title="关闭（Esc）">
            ×
          </button>
        </header>

        <p className="dialog-hint">
          只有填写的项才会改动；留空 = 保持原样。所有选中的记录都会被改成同样的值。
        </p>

        <div className="dialog-field">
          <span>完成时间</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={doneDate} onChange={(event) => setDoneDate(event.currentTarget.value)} />
              <input type="time" value={doneTime} onChange={(event) => setDoneTime(event.currentTarget.value)} />
              <button
                type="button"
                className="opt-chip"
                onClick={() => {
                  const now = momentKey();
                  setDoneDate(now.split("T")[0]);
                  setDoneTime(now.split("T")[1]);
                }}
              >
                现在
              </button>
              <button
                type="button"
                className="opt-chip"
                onClick={() => {
                  setDoneDate("");
                  setDoneTime("");
                }}
              >
                清空
              </button>
            </div>
            {commonDate ? <p className="dialog-hint">当前都是 {momentLabel(commonDate)}</p> : <p className="dialog-hint">当前不一致或为空</p>}
          </div>
        </div>

        <div className="dialog-field">
          <span>截止</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.currentTarget.value)} />
            </div>
            {commonDue ? <p className="dialog-hint">当前都是 {momentLabel(commonDue)}</p> : null}
          </div>
        </div>

        <div className="dialog-field">
          <span>提醒</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              <input type="date" value={remindDate} onChange={(event) => setRemindDate(event.currentTarget.value)} />
            </div>
            {commonRemind ? <p className="dialog-hint">当前都是 {momentLabel(commonRemind)}</p> : null}
          </div>
        </div>

        <div className="dialog-field">
          <span>追加标签</span>
          <div className="dialog-field-body">
            <TagTokenInput value={tagText} onChange={setTagText} tags={tags} placeholder="回车确认；每个标签以 ; 结尾，退格一次删掉整个" />
            <p className="dialog-hint">只追加，不会删掉原有标签</p>
          </div>
        </div>

        <div className="dialog-field">
          <span>置顶</span>
          <div className="dialog-field-body">
            <div className="dialog-inline">
              {([
                { key: "keep", label: "不改" },
                { key: "on", label: "置顶" },
                { key: "off", label: "取消置顶" },
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={"opt-chip" + (pinnedChoice === option.key ? " active" : "")}
                  onClick={() => setPinnedChoice(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="dialog-foot">
          <span className="dialog-foot-gap" />
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={changes.length === 0}
            onClick={() => setConfirming(true)}
          >
            应用改动
          </button>
        </footer>
      </div>

      {confirming && (
        <ConfirmDialog
          title="确认批量修改"
          message={"将对 " + count + " 条记录做以下改动：\n\n" + changes.map((line) => "· " + line).join("\n")}
          options={[{ label: "确认修改", primary: true }]}
          onPick={() => {
            setConfirming(false);
            onApply(patch);
            onClose();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
