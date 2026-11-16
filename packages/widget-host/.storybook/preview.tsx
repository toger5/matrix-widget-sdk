import type { Decorator, Preview } from "@storybook/react-vite";

import "../src/styles/fonts";
import "../src/styles/app.css";
import { StoryEnv } from "../src/views/storyEnv";

/**
 * Stories render outside the app's shadow root: a `WidgetSlot` shows its stand-in children, and
 * the stylesheet is a plain document stylesheet. The theme is the toolbar's "Theme" switch.
 */
const withEnv: Decorator = (Story, context) => {
  document.documentElement.dataset.theme = String(context.globals.theme ?? "dark");
  return (
    <StoryEnv>
      <Story />
    </StoryEnv>
  );
};

const preview: Preview = {
  decorators: [withEnv],
  parameters: { layout: "fullscreen" },
  globalTypes: {
    theme: { description: "Color theme", toolbar: { title: "Theme", items: ["dark", "light"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "dark" },
};
export default preview;
