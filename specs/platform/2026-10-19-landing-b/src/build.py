import base64
import html as htmllib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from blog_data import CATEGORIES, DATE, DATE_LABEL, POSTS  # noqa: E402
from illus import ART, MINI  # noqa: E402

MAIN = pathlib.Path("/home/mouhamed/dev/repos/jendal/worktrees/main/specs/platform")
OUT_DIR = MAIN / "2026-10-19-landing-b"
FONT = pathlib.Path("/home/mouhamed/dev/repos/jendal/worktrees/brand-ds/apps/web/public/fonts/CalSansUI-Variable.woff2")
SIGNUP = "https://dash.payleor.com/signup"
BASE = "https://payleor.com"

P = ('<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10.5 25.5V7.5h7a5.75 5.75 0 0 1 0 11.5h-7" fill="none" '
     'stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
     '<rect x="19" y="21.5" width="5" height="5" rx="1.25" fill="var(--mint)"/></svg>')
CHECK_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9.5a8.5 8.5 0 0 1 0 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" '
             'fill="var(--mint)"/><path d="M7.5 11.6l3 3 5.5-6" fill="none" stroke="var(--on-mint)" stroke-width="2.2" '
             'stroke-linecap="round" stroke-linejoin="round"/></svg>')
CHECK = f'<span class="check" title="Payleor Network member">{CHECK_SVG}Member</span>'

ICONS = json.loads((HERE.parent / "icons" / "paths.json").read_text())
CHAT_GLYPH = "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"


def mark(name, d):
    return f'<span class="logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="{d}"/></svg>{name}</span>'


FOUND = ('<div class="found" data-in><div class="group"><span class="label">Where clients find you</span>'
         + mark("ChatGPT", CHAT_GLYPH) + mark("Claude", ICONS["claude"]["d"]) + mark("Perplexity", ICONS["perplexity"]["d"])
         + mark("Gemini", ICONS["googlegemini"]["d"]) + mark("Google", ICONS["google"]["d"])
         + '</div><div class="group"><span class="label">Paid through</span>' + mark("PayPal", ICONS["paypal"]["d"]) + "</div></div>")

NETWORK = [
    ("network.html", "Payleor Network", "The connector clients add to Claude and ChatGPT", "network"),
    ("discover.html", "Discover", "Browse everything sellers offer on the network", "discover"),
    ("visibility.html", "Get found", "Web SEO for all, AI visibility for members", "visibility"),
    ("network.html#membership", "Membership", "The member check, by waitlist", "membership"),
]
NETWORK_FEATURE = ("blog/ai-shopping-left-services-out.html", "Why Payleor Network exists", "AI shopping left services out. Here is the gap it fills.", "Read the guide", "gap")
AUDIENCES = [
    ("freelancers.html", "Freelancers", "Get hired from your clients' AI", "freelancers"),
    ("agencies.html", "Agencies", "Everyone paid by your rules", "agencies"),
    ("stores.html", "Stores", "Your products in AI carts", "stores"),
    ("studios.html", "Studios", "Services and products, one shop", "studios"),
]
AUDIENCE_FEATURE = ("pricing.html", "Plans from $12 a month", "Services, stores, or both at a lower price. Enterprise on request.", "Compare plans", "plans")
TOP = ["network", "audiences", ("pricing.html", "Pricing"), ("blog.html", "Blog"), ("contact.html", "Contact")]

