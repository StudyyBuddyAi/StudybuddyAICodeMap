import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a failing diagram from taking the sheet with it.
 *
 * React unmounts the entire tree on an uncaught render error, so without this
 * a bug anywhere in the anatomy panel blanks the whole page. A missing diagram
 * is an acceptable degradation; a blank app is not.
 */
export default class AnatomyBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[anatomy] panel crashed, hiding it", error, info.componentStack);
  }

  render() {
    // Render nothing, matching how a no-match result behaves — the reader
    // simply has no diagram, and the sheet around it is untouched.
    return this.state.failed ? null : this.props.children;
  }
}
