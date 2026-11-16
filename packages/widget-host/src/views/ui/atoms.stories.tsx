import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar, Button, DevAvatar, Icon, IconButton, Logo, Toggle } from "./atoms";
import { ICONS, type IconName } from "./icons";

const meta: Meta = { title: "UI/Atoms" };
export default meta;

export const Atoms: StoryObj = {
  render: () => (
    <div style={{ padding: 24, display: "grid", gap: 16, justifyItems: "start" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Logo size={32} />
        <Avatar name="Ada Okafor" />
        <Avatar name="Design crit" square />
        <DevAvatar />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button kind="primary" icon="plus">
          Primary
        </Button>
        <Button end="arrowRight">Default</Button>
        <Button sm>Small</Button>
        <IconButton icon="x" title="Close" />
        <Toggle on label="Example" onChange={() => {}} />
        <Toggle on={false} label="Example" onChange={() => {}} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 480 }}>
        {(Object.keys(ICONS) as IconName[]).map((name) => (
          <span key={name} title={name}>
            <Icon name={name} />
          </span>
        ))}
      </div>
    </div>
  ),
};