META = {
    "index.html": ("/", "Sell services and products where AI shops. Payleor Network brings freelancers, agencies, stores and studios into Claude and ChatGPT, paid through PayPal."),
    "network.html": ("/network", "Payleor Network is the connector clients add to Claude and ChatGPT. Their AI finds sellers and requests quotes, and clients pay on Payleor with PayPal."),
    "discover.html": ("/discover", "Browse services, courses, downloads and goods from sellers on Payleor Network, the same catalog clients' AI searches in Claude and ChatGPT."),
    "freelancers.html": ("/freelancers", "Get hired from your clients' AI. An agent drafts your quotes, clients pay deposits with PayPal, and you pay 1% per payment and 5% once on new clients."),
    "agencies.html": ("/agencies", "Run your agency with agents: requests from AI and Discord, quotes drafted for you, and every member paid their share by your payout rules."),
    "stores.html": ("/stores", "Sell in AI carts. Clients' AI fills one cart across Payleor stores and pays once with PayPal. Downloads, courses and shipped goods, from $12 a month."),
    "studios.html": ("/studios", "For salons, spas and studios that sell services and products: one shop, one link, staff paid their share, and the cheaper plan at half price."),
    "pricing.html": ("/pricing", "Payleor pricing: a plan from $12 a month, 0.25 to 2% per payment or order, and 5% once only on clients AI brings you. Services, stores, both or Enterprise."),
    "visibility.html": ("/visibility", "Get found on Google and in AI answers. Web SEO is built into every Payleor page, and Network members get AI visibility run by an agent with their approval."),
    "contact.html": ("/contact", "Talk to Payleor about Enterprise plans, Network membership, partnerships or support. Write to contact@payleor.com."),
    "blog.html": ("/blog", "Plain guides for people who sell their work: how AI shopping works, how to get paid with PayPal, and how to get found on Google and in AI answers."),
}

v6 = (HERE / "v6.src.html").read_text()


def section(src, marker):
    start = src.index(marker)
    return src[start:src.index("</section>", start) + len("</section>")]


TERMS = section(v6, '<section id="terms"')
SEEN = section(v6, '<section id="seen"')
WEEK = section(v6, '<section id="week"')
LINK = section(v6, '<section id="link"')
FAQ = section(v6, '<section aria-labelledby="faq-h">')

CLOSE = f'''<section id="start" aria-labelledby="start-h">
    <div class="wrap">
      <div class="close" data-in>
        <h2 id="start-h">Be there when AI comes shopping</h2>
        <div class="close-ctas"><a class="btn btn-mint" href="{SIGNUP}">Start selling</a><a class="link" href="contact.html#sales">Talk to sales</a></div>
      </div>
    </div>
  </section>'''

exec((HERE / "tiers_part.py").read_text())

# Discover: sample listings while the network opens. Never published as structured data.
LISTINGS = [
    # title, seller, member, type, done, category, price label, price (dollars), detail, glyph, tone
    ("Logo and brand kit", "Walk Crew", True, "service", "people", "design", "From $400", 400, "7 to 14 days", "WC", 1),
    ("Landing page in Webflow", "Fold Studio", True, "service", "both", "development", "From $1,200", 1200, "10 days", "FS", 2),
    ("Pedicure", "Maison Lune", True, "service", "people", "beauty", "$45", 45, "45 min", "ML", 4),
    ("Podcast mix and master", "Northwave Audio", True, "service", "people", "video", "$90 an episode", 90, "48 hours", "NA", 3),
    ("Logo ideas in a minute", "Logo Bot", False, "service", "ai", "design", "$29", 29, "Ready now", "LB", 3),
    ("Brand identity", "Amadou", True, "service", "people", "design", "From $600", 600, "2 to 3 weeks", "AM", 1),
    ("Shopify fixes", "Patchwork Dev", False, "service", "people", "development", "From $90", 90, "1 to 3 days", "PD", 4),
    ("Website copy", "Quill and Co", True, "service", "both", "writing", "From $300", 300, "5 days", "QC", 2),
    ("Deck translation", "Lingo Bot", False, "service", "ai", "writing", "$12", 12, "Ready in minutes", "LG", 3),
    ("YouTube video edit", "Cutroom", False, "service", "both", "video", "From $150", 150, "3 days", "CR", 1),
    ("Pricing your services", "Amadou", True, "course", "people", "courses", "$49", 49, "6 lessons", "PS", 2),
    ("Glazing course", "Clay Room", True, "course", "people", "courses", "$29", 29, "6 videos", "GC", 4),
    ("Freelance OS for Notion", "Desk and Co", False, "download", "people", "templates", "$19", 19, "Notion template", "OS", 3),
    ("Film preset pack", "Lightfold", False, "download", "people", "templates", "$15", 15, "12 presets", "LF", 1),
    ("Argan shampoo", "Maison Lune", True, "product", "people", "beauty", "$18", 18, "250 ml, shipped", "AS", 2),
    ("Yoga class pack", "Studio Ama", False, "service", "people", "beauty", "$60", 60, "5 classes", "YA", 3),
    ("Blue mug", "Clay Room", True, "product", "people", "goods", "$18", 18, "Shipped", "BM", 4),
    ("Coffee beans, 1 kg", "Roast House", False, "product", "people", "goods", "$24", 24, "Shipped", "RH", 1),
]
KIND = {"service": "Service", "download": "Download", "course": "Course", "product": "Goods"}
DONE = {"people": "By people", "both": "People with AI", "ai": "Automated"}


