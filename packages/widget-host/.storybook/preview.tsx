import type { Decorator, Preview } from "@storybook/react-vite";

import "../src/styles/fonts";
import "./preview.css";
import { StoryEnv, storySize } from "../src/views/storyEnv";

/**
 * Stories render outside the app's shadow root: a `WidgetSlot` shows the fake widget of
 * `ViewEnv.widgetStandIn`, and the stylesheet is a plain document stylesheet (`preview.css`: the
 * app's, plus the mockups' stages and fake widgets). The theme is the toolbar's "Theme" switch (a
 * story pins one with `globals: { theme: "light" }`).
 *
 * `parameters.size: [width, height]` is the size the story is drawn for (default 1280 × 800, a
 * full screen): written to `<html data-story-size="WxH">`, where `e2e/tools/shot.mjs` reads it as
 * the viewport of the screenshot. Decorators that draw a stage of that size use `storySize()`.
 */
const withEnv: Decorator = (Story, context) => {
  const root = document.documentElement;
  root.dataset.theme = String(context.globals.theme ?? "dark");
  const [width, height] = storySize(context.parameters);
  root.dataset.storySize = `${width}x${height}`;
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
