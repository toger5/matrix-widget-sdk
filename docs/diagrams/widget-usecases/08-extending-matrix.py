"""Generates 08-extending-matrix.svg (see 08-extending-matrix.md).

Usage: python3 docs/diagrams/widget-usecases/08-extending-matrix.py [output.svg]
Without an argument the SVG next to this script is overwritten.
"""
import sys
import textwrap
from html import escape
from pathlib import Path

OUT = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).with_suffix(".svg"))
W = 1540

# ---- colour families (where the code runs) ------------------------------------------------
FAM = {
    "client": ("#1d4ed8", "#dbeafe"),  # inside one client
    "widget": ("#6d28d9", "#ede9fe"),  # web view (iframe) on the Widget API
    "a2ui":   ("#0f766e", "#ccfbf1"),  # A2UI rendered natively + local wasm
    "bot":    ("#c2410c", "#ffedd5"),  # server side: bots
}
PLUS, MINUS = "#15803d", "#b91c1c"

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
    "globe":  '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/>',
    "cloud":  '<path d="M7 19h10.5a4.5 4.5 0 0 0 .5-9 6.5 6.5 0 0 0-12.6 1.7A3.7 3.7 0 0 0 7 19z"/>',
    "mx":     '<path d="M6 3H3v18h3M18 3h3v18h-3"/><path d="M7.5 16v-7M7.5 11a2.2 2.2 0 0 1 4.5 0v5M12 11a2.2 2.2 0 0 1 4.5 0v5"/>',
    "person": '<circle cx="12" cy="7.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    "group":  '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>'
              '<circle cx="17" cy="9" r="3"/><path d="M15.5 14.3A5.5 5.5 0 0 1 22 19.5"/>',
}

# name, family, icons, sub pills, uses Iframe + Widget API
SOL = {
    "native":   ("Native client impl", "client", ["laptop"], [], False),
    "module":   ("Module for specific client", "client", ["puzzle"], [], False),
    "wide":     ("Client-wide widget", "widget", ["globe"], [("Iframe", "widget"), ("A2UI", "a2ui")], True),

    "iframe":   ("Iframe + Widget API", "widget", ["window"], [], True),
    "a2ui":     ("A2UI + wasm + Widget API", "a2ui", ["blocks", "cpu"], [], False),
    "bot_a2ui": ("Bot + A2UI", "bot", ["robot", "blocks"], [], False),
    "bot_wid":  ("Bot + Widget", "widget", ["robot", "window"], [], True),
    "bot_dm":   ("Bot DM", "bot", ["robot"], [("A2UI", "a2ui"), ("Widget", "widget")], True),
    "bot":      ("Bot", "bot", ["robot"], [], False),
}
# Solutions that are tricky security wise: dashed outline and a "!" badge everywhere; the reason
# is spelled out once, in the solutions list.
RISKY = {"wide": "third-party JS with full client access"}

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


def warn_badge(cx, cy):
    add(f'<circle cx="{cx}" cy="{cy}" r="10" fill="{MINUS}"/>')
    text(cx, cy + 5, "!", "rank", 'text-anchor="middle"')


def pill(key, x, y, w):
    name, fam, icons, subs, _ = SOL[key]
    color, tint = FAM[fam]
    dash = ' stroke-dasharray="6 4"' if key in RISKY else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="34" rx="17" fill="{tint}" stroke="{color}" stroke-width="1.6"{dash}/>')
    ix = x + 12
    for i in icons:
        icon(i, ix, y + 7, color)
        ix += 24
    text(ix + 4, y + 22, name, "chip", f'fill="{color}"')
    sx = ix + 4 + 7.3 * len(name) + 8
    for label, sfam in subs:
        c, _ = FAM[sfam]
        sw = 10 + 6.6 * len(label)
        add(f'<rect x="{sx}" y="{y + 7}" width="{sw}" height="20" rx="10" fill="#ffffff" stroke="{c}"/>')
        text(sx + 5, y + 21, label, "sub", f'fill="{c}"')
        sx += sw + 5
    if key in RISKY:
        warn_badge(sx + 8, y + 17)