def listing(i, item, shelf=False):
    title, seller, member, kind, done, cat, label, price, detail, glyph, tone = item
    text = " ".join([title, seller, KIND[kind], DONE[done], cat, detail]).lower()
    return (f'<article class="item-card" data-in data-order="{i}" data-cat="{cat}" data-type="{kind}" data-done="{done}" data-price="{price}" '
            f'data-text="{htmllib.escape(text)}"><div class="cover tone-{tone}" aria-hidden="true"><span class="kind">{KIND[kind]}</span>'
            f'<span class="glyph">{glyph}</span></div><div class="item-body"><p class="item-title">{title}</p>'
            f'<p class="seller">{seller}{CHECK if member else ""}</p><p class="item-meta">{DONE[done]} &#183; {detail}</p>'
            f'<p class="item-price num">{label}</p></div></article>')


SHELF = "\n".join(listing(i, it, True) for i, it in enumerate(LISTINGS[:4]))
ITEMS = "\n".join(listing(i, it) for i, it in enumerate(LISTINGS))


def header(current):
    def link(href, label, cls="nav-item"):
        cur = ' aria-current="page"' if href == current else ""
        return f'<a class="{cls}" href="{href}"{cur}>{label}</a>'

    def tile(h, l, d, art, cls="mega-item"):
        cur = ' aria-current="page"' if h == current else ""
        return f'<a class="{cls}" href="{h}"{cur}><span class="mega-art">{MINI[art]}</span><span class="mega-txt"><b>{l}</b><small>{d}</small></span></a>'

    def feature(f):
        h, title, text, go, art = f
        pic = ART[art]() if art in ART else MINI[art]
        return f'<a class="mega-feature" href="{h}"><span class="art">{pic}</span><b>{title}</b><small>{text}</small><span class="go">{go}</span></a>'

    def drop(label, entries, feat):
        here = any(e[0] == current for e in entries)
        tiles = "".join(tile(*e) for e in entries)
        return (f'<details class="drop nav-item{" current" if here else ""}"><summary>{label}</summary>'
                f'<div class="mega">{tiles}{feature(feat)}</div></details>')

    parts = {"network": drop("Network", NETWORK, NETWORK_FEATURE), "audiences": drop("Who it is for", AUDIENCES, AUDIENCE_FEATURE)}
    items = "".join(parts[t] if isinstance(t, str) else link(*t) for t in TOP)
    plain = "".join(link(*t, cls="menu-link") for t in TOP if not isinstance(t, str))
    menu = (f'<p class="menu-h">Network</p><div class="menu-grid">{"".join(tile(*e, cls="menu-tile") for e in NETWORK)}</div>'
            f'<p class="menu-h">Who it is for</p><div class="menu-grid">{"".join(tile(*e, cls="menu-tile") for e in AUDIENCES)}</div>'
            f'<div class="menu-links">{plain}</div>')
    return f'''<header class="top band">
  <div class="wrap">
    <a class="mark" href="index.html" aria-label="Payleor home">{P}Payleor</a>
    <nav class="links" aria-label="Main">
      {items}
      <details class="menu"><summary>Menu</summary><div class="menu-panel">{menu}</div></details>
      <a class="btn btn-mint" href="{SIGNUP}">Get started</a>
    </nav>
  </div>
</header>'''


