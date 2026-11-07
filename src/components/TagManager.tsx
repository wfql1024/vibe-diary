import { useState } from "react";
import {
  TagNameTakenError,
  createTag,
  deleteTag,
  mergeTags,
  renameTag,
  type Tag,
} from "../db";

interface Props {
  tags: Tag[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

export default function TagManager({ tags, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [merge, setMerge] = useState<{ sourceId: number; sourceName: string; targetId: number; targetName: string } | null>(null);
  const [removing, setRemoving] = useState<Tag | null>(null);

  function reset() {
    setError(null);
    setInfo(null);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    reset();
    try {
      await createTag(name);
      setNewName("");
      setInfo(`已添加标签「${name}」`);
      await onChanged();
    } catch (e) {
      if (e instanceof TagNameTakenError) setError(`标签「${name}」已存在，不能重复创建`);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRename(tag: Tag, name: string) {
    reset();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === tag.name) {
      setEditing(null);
      return;
    }
    try {
      await renameTag(tag.id, trimmed);
      setEditing(null);
      await onChanged();
    } catch (e) {
      if (e instanceof TagNameTakenError) {
        const target = tags.find((item) => item.id === e.existingId);
        setMerge({
          sourceId: tag.id,
          sourceName: tag.name,
          targetId: e.existingId,
          targetName: target?.name ?? trimmed,
        });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function confirmMerge() {
    if (!merge) return;
    reset();
    await mergeTags(merge.sourceId, merge.targetId);
    setInfo(`已把「${merge.sourceName}」合并进「${merge.targetName}」`);
    setMerge(null);
    setEditing(null);
    await onChanged();
  }

  async function confirmDelete() {
    if (!removing) return;
    reset();
    const { affectedEntries } = await deleteTag(removing.id);
    setInfo(`已删除标签「${removing.name}」，已从 ${affectedEntries} 条记录中移除`);
    setRemoving(null);
    await onChanged();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>标签管理</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <form className="tag-add" onSubmit={handleCreate}>
          <input
            value={newName}
            placeholder="新标签名称"
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
          <button type="submit">添加</button>
        </form>

        {error && <p className="error-inline">{error}</p>}
        {info && <p className="info-inline">{info}</p>}

        {merge && (
          <div className="merge-box">
            <p>
              名称「{merge.targetName}」已被占用。要把「{merge.sourceName}」合并进「{merge.targetName}」吗？
              合并后这些记录的标签引用会全部改为「{merge.targetName}」，原标签删除。
            </p>
            <div className="row-actions">
              <button type="button" onClick={confirmMerge}>
                合并
              </button>
              <button type="button" className="ghost" onClick={() => setMerge(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {removing && (
          <div className="merge-box danger">
            <p>
              删除「{removing.name}」会把它从 {removing.usage} 条记录中移除（记录本身不会删除），
              同时断开与它相关的关系线。确定删除吗？
            </p>
            <div className="row-actions">
              <button type="button" className="danger" onClick={confirmDelete}>
                删除标签
              </button>
              <button type="button" className="ghost" onClick={() => setRemoving(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        <ul className="tag-list">
          {tags.map((tag) => (
            <li key={tag.id}>
              <span className="dot" style={{ background: tag.color ?? "#8a8f98" }} />
              {editing?.id === tag.id ? (
                <>
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(event) => setEditing({ id: tag.id, name: event.currentTarget.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleRename(tag, editing.name);
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                  <button type="button" onClick={() => void handleRename(tag, editing.name)}>
                    确定
                  </button>
                  <button type="button" className="ghost" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="tag-name">{tag.name}</span>
                  <span className="muted">{tag.usage} 条</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      reset();
                      setEditing({ id: tag.id, name: tag.name });
                    }}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text"
                    onClick={() => {
                      reset();
                      setRemoving(tag);
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </li>
          ))}
          {tags.length === 0 && <li className="muted">还没有标签</li>}
        </ul>
      </div>
    </div>
  );
}
