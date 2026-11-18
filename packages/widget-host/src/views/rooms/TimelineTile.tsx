/**
 * One event of the RoomTimeline, drawn like Element Web draws it, with its shared components: the
 * sender's avatar and name, the time, the body (text, image, undecryptable, deleted) and the
 * reactions as buttons below it. For debugging: the event type at the end of the line opens its
 * JSON (a state or other event is one line that does). The view models of the shared views are
 * fixed snapshots of the `TimelineRow`.
 */
import {
  DecryptionFailureBodyView,
  DisambiguatedProfileView,
  EventContentBodyView,
  EventTileView,
  ImageBodyView,
  MemberAvatarView,
  MessageTimestampView,
  ReactionsRowButtonView,
  ReactionsRowView,
  RedactedBodyView,
  TextualBodyView,
  type DecryptionFailureReason,
  type ImageBodyViewState,
  type TextualBodyViewKind,
  type ViewModel,
} from "@element-hq/web-shared-components";
import { memo, useEffect, useState } from "react";

import type { TimelineBody, TimelineReaction, TimelineRow } from "../../session";
import { useViewEnv } from "../env";
import { Icon, Json } from "../ui/atoms";
import { describeEvent, timeLabel } from "./eventText";
import { sanitizeHtml } from "./sanitizeHtml";

/** A view model of a shared view that never changes: `snapshot`, plus its `actions`. */
const fixed = <S, A extends object = object>(snapshot: S, actions?: A) => ({ ...actions, getSnapshot: () => snapshot, subscribe: () => () => {} }) as unknown as ViewModel<S> & A;

/** What `load` resolves to (a media URL), once it has; `null` when it could not. Loaded again when `key` changes. */
function useLoaded(key: unknown, load: (() => Promise<string | undefined>) | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null>();
  useEffect(() => {
    let cancelled = false;
    void load?.().then((u) => !cancelled && setUrl(u ?? null));
    return () => void (cancelled = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is new on every render, `key` names what it loads
  }, [key]);
  return url;
}

/** One of Compound's six decorative colours per user, as Element Web colours sender names. */
function colorClass(userId: string): string {
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return `tl-c${(Math.abs(hash) % 6) + 1}`;
}

const SENT_AT = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "medium" });

export interface TimelineTileProps {
  rowKey: string;
  row: TimelineRow;
  /** Same sender as the tile before: no avatar and name. */
  continuation: boolean;
  /** The event's JSON is shown. */
  open: boolean;
  onToggle: (key: string) => void;
}

