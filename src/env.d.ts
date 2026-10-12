/// <reference types="vite/client" />

declare const __BUILD_TIME__: string;
declare const __APP_VERSION__: string;

/** The artifact runtime's capability entry point. Absent outside a claude.ai artifact viewer. */
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

interface Window {
  claude?: ClaudeRuntime;
}
