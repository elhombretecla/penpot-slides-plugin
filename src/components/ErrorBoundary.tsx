import { Component, type ReactNode } from 'react';
import { flushSave } from '../autosave';
import { penpotApi } from '../api';
import { useSlideStore } from '../store';

interface State {
  error: Error | null;
}

// A rendering error must not leave the plugin blank: show what happened and
// offer a way back. The deck itself is autosaved, so nothing is lost.
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[Slide Builder]', error);
  }

  private retry = () => this.setState({ error: null });

  private backHome = () => {
    flushSave();
    useSlideStore.getState().closeDeck();
    penpotApi.listDecks();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen" role="alert">
        <p className="title-s">Something went wrong</p>
        <p className="body-s error-screen-message">{this.state.error.message || String(this.state.error)}</p>
        <p className="body-s error-screen-hint">Your presentation is saved in the file.</p>
        <div className="error-screen-actions">
          <button data-appearance="primary" onClick={this.retry}>Try again</button>
          <button data-appearance="secondary" onClick={this.backHome}>All presentations</button>
        </div>
      </div>
    );
  }
}
