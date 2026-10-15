// Create / edit a review flag in a modal <dialog>: Save, Cancel, Delete and Esc all close it.
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type Flag } from "../review/flags";

export interface FlagDraft { flag: Flag; isNew: boolean; where: string; }

interface Props {
  draft: FlagDraft | null;
  onSave: (f: Flag) => void;
  onDelete: (f: Flag) => void;
  onClose: () => void;
}

/** the form, keyed by the flag so every draft starts from its own values */
function FlagForm({ draft, onSave, onDelete, onClose }: Props & { draft: FlagDraft }) {
  const f = draft.flag;
  const [category, setCategory] = useState(f.category || "geometry");
  const [note, setNote] = useState(f.note || "");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // showModal() focuses the first focusable element (the close button): start in the note instead
  useEffect(() => {
    const t = setTimeout(() => noteRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, category, note: note.trim() }); }}>
      <header className="dialog-head">
        <h2>{draft.isNew ? "New review flag" : `Flag #${f.id}`}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <p className="muted small">{draft.where}</p>
      {!draft.isNew && f.reply && (
        <div className="reply"><span className={`chip status-${f.status ?? "open"}`}>{f.status ?? "open"}</span> {f.reply}</div>
      )}
      <label className="field">
        <span>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>What is wrong here?</span>
        <textarea ref={noteRef} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what you see…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && note.trim()) e.currentTarget.form?.requestSubmit(); }} />
      </label>
      <footer className="dialog-foot">
        {!draft.isNew && <button type="button" className="btn danger" onClick={() => onDelete(f)}>Delete</button>}
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!note.trim()} title="Save (Ctrl+Enter)">Save</button>
      </footer>
    </form>
  );
}

export default function FlagDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { draft, onClose } = props;
  useEffect(() => {
    const d = ref.current!;
    if (draft && !d.open) d.showModal();
    else if (!draft && d.open) d.close();
  }, [draft]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {draft && <FlagForm key={`${draft.flag.id}-${draft.isNew}`} {...props} draft={draft} />}
    </dialog>
  );
}
