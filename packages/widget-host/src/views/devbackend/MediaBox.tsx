/** The content of the Media Backend Tool (mockup function `mediaBox`). leaf devbackend/media-open */
import { useRef, useState } from "react";

import type { MockedRoomData } from "../../appViewModel";
import { useDispatch } from "../env";
import { Icon, IconButton } from "../ui/atoms";
import { ToolBox } from "./ToolBox";

const sizeOf = (bytes: number) => (bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${Math.round(bytes / 1000)} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`);
const nameOf = (m: MockedRoomData["media"][number]) => m.name ?? m.mxcUri.split("/").filter(Boolean).pop() ?? m.mxcUri;
export const filesLabel = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

export function MediaBox({ media, heightShare }: { media: MockedRoomData["media"]; heightShare: number }) {
  const dispatch = useDispatch();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = (files: FileList | null) => {
    if (files?.length) dispatch({ type: "media/upload", files: Array.from(files) });
  };

  return (
    <ToolBox tool="media" heightShare={heightShare} className="mediabox">
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
    </ToolBox>
  );
}
