// What could not be read or drawn as written (xodr/parse.ts, xodr/build.ts, the loader): one banner per opened network,
// the list folded away, dismissible. Nothing in a file is dropped without the user being told.
import { Icon } from "./Icon";

const SHOWN = 20;

export function IssuesBanner({ name, issues, onDismiss }: { name: string; issues: string[]; onDismiss: () => void }) {
  const n = issues.length;
  return (
    <div className="banner info banner-issues" role="status">
      <Icon name="alert" />
      <div className="banner-body">
        <details>
          <summary>{n === 1 ? "1 problem" : `${n} problems`} reading {name}: shown as far as possible</summary>
          <ul className="banner-list">
            {issues.slice(0, SHOWN).map((t, i) => <li key={i}>{t}</li>)}
            {n > SHOWN && <li>… and {n - SHOWN} more</li>}
          </ul>
        </details>
      </div>
      <button className="link" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
