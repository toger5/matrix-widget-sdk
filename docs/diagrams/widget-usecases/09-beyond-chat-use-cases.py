"""Generates 09-beyond-chat-use-cases.svg (see 09-beyond-chat-use-cases.md).

The use cases come from the widget clinic meeting on 2026-10-27 (see README.md), sorted into the
grid of 08-extending-matrix.svg, each with its ideal technical solution.

Usage: python3 docs/diagrams/widget-usecases/09-beyond-chat-use-cases.py [output.svg]
Without an argument the SVG next to this script is overwritten.
"""
import sys
import textwrap
from html import escape
from pathlib import Path

OUT = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).with_suffix(".svg"))
W = 1540

FAM = {
    "client": ("#1d4ed8", "#dbeafe"),
    "widget": ("#6d28d9", "#ede9fe"),
    "a2ui":   ("#0f766e", "#ccfbf1"),
    "bot":    ("#c2410c", "#ffedd5"),
}
WIDGET_BAND = ("#8b5cf6", "#f5f3ff")

ICONS = {
    "laptop": '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    "window": '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>'
              '<path d="M10 12.5l-2.5 2.5 2.5 2.5M14 12.5l2.5 2.5-2.5 2.5"/>',
    "blocks": '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/>'
              '<rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    "cpu":    '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/>'
              '<path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    "robot":  '<rect x="4" y="8" width="16" height="12" rx="3"/><line x1="12" y1="4" x2="12" y2="8"/>'
              '<circle cx="12" cy="3" r="1.3"/><circle cx="9" cy="13.5" r="1.3"/><circle cx="15" cy="13.5" r="1.3"/>'
              '<line x1="9.5" y1="17" x2="14.5" y2="17"/>',
    "puzzle": '<path d="M4 7h4a2.2 2.2 0 1 1 4.4 0H17v4.6a2.2 2.2 0 1 1 0 4.4V20h-4.6a2.2 2.2 0 1 0-4.4 0H4v-4a2.2 2.2 0 1 0 0-4.4z"/>',
    "cloud":  '<path d="M7 19h10.5a4.5 4.5 0 0 0 .5-9 6.5 6.5 0 0 0-12.6 1.7A3.7 3.7 0 0 0 7 19z"/>',
    "mx":     '<path d="M6 3H3v18h3M18 3h3v18h-3"/><path d="M7.5 16v-7M7.5 11a2.2 2.2 0 0 1 4.5 0v5M12 11a2.2 2.2 0 0 1 4.5 0v5"/>',
    "person": '<circle cx="12" cy="7.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    "group":  '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>'
              '<circle cx="17" cy="9" r="3"/><path d="M15.5 14.3A5.5 5.5 0 0 1 22 19.5"/>',
    "help":   '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r="0.6"/>',
}

# name, family, icons; widget = built on Iframe + Widget API
SOL = {
    "native":   ("Native client impl", "client", ["laptop"], False),
    "module":   ("Module for specific client", "client", ["puzzle"], False),
    "iframe":   ("Iframe + Widget API", "widget", ["window"], True),
    "a2ui":     ("A2UI + wasm + Widget API", "a2ui", ["blocks", "cpu"], False),
    "bot":      ("Bot", "bot", ["robot"], False),
    "bot_a2ui": ("Bot + A2UI", "a2ui", ["robot", "blocks"], False),
    "bot_iframe": ("Bot + Iframe + Widget API", "widget", ["robot", "window"], True),
}

# Groups whose apps can be built on Iframe + Widget API just as well get an "or" pill.
ALT_IFRAME = ["iframe"]

