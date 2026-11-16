/**
 * The tool boxes below the room box (mockup functions `toolButton`, `toolSplit`, `toolHead`): each
 * tool is a button; at most one is open as a box, in the place of its button.
 * leaves devbackend/tools-collapsed, devbackend/behavior, devbackend/todevice, devbackend/media-open
 */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import type { DevBackendTool } from "../../appViewModel";
import { useDispatch } from "../env";
import { Icon, IconButton } from "../ui/atoms";
import type { IconName } from "../ui/icons";

export const TOOL_SHARE = { min: 0.15, max: 0.8, initial: 0.5, step: 0.05 };
const clamp = (share: number) => Math.round(Math.min(TOOL_SHARE.max, Math.max(TOOL_SHARE.min, share)) * 1000) / 1000;

const TOOLS: Record<DevBackendTool, { icon: IconName; label: string; title: string; minimise: string; resize: string; testId: string }> = {
  client: { icon: "monitor", label: "Client Backend Tool", title: "Client backend", minimise: "Minimise the client backend tool", resize: "Resize the client backend box", testId: "devbackend-client" },
  media: { icon: "image", label: "Media Backend Tool", title: "Media", minimise: "Minimise the media tool", resize: "Resize the media box", testId: "devbackend-media" },
};

/**
 * A pressed tool button (or minimise button) is replaced by the box (or the button), so the focus
 * would fall back to the document. The pressed control sets this right before it toggles; the
 * control that replaces it takes the focus when it mounts. The toggle always re-renders.
 */
let handOver: { tool: DevBackendTool; to: "box" | "button" } | undefined;
const takeFocus = (tool: DevBackendTool, to: "box" | "button") => (el: HTMLElement | null) => {
  if (!el || handOver?.tool !== tool || handOver.to !== to) return;
  handOver = undefined;
  (to === "box" ? el.querySelector<HTMLElement>(".side-head .ibtn") : el)?.focus();
};

/** A closed tool. Pressing it opens its box (and closes the open one). */
export function ToolButton({ tool, count }: { tool: DevBackendTool; count?: string }) {
  const dispatch = useDispatch();
  const t = TOOLS[tool];
  const open = () => {
    handOver = { tool, to: "box" };
    dispatch({ type: "mock/toggleTool", tool });
  };
  return (
    <button ref={takeFocus(tool, "button")} type="button" className="tool-btn" aria-expanded={false} onClick={open}>
      <Icon name={t.icon} size={16} />
      <span>{t.label}</span>
      {count && <em>{count}</em>}
      <Icon name="chevRight" size={14} className="end" />
    </button>
  );
}

/** The handle above the open tool box. The share is measured against the column the boxes are in. */
export function ToolSeparator({ tool, heightShare }: { tool: DevBackendTool; heightShare: number }) {
  const dispatch = useDispatch();
  const drag = useRef<{ y: number; share: number; height: number }>(undefined);
  const resize = (share: number) => dispatch({ type: "mock/resizeTool", heightShare: clamp(share) });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const height = e.currentTarget.parentElement?.getBoundingClientRect().height;
    if (!height) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, share: heightShare, height };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) resize(d.share + (d.y - e.clientY) / d.height);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const next = e.key === "ArrowUp" ? heightShare + TOOL_SHARE.step : e.key === "ArrowDown" ? heightShare - TOOL_SHARE.step : e.key === "Home" ? TOOL_SHARE.min : e.key === "End" ? TOOL_SHARE.max : e.key === "Enter" ? TOOL_SHARE.initial : undefined;
    if (next === undefined) return;
    e.preventDefault();
    resize(next);
  };
  return (
    <div
      className="vsplit"
      role="separator"
      aria-orientation="horizontal"
      aria-label={TOOLS[tool].resize}
      aria-valuenow={Math.round(heightShare * 100)}
      aria-valuemin={TOOL_SHARE.min * 100}
      aria-valuemax={TOOL_SHARE.max * 100}
      tabIndex={0}
      title="Drag or use the arrow keys to resize · double click or Enter to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
      onDoubleClick={() => resize(TOOL_SHARE.initial)}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}

/**
 * The open tool box: header with the minimise button, then the tool's content. It shrinks below its
 * share where the column is too short for the room box's minimum height (app.css).
 */
export function ToolBox({ tool, heightShare, className, children }: { tool: DevBackendTool; heightShare: number; className: string; children: ReactNode }) {
  const dispatch = useDispatch();
  const t = TOOLS[tool];
  const minimise = () => {
    handOver = { tool, to: "button" };
    dispatch({ type: "mock/toggleTool", tool });
  };
  return (
    <section ref={takeFocus(tool, "box")} className={`sidebox toolbox ${className}`} style={{ flex: `0 1 ${clamp(heightShare) * 100}%` }} aria-label={t.title} data-testid={t.testId}>
      <header className="side-head">
        <Icon name={t.icon} size={16} />
        <div className="side-title">
          <b>{t.title}</b>
          <small>shared by all mocked rooms</small>
        </div>
        <span className="sp" />
        <IconButton icon="minus" title={t.minimise} onClick={minimise} />
      </header>
      <div className="side-body">{children}</div>
    </section>
  );
}