export const TimelineTile = memo(function TimelineTile({ rowKey, row, continuation, open, onToggle }: TimelineTileProps) {
  const { avatar } = useViewEnv();
  const avatarUrl = useLoaded(row.avatar, row.avatar ? () => avatar(row.avatar!) : undefined);
  const json = row.json();
  const info = row.body.kind === "event";
  const said = info && json ? describeEvent(json) : undefined;
  const type = json ? String(json.type) : "";
  const toggle = (
    <button type="button" className="tl-json mono" aria-expanded={open} title={open ? "Hide the event's JSON" : "Show the event's JSON"} onClick={() => onToggle(rowKey)}>
      {type || "local echo"}
    </button>
  );
  const name = row.name ?? row.sender;
  return (
    <EventTileView
      root={{
        id: `tl-${rowKey}`,
        as: "div",
        eventId: typeof json?.event_id === "string" ? json.event_id : undefined,
        shape: "Room",
        state: { isOwnEvent: false, hasReply: false, info, continuation, encryptionFailure: row.body.kind === "utd" },
      }}
      classNames={{ root: `tl-tile ${said?.state ? "state" : ""} ${open ? "open" : ""}`, slotTimestamp: "tl-ts" }}
      slots={{
        avatar: continuation || info ? undefined : <MemberAvatarView vm={fixed({ id: row.sender, name, url: avatarUrl ?? undefined, size: "30px" })} />,
        sender: continuation || info ? undefined : <DisambiguatedProfileView vm={fixed({ displayName: name, colorClass: colorClass(row.sender), title: row.sender, emphasizeDisplayName: true })} />,
        timestamp: <MessageTimestampView vm={fixed({ ts: timeLabel(row.ts).slice(0, 5), tsSentAt: SENT_AT.format(row.ts) })} />,
        body: (
          <div className="tl-body">
            {said ? (
              <button type="button" className="tl-h" aria-expanded={open} onClick={() => onToggle(rowKey)}>
                <span className="tl-p">
                  {said.icon && <Icon name={said.icon} size={13} />}
                  <span className={said.mono ? "mono" : ""}>
                    {name} {said.text}
                  </span>
                </span>
                <span className="mono tl-t">{type}</span>
              </button>
            ) : (
              <div className="tl-msg">
                <Body body={row.body} />
                {toggle}
              </div>
            )}
            {open && (
              <pre className="code">
                <Json value={json ?? null} />
              </pre>
            )}
          </div>
        ),
        footer: row.reactions.length > 0 ? <Reactions reactions={row.reactions} toggle={row.toggleReaction} /> : undefined,
        receipt: row.sendState && row.sendState !== "sent" ? <span className="tl-send">{row.sendState}</span> : undefined,
      }}
    />
  );
});

/** A message, an image, an undecryptable or a deleted event, with the shared body views. */
function Body({ body }: { body: TimelineBody }) {
  const src = useLoaded(body, body.kind === "image" ? body.load : undefined);
  switch (body.kind) {
    case "text":
      return (
        <TextualBodyView
          vm={fixed({ kind: "TEXT" as TextualBodyViewKind, showEditedMarker: body.edited, editedMarkerText: "(edited)", editedMarkerTooltip: "Edited" })}
          body={<EventContentBodyView as="div" vm={fixed({ body: body.text, formattedBody: body.html === undefined ? undefined : sanitizeHtml(body.html), className: "tl-text" })} />}
        />
      );
    case "image": {
      const state = (src === null ? "ERROR" : "READY") as ImageBodyViewState;
      const ratio = body.width && body.height ? body.width / body.height : undefined;
      return (
        <ImageBodyView
          vm={fixed({ state, src: src ?? undefined, thumbnailSrc: src ?? undefined, alt: body.caption, errorLabel: "The image could not be loaded", maxWidth: 320, maxHeight: 240, aspectRatio: ratio })}
        />
      );
    }
    case "utd":
      return <DecryptionFailureBodyView vm={fixed({ decryptionFailureReason: (body.reason ?? "UNABLE_TO_DECRYPT") as DecryptionFailureReason })} />;
    case "redacted":
      return <RedactedBodyView vm={fixed({ text: "Message deleted", tooltip: body.reason ? `Reason: ${body.reason}` : undefined })} />;
    case "event":
      return null;
  }
}

/** The reactions below an event, one button per key; pressing one adds or takes back the account's reaction. */
function Reactions({ reactions, toggle }: { reactions: TimelineReaction[]; toggle?: (key: string) => void }) {
  return (
    <ReactionsRowView vm={fixed({ ariaLabel: "Reactions", isVisible: true, addReactionButtonLabel: "React", showAddReactionButton: false })}>
      {reactions.map(({ key, senders, mine }) => (
        <ReactionsRowButtonView
          key={key}
          vm={fixed(
            {
              content: key,
              count: senders.length,
              isSelected: mine,
              isDisabled: !toggle,
              "aria-label": `${key}, ${senders.length === 1 ? "1 reaction" : `${senders.length} reactions`}`,
              tooltipVm: fixed({ formattedSenders: senders.join(", "), caption: key }),
            },
            { onClick: () => toggle?.(key) },
          )}
        />
      ))}
    </ReactionsRowView>
  );
}