# ---- the sorting ----------------------------------------------------------------------------
# Each cell: a list of groups. A group is (solution, note, [use cases]) or
# (solution, note, [alternative solutions], [use cases]).
CELLS = {
    (0, 0): [
        ("native", "", ["module"], ["Full text search", "Matrix-backed calendar view (all rooms)"]),
    ],
    (0, 1): [
        ("iframe", "", ["Shared text editor (HedgeDoc, Etherpad)", "Whiteboard (Neoboard)",
                        "Games (FloorItIpsum, Flappy Royal)", "Kanban", "Shared route planner", "Barcamp planning",
                        "WebXDC apps (bridged)", "PDF signature tool"]),
        ("a2ui", "", ALT_IFRAME, ["Polls (NeoChoice)", "Meeting finder (NeoDateFix)", "To-do list (UltimateList)",
                                  "Pack list", "Expense sharing", "Shared travel itinerary", "Forms (FHIR)",
                                  "Matrix conference browser", "Shared room data renderer",
                                  "Renderer for custom event data", "Local per-room LLM integration",
                                  "Room devtools"]),
        ("native", "", ["module"], ["Calendar events in the room", "Time zone resolver"]),
    ],
    (1, 0): [
        ("native", "", ["Translation", "Send enhanced / rich messages (e.g. auto-populated weather data)",
                        "Calendar view from an external service"]),
        ("module", "", ["Local per-user-account LLM integrations"]),
    ],
    (1, 1): [
        ("iframe", "hybrid: Matrix for membership + MatrixRTC, own server for the rest",
         ["WorkAdventure (2D world)", "Video calls (BigBlueButton)"]),
        ("bot", "", ["bot_a2ui", "bot_iframe"], ["Hookshot", "Jira / GitHub management", "Approvals, Zapier-like workflows",
                          "Lab equipment control", "UI for bots and external services"]),
    ],
}

RH_X, RH_W = 40, 230
C1_X, C2_X, CW = 285, 900, 600

out = []
add = out.append


def icon(name, x, y, color, size=20, sw=2):
    s = size / 24
    add(f'<g transform="translate({x},{y}) scale({s})" fill="none" stroke="{color}" stroke-width="{sw}" '
        f'stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>')


def text(x, y, s, cls="", extra=""):
    # Colours go into `style`: a presentation attribute would lose against the `text` CSS rule.
    extra = extra.replace('fill="', 'style="fill:')
    add(f'<text x="{x}" y="{y}" class="{cls}" {extra}>{escape(s)}</text>')


def pill_width(key):
    name, _, icons, _ = SOL[key]
    return 12 + 24 * len(icons) + 4 + 7.3 * len(name) + 14


def pill(key, x, y):
    name, fam, icons, _ = SOL[key]
    color, tint = FAM[fam]
    w = pill_width(key)
    add(f'<rect x="{x}" y="{y}" width="{w}" height="32" rx="16" fill="{tint}" stroke="{color}" stroke-width="1.5"/>')
    ix = x + 12
    for i in icons:
        icon(i, ix, y + 6, color)
        ix += 24
    text(ix + 4, y + 21, name, "chip", f'fill="{color}"')
    return w


def chip_width(label):
    return 6.6 * len(label) + 20


def flow(labels, x0, x1):
    """Positions (x, line) of use case chips flowed from x0 to x1."""
    pos, x, line = [], x0, 0
    for label in labels:
        w = chip_width(label)
        if x + w > x1 and x > x0:
            x, line = x0, line + 1
        pos.append((x, line))
        x += w + 8
    return pos, line + 1


def group(cx, gy, g, draw):
    """Lay out one group at `gy`; returns its height. Draws only when `draw`."""
    if len(g) == 4:
        key, note, alts, cases = g
    else:
        (key, note, cases), alts = g, []
    pos, lines = flow(cases, cx + 26, cx + CW - 16)
    h = 44 + lines * 32
    if draw:
        if SOL[key][3] or any(SOL[a][3] for a in alts):
            # Dashed when Iframe + Widget API is the alternative rather than the first choice.
            dash = "" if SOL[key][3] else ' stroke-dasharray="6 4"'
            add(f'<rect x="{cx + 8}" y="{gy}" width="{CW - 16}" height="{h}" rx="10" '
                f'fill="{WIDGET_BAND[1]}" stroke="{WIDGET_BAND[0]}" stroke-width="1.6"{dash}/>')
        w = pill(key, cx + 16, gy + 6)
        for alt in alts:
            text(cx + 16 + w + 10, gy + 27, "or", "h3", 'fill="#4b5563"')
            w += 34 + pill(alt, cx + 16 + w + 34, gy + 6)
        if note:
            text(cx + 16 + w + 12, gy + 27, note, "s", 'font-style="italic"')
        for label, (x, line) in zip(cases, pos):
            y = gy + 46 + line * 32
            add(f'<rect x="{x}" y="{y}" width="{chip_width(label)}" height="24" rx="12" fill="#ffffff" stroke="#9ca3af"/>')
            text(x + 10, y + 16.5, label, "case")
    return h