FOOTER = f'''<footer class="wrap site">
  <div class="brand"><a class="mark" href="index.html">{P}Payleor</a><p>Sell products and services inside AI, paid through PayPal.</p></div>
  <div><b>Sell</b><a href="freelancers.html">Freelancers</a><a href="agencies.html">Agencies</a><a href="stores.html">Stores</a><a href="studios.html">Studios</a></div>
  <div><b>Payleor</b><a href="network.html">Payleor Network</a><a href="discover.html">Discover</a><a href="visibility.html">Get found</a><a href="pricing.html">Pricing</a><a href="blog.html">Blog</a><a href="contact.html">Contact</a><a href="mailto:contact@payleor.com">contact@payleor.com</a></div>
  <p class="small">Sandbox prototype. Walk Crew, Amadou, Clay Room, Roast House, Maison Lune, Coco Nails, Logo Bot, Inès and the Discover listings are examples.</p>
</footer>'''

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap">\n'
         '<link rel="stylesheet" href="site.css">')


def entities(text):
    return "".join(f"&#{ord(c)};" if ord(c) > 127 else c for c in text)


def plain(fragment):
    return htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def ld(obj):
    return f'<script type="application/ld+json">{json.dumps(obj, ensure_ascii=True)}</script>'


ORG = {"@type": "Organization", "@id": f"{BASE}/#org", "name": "Payleor", "url": f"{BASE}/", "email": "contact@payleor.com"}


def crumbs(*pairs):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": name, "item": f"{BASE}{path}"} for i, (name, path) in enumerate(pairs)]}


def faq_ld(body):
    pairs = re.findall(r"<details[^>]*><summary>(.*?)</summary><p>(.*?)</p></details>", body, re.S)
    if not pairs:
        return None
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": plain(q), "acceptedAnswer": {"@type": "Answer", "text": plain(a)}} for q, a in pairs]}


def head_tags(title, description, path, graph, kind="website"):
    url = f"{BASE}{path}"
    tags = [
        f'<meta name="description" content="{htmllib.escape(description)}">',
        f'<link rel="canonical" href="{url}">',
        f'<meta property="og:site_name" content="Payleor">',
        f'<meta property="og:type" content="{kind}">',
        f'<meta property="og:title" content="{htmllib.escape(title)}">',
        f'<meta property="og:description" content="{htmllib.escape(description)}">',
        f'<meta property="og:url" content="{url}">',
        '<meta name="twitter:card" content="summary">',
        ld({"@context": "https://schema.org", "@graph": graph}),
    ]
    return "\n".join(tags)


def fill(body):
    body = body.replace("{{SIGNUP}}", SIGNUP).replace("{{P}}", P).replace("{{CHECK}}", CHECK).replace("{{TERMS}}", TERMS)
    body = body.replace("{{SEEN}}", SEEN).replace("{{WEEK}}", WEEK).replace("{{LINK}}", LINK).replace("{{FAQ}}", FAQ)
    body = body.replace("{{CLOSE}}", CLOSE).replace("{{SHELF}}", SHELF).replace("{{FOUND}}", FOUND).replace("{{ITEMS}}", ITEMS)
    for key, value in TIERS.items():
        body = body.replace("{{TIER_" + key + "}}", value)
    left = re.findall(r"\{\{[A-Z_]+\}\}", body)
    assert not left, left
    return body


