import type { Meta, StoryObj } from "@storybook/react-vite";

import { SideStage } from "../storyEnv";
import { Avatar, Button, Field, Icon, Toggle } from "../ui/atoms";
import { Sub } from "./parts";

/** Sketches of the tool boxes of the DevBackendView: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/SidePanel/DevBackendView/Tools", tags: ["sketch"], decorators: [SideStage], parameters: { size: [348, 400], fence: true } };
export default meta;

/**
 * Redraw of the to-device form of `sidepanel-devbackendview-tools--to-device`: one "Sender" select
 * (a member's avatar, user ID and device) instead of the two text fields "User ID" and "Device ID".
 * Not built: `ToDeviceMessage` has a user and a device without saying whose they are, so the form
 * has separate fields (finding `devbackend-todevice-sender`: a select, or separate fields).
 */
export const ToDevice: StoryObj = {
  render: () => (
    <section className="sidebox devb">
      <div className="acc-sec-b">
        <Sub title="Send to the widget's device" />
        <div className="form">
          <Field label="Type">
            <span className="input mono">org.matrix.msc4143.rtc.encryption_keys</span>
          </Field>
          <Field label="Sender">
            <span className="input select" role="button" aria-haspopup="listbox">
              <Avatar name="Bob" id="@bob:dev.local" size={16} />
              @bob:dev.local · BOBDEV
              <Icon name="chevDown" size={14} />
            </span>
          </Field>
          <pre className="code edit">{JSON.stringify({ keys: [{ index: 0, key: "c2VjcmV0" }] }, null, 2)}</pre>
          <div className="inline-row">
            <Toggle on label="Mark as encrypted" onChange={() => {}} />
            <span>Mark as encrypted</span>
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