# ---- content --------------------------------------------------------------------------------
# One row per backend situation, one cell per audience; each cell is a ranking, best first.
ROWS = [
    ("mx", "Matrix as the backend is enough", [],
     [("native", [("+", "most coherent, most integrated")]),
      ("module", [("+", "more flexible, easier to maintain"), ("-", "less deep integration")]),
      ("wide", [("+", "easiest to maintain and adopt"), ("+", "shared by all clients"), ("-", "least integrated")])],
     [("iframe", [("+", "covers all use cases")]),
      ("a2ui", [("+", "looks more native"), ("-", "covers fewer use cases")]),
      ("native", [("+", "most integrated, most coherent"), ("-", "spec is very expensive"),
                  ("-", "huge adoption effort"), ("", "(every client has to implement it)")])]),
    ("cloud", "External backend", ["By nature: weaker integration,", "more work to set up,", "less secure."],
     [("native", [("+", "most integrated, most coherent")]),
      ("module", [("+", "easier to maintain"), ("-", "less deep integration")]),
      ("wide", [("+", "easiest to maintain and adopt"), ("+", "shared by all clients"), ("-", "least integrated")]),
      ("bot_dm", [("+", "easiest to deploy and maintain"), ("-", "a room for a client feature is a hack")])],
     [("bot_a2ui", [("+", "native; the backend is needed anyhow"), ("+", "little work on the client")]),
      ("bot_wid", [("+", "very custom UX, possible today"), ("-", "less native")]),
      ("bot", [("+", "possible today"), ("-", "less native, can be cumbersome")])]),
]

# One example use case per cell: (row, column) -> text.
EXAMPLES = {
    (0, 0): "A calendar overview spanning all events in all rooms.",
    (0, 1): "A shared document: HedgeDoc with Matrix as the data backend.",
    (1, 0): "A Nextcloud sharing integration.",
    (1, 1): "Shared management of an external resource (Jira, GitHub) with interactions: "
            "close a ticket, reply in the app, ...",
}
EXAMPLE_WRAP = 72

RH_X, RH_W = 40, 230
C1_X, C2_X, CW = 285, 900, 600
PILL_W = 304
HEAD_Y, HEAD_H = 104, 96
ENTRY_GAP = 12


def entry_height(notes):
    return max(34, 16 * len(notes) + 4)


# ---- header ---------------------------------------------------------------------------------
text(40, 48, "Extending Matrix beyond chat: what fits best where", "h1")
text(40, 76, "Each cell ranks the solutions for one case, best first.", "b")
text(372, 76, "Highlighted: options built on Iframe + Widget API.", "b", 'fill="#6d28d9" font-weight="700"')

add(f'<rect x="{C1_X}" y="{HEAD_Y}" width="{CW}" height="{HEAD_H}" rx="12" fill="#f1f5f9" stroke="#64748b" stroke-width="1.5"/>')
icon("person", C1_X + 18, HEAD_Y + 16, "#334155", 26)
text(C1_X + 54, HEAD_Y + 36, "Just for the active user", "h2")
text(C1_X + 18, HEAD_Y + 64, "Each user decides what they see; other room members may see", "s")
text(C1_X + 18, HEAD_Y + 81, "something different or nothing at all.", "s")

add(f'<rect x="{C2_X}" y="{HEAD_Y}" width="{CW}" height="{HEAD_H}" rx="12" fill="#dcfce7" stroke="#15803d" stroke-width="1.5"/>')
icon("group", C2_X + 18, HEAD_Y + 16, "#15803d", 26)
text(C2_X + 54, HEAD_Y + 36, "Same experience for anyone in one Matrix room", "h2", 'fill="#14532d"')
text(C2_X + 18, HEAD_Y + 64, "Note: the room (state + events) is the only primitive that guarantees", "s", 'fill="#166534"')
text(C2_X + 18, HEAD_Y + 81, "that every member sees the same thing.", "s", 'fill="#166534"')

