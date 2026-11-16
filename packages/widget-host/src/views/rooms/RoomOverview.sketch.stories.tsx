import type { Meta, StoryObj } from "@storybook/react-vite";

import { ROOM_DETAILS } from "../fixtures";
import { Avatar, Icon } from "../ui/atoms";

/** Sketches of the RoomOverview: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/Rooms/RoomOverview", tags: ["sketch"], parameters: { size: [900, 330] } };
export default meta;

/**
 * Redraw of the members card of `rooms-roomoverview--plain`: below the first members, a "Show all
 * 12 members" link opens the whole member list. Not built: there is no data and no intent for the
 * full list, so the overview says "The first 6 of 12 members are shown." (finding
 * `overview-show-all-members`: add an intent and a member list view, or drop the link).
 */
export const Plain: StoryObj = {
  render: () => (
    <div className="stage">
      <div className="ov">
        <div className="ov-in">
          <div className="ov-grid">
            <section className="card span">
              <h3>
                <Icon name="users" size={15} />
                Members <em>{ROOM_DETAILS.memberCount}</em>
              </h3>
              <div className="ov-members">
                {(ROOM_DETAILS.members ?? []).map((m) => (
                  <div key={m.userId} className="member">
                    <Avatar name={m.displayName ?? m.userId} id={m.userId} size={30} />
                    <span className="row-main">
                      <b>{m.displayName}</b>
                      <small>{m.userId}</small>
                    </span>
                    {m.role && <span className="pill">{m.role}</span>}
                  </div>
                ))}
              </div>
              <button type="button" className="link">
                Show all {ROOM_DETAILS.memberCount} members
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  ),
};
