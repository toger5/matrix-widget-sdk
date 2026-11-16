/** The wrapper of the `App/AppShell` and `App/Complete` stories. */
import type { AppViewModel } from "../../appViewModel";
import { AppShell } from "./AppShell";

/**
 * The app shell filling the story, drawn in the theme of the story (`globals.theme`: the toolbar's
 * switch, or the theme a story pins) instead of the system's; the Settings keep their choice.
 */
export function Screen({ vm, theme }: { vm: AppViewModel; theme: unknown }) {
  return (
    <div style={{ height: "100vh" }}>
      <AppShell vm={vm} storyTheme={theme === "light" ? "light" : "dark"} />
    </div>
  );
}
