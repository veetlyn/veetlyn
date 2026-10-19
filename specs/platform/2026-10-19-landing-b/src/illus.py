"""Article illustrations drawn from the brand's own shapes: the bowl (square left, round right), mint as the
signal, graphite and paper. Every colour is a page token, so they follow light and dark mode."""

G, INK, MINT, SUNK, SURF, MUTED, EDGE = "var(--graphite)", "var(--ink)", "var(--mint)", "var(--sunk)", "var(--surface)", "var(--muted)", "var(--edge)"


def bowl(x, y, w, h, fill, r=None, extra=""):
    r = h / 2 if r is None else r
    return (f'<path d="M{x + 6} {y}H{x + w - r}A{r} {r} 0 0 1 {x + w - r} {y + h}H{x + 6}A6 6 0 0 1 {x} {y + h - 6}V{y + 6}'
            f'A6 6 0 0 1 {x + 6} {y}Z" fill="{fill}" {extra}/>')


def bar(x, y, w, h=10, fill=SUNK):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" fill="{fill}"/>'


def card(x, y, w, h, fill=SURF):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}"/>'


def svg(body):
    return f'<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">{body}</svg>'


def gap():
    b = f'<rect width="800" height="450" fill="{SUNK}"/>'
    b += card(60, 90, 260, 170, G) + bar(90, 130, 170, 12, "var(--graphite-raise)") + bar(90, 160, 200, 12, "var(--graphite-raise)") + bar(90, 190, 120, 12, MINT)
    b += f'<path d="M110 260 L100 300 L150 260Z" fill="{G}"/>'
    b += f'<path d="M330 175 H430" stroke="{MINT}" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 14"/>'
    b += bowl(430, 105, 150, 140, MINT)
    b += f'<path d="M475 205V145h28a17 17 0 0 1 0 34h-28" fill="none" stroke="var(--on-mint)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>'
    for i, (fill, w) in enumerate([(SURF, 150), (INK, 120), (SURF, 170)]):
        y = 300 + i * 0
        b += bowl(250 + i * 180, 320, w, 64, fill)
    b += bar(270, 346, 90, 12, SUNK) + bar(450, 346, 70, 12, "var(--graphite-raise)") + bar(630, 346, 110, 12, SUNK)
    return svg(b)


def freelancer():
    b = f'<rect width="800" height="450" fill="{G}"/>'
    b += card(90, 70, 330, 310) + bar(120, 105, 150, 14, INK)
    for i, w in enumerate([210, 170, 190]):
        b += bar(120, 150 + i * 38, w) + bar(360, 150 + i * 38, 36, 10, MUTED)
    b += f'<rect x="120" y="268" width="270" height="2" fill="{EDGE}"/>' + bar(120, 292, 90, 14, INK) + bar(330, 292, 66, 14, INK)
    b += bowl(120, 330, 140, 34, MINT)
    b += bowl(480, 150, 230, 56, MINT) + bowl(480, 222, 230, 56, "var(--graphite-raise)")
    b += f'<circle cx="610" cy="345" r="42" fill="none" stroke="{MINT}" stroke-width="8"/><path d="M592 345l12 12 22-26" fill="none" stroke="{MINT}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'
    return svg(b)


def agency():
    b = f'<rect width="800" height="450" fill="{SUNK}"/>'
    b += bowl(70, 165, 210, 120, G) + bar(105, 205, 110, 14, "var(--graphite-raise)") + bar(105, 235, 70, 14, MINT)
    ys = [70, 160, 250, 340]
    for i, y in enumerate(ys):
        b += f'<path d="M280 225 C 380 225, 400 {y + 22}, 500 {y + 22}" fill="none" stroke="{MINT if i == 0 else EDGE}" stroke-width="{6 if i == 0 else 4}" stroke-linecap="round"/>'
        b += f'<circle cx="530" cy="{y + 22}" r="26" fill="{MINT if i == 0 else SURF}"/>'
        b += bowl(575, y + 6, [170, 120, 140, 100][i], 32, INK if i == 0 else SURF)
    return svg(b)


def store():
    b = f'<rect width="800" height="450" fill="{G}"/>'
    b += card(70, 70, 200, 140) + bowl(95, 95, 70, 70, MINT) + bar(180, 110, 60) + bar(180, 140, 40)
    b += card(70, 240, 200, 140) + bowl(95, 265, 70, 70, INK) + bar(180, 280, 60) + bar(180, 310, 40)
    b += f'<path d="M270 140 C 340 140, 340 225, 400 225 M270 310 C 340 310, 340 225, 400 225" fill="none" stroke="{MINT}" stroke-width="6" stroke-linecap="round"/>'
    b += f'<path d="M410 170h40l30 110h150l26-80H470" fill="none" stroke="{SURF}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>'
    b += f'<circle cx="505" cy="320" r="16" fill="{SURF}"/><circle cx="610" cy="320" r="16" fill="{SURF}"/>'
    b += bowl(540, 220, 70, 40, MINT)
    return svg(b)


def studio():
    b = f'<rect width="800" height="450" fill="{SUNK}"/>'
    b += f'<rect x="120" y="75" width="280" height="300" rx="10" fill="{G}"/>'
    b += f'<path d="M400 75H530a150 150 0 0 1 0 300H400Z" fill="{MINT}"/>'
    b += f'<circle cx="230" cy="180" r="34" fill="none" stroke="{SURF}" stroke-width="8"/><circle cx="290" cy="180" r="34" fill="none" stroke="{SURF}" stroke-width="8"/>'
    b += f'<path d="M230 214 L300 300 M290 214 L220 300" stroke="{SURF}" stroke-width="8" stroke-linecap="round"/>'
    b += f'<rect x="485" y="150" width="90" height="170" rx="22" fill="var(--on-mint)"/><rect x="510" y="122" width="40" height="34" rx="8" fill="var(--on-mint)"/>'
    b += bar(500, 210, 60, 12, MINT)
    return svg(b)


