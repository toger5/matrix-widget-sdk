import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import type { ModalViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Icon, IconButton, Logo } from "../ui/atoms";

export interface ModalProps {
  modal: ModalViewModel;
  /** Shown in the app info modal. */
  version?: string;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focused element, also inside the app's shadow root (where `document.activeElement` is only the host). */
function activeElementOf(node: Node): Element | null {
  const root = node.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot ? root.activeElement : document.activeElement;
}

// TODO-FINDING info-modal-links - the designed "Documentation" and "Source code" links have no target and the view model has none. These point at the repository of this checkout.
const SOURCE_URL = "https://github.com/toger5/matrix-widget-sdk";
const DOCS_URL = `${SOURCE_URL}#readme`;

/** stories `app-appshell--info-modal`, `app-appshell--confirm`, `app-appshell--room-tools-confirm` (`danger`: the alert icon and a danger button): scrim + dialog, focus trap, Escape closes (modal/close). A confirm dispatches its `intent`, then closes. */
export function Modal({ modal, version = "0.1.0" }: ModalProps) {
  const dispatch = useDispatch();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = () => dispatch({ type: "modal/close" });

  // Focus moves into the dialog (to its safe button) and goes back to where it was on close.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const before = activeElementOf(dialog);
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return e.preventDefault();
    const active = activeElementOf(ref.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (modal.kind === "confirm") {
    return (
      <>
        {/* An alertdialog needs an answer: pressing the scrim does not close it, and does not take the focus out of it (Escape and the focus trap keep working). */}
        <div className="scrim" onMouseDown={(e) => e.preventDefault()} />
        <div ref={ref} className="modal sm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} data-testid="modal">
          <header>
            <Icon name={modal.danger ? "alert" : "cone"} size={22} className={modal.danger ? "danger" : "dev"} />
            <div>
              <h2 id={titleId}>{modal.title}</h2>
            </div>
          </header>
          {/* TODO-FINDING confirm-modal-body-plain - the design emphasises parts of the text (<b>2 room panels</b>); `body` is a plain string, so nothing is bold. */}
          <p>{modal.body}</p>
          <footer>
            <span className="sp" />
            <Button onClick={close} data-autofocus={modal.danger ? true : undefined}>
              Cancel
            </Button>
            <Button
              kind={modal.danger ? "danger" : "primary"}
              data-autofocus={modal.danger ? undefined : true}
              onClick={() => {
                dispatch(modal.intent);
                close();
              }}
            >
              {modal.confirmLabel}
            </Button>
          </footer>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={close} />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} data-testid="modal">
        <header>
          <Logo size={32} />
          <div>
            <h2 id={titleId}>Widget Host</h2>
            {/* TODO-FINDING info-modal-version - neither the version nor the SDK ("matrix-js-sdk" or the rust-sdk player) is in the view model; the text is the design's, with an optional `version` prop. */}
            <small>version {version} · matrix-js-sdk</small>
          </div>
          <span className="sp" />
          <IconButton icon="x" title="Close" onClick={close} />
        </header>
        <p>
          A Matrix client that only does one thing: it opens the <b>widgets</b> of your rooms. Use it to run widgets next to each other, or to develop and debug your own.
        </p>
        <ul className="feat">
          <li>
            <Icon name="grid" size={16} />
            <span>
              <b>Rooms side by side.</b> Every room panel has tabs, one per widget.
            </span>
          </li>
          <li>
            <Icon name="pin" size={16} />
            <span>
              <b>Always on screen.</b> Widgets that ask for it float above everything.
            </span>
          </li>
          <li>
            <Icon name="terminal" size={16} />
            <span>
              <b>Dev tools.</b> See every message of the widget API, per widget.
            </span>
          </li>
          <li>
            <Icon name="cone" size={16} />
            <span>
              <b>DevBackend.</b> Mock rooms in memory and test a widget without a homeserver.
            </span>
          </li>
        </ul>
        <footer>
          <a className="link" href={DOCS_URL} target="_blank" rel="noreferrer">
            Documentation <Icon name="external" size={12} />
          </a>
          <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source code <Icon name="external" size={12} />
          </a>
          <span className="sp" />
          <Button kind="primary" onClick={close} data-autofocus>
            Got it
          </Button>
        </footer>
      </div>
    </>
  );
}