def cell_height(cell):
    return sum(group(0, 0, g, False) + 10 for g in cell) + 18


# ---- header ---------------------------------------------------------------------------------
text(40, 48, "Beyond chat use cases: where they belong and what solves them best", "h1")
text(40, 76, "Each cell names the ideal solution and the use cases it fits. Solutions and their trade-offs: "
             "see 08-extending-matrix.svg.", "b")
text(40, 96, "Highlighted: use cases solved with Iframe + Widget API.", "b", 'fill="#6d28d9" font-weight="700"')

HEAD_Y, HEAD_H = 116, 70
add(f'<rect x="{C1_X}" y="{HEAD_Y}" width="{CW}" height="{HEAD_H}" rx="12" fill="#f1f5f9" stroke="#64748b" stroke-width="1.5"/>')
icon("person", C1_X + 18, HEAD_Y + 14, "#334155", 26)
text(C1_X + 54, HEAD_Y + 34, "Just for the active user", "h2")
text(C1_X + 54, HEAD_Y + 55, "Others may see something different or nothing.", "s")
add(f'<rect x="{C2_X}" y="{HEAD_Y}" width="{CW}" height="{HEAD_H}" rx="12" fill="#dcfce7" stroke="#15803d" stroke-width="1.5"/>')
icon("group", C2_X + 18, HEAD_Y + 14, "#15803d", 26)
text(C2_X + 54, HEAD_Y + 34, "Same experience for anyone in one Matrix room", "h2", 'fill="#14532d"')
text(C2_X + 54, HEAD_Y + 55, "Only the room guarantees that every member sees the same thing.", "s", 'fill="#166534"')

ROWS = [("mx", "Matrix as the backend is enough", []),
        ("cloud", "External backend", ["Weaker integration, more work", "to set up, less secure."])]

y = HEAD_Y + HEAD_H + 12
for r, (row_icon, label, note) in enumerate(ROWS):
    h = max(cell_height(CELLS[(r, 0)]), cell_height(CELLS[(r, 1)]))
    add(f'<rect x="{RH_X}" y="{y}" width="{RH_W}" height="{h}" rx="12" fill="#f9fafb" stroke="#9ca3af"/>')
    icon(row_icon, RH_X + 16, y + 18, "#374151", 26)
    for k, line in enumerate(textwrap.wrap(label, 20)):
        text(RH_X + 16, y + 70 + k * 20, line, "h2")
    for k, line in enumerate(note):
        text(RH_X + 16, y + 118 + k * 17, line, "s")
    for c, (cx, fill, stroke) in enumerate([(C1_X, "#ffffff", "#cbd5e1"), (C2_X, "#f7fef9", "#86efac")]):
        add(f'<rect x="{cx}" y="{y}" width="{CW}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}"/>')
        gy = y + 12
        for g in CELLS[(r, c)]:
            gy += group(cx, gy, g, True) + 10
    y += h + 10

# ---- takeaway -------------------------------------------------------------------------------
FAM_OF = {key: sol[1] for key, sol in SOL.items()}


def count(cells, pred):
    n = 0
    for cell in cells:
        for g in cell:
            if pred(g[0]):
                n += len(g[-1])
    return n


room_cells = [CELLS[(0, 1)], CELLS[(1, 1)]]
room_total = count(room_cells, lambda k: True)
room_widget = count(room_cells, lambda k: SOL[k][3])
# Use cases whose first choice is not the Widget API, but which list it as an alternative.
room_alt = sum(len(g[-1]) for cell in room_cells for g in cell
               if len(g) == 4 and not SOL[g[0]][3] and any(SOL[a][3] for a in g[2]))
room_client = count(room_cells, lambda k: FAM_OF[k] == "client")
user_total = count([CELLS[(0, 0)], CELLS[(1, 0)]], lambda k: True)

