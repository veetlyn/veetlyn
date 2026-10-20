"""The blog's articles. Each teaches one difference Payleor makes, for one kind of seller."""

DATE = "2026-10-19"
DATE_LABEL = "October 19, 2026"

CATEGORIES = [
    ("network", "Payleor Network"),
    ("freelancers", "For freelancers"),
    ("agencies", "For agencies"),
    ("stores", "For stores"),
    ("studios", "For studios"),
    ("visibility", "Getting found"),
]

POSTS = [
    {
        "slug": "ai-shopping-left-services-out",
        "cat": "network",
        "art": "gap",
        "title": "AI shopping left services out. Here is how Payleor Network lets them in",
        "description": "AI assistants sell physical goods. Services, courses and downloads had no way in. Payleor Network is one connector that lets clients' AI find, ask and request, while the client pays on Payleor with PayPal.",
        "lead": "AI assistants now help people shop. Their own checkouts sell physical goods. Freelancers, agencies and everyone who sells their work had no way in.",
        "short": [
            "Assistant checkouts sell physical goods. Services and downloads fall outside their rules.",
            "Payleor Network is one connector that clients add to Claude or ChatGPT.",
            "The AI finds, asks and requests. The client accepts and pays on Payleor, with PayPal.",
        ],
        "sections": [
            ("What changed in 2026", [
                "People ask AI assistants for help with almost everything, including who to hire. The assistants answer with names and links. When it comes to payment, the rules are strict.",
                "OpenAI's guidelines for ChatGPT apps allow commerce only for physical goods, with checkout on the seller's own site. Anthropic's directory does not list software that executes financial transactions for users. OpenAI also retired Instant Checkout in March 2026, so purchases now finish on the seller's side.",
                "So a designer, a developer or a salon can be recommended, but the assistant cannot take the order. The client has to leave the chat and start again somewhere else.",
            ]),
            ("One connector for every seller", [
                "Payleor Network is a connector. A client adds it to Claude or ChatGPT once, by its address. From then on, their AI can search every seller on the network: services, courses, downloads and goods.",
                "No seller builds an app or passes a platform review. We do that work once, for everyone on the network.",
            ]),
            ("The AI never pays", [
                "Payleor Network keeps the money out of the chat. The AI can find sellers, ask questions, request quotes and fill a cart. It cannot commit the client to anything.",
                ["To accept a quote, the client presses a button on a card.",
                 "To accept a delivery, the client presses a button on a card.",
                 "To pay, the client opens Payleor's pay page and approves the payment in PayPal."],
                "This fits the platforms' rules, which target selling inside the chat. It also gives the seller a clear record of consent.",
            ]),
            ("A record for work with no tracking number", [
                "A parcel has a tracking number. A logo does not. Payleor keeps the agreed scope, every change, each delivery and the client's answers on the project. Both sides see the same record.",
            ]),
            ("Money after the sale", [
                "Most checkouts stop at the payment. Paid work often starts there. Payleor asks for the deposit, asks for the balance when the client accepts the delivery, and pays each member of a team their share by the rules the team set. The money goes through PayPal, and Payleor never holds it.",
            ]),
            ("What it costs a seller", [
                "Sellers pay their plan and a small fee on each payment. When the network brings a new client, Payleor takes 5% of that first project, once. After that, the client is the seller's own.",
                "For comparison, Gumroad's Discover marketplace takes 30% of each sale it brings, on every sale.",
            ]),
        ],
        "faq": [
            ("Is Payleor Network in the ChatGPT or Claude directory?", "Not yet. Clients add it by its address, api.payleor.com/mcp. Directory listings come after the platforms' review."),
            ("Can the AI spend the client's money?", "No. Every payment needs the client's approval in PayPal, on Payleor's page."),
            ("Who can be found on the network?", "Freelancers, agencies, stores and studios on Payleor. Every offering is listed by default, and sellers can take any of them off."),
        ],
        "cta": ("How Payleor Network works", "network.html"),
    },
    {
        "slug": "freelancers-get-hired-from-ai",
        "cat": "freelancers",
        "art": "freelancer",
        "title": "Freelancers: get hired from your clients' AI, and paid before you start",
        "description": "How a freelancer on Payleor gets briefs from clients' AI, sends a quote drafted by an agent, and collects a deposit through PayPal, with every fee shown to the cent.",
        "lead": "Clients now ask AI who to hire. Here is how a freelancer on Payleor gets the brief, sends the quote and collects a deposit through PayPal.",
        "short": [
            "Your services are on Payleor Network, so your clients' AI can find you.",
            "Your intake agent drafts each quote from your prices. You send it.",
            "The client pays half up front with PayPal, as a guest if they like.",
        ],
        "sections": [
            ("Get found where clients ask", [
                "A client asks Claude or ChatGPT for a logo, a site or an edit. If they use Payleor Network, your offer can come up with your price range and your delivery time. Buyers also see that the work is done by people, not by an automated seller.",
            ]),
            ("Quote in minutes, not evenings", [
                "The brief arrives as a request. Your intake agent drafts a quote from your own prices: the lines, the total and the delivery time. You check it and send it. Nothing goes out without you. The Solo plan includes 50 drafts a month.",
            ]),
            ("Get paid half up front", [
                "When the client accepts, they pay the deposit on your pay page with PayPal, or as a PayPal guest. The money goes to your PayPal business account. Payleor never holds it.",
            ]),
            ("Deliver, then get the rest", [
                "You deliver on the project page. The client accepts the delivery with a press and pays the balance. The project keeps the scope, the changes and the files, so both of you see the same record.",
            ]),
            ("What you keep", [
                "Here is a $640 logo project with a new client from the network, on the Solo plan:",
                ["Payleor takes 1% of each payment: $6.40.",
                 "Payleor takes 5% once, because the network brought the client: $32.00.",
                 "PayPal's own fee in this example: $22.83.",
                 "You keep $578.77."],
                "On the next project with the same client, Payleor takes 1% only. Your own clients never pay the 5%.",
            ]),
        ],
        "faq": [
            ("Do my clients need an account?", "No. They get a private link and can pay as a PayPal guest."),
            ("When do I pay the 5% network fee?", "Only on the first project with a client who found you through Payleor Network. The project shows it before you quote."),
            ("Can I bring my own clients?", "Yes. Your own clients only pay your plan's 1% fee."),
        ],
        "cta": ("Payleor for freelancers", "freelancers.html"),
    },
    {
        "slug": "agencies-split-client-payments",
        "cat": "agencies",
        "art": "agency",
        "title": "Agencies: one client payment, every member paid by your rules",
        "description": "How agencies on Payleor take requests from AI, Discord and their page, let an agent draft quotes, and pay every freelancer their share by approval, by rule or by the payout agent.",
        "lead": "Agencies spend hours paying freelancers by hand. On Payleor, each share is worked out per project and sent by rules you set.",
        "short": [
            "Requests come from AI, Discord or your page. The intake agent drafts the quote.",
            "The client pays the agency's PayPal. Payleor works out each member's share.",
            "Payouts go out by approval, by rule, or by the payout agent on the Agency plan.",
        ],
        "sections": [
            ("Requests from everywhere, one queue", [
                "A request can come from a client's AI through Payleor Network, from a request thread in your Discord, or from your own page. Each one lands in the same place. Your intake agent drafts the quote, and an admin confirms it.",
            ]),
            ("Every share worked out per project", [
                "You set the agency's cut and its management fee once. For each project, Payleor shows what the client pays, what each member receives and every fee, to the cent. Here is a $640 project from your own client, on the Team plan:",
                ["The client pays $704: the quote and a 10% management fee.",
                 "Amadou, the designer, receives $543.75.",
                 "The agency keeps $131.42.",
                 "PayPal's fees are $25.31, and Payleor's 0.5% is $3.52."],
            ]),
            ("Payouts by your rules", [
                "You decide how money leaves the agency:",
                ["Approve each payout yourself.",
                 "Approve payouts up to an amount automatically.",
                 "Pay each finished project after a waiting period.",
                 "On Agency, ask a second admin to approve big payouts, or let the payout agent pay by your rules."],
                "Each payout is sent once. If a request is retried after an error, PayPal still pays it only once.",
            ]),
            ("Ask your books", [
                "The team copilot answers money questions in plain words: what came in this week, what you owe each member, what is waiting. It reads your books and your PayPal reports. It changes nothing.",
            ]),
            ("Bring your own agents", [
                "On Team and Agency, your own agents can take requests, draft and deliver through the public API and webhooks. The same approvals and payout rules apply to them.",
            ]),
        ],
        "faq": [
            ("Do our members need a PayPal account?", "Yes. Each member connects their own PayPal, and their share goes straight to it."),
            ("We work in Slack or Microsoft Teams. Can we use them?", "Not yet. Slack comes after launch. Today, requests come from AI, Discord and your page, and notices go by email."),
            ("We are more than 50 people.", "Enterprise covers larger teams, several agencies and custom fees. Talk to sales."),
        ],
        "cta": ("Payleor for agencies", "agencies.html"),
    },
    {
        "slug": "stores-sell-in-ai-carts",
        "cat": "stores",
        "art": "store",
        "title": "Stores: sell in AI carts without building your own ChatGPT app",
        "description": "AI assistants can fill a cart, but most stores cannot plug into it. Payleor Network lets clients' AI fill one cart across Payleor stores, with one PayPal payment and an order for each store.",
        "lead": "AI assistants can now fill a shopping cart. Most stores cannot plug into it. Payleor Network gives every store on Payleor a place in it.",
        "short": [
            "Clients' AI searches products across Payleor stores and fills one cart.",
            "Checkout happens on Payleor: one PayPal payment, one order for each store.",
            "Downloads arrive at once. PayPal collects the shipping address for goods.",
        ],
        "sections": [
            ("Why most stores are not in AI carts", [
                "OpenAI retired Instant Checkout in March 2026. Purchases now finish on the seller's own site or in a retailer's own ChatGPT app. Building that app and getting it approved is out of reach for most small stores.",
            ]),
            ("One cart across stores", [
                "With Payleor Network, a client's AI can add products from several Payleor stores to one cart. The client checks out on Payleor in a new tab and approves one PayPal payment. Each store gets its own order, and its money goes to its own PayPal.",
            ]),
            ("Downloads, courses and goods", [
                ["Downloads and courses arrive at once, with time-limited links.",
                 "Goods ship with each store's flat shipping. PayPal collects the address, and you add tracking.",
                 "The same products sit on your page, behind one link for your bio."],
            ]),
            ("Coming from Shopify, WooCommerce or Gumroad", [
                "You can keep your current shop. Add your products to a Payleor store to sell them inside AI and behind your link in bio. There is no import tool yet.",
            ]),
            ("What it costs", [
                "Store plans start at $12 a month with a 2% fee on each order. Grow is $39 with 1%, and Scale is $129 with 0.5%. PayPal's own fees are separate.",
            ]),
        ],
        "faq": [
            ("Can I import my products from Shopify?", "Not yet. Add them to your Payleor store by hand for now."),
            ("Who collects the shipping address?", "PayPal, at checkout. You see it on the order."),
            ("Do I need a PayPal business account?", "Yes. Payments go straight into it."),
        ],
        "cta": ("Payleor for stores", "stores.html"),
    },
    {
        "slug": "studios-sell-services-and-products",
        "cat": "studios",
        "art": "studio",
        "title": "Studios: sell the session and the product from one shop",
        "description": "Salons, spas and studios sell time and things. Payleor runs services and products from one workspace and one link, pays staff their share, and halves the cheaper plan when you run both.",
        "lead": "Salons, spas and studios sell time and things. Most tools make you pick one. Payleor runs both from one workspace and one link.",
        "short": [
            "Services and products share one page, one link and one card in the chat.",
            "Staff get their share of each service through PayPal, by your rules.",
            "Run both and the cheaper plan is half price, with the lower fee on everything.",
        ],
        "sections": [
            ("One page for everything you sell", [
                "Your page lists your services next to your products: a pedicure next to the shampoo you use, a pottery class next to the mugs. The same list shows up in a client's AI through Payleor Network.",
            ]),
            ("Requests, not a calendar", [
                "Clients request a service and say when they would like it. You confirm the time and the price in the quote, and the client pays a deposit with PayPal. There is no booking calendar yet.",
            ]),
            ("Products in the same chat", [
                "In the same conversation, the client's AI can add your products to a cart. A service and a product are paid separately for now: the service on its pay page, the products at checkout.",
            ]),
            ("Staff paid their share", [
                "Your payout rules send each person their share of each service. Here is a $45 pedicure with a new client from the network: Inès receives $26.75, the salon keeps $13.45, PayPal takes $2.32 and Payleor $2.48.",
            ]),
            ("Pay less when you run both", [
                "The dearer plan is full price and the other is half. Team for services and Grow for the store come to $78.50 a month, and every payment and order pays 0.5%, the lower of the two fees.",
            ]),
        ],
        "faq": [
            ("Can a client pay for a service and a product at once?", "Not yet. A service is paid on its pay page, products at the cart checkout."),
            ("Is there a booking calendar?", "Not yet. Clients request a time, and you confirm it in the quote."),
        ],
        "cta": ("Payleor for studios", "studios.html"),
    },
    {
        "slug": "get-found-on-google-and-in-ai-answers",
        "cat": "visibility",
        "art": "visibility",
        "title": "How to get found on Google and in AI answers, without ads",
        "description": "Search engines and AI assistants read the web the same way: clear pages, plain facts and structured data. What helps a seller get found, and what Payleor does for you.",
        "lead": "Search engines and AI assistants read the web the same way: clear pages, plain facts and structured data. Here is what helps, and what Payleor does for you.",
        "short": [
            "Give each offer its own page that says what, for whom, where and at what price.",
            "Add structured data so machines read your prices and reviews correctly.",
            "Keep one link for everything, and be listed where AI looks for sellers.",
        ],
        "sections": [
            ("One clear page per offer", [
                "A page that answers the buyer's first question gets read, by people and by machines. For each offer, say:",
                ["What it is, in the words buyers search with.",
                 "Where you work, if it matters.",
                 "The price, or the range, and the delivery time.",
                 "Who does the work: people, AI or both."],
            ]),
            ("Structured data", [
                "Structured data is a short block of code that labels the facts on a page: this is a service, this is its price, these are its reviews. Search engines and AI tools read it to show your offer correctly. The usual types are Service, Product, Offer, LocalBusiness and FAQPage, written as JSON-LD.",
                "Structured data does not guarantee a rich result or a mention. It makes sure that, when you are shown, you are shown right.",
            ]),
            ("Proof that machines can check", [
                "Assistants prefer sellers they can verify. Keep your name, address and links the same everywhere. Reviews on your page, a Google Business Profile, a Trustpilot page and active social accounts all count.",
            ]),
            ("Files that AI crawlers look for", [
                ["A sitemap.xml lists every page you want found.",
                 "A robots.txt tells crawlers what they may read. Allow the AI crawlers you want to be found by.",
                 "An llms.txt is a plain text summary of your site for AI tools, with links to the pages that matter."],
            ]),
            ("Be where AI looks for sellers", [
                "Clients who add Payleor Network to Claude or ChatGPT search every seller on it. People can browse the same catalog on Discover. Every Payleor offering is listed in both by default.",
            ]),
            ("What Payleor does for you", [
                "Web SEO is included in every plan: structured data on every offer, a sitemap, an llms.txt, AI crawlers allowed, and a listing on Discover and Payleor Network.",
                "Network members also get AI visibility. An agent asks ChatGPT, Claude, Perplexity and Gemini about your field, drafts articles and page fixes for your approval, checks that your prices are quoted right, and reports every week. Membership opens by waitlist, with manual approval.",
                "We report what happened. We never promise rankings.",
            ]),
        ],
        "faq": [
            ("What is llms.txt?", "A plain text file at the root of a site that summarises it for AI tools, with links to the important pages."),
            ("Does structured data guarantee a rich result?", "No. It helps search engines and AI tools read your page correctly. They decide what to show."),
            ("Will Payleor rank me first?", "No one can promise that. We report what happened, honestly."),
        ],
        "cta": ("Get listed on Payleor Network", "network.html"),
    },
]