def graph_for(name, title, description, path, body):
    page_ld = {"@type": "WebPage", "@id": f"{BASE}{path}#page", "url": f"{BASE}{path}", "name": title, "description": description,
               "isPartOf": {"@id": f"{BASE}/#site"}}
    graph = [ORG]
    if name == "index.html":
        graph.append({"@type": "WebSite", "@id": f"{BASE}/#site", "url": f"{BASE}/", "name": "Payleor", "publisher": {"@id": f"{BASE}/#org"},
                      "potentialAction": {"@type": "SearchAction", "target": f"{BASE}/discover?q={{search_term_string}}",
                                          "query-input": "required name=search_term_string"}})
    else:
        graph.append(crumbs(("Payleor", "/"), (title.split(" | ")[0], path)))
    if name == "discover.html":
        page_ld["@type"] = "CollectionPage"
    if name == "pricing.html":
        graph.append({"@type": "SoftwareApplication", "name": "Payleor", "applicationCategory": "BusinessApplication", "operatingSystem": "Web",
                      "offers": [{"@type": "Offer", "name": n, "price": p, "priceCurrency": "USD", "description": d} for n, p, d in [
                          ("Solo", "19", "A month, 1% on each client payment"), ("Team", "59", "A month, 0.5% on each client payment"),
                          ("Agency", "199", "A month, 0.25% on each client payment"), ("Starter", "12", "A month, 2% on each order"),
                          ("Grow", "39", "A month, 1% on each order"), ("Scale", "129", "A month, 0.5% on each order")]]})
    graph.append(page_ld)
    faq = faq_ld(body)
    if faq:
        graph.append(faq)
    return graph


PREVIEW = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           '{base}<title>{title}</title>\n{head}\n{fonts}\n</head>\n<body>\n{content}</body>\n</html>\n')


def render(name, title, body, description, path, graph, current, kind="website", base=""):
    content = entities(f"{header(current)}\n\n{body}\n{FOOTER}\n<script src=\"site.js\"></script>\n")
    head = entities(head_tags(title, description, path, graph, kind))
    return title, head, content, base


def from_source(name):
    src = (HERE / name).read_text()
    title = re.match(r"<!-- title: (.*?) -->\n", src).group(1)
    body = fill(src.split("\n", 1)[1])
    path, description = META[name]
    return render(name, title, body, description, path, graph_for(name, title, description, path, body), name if name != "index.html" else "")


# Blog
CAT_LABEL = dict(CATEGORIES)


def words(post):
    text = " ".join([post["lead"], *post["short"]])
    for _, blocks in post["sections"]:
        for b in blocks:
            text += " " + (" ".join(b) if isinstance(b, list) else b)
    return len(text.split())


def minutes(post):
    return max(2, round(words(post) / 220))


def art(post, label):
    return f'<figure class="post-art" role="img" aria-label="{htmllib.escape(label)}">{ART[post["art"]]()}</figure>'


def post_card(post, feature=False):
    cls = "post-feature" if feature else "post-card"
    inner_art = f'<div class="art">{ART[post["art"]]()}</div>'
    head = "h2" if feature else "h3"
    return (f'<a class="{cls}" data-in data-cat="{post["cat"]}" href="blog/{post["slug"]}.html">{inner_art}<div class="txt">'
            f'<p class="post-cat">{CAT_LABEL[post["cat"]]}</p><{head}>{post["title"]}</{head}><p class="post-lead">{post["lead"]}</p>'
            f'<p class="post-time">{minutes(post)} min read</p></div></a>')


