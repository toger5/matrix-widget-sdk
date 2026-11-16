import type { ReactNode } from "react";

import { useDispatch } from "../env";
import { IconButton } from "../ui/atoms";

interface SideBoxProps {
  title: string;
  sub?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}

/** The box of a SidePanel view: a header with the title and the close button, and the body. */
export function SideBox({ title, sub, className = "", testId, children }: SideBoxProps) {
  const dispatch = useDispatch();
  return (
    <section className={`sidebox ${className}`} aria-label={title} data-testid={testId}>
      <header className="side-head">
        <div className="side-title">
          <b>{title}</b>
          {sub && <small>{sub}</small>}
        </div>
        <span className="sp" />
        <IconButton icon="x" title="Close panel" onClick={() => dispatch({ type: "sidePanel/close" })} />
      </header>
      <div className="side-body">{children}</div>
    </section>
  );
}
