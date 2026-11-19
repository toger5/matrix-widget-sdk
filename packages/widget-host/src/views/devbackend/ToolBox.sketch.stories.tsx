import type { Meta, StoryObj } from "@storybook/react-vite";

import { MOCKED_ROOM_DATA } from "../fixtures";
import { SideStage } from "../storyEnv";
import { Avatar, Button, Check, Field, Icon, IconButton } from "../ui/atoms";
import { timeOf } from "./parts";

/** Sketches of the tool boxes of the DevBackendView: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/SidePanel/DevBackendView/Tools", tags: ["sketch"], decorators: [SideStage], parameters: { size: [348, 500], fence: true } };
export default meta;

/**
 * Redraw of `sidepanel-devbackendview-tools--to-device`: the to-device form with one "Sender" select
 * (a member's avatar, user ID and device) instead of the two text fields "User ID" and "Device ID".
 * Not built: `ToDeviceMessage` has a user and a device without saying whose they are, so the form
 * has separate fields (finding `devbackend-todevice-sender`: a select, or separate fields).
 */
export const ToDevice: StoryObj = {
  render: () => (
    <section className="sidebox toolbox rdt-toolbox devb" aria-label="Client backend" data-testid="devbackend-client">
      <div className="dt">
        <header className="dt-ph">
          <Icon name="monitor" size={12} />
          <span>Client backend</span>
          <em>all mocked rooms</em>
          <span className="sp" />
          <IconButton icon="minus" title="Minimise the client backend tool" className="xs" />
        </header>
        <div className="rdt-tool-b">
          <div className="dt-sub">
            <button type="button" className="dt-disc" aria-expanded={false}>
              <Icon name="chevRight" size={12} />
              <span>Widget host behavior</span>
            </button>
          </div>
          <div className="dt-sub">
            <button type="button" className="dt-disc" aria-expanded>
              <Icon name="chevDown" size={12} />
              <span>To-device messages</span>
            </button>
            <em>{MOCKED_ROOM_DATA.toDevice.length}</em>
          </div>
          <form className="form" aria-label="Send to-device message">
            <Field label="Type">
              <span className="input sm mono">org.matrix.msc4143.rtc.encryption_keys</span>
            </Field>
            <Field label="Sender">
              <span className="input sm mono select" role="button" aria-haspopup="listbox">
                <Avatar name="Bob" id="@bob:dev.local" size={14} />
                @bob:dev.local · BOBDEV
                <Icon name="chevDown" size={12} />
              </span>
            </Field>
            <pre className="code edit">{JSON.stringify({ keys: [{ index: 0, key: "c2VjcmV0" }] }, null, 2)}</pre>
            <div className="inline-row">
              <Check on label="Mark as encrypted" onChange={() => {}} />
              <span>Encrypted</span>
              <span className="sp" />
              <Button kind="primary" sm icon="send">
                Send
              </Button>
            </div>
          </form>
          <div role="list" aria-label="To-device messages">
            {MOCKED_ROOM_DATA.toDevice.map((m, i) => (
              <div key={i} className="msg" role="listitem">
                <button type="button" className="msg-h" aria-expanded={false}>
                  <Icon name="chevRight" size={11} />
                  <span className={`msg-dir ${m.direction === "fromWidget" ? "from" : "to"}`}>{m.direction === "fromWidget" ? "W→H" : "H→W"}</span>
                  <span className="rdt-t">{m.type}</span>
                  <span className="rdt-s" title={`${m.userId} · ${m.deviceId}`}>
                    {m.userId.split(":")[0]}
                  </span>
                  {m.encrypted && <Icon name="lock" size={11} />}
                  <span className="msg-time">{timeOf(m.timestamp)}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  ),
};
