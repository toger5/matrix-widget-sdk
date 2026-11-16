import type { Meta, StoryObj } from "@storybook/react-vite";

import { SideStage } from "../storyEnv";
import { Avatar, Button, Field, Icon, Toggle } from "../ui/atoms";
import { Sub } from "./parts";

/** Sketches of the Timeline section of the DevBackendView: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/SidePanel/DevBackendView", tags: ["sketch"], decorators: [SideStage], parameters: { fence: true } };
export default meta;

/**
 * Redraw of the send form of `sidepanel-devbackendview--timeline`: the "Sender" of a predefined form
 * is a select of the room's members, with their avatars. Not built: it is a text field with the
 * members as suggestions (implementation_findings.md, Trivial: "The sender of the send forms
 * (DevBackend) is a text input with suggestions; the design has a select with an avatar").
 */
export const Timeline: StoryObj = {
  parameters: { size: [348, 250] },
  render: () => (
    <section className="sidebox devb">
      <div className="acc-sec-b">
        <Sub title="Send event" />
        <div className="form">
          <Field label="Sender">
            <span className="input select" role="button" aria-haspopup="listbox">
              <Avatar name="Bob" id="@bob:dev.local" size={16} />
              @bob:dev.local
              <Icon name="chevDown" size={14} />
            </span>
          </Field>
          <Field label="Body">
            <span className="input">Can you hear me?</span>
          </Field>
          <div className="inline-row">
            <Toggle on={false} label="Send delayed" onChange={() => {}} />
            <span>Delayed</span>
            <span className="sp" />
            <Button kind="primary" sm icon="send">
              Send
            </Button>
          </div>
        </div>
      </div>
    </section>
  ),
};

/** A scheduled (delayed) event: type, countdown, what it sends. */
function ScheduledRow({ type, due, preview }: { type: string; due: string; preview: string }) {
  return (
    <div className="ev sched">
      <span className="mono ev-t">{type}</span>
      <span className="ev-time">
        <Icon name="clock" size={11} /> {due}
      </span>
      <span className="ev-p">{preview}</span>
      <span className="ev-acts">
        <Button sm>Send now</Button>
        <Button sm>Restart</Button>
        <Button sm>Cancel</Button>
      </span>
    </div>
  );
}

/** An event of the list: type, time, what happened in words, sender. */
function EventRow({ type, time, what, sender }: { type: string; time: string; what: string; sender: string }) {
  return (
    <div className="ev">
      <span className="mono ev-t">{type}</span>
      <span className="ev-time">{time}</span>
      <span className="ev-p">{what}</span>
      <span className="ev-s">{sender}</span>
    </div>
  );
}

/**
 * Redraw of "Scheduled" and "Events" of `sidepanel-devbackendview--timeline-delayed` (and of the
 * event list of `sidepanel-roomtoolsview--timeline`): a scheduled row says what it sends (the body
 * of a message; "leave · scheduled by Element Call"), and an event row says what happened in words,
 * as the RoomTimeline does ("joined · device ALICEDEV", "party parrot"). Not built
 * (implementation_findings.md, Trivial): `ScheduledEvent` has no content, so a row says only
 * "timeline" or its state key; the rows of the list show the generic content preview (`previewOf`),
 * not `describeEvent` of the RoomTimeline.
 */
export const TimelineDelayed: StoryObj = {
  parameters: { size: [348, 560] },
  render: () => (
    <section className="sidebox devb">
      <div className="acc-sec-b">
        <Sub title="Scheduled">
          <em className="count">2</em>
        </Sub>
        <div className="ev-list">
          <ScheduledRow type="m.room.message" due="in 3.2 s" preview="“Can you hear me?”" />
          <ScheduledRow type="org.matrix.msc4143.rtc.member" due="in 7.9 s" preview="leave · scheduled by Element Call" />
        </div>
        <Sub title="Events">
          <em className="count">5 of 128</em>
        </Sub>
        <div className="ev-list">
          <EventRow type="m.room.message" time="12:04:33" what="“Can you hear me?”" sender="@bob:dev.local" />
          <EventRow type="org.matrix.msc4143.rtc.member" time="12:04:31" what="joined · device ALICEDEV" sender="@alice:dev.local" />
          <EventRow type="m.sticker" time="12:03:02" what="party parrot" sender="@carol:dev.local" />
          <EventRow type="m.room.message" time="12:02:47" what="“Starting the call now”" sender="@alice:dev.local" />
          <EventRow type="m.room.member" time="12:01:10" what="joined" sender="@carol:dev.local" />
        </div>
      </div>
    </section>
  ),
};
