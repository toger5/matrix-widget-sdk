import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { SideStage } from "../storyEnv";
import { Avatar, Button, Check, Field, Icon } from "../ui/atoms";

/** Sketches of the Timeline panel of the DevBackendView: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/SidePanel/DevBackendView", tags: ["sketch"], decorators: [SideStage], parameters: { fence: true } };
export default meta;

/** The Timeline panel of the room dev tools, without its bar: the header, then `children` (the panel's body). */
const TimelinePanel = ({ count, children }: { count: string; children: ReactNode }) => (
  <div className="dt rdt dt-left">
    <div className="rdt-main">
      <div className="dt-panels">
        <section className="dt-panel dtp-timeline" aria-label="Timeline">
          <header className="dt-ph">
            <Icon name="message" size={12} />
            <span>Timeline</span>
            <em>{count}</em>
          </header>
          <div className="dt-pb">
            <div className="rdt-body">{children}</div>
          </div>
        </section>
      </div>
    </div>
  </div>
);

/**
 * Redraw of the send form of `sidepanel-devbackendview--timeline`: the "Sender" of a predefined form
 * is a select of the room's members, with their avatars. Not built: it is a text field with the
 * members as suggestions (implementation_findings.md, Trivial: "The sender of the send forms
 * (DevBackend) is a text input with suggestions; the design has a select with an avatar").
 */
export const Timeline: StoryObj = {
  parameters: { size: [348, 200] },
  render: () => (
    <TimelinePanel count="3">
      <section className="rdt-compose open" aria-label="Send event">
        <div className="dt-sub">
          <button type="button" className="dt-disc" aria-expanded>
            <Icon name="chevDown" size={12} />
            <span>Send event</span>
          </button>
        </div>
        <div className="rdt-compose-b">
          <form className="form" aria-label="Send event">
            <Field label="Sender">
              <span className="input sm mono select" role="button" aria-haspopup="listbox">
                <Avatar name="Bob" id="@bob:dev.local" size={14} />
                @bob:dev.local
                <Icon name="chevDown" size={12} />
              </span>
            </Field>
            <Field label="Body">
              <span className="input sm">Can you hear me?</span>
            </Field>
            <div className="inline-row">
              <Check on={false} label="Send delayed" onChange={() => {}} />
              <span>Delayed</span>
              <span className="sp" />
              <Button kind="primary" sm icon="send">
                Send
              </Button>
            </div>
          </form>
        </div>
      </section>
    </TimelinePanel>
  ),
};

/** Events of the Widget lab said in words, as the RoomTimeline describes them. */
const IN_WORDS = [
  { id: "$5", time: "12:04:33", type: "m.room.message", what: "“Can you hear me?”", sender: "@bob" },
  { id: "$4", time: "12:04:31", type: "org.matrix.msc4143.rtc.member", what: "joined · device ALICEDEV", sender: "@alice" },
  { id: "$3", time: "12:03:02", type: "m.sticker", what: "party parrot", sender: "@carol" },
  { id: "$2", time: "12:02:47", type: "m.room.message", what: "“Starting the call now”", sender: "@alice" },
  { id: "$1", time: "12:01:10", type: "m.room.member", what: "joined", sender: "@carol" },
];
const SCHEDULED = [
  { delayId: "d1", type: "m.room.message", due: "3.2 s", what: "“Can you hear me?”" },
  { delayId: "d2", type: "org.matrix.msc4143.rtc.member", due: "7.9 s", what: "leave · scheduled by Element Call" },
];

/**
 * Redraw of "Scheduled" and "Events" of `sidepanel-devbackendview--timeline-delayed` (and of the
 * event list of `sidepanel-roomtoolsview--timeline`), in a wide panel so the rows show what they
 * say: a scheduled row says what it sends (the body of a message; "leave · scheduled by Element
 * Call"), an event row what happened in words, as the RoomTimeline does ("joined · device
 * ALICEDEV", "party parrot"). Not built (implementation_findings.md, Trivial): `ScheduledEvent` has
 * no content, so a row says only "timeline" or its state key; the rows of the list show the generic
 * content preview (`previewOf`), not `describeEvent` of the RoomTimeline.
 */
export const TimelineDelayed: StoryObj = {
  parameters: { size: [640, 300] },
  render: () => (
    <TimelinePanel count="5 · 2 scheduled">
      <div className="rdt-list">
        <div className="dt-sub">
          <span>Scheduled</span>
        </div>
        <div role="list" aria-label="Scheduled events">
          {SCHEDULED.map((s) => (
            <div key={s.delayId} className="msg" role="listitem">
              <div className="msg-h rdt-sched">
                <span className="rdt-due">
                  <Icon name="clock" size={11} />
                  {s.due}
                </span>
                <span className="rdt-t">{s.type}</span>
                <span className="rdt-p">{s.what}</span>
                <span className="rdt-acts">
                  {(
                    [
                      ["send", "Send now"],
                      ["refresh", "Restart"],
                      ["x", "Cancel"],
                    ] as const
                  ).map(([icon, label]) => (
                    <button key={label} type="button" className="dt-ib" title={label} aria-label={label}>
                      <Icon name={icon} size={12} />
                    </button>
                  ))}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="dt-sub">
          <span>Events</span>
        </div>
        <div role="list" aria-label="Timeline events">
          {IN_WORDS.map((r) => (
            <div key={r.id} className="msg" role="listitem">
              <button type="button" className="msg-h" aria-expanded={false}>
                <Icon name="chevRight" size={11} />
                <span className="rdt-t">{r.type}</span>
                <span className="rdt-p">{r.what}</span>
                <span className="rdt-s">
                  {r.sender}
                  <i>:dev.local</i>
                </span>
                <span className="msg-time">{r.time}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </TimelinePanel>
  ),
};
