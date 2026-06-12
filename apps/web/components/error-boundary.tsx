"use client";

import React from "react";
import Link from "next/link";

const PUBLIC_ERROR_PREFIXES = [
  "SyntaxError",
  "TypeError",
  "ReferenceError",
  "RangeError",
];

const isPublicError = (msg: string) =>
  PUBLIC_ERROR_PREFIXES.some((p) => msg.startsWith(p)) || msg.length < 100;

const sanitizeError = (msg: string) =>
  isPublicError(msg) ? msg : "An unexpected error occurred";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const message = this.state.error
        ? sanitizeError(this.state.error.message)
        : "An unexpected error occurred";
      return (
        <div className="bg-white rounded-xl border p-8 max-w-md mx-auto mt-20 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-red-600 text-xl font-bold">!</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2>
          <p className="text-sm text-slate-500 mt-2">{message}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