# ---- rows -----------------------------------------------------------------------------------
y = HEAD_Y + HEAD_H + 12
for row_no, (row_icon, row_label, row_note, personal, shared) in enumerate(ROWS):
    examples = [textwrap.wrap(EXAMPLES[(row_no, col)], EXAMPLE_WRAP) for col in (0, 1)]
    example_h = 24 + 16 * max(len(lines) for lines in examples)
    entries_h = max(sum(entry_height(n) + ENTRY_GAP for _, n in cell) for cell in (personal, shared)) + 22
    cell_h = entries_h + example_h
    add(f'<rect x="{RH_X}" y="{y}" width="{RH_W}" height="{cell_h}" rx="12" fill="#f9fafb" stroke="#9ca3af"/>')
    icon(row_icon, RH_X + 16, y + 18, "#374151", 26)
    for k, line in enumerate(textwrap.wrap(row_label, 20)):
        text(RH_X + 16, y + 70 + k * 20, line, "h2")
    for k, line in enumerate(row_note):
        text(RH_X + 16, y + 120 + k * 17, line, "s")

    for col, (cx, cell, fill, stroke) in enumerate(
        [(C1_X, personal, "#ffffff", "#cbd5e1"), (C2_X, shared, "#f7fef9", "#86efac")]
    ):
        add(f'<rect x="{cx}" y="{y}" width="{CW}" height="{cell_h}" rx="12" fill="{fill}" stroke="{stroke}"/>')
        # The example sits at the bottom of the cell, below a dashed separator.
        sy = y + entries_h
        add(f'<line x1="{cx + 16}" y1="{sy}" x2="{cx + CW - 16}" y2="{sy}" stroke="#cbd5e1" stroke-dasharray="4 4"/>')
        text(cx + 18, sy + 22, "Example", "exlabel")
        for k, line in enumerate(examples[col]):
            text(cx + 84, sy + 22 + k * 16, line, "example")
        ey = y + 16
        for rank, (key, notes) in enumerate(cell, 1):
            eh = entry_height(notes)
            if SOL[key][4]:
                # Iframe + Widget API highlight: a purple band behind the whole entry.
                add(f'<rect x="{cx + 6}" y="{ey - 6}" width="{CW - 12}" height="{eh + 12}" rx="10" '
                    f'fill="#f5f3ff" stroke="#8b5cf6" stroke-width="1.6"/>')
            add(f'<circle cx="{cx + 28}" cy="{ey + eh / 2}" r="12" fill="#1f2937"/>')
            text(cx + 28, ey + eh / 2 + 5, str(rank), "rank", 'text-anchor="middle"')
            py = ey + (eh - 34) / 2
            pill(key, cx + 48, py, PILL_W)
            nx = cx + 48 + PILL_W + 14
            ny = ey + eh / 2 - 8 * (len(notes) - 1) + 4
            for k, (sign, note) in enumerate(notes):
                c = PLUS if sign == "+" else MINUS
                # An empty sign continues the previous note on a new line.
                text(nx, ny + k * 16, {"+": "+", "-": "–", "!": "!", "": ""}[sign], "sign", f'fill="{c}"')
                text(nx + 14, ny + k * 16, note, "note", f'fill="{MINUS}" font-weight="700"' if sign == "!" else "")
            ey += eh + ENTRY_GAP
    y += cell_h + 10

# ---- key messages: one box per column -------------------------------------------------------
TAKEAWAYS = [
    (C1_X, "client", ["laptop", "puzzle"], "For one user: build it into the client",
     "A native client implementation or a module for a specific client gives the deepest, most coherent "
     "integration. A widget is not really needed here: a feature for a single user does not have to look "
     "the same across clients."),
    (C2_X, "widget", ["window"], "For a room: Iframe + Widget API",
     "It covers every use case, every member runs the same app in every client, and it works today. One "
     "Widget API implementation per client serves all room features, with no new spec per feature."),
]
box_h = 108
add(f'<rect x="{RH_X}" y="{y + 4}" width="{RH_W}" height="{box_h}" rx="12" fill="#f9fafb" stroke="#9ca3af"/>')
text(RH_X + 16, y + 32, "Takeaway", "h2")
# The thread through the whole table: the highlighted option exists in every cell.
for k, line in enumerate(textwrap.wrap("Iframe + Widget API is an option in every cell.", 24)):
    text(RH_X + 16, y + 56 + k * 18, line, "b", f'fill="{FAM["widget"][0]}" font-weight="700"')
for bx, fam, icons, title, body in TAKEAWAYS:
    color, tint = FAM[fam]
    add(f'<rect x="{bx}" y="{y + 4}" width="{CW}" height="{box_h}" rx="12" fill="{color}"/>')
    ix = bx + 18
    for i in icons:
        icon(i, ix, y + 20, "#ffffff", 24)
        ix += 30
    text(ix + 6, y + 38, title, "h2", 'fill="#ffffff"')
    for k, line in enumerate(textwrap.wrap(body, 84)):
        text(bx + 20, y + 64 + k * 17, line, "b", f'fill="{tint}"')
y += box_h + 4