def blog_index():
    title = "The Payleor blog"
    path, description = META["blog.html"]
    cats = '<button type="button" aria-pressed="true" data-v="all">All</button>' + "".join(
        f'<button type="button" aria-pressed="false" data-v="{k}">{v}</button>' for k, v in CATEGORIES)
    body = f'''<div class="band">
  <div class="wrap hero page solo">
    <div>
      <h1 data-in>The Payleor blog</h1>
      <p class="lead" data-in>Plain guides for people who sell their work: how AI shopping works, how to get paid, and how to get found.</p>
      <div class="cat-row" id="cats" role="group" aria-label="Topic">{cats}</div>
    </div>
  </div>
</div>

<main>
  <section aria-label="Articles" style="padding-top:clamp(40px,5vw,64px)">
    <div class="wrap">
      {post_card(POSTS[0], feature=True)}
      <div class="posts">
        {"".join(post_card(p) for p in POSTS[1:])}
      </div>
    </div>
  </section>

  {CLOSE}
</main>'''
    graph = [ORG, crumbs(("Payleor", "/"), ("Blog", "/blog")),
             {"@type": "Blog", "@id": f"{BASE}/blog#blog", "url": f"{BASE}/blog", "name": title, "description": description, "publisher": {"@id": f"{BASE}/#org"},
              "blogPost": [{"@type": "BlogPosting", "headline": p["title"], "url": f"{BASE}/blog/{p['slug']}", "datePublished": DATE} for p in POSTS]}]
    return render("blog.html", title, body, description, path, graph, "blog.html")


def block(b):
    if isinstance(b, list):
        return "<ul>" + "".join(f"<li>{x}</li>" for x in b) + "</ul>"
    return f"<p>{b}</p>"


def post_page(post):
    path = f"/blog/{post['slug']}"
    prose = "".join(f"<h2>{h}</h2>" + "".join(block(b) for b in blocks) for h, blocks in post["sections"])
    faq = "".join(f'<details{" open" if i == 0 else ""}><summary>{q}</summary><p>{a}</p></details>' for i, (q, a) in enumerate(post["faq"]))
    related = [p for p in POSTS if p is not post][:3]
    cta_label, cta_href = post["cta"]
    body = f'''<div class="band">
  <div class="wrap hero page solo post-hero">
    <div>
      <nav class="crumbs" aria-label="Breadcrumb"><a href="blog.html">Blog</a><span aria-hidden="true">/</span><a href="blog.html#{post["cat"]}">{CAT_LABEL[post["cat"]]}</a></nav>
      <h1 data-in>{post["title"]}</h1>
      <p class="lead" data-in>{post["lead"]}</p>
      <p class="post-meta"><time datetime="{DATE}">{DATE_LABEL}</time> &#183; {minutes(post)} min read &#183; The Payleor team</p>
    </div>
  </div>
</div>

<main>
  <article class="post wrap">
    {art(post, post["title"])}
    <aside class="tldr" aria-label="In short"><p class="tldr-h">In short</p><ul>{"".join(f"<li>{x}</li>" for x in post["short"])}</ul></aside>
    <div class="prose">{prose}</div>
    <section class="faq" aria-labelledby="faq-h" style="padding:0">
      <h2 id="faq-h">Questions</h2>
      <div>{faq}</div>
    </section>
    <div class="post-cta"><p>{cta_label}</p><a class="btn" href="{cta_href}">Read more</a></div>
    <section class="related" aria-labelledby="rel-h" style="padding:0">
      <h2 id="rel-h">Keep reading</h2>
      <div class="posts">{"".join(post_card(p) for p in related)}</div>
    </section>
  </article>

  {CLOSE}
</main>'''
    graph = [ORG, crumbs(("Payleor", "/"), ("Blog", "/blog"), (post["title"], path)),
             {"@type": "BlogPosting", "@id": f"{BASE}{path}#post", "headline": post["title"], "description": post["description"],
              "datePublished": DATE, "dateModified": DATE, "url": f"{BASE}{path}", "mainEntityOfPage": f"{BASE}{path}",
              "articleSection": CAT_LABEL[post["cat"]], "wordCount": words(post), "inLanguage": "en",
              "author": {"@id": f"{BASE}/#org"}, "publisher": {"@id": f"{BASE}/#org"}}]
    faq_obj = faq_ld(faq)
    if faq_obj:
        graph.append(faq_obj)
    title = post["title"]
    return render(f"blog/{post['slug']}.html", title, body, post["description"], path, graph, "blog.html", kind="article", base='<base href="../">\n')


