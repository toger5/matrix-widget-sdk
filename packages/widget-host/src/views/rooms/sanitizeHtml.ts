/**
 * The `formatted_body` of a message, cut down to what the Matrix spec allows (m.room.message, "HTML
 * formatting"), before the RoomTimeline renders it (Element Web's `EventContentBodyView` does not
 * sanitise). Parsed with the browser's `DOMParser`, which runs nothing. Other tags are unwrapped
 * (their text stays), dangerous ones and the reply fallback (`mx-reply`) removed with their
 * content; attributes are dropped except the few below; links only to http(s) and mailto. Images
 * are dropped (an `mxc://` source would need the session).
 */
const TAGS = new Set("font del h1 h2 h3 h4 h5 h6 blockquote p a ul ol sup sub li b i u strong em s code hr br div table thead tbody tr th td caption pre span details summary".split(" "));
const DROP = new Set(["script", "style", "mx-reply", "iframe", "object", "embed", "template", "noscript", "svg", "math", "title", "head"]);
const ATTRS: Record<string, string[]> = { a: ["href"], ol: ["start"], code: ["class"], font: ["color", "data-mx-color", "data-mx-bg-color"], span: ["data-mx-color", "data-mx-bg-color", "data-mx-spoiler"] };

export function sanitizeHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const clean = (parent: Element) => {
    for (const el of [...parent.children]) {
      const tag = el.localName;
      if (DROP.has(tag)) {
        el.remove();
        continue;
      }
      clean(el);
      if (!TAGS.has(tag)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const { name } of [...el.attributes]) if (!ATTRS[tag]?.includes(name)) el.removeAttribute(name);
      if (tag === "a") {
        if (!/^(https?:|mailto:)/i.test(el.getAttribute("href") ?? "")) el.removeAttribute("href");
        else el.setAttribute("target", "_blank"), el.setAttribute("rel", "noreferrer noopener");
      }
      if (tag === "code" && !/^language-[\w-]+$/.test(el.getAttribute("class") ?? "")) el.removeAttribute("class");
    }
  };
  clean(body);
  return body.innerHTML;
}
