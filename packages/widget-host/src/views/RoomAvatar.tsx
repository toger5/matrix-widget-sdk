import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { LiveSession, RoomSummary } from "../session";

/** A hue that stays the same for a room, for the placeholder shown instead of a missing avatar. */
function hue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}

/** The first letter of the name, ignoring a leading sigil like the `#` of an alias. */
const initial = (name: string) => Array.from(name.replace(/^[#!@\s]+/, ""))[0]?.toUpperCase() ?? "?";

/** The avatar of a room: its image once that is downloaded, a coloured initial until then and without one. */
export function RoomAvatar({ session, room }: { session: LiveSession; room: RoomSummary }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ avatarUrl: string; src: string }>();
  const { avatarUrl } = room;

  // Download only once the row is scrolled into view: an account can have hundreds of rooms.
  useEffect(() => {
    if (!avatarUrl || !ref.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void session.avatar(avatarUrl).then((src) => !cancelled && src && setLoaded({ avatarUrl, src }));
    });
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [session, avatarUrl]);

  const src = loaded && loaded.avatarUrl === avatarUrl ? loaded.src : undefined;
  return (
    <span ref={ref} className="avatar" style={{ "--hue": hue(room.id) } as CSSProperties} aria-hidden>
      {src ? <img src={src} alt="" /> : initial(room.name)}
    </span>
  );
}