# Files for crawlers
PAGES = ["network.html", "discover.html", "visibility.html", "freelancers.html", "agencies.html", "stores.html", "studios.html", "pricing.html", "contact.html"]


def llms_txt():
    lines = ["# Payleor", "",
             "> Payleor lets freelancers, agencies, stores and studios sell services and products inside Claude and ChatGPT through "
             "Payleor Network, a connector clients add to their AI. The AI finds sellers, asks questions, requests quotes and fills carts. "
             "The client approves every payment in PayPal on Payleor's page; a person or a rule the team sets approves every payout. "
             "Payleor never holds the money.", "",
             "## Product",
             f"- [Payleor Network]({BASE}/network): the connector (api.payleor.com/mcp), the gaps it fills, membership, and how clients add it",
             f"- [Discover]({BASE}/discover): services, courses, downloads and goods from sellers on the network",
             f"- [Get found]({BASE}/visibility): web SEO included in every plan, and AI visibility for Network members",
             f"- [Pricing]({BASE}/pricing): plans from $12 a month, 0.25 to 2% per payment or order, 5% once on clients the network brings", "",
             "## Who it is for"]
    lines += [f"- [{l}]({BASE}/{h[:-5]}): {d}" for h, l, d, _ in AUDIENCES]
    lines += ["", "## Guides"]
    lines += [f"- [{p['title']}]({BASE}/blog/{p['slug']}): {p['description']}" for p in POSTS]
    lines += ["", "## Optional", f"- [Contact]({BASE}/contact): Enterprise, membership, partnerships and support, contact@payleor.com", ""]
    return "\n".join(lines)


def sitemap():
    urls = ["/"] + [META[p][0] for p in PAGES] + ["/blog"] + [f"/blog/{p['slug']}" for p in POSTS]
    rows = "".join(f"<url><loc>{BASE}{u}</loc><lastmod>{DATE}</lastmod></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>\n'


ROBOTS = """# Every crawler may read the site, including the AI assistants' crawlers.
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://payleor.com/sitemap.xml
"""


# Build
css = (HERE / "base.css").read_text() + (HERE / "more.css").read_text()
css = css.replace("__CALSANS__", base64.b64encode(FONT.read_bytes()).decode())
OUT_DIR.mkdir(exist_ok=True)
(OUT_DIR / "blog").mkdir(exist_ok=True)
(OUT_DIR / "site.css").write_text(css)
(OUT_DIR / "site.js").write_text((HERE / "site.js").read_text())
(OUT_DIR / "llms.txt").write_text(llms_txt())
(OUT_DIR / "sitemap.xml").write_text(sitemap())
(OUT_DIR / "robots.txt").write_text(ROBOTS)

title, head, content, _ = from_source("index.html")
(MAIN / "2026-10-19-landing-b.html").write_text(
    f'<title>{title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n{head}\n{FONTS}\n\n{content}')
# A local copy of the index sits beside the pages so relative links work in a preview; it is not published.
(OUT_DIR / "index.html").write_text(PREVIEW.format(base="", title=title, head=head, fonts=FONTS, content=content))
for name in PAGES:
    title, head, content, base = from_source(name)
    (OUT_DIR / name).write_text(PREVIEW.format(base=base, title=title, head=head, fonts=FONTS, content=content))
title, head, content, base = blog_index()
(OUT_DIR / "blog.html").write_text(PREVIEW.format(base=base, title=title, head=head, fonts=FONTS, content=content))
for post in POSTS:
    title, head, content, base = post_page(post)
    (OUT_DIR / "blog" / f"{post['slug']}.html").write_text(PREVIEW.format(base=base, title=entities(title), head=head, fonts=FONTS, content=content))
print("built", sorted(str(p.relative_to(OUT_DIR)) for p in OUT_DIR.rglob("*") if p.is_file()))
