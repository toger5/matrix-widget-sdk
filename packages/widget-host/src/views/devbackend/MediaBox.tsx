/** The media box below the room box, its separator, and the button that opens it (mockup function `mediaBox`). leaves devbackend/media-* */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { MockedRoomData } from "../../appViewModel";
import { useDispatch } from "../env";
import { Icon, IconButton } from "../ui/atoms";

export const MEDIA_SHARE = { min: 0.15, max: 0.8, initial: 0.4, step: 0.05 };
const clamp = (share: number) => Math.round(Math.min(MEDIA_SHARE.max, Math.max(MEDIA_SHARE.min, share)) * 1000) / 1000;

const sizeOf = (bytes: number) => (bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${Math.round(bytes / 1000)} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`);
const nameOf = (m: MockedRoomData["media"][number]) => m.name ?? m.mxcUri.split("/").filter(Boolean).pop() ?? m.mxcUri;
const filesLabel = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

/** Closed: only the button. */
export function MediaButton({ count }: { count: number }) {
  const dispatch = useDispatch();
  return (
    <button type="button" className="media-btn" aria-expanded={false} onClick={() => dispatch({ type: "media/toggleBox" })}>
      <Icon name="image" size={16} />
      <span>Media Backend Tool</span>
      <em>{filesLabel(count)}</em>
      <Icon name="chevRight" size={14} className="end" />
    </button>
  );
}

/** The handle between the room box and the media box. The share is measured against the column both boxes are in. */
export function MediaSeparator({ heightShare }: { heightShare: number }) {
  const dispatch = useDispatch();
  const drag = useRef<{ y: number; share: number; height: number }>(undefined);
  const resize = (share: number) => dispatch({ type: "media/resizeBox", heightShare: clamp(share) });

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
    const next = e.key === "ArrowUp" ? heightShare + MEDIA_SHARE.step : e.key === "ArrowDown" ? heightShare - MEDIA_SHARE.step : e.key === "Home" ? MEDIA_SHARE.min : e.key === "End" ? MEDIA_SHARE.max : e.key === "Enter" ? MEDIA_SHARE.initial : undefined;
    if (next === undefined) return;
    e.preventDefault();
    resize(next);
  };
  return (
    <div
      className="vsplit"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the media box"
      aria-valuenow={Math.round(heightShare * 100)}
      aria-valuemin={MEDIA_SHARE.min * 100}
      aria-valuemax={MEDIA_SHARE.max * 100}
      tabIndex={0}
      title="Drag or use the arrow keys to resize · double click or Enter to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
      onDoubleClick={() => resize(MEDIA_SHARE.initial)}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}

export function MediaBox({ media, heightShare }: { media: MockedRoomData["media"]; heightShare: number }) {
  const dispatch = useDispatch();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = (files: FileList | null) => {
    if (files?.length) dispatch({ type: "media/upload", files: Array.from(files) });
  };

  return (
    <section className="sidebox mediabox" style={{ flex: `0 0 ${clamp(heightShare) * 100}%` }} aria-label="Media" data-testid="devbackend-media">
      <header className="side-head">
        <Icon name="image" size={16} />
        <div className="side-title">
          <b>Media</b>
          <small>shared by all mocked rooms</small>
        </div>
        <span className="sp" />
        <IconButton icon="minus" title="Minimise the media tool" onClick={() => dispatch({ type: "media/toggleBox" })} />
      </header>
      <div className="side-body">
        <input
          ref={input}
          className="vh"
          type="file"
          multiple
          tabIndex={-1}
          aria-label="Upload media files"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={`drop ${over ? "over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={16} />
          <span>
            Drop files or <u>browse</u> to upload
          </span>
        </button>
        <div className="media-list" role="list" aria-label="Media files">
          {media.map((m) => {
            const kind = m.mimetype?.split("/")[0];
            return (
              <div key={m.mxcUri} className="media" role="listitem">
                <span className="thumb">{m.url && kind === "image" ? <img src={m.url} alt="" /> : <Icon name={kind === "audio" ? "audio" : "image"} size={16} />}</span>
                <span className="media-t">
                  <b>{nameOf(m)}</b>
                  <small>
                    {/* TODO-FINDING devbackend-media-uploader-name - `uploadedBy` is a WidgetInstanceId; the mockup shows the widget's name ("by Whiteboard"). The view has no widget names, so it shows the widget key. */}
                    {m.mimetype ?? "unknown type"} · {sizeOf(m.bytes)} · <i>{m.uploadedBy ? `by ${m.uploadedBy.split("|").pop()}` : "uploaded here"}</i>
                  </small>
                  <small className="mono">{m.mxcUri}</small>
                </span>
                <IconButton icon="copy" title="Copy the MXC URI" aria-label={`Copy the MXC URI of ${nameOf(m)}`} className="xs" onClick={() => dispatch({ type: "media/copyMxcUri", mxcUri: m.mxcUri })} />
              </div>
            );
          })}
          {media.length === 0 && <p className="hint center">No media yet.</p>}
        </div>
      </div>
    </section>
  );
}