box_h = 108
add(f'<rect x="{RH_X}" y="{y + 4}" width="{RH_W}" height="{box_h}" rx="12" fill="#f9fafb" stroke="#9ca3af"/>')
text(RH_X + 16, y + 32, "Takeaway", "h2")
text(RH_X + 16, y + 54, f"{user_total + room_total} use cases from the", "s")
text(RH_X + 16, y + 71, "widget clinic meeting.", "s")
TAKEAWAYS = [
    (C1_X, "client", f"{user_total} are personal: build them into the client",
     "Almost all of them fit best as native client features or modules. Their functionality does not rely "
     "on every room member having access to them, so they need neither support in all clients nor a "
     "cross-client widget."),
    (C2_X, "widget", f"{room_total} are room features: {room_widget} of them on Iframe + Widget API",
     f"Another {room_alt} (polls, lists, forms, renderers, bot workflows, ...) use A2UI or a bot, but can be "
     f"built on Iframe + Widget API too. {room_client} (calendar events, time zone resolver) are best built into the client."),
]
for bx, fam, title, body in TAKEAWAYS:
    color, tint = FAM[fam]
    add(f'<rect x="{bx}" y="{y + 4}" width="{CW}" height="{box_h}" rx="12" fill="{color}"/>')
    text(bx + 20, y + 34, title, "h2", 'fill="#ffffff"')
    for k, line in enumerate(textwrap.wrap(body, 84)):
        text(bx + 20, y + 58 + k * 17, line, "b", f'fill="{tint}"')
y += box_h + 4

# ---- open questions -------------------------------------------------------------------------
oy = y + 60
add(f'<line x1="{RH_X}" y1="{oy - 30}" x2="{C2_X + CW}" y2="{oy - 30}" stroke="#e5e7eb"/>')
text(RH_X, oy, "Open questions (follow-up MSCs)", "h2")
text(RH_X + 290, oy, "Topics that need a decision beyond picking one of the solutions above.", "s")
QUESTIONS = [
    ("Layout of beyond-chat content",
     "How much control over the layout of beyond-chat content should the client developer own, and how much "
     "the Matrix spec? Example: cross-client layout sharing, where a moderator sets a layout (timeline in the "
     "centre, widget X left, widget Y right) and users opt in."),
    ("Widget discovery",
     "How do users find and add widgets (widget browser, Modular integration manager)? The one case where a "
     "client-wide widget makes sense, but it is tricky security-wise, so a custom client may fit best. Long "
     "term: a specced discovery format that clients support. Room widgets are an easy fallback."),
    ("All-client implementation of event composer extensions",
     "Examples: send enhanced / rich messages, such as auto-populated weather data; create new calendar "
     "events from the composer. Does this need a spec, or "
     "is a native client implementation without a shared approach enough? A bot can do it by enhancing the "
     "input: the bot fetches the weather and replies to the message (or adds a custom A2UI edit rendering)."),
]
col_w = (C2_X + CW - RH_X + 10) // len(QUESTIONS)
wrapped = [textwrap.wrap(body, 74) for _, body in QUESTIONS]
q_h = 60 + 16 * max(len(lines) for lines in wrapped)
for n, ((title, _), lines) in enumerate(zip(QUESTIONS, wrapped)):
    x = RH_X + n * col_w
    qy = oy + 22
    add(f'<rect x="{x}" y="{qy}" width="{col_w - 10}" height="{q_h}" rx="12" fill="#f8fafc" stroke="#64748b" '
        f'stroke-dasharray="6 4"/>')
    icon("help", x + 14, qy + 12, "#334155", 22)
    text(x + 46, qy + 29, title, "h3")
    for k, line in enumerate(lines):
        text(x + 16, qy + 52 + k * 16, line, "s", 'fill="#374151"')
H = oy + 22 + q_h + 24

head = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        'font-family="-apple-system, \'Segoe UI\', Helvetica, Arial, sans-serif">',
        """<style>
  text { fill: #1f2937; white-space: pre; }
  .h1 { font-size: 24px; font-weight: 700; }
  .h2 { font-size: 16px; font-weight: 700; }
  .h3 { font-size: 14px; font-weight: 700; }
  .b { font-size: 13px; }
  .s { font-size: 12px; fill: #4b5563; }
  .chip { font-size: 13px; font-weight: 600; }
  .case { font-size: 12px; fill: #1f2937; }
  .rank { font-size: 12px; font-weight: 700; fill: #ffffff; }
</style>""",
        f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
open(OUT, "w").write("\n".join(head + out + ["</svg>"]) + "\n")