# ---- solutions list -------------------------------------------------------------------------
ly = y + 66
add(f'<line x1="{RH_X}" y1="{ly - 34}" x2="{C2_X + CW}" y2="{ly - 34}" stroke="#e5e7eb"/>')
text(RH_X, ly, "The solutions", "h2")
text(RH_X + 120, ly, "Colour = where the code runs:", "s")
lx = RH_X + 300
for fam, label in [("client", "inside one client"), ("widget", "web view on the Widget API (iframe)"),
                   ("a2ui", "native A2UI + local wasm"), ("bot", "server (bot)")]:
    color, tint = FAM[fam]
    add(f'<rect x="{lx}" y="{ly - 12}" width="14" height="14" rx="4" fill="{tint}" stroke="{color}" stroke-width="1.4"/>')
    text(lx + 20, ly, label, "s")
    lx += 34 + 6.4 * len(label)

LIST = [
    ("native", "A feature specified in a Matrix spec and built into each client natively. The most integrated "
               "and coherent result, but every feature needs a spec and an implementation in every client."),
    ("module", "A native extension of one client (Element Web module API, Robrix mini apps). Full UI and "
               "client access, but only for users of that client, so never a guaranteed shared view."),
    ("iframe", "A web app that talks to the Matrix client over a standardised postMessage API, without access to "
               "the client-server API or encryption keys. For one shared room experience, one member picks the app "
               "and everyone runs it locally. Use with caution: \"I run JS on my machine that someone else in the "
               "room has chosen.\""),
    ("a2ui", "The UI is described in JSON building blocks (A2UI, extensible events) and rendered natively by the "
             "client. The logic runs as a sandboxed wasm process inside the client (a background widget) that "
             "talks to the client over the Widget API."),
    ("wide", "A widget that is not bound to one room (cross-room, per space, whole client), shown as an iframe "
             "or as an A2UI surface. Written once for every client, but every client has to support the "
             "interface."),
    ("bot_a2ui", "A bot in the room posts A2UI messages and handles the interactions (relations to the A2UI "
                 "event, visible to the whole room). Logic and secrets stay on the server."),
    ("bot_wid", "A bot keeps the logic and the external connection; a room widget shows its UI. Works today "
                "with any UX, but looks less native. In a DM with the bot (Bot DM) it serves a single user."),
    ("bot", "Classic bot or appservice: text, commands, reactions, notices (e.g. Hookshot). Works in every "
            "client today; the UI is limited to what the timeline can show."),
]
col_w = (C2_X + CW - RH_X) // 2
ITEM_H = 92
for n, (key, desc) in enumerate(LIST):
    col, row = n % 2, n // 2
    x = RH_X + col * (col_w + 10)
    iy = ly + 26 + row * (ITEM_H + 10)
    name, fam, icons, subs, _ = SOL[key]
    color, tint = FAM[fam]
    dash = ' stroke-dasharray="6 4"' if key in RISKY else ""
    add(f'<rect x="{x}" y="{iy}" width="{col_w - 10}" height="{ITEM_H}" rx="12" fill="{tint}" fill-opacity="0.45" '
        f'stroke="{color}" stroke-width="1.4"{dash}/>')
    ix = x + 14
    for i in icons:
        icon(i, ix, iy + 12, color, 22)
        ix += 26
    text(ix + 4, iy + 29, name, "h3", f'fill="{color}"')
    if key in RISKY:
        bx = ix + 4 + 7.8 * len(name) + 18
        warn_badge(bx, iy + 24)
        text(bx + 16, iy + 29, RISKY[key], "h3", f'fill="{MINUS}"')
    for k, l in enumerate(textwrap.wrap(desc, 118)):
        text(x + 16, iy + 50 + k * 15.5, l, "s", 'fill="#374151"')

H = ly + 26 + 4 * (ITEM_H + 10) + 20

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
  .sub { font-size: 11px; font-weight: 600; }
  .rank { font-size: 13px; font-weight: 700; fill: #ffffff; }
  .sign { font-size: 15px; font-weight: 800; }
  .note { font-size: 12.5px; fill: #374151; }
  .exlabel { font-size: 12px; font-weight: 700; fill: #374151; letter-spacing: 0.3px; }
  .example { font-size: 12.5px; font-style: italic; fill: #374151; }
</style>""",
        f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
open(OUT, "w").write("\n".join(head + out + ["</svg>"]) + "\n")