def visibility():
    b = f'<rect width="800" height="450" fill="{G}"/>'
    b += card(70, 70, 380, 300)
    b += f'<circle cx="112" cy="112" r="16" fill="none" stroke="{MUTED}" stroke-width="5"/><path d="M124 124l14 14" stroke="{MUTED}" stroke-width="5" stroke-linecap="round"/>'
    b += bar(155, 104, 250, 16)
    for i in range(3):
        y = 160 + i * 66
        b += bar(100, y, 220 if i else 260, 14, MINT if i == 0 else INK) + bar(100, y + 26, 300, 10) + bar(100, y + 44, 200, 10)
    b += card(490, 70, 240, 150, "var(--graphite-raise)") + bar(515, 105, 170, 12, SUNK) + bar(515, 135, 140, 12, SUNK) + bowl(515, 165, 150, 32, MINT)
    for i, h in enumerate([50, 80, 70, 110, 140]):
        b += f'<rect x="{500 + i * 46}" y="{380 - h}" width="30" height="{h}" rx="6" fill="{MINT if i == 4 else SUNK}"/>'
    return svg(b)


ART = {"gap": gap, "freelancer": freelancer, "agency": agency, "store": store, "studio": studio, "visibility": visibility}


# Small pictures for the menu tiles: one idea each, in the same shapes and tokens.
def mini(body, bg=G):
    return f'<svg viewBox="0 0 72 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect width="72" height="52" fill="{bg}"/>{body}</svg>'


RAISE = "var(--graphite-raise)"
MINI = {
    "network": mini(f'<rect x="8" y="12" width="28" height="20" rx="5" fill="{RAISE}"/><path d="M14 32 L12 40 L20 32Z" fill="{RAISE}"/>'
                    f'<rect x="13" y="18" width="16" height="3" rx="1.5" fill="{MINT}"/><rect x="13" y="24" width="11" height="3" rx="1.5" fill="{SUNK}"/>'
                    f'<path d="M38 22h6" stroke="{MINT}" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round"/>'
                    + bowl(46, 12, 20, 20, MINT) + f'<path d="M52 28v-11h5a3 3 0 0 1 0 6h-5" fill="none" stroke="var(--on-mint)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    "discover": mini("".join(f'<rect x="{10 + (i % 3) * 18}" y="{9 + (i // 3) * 18}" width="14" height="14" rx="3" fill="{MINT if i == 4 else RAISE}"/>' for i in range(6))),
    "visibility": mini(f'<rect x="8" y="9" width="42" height="9" rx="4.5" fill="{RAISE}"/><circle cx="14" cy="13.5" r="2.4" fill="none" stroke="{SUNK}" stroke-width="1.4"/>'
                       + "".join(f'<rect x="{12 + i * 11}" y="{44 - h}" width="7" height="{h}" rx="2" fill="{MINT if i == 3 else RAISE}"/>' for i, h in enumerate([8, 13, 11, 20, 0][:4]))
                       + f'<path d="M54 30l6-6 4 4" fill="none" stroke="{MINT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    "membership": mini(bowl(18, 10, 36, 32, MINT) + '<path d="M27 26l6 6 10-11" fill="none" stroke="var(--on-mint)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
    "freelancers": mini(f'<rect x="12" y="8" width="34" height="36" rx="5" fill="{SURF}"/><rect x="17" y="14" width="18" height="3" rx="1.5" fill="{INK}"/>'
                        f'<rect x="17" y="21" width="22" height="2.5" rx="1.25" fill="{SUNK}"/><rect x="17" y="26" width="16" height="2.5" rx="1.25" fill="{SUNK}"/>'
                        + bowl(17, 33, 16, 6, MINT) + f'<circle cx="56" cy="30" r="8" fill="none" stroke="{MINT}" stroke-width="2.2"/>'),
    "agencies": mini(bowl(6, 18, 18, 16, SURF) + "".join(
        f'<path d="M24 26 C 34 26, 34 {y}, 44 {y}" fill="none" stroke="{MINT if i == 0 else SUNK}" stroke-width="{2 if i == 0 else 1.4}"/>'
        f'<circle cx="49" cy="{y}" r="5" fill="{MINT if i == 0 else RAISE}"/><rect x="57" y="{y - 2}" width="10" height="4" rx="2" fill="{RAISE}"/>' for i, y in enumerate([12, 26, 40]))),
    "stores": mini(f'<path d="M12 12h6l5 20h26l5-14H21" fill="none" stroke="{SURF}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
                   f'<circle cx="26" cy="38" r="3" fill="{SURF}"/><circle cx="46" cy="38" r="3" fill="{SURF}"/>' + bowl(28, 20, 16, 8, MINT)),
    "studios": mini(f'<rect x="14" y="10" width="22" height="32" rx="4" fill="{RAISE}"/><path d="M36 10h6a16 16 0 0 1 0 32h-6Z" fill="{MINT}"/>'
                    f'<circle cx="22" cy="20" r="3.4" fill="none" stroke="{SURF}" stroke-width="1.6"/><circle cx="28" cy="20" r="3.4" fill="none" stroke="{SURF}" stroke-width="1.6"/>'
                    f'<path d="M22 23.5L29 33M28 23.5L21 33" stroke="{SURF}" stroke-width="1.6" stroke-linecap="round"/>'),
    "plans": mini("".join(f'<rect x="{9 + i * 19}" y="{16 - (6 if i == 1 else 0)}" width="15" height="{26 + (6 if i == 1 else 0)}" rx="4" fill="{MINT if i == 1 else RAISE}"/>' for i in range(3))),
}
