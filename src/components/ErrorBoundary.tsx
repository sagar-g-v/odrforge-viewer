// A rendering error stops at the nearest boundary instead of blanking the app: the map has its own (the side panel stays
// usable), and the whole app one more. The panel says what failed and offers a way on: try again, open another file, or
// reload. A new `resetKey` (another network opened) clears the error by itself.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "./Icon";

interface Props { label: string; resetKey?: unknown; children: ReactNode; onOpenAnother?: () => void }
interface State { error: Error | null; key: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`OdrForge Viewer: ${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // the whole app: a URL without the file parameter opens the viewer empty, so a file that crashes it is not reopened
    const fresh = () => { const u = new URL(location.href); u.searchParams.delete("file"); location.assign(u.toString()); };
    return (
      <div className="crash" role="alert">
        <Icon name="alert" size={24} />
        <h2>Something went wrong in {this.props.label}</h2>
        <p>The viewer stopped drawing it. Your review flags on the server are not affected.</p>
        <details><summary>Details</summary><pre>{error.message}</pre></details>
        <div className="crash-actions">
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn" onClick={this.props.onOpenAnother ?? fresh}>Open another file</button>
          <button className="link" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
