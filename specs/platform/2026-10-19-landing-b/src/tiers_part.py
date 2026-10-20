def tier(name, for_, m, y, bill_y, fee, cta, feats, kind="", href=SIGNUP, btn="btn-quiet"):
    if m == "Custom":
        price = '<p class="price">Custom</p><p class="bill">Fees and limits set with you</p>'
    else:
        price = (f'<p class="price num"><span data-m="{m}" data-y="{y}">{m}</span><small> a month</small></p>'
                 f'<p class="bill" data-m="Billed monthly" data-y="Billed {bill_y} a year">Billed monthly</p>')
    items = "".join(f'<li class="plus">{f[1:]}</li>' if f.startswith("+") else f"<li>{f}</li>" for f in feats)
    return (f'<article class="tier {kind}" data-in><div><p class="name">{name}</p><p class="for">{for_}</p></div>'
            f'<div>{price}</div><p class="fee">{fee}</p><a class="btn {btn}" href="{href}">{cta}</a><ul>{items}</ul></article>')


TIERS = {
    "SOLO": tier("Solo", "For one freelancer", "$19", "$16", "$192", "<strong>1%</strong> on each client payment", "Start with Solo", [
        "<b>Listed on Payleor Network</b>", "<b>Intake agent</b>, 50 drafts a month", "Your seller page and pay links",
        "Pay pages, deposits and deliveries", "Guest checkout with PayPal", "<b>Web SEO</b> built into every page", "5 GB of files", "Export everything"]),
    "TEAM": tier("Team", "For small agencies and Discord teams", "$59", "$49", "$588", "<strong>0.5%</strong> on each client payment", "Start with Team", [
        "+Everything in Solo, plus:", "Up to 10 members", "<b>Intake agent</b>, 300 drafts a month", "<b>Team copilot</b> with charts",
        "Payouts by approval or by rule", "Discord and the public API", "Your own domain, no Payleor badge", "50 GB of files"],
        kind="pick", btn="btn-ink"),
    "AGENCY": tier("Agency", "For agencies up to 50 people", "$199", "$166", "$1,992", "<strong>0.25%</strong> on each client payment", "Start with Agency", [
        "+Everything in Team, plus:", "Up to 50 members", "<b>Intake agent</b>, 1,500 drafts a month", "<b>Payout agent</b> for automatic payouts",
        "A second approver for big payouts", "Several services teams", "Priority support", "500 GB of files"]),
    "ENTERPRISE": tier("Enterprise", "For networks and large teams", "Custom", "", "", "<strong>Custom</strong> fees", "Talk to sales", [
        "+Everything in Agency or Scale, plus:", "More than 50 people", "Several agencies, shops and studios in one account", "Custom agent limits",
        "A named contact and onboarding help", "Help moving your catalog", '<span class="later">Self-hosted, planned for 2027</span>'],
        kind="dark", href="contact.html#sales", btn="btn-mint"),
    "STARTER": tier("Starter", "For creators and new shops", "$12", "$9", "$108", "<strong>2%</strong> on each order", "Start with Starter", [
        "<b>Sold in Payleor Network carts</b>", "Storefront on your page", "<b>Web SEO</b> built into every page", "Digital downloads and courses",
        "Shipped goods, flat shipping and tracking", "One PayPal checkout across stores", "AI credits for your agents", "2 staff accounts"]),
    "GROW": tier("Grow", "For growing shops", "$39", "$29", "$348", "<strong>1%</strong> on each order", "Start with Grow", [
        "+Everything in Starter, plus:", "<b>Admin agent</b>", "More AI credits", "Your own domain", "5 staff accounts"],
        kind="pick", btn="btn-ink"),
    "SCALE": tier("Scale", "For large catalogs", "$129", "$99", "$1,188", "<strong>0.5%</strong> on each order", "Start with Scale", [
        "+Everything in Grow, plus:", "The most AI credits", "15 staff accounts", "Priority support"]),
}


