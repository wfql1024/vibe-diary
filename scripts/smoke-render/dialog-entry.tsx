import { renderToString } from "react-dom/server";
import EntryDialog from "../../src/components/EntryDialog";
import ConfirmDialog from "../../src/components/ConfirmDialog";
import BatchEditDialog from "../../src/components/BatchEditDialog";
import type { EntryRow } from "../../src/db";

const noop = () => {};
const entry = renderToString(<EntryDialog date="2025-09-28" tags={[]} onClose={noop} onSaved={noop} />);
console.log("DIALOG_RENDER_OK length=" + entry.length + " hasTextarea=" + entry.includes("<textarea"));
const confirm = renderToString(
  <ConfirmDialog
    title="这条已经过了截止时间"
    message="截止 2025-09-28，现在是 2025-10-01。"
    options={[{ label: "按当前时间", primary: true }, { label: "按截止时间" }]}
    onPick={noop}
    onCancel={noop}
  />,
);
console.log("CONFIRM_RENDER_OK length=" + confirm.length + " hasCancel=" + confirm.includes("取消"));
const rows: EntryRow[] = [
  {
    id: 1, title: "暖暖：测试", content: "内容", status: "completed", date: "2025-09-28T10:00",
    created_at: "", updated_at: "", pinned: 0, repeat_rule: "", due_at: null, remind_at: null,
  },
  {
    id: 2, title: "粥：测试", content: "内容", status: "pending", date: null,
    created_at: "", updated_at: "", pinned: 1, repeat_rule: "", due_at: "2025-10-01", remind_at: null,
  },
];
const batch = renderToString(<BatchEditDialog selected={rows} tags={[]} onClose={noop} onApply={noop} />);
console.log("BATCH_RENDER_OK length=" + batch.length + " hasApply=" + batch.includes("应用改动"));
