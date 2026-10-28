/** Help content: step-by-step tutorials and knowledge base articles. Plain data so it is easy to edit. */

export type Tutorial = {
  id: string;
  title: string;
  summary: string;
  who: string;
  steps: { text: string; href?: string; linkLabel?: string }[];
  tip?: string;
  /** True when no screenshots exist for this tutorial (they are public/help/<id>-<step>.jpg). */
  noImages?: boolean;
};

export const TUTORIALS: Tutorial[] = [
  {
    id: "order-flow",
    title: "From order to invoice (the full order flow)",
    summary: "How an order moves from the sales rep to the pick ticket, the warehouse, the orders manager and the invoice.",
    who: "Sales rep, warehouse, orders manager",
    steps: [
      { text: "Sales rep: open Sales orders, choose the customer and create the order. Add each product, unit and price.", href: "/sales", linkLabel: "Sales orders" },
      { text: "Sales rep: set the ship date and check the Deliver to address (it comes from the customer; change it on the order if this delivery goes elsewhere).", },
      { text: "Sales rep: if the order needs extra care, tap Mark MUST CHECK. A red MUST CHECK box with a signature line prints in the corner of the pick ticket." },
      { text: "Sales rep: tap Send to pull. The order is now Ready to pull." },
      { text: "Tap Print pull ticket. It lists items by section of the shop, A to Z, with blank Pulled and Packed lines and Pulled by / Packed by signature lines." },
      { text: "Warehouse: pull the items, fill in the ticket and sign it, then hand the ticket back to the orders manager." },
      { text: "Anyone in sales or warehouse: open the order and tap Mark pulled. Stock comes out of the oldest lots first. To choose exact lots instead, use Mark pulled from chosen lots (or scan to pick)." },
      { text: "Orders manager: check the returned ticket against the order, then tap Mark completed. Made a mistake? Send back to Pulled." },
      { text: "Orders manager or sales: on a Completed order, set the sales tax % (leave 0 for resale-exempt customers) and tap Create invoice." },
      { text: "Print the invoice. It shows the billing location address, the delivery address and which shop it ships from.", href: "/invoices", linkLabel: "Invoices" },
    ],
    tip: "The bar at the top of every order shows where it is: Draft, Ready to pull, Pulled, Completed, Invoiced.",
  },
  {
    id: "pull-ticket",
    title: "Print and use a pull ticket",
    summary: "Get a one-page ticket the warehouse can walk the shop with.",
    who: "Sales rep, warehouse",
    steps: [
      { text: "Open the order (it must be Draft or Ready to pull) and tap Print pull ticket.", href: "/sales", linkLabel: "Sales orders" },
      { text: "Check the header: customer, ship date, number of lines. MUST CHECK shows in red at the top right if it was set." },
      { text: "Tap Print / PDF. Letter size, black and white." },
      { text: "Lines are grouped by the section of the shop where the stock is, and A to Z inside each section. Each line names the lot to pull from." },
      { text: "Anything short on stock appears under Not in stock with how much is missing." },
      { text: "Tick the box and fill in Pulled and Packed for each line, then sign Pulled by and Packed by at the bottom." },
    ],
    tip: "If you own more than one shop, the ticket groups by shop first, then section.",
  },
  {
    id: "receive",
    title: "Receive a purchase order",
    summary: "Bring stock in, split into lots, and print labels.",
    who: "Buyer, warehouse",
    steps: [
      { text: "Buyer: create a purchase order for the vendor, add lines and mark it Ordered.", href: "/purchasing", linkLabel: "Purchasing" },
      { text: "When the truck arrives, open Receiving and choose the order.", href: "/receiving", linkLabel: "Receiving" },
      { text: "Enter what actually arrived for each line and the location it goes to (and an expiry date where it applies)." },
      { text: "Save. Each delivery becomes a lot with its own code, cost and received date." },
      { text: "Open Lot labels from the order to print a label for each lot.", href: "/labels", linkLabel: "Labels" },
      { text: "If the order is only partly delivered it stays open. Close the order when nothing more is coming." },
    ],
  },
  {
    id: "labels",
    title: "Print lot and product labels",
    summary: "Labels for a roll printer or an ordinary printer.",
    who: "Warehouse, buyer",
    steps: [
      { text: "Open Labels, or tap Print label on a product or Lot labels on a purchase order.", href: "/labels", linkLabel: "Labels" },
      { text: "Choose lots or products and the number of labels for each." },
      { text: "In Settings → Printing, choose Label printer (thermal or roll) or Regular printer (plain paper). This is saved on that computer only.", href: "/settings", linkLabel: "Settings" },
      { text: "Tap Print. Each label has a scannable barcode for the lot." },
    ],
  },
  {
    id: "floor-plan",
    title: "Draw your shop in Location in shop",
    summary: "Shape sections to match the real floor, set the size in feet, and mark doors.",
    who: "Warehouse, admin",
    steps: [
      { text: "Open Location in shop. If you own several shops, use the shop menu to pick one or add another.", href: "/floor-plan", linkLabel: "Location in shop" },
      { text: "Enter the real width of the floor in feet. The grid and the sizes shown update to match." },
      { text: "Tap a section to select it. Drag it to move. Drag a corner dot to reshape it, tap a + to add a corner, double-tap a corner to remove it." },
      { text: "Drag the handles on the outer frame to resize and the round handle to rotate." },
      { text: "Add an Entry or Exit and name it if you have more than one." },
      { text: "Pick a product and tap a section to set where it lives (its home). Stock that is somewhere else shows differently so you can tell." },
    ],
  },
  {
    id: "counter",
    title: "Ring up a counter sale",
    summary: "A walk-in sale that is paid for on the spot.",
    who: "Sales",
    steps: [
      { text: "Open Counter sale. Walk-in is the default customer.", href: "/counter", linkLabel: "Counter sale" },
      { text: "Scan or search for products and set quantities." },
      { text: "Choose how the customer pays: cash, card or check. For a card terminal, send the amount to the terminal." },
      { text: "Finish the sale. Stock is pulled, the order is completed and an invoice is created and marked paid in one step." },
    ],
  },
  {
    id: "returns",
    title: "Record a return and give a credit",
    summary: "Put resellable items back in stock, write off damaged ones, and credit the customer.",
    who: "Sales, warehouse",
    steps: [
      { text: "Open the order the goods came from (it must be Pulled, Completed or Invoiced)." },
      { text: "Under Returns & credits, tap Record a return." },
      { text: "Enter the quantity for each line. Leave Restock ticked for items that can be resold; untick for damaged items (they are written off as shrink)." },
      { text: "Add a reason and save. The credit uses the price on the order plus the invoice's tax." },
      { text: "Mark the credit Applied (used on a later invoice) or Refunded (money returned).", href: "/returns", linkLabel: "Returns & credits" },
    ],
  },
  {
    id: "payments",
    title: "Take a deposit or payment",
    summary: "Record money against an order or invoice.",
    who: "Sales",
    steps: [
      { text: "Open the order or the invoice and find the Payments panel." },
      { text: "Before an order is invoiced, a payment is a deposit. After, it counts toward the invoice." },
      { text: "Pick the method, enter the amount (and tip if any) and save." },
      { text: "When payments cover the invoice total it is marked paid automatically. A mistaken payment can be voided, which reopens the invoice.", href: "/payments", linkLabel: "Payments" },
    ],
  },
  {
    id: "recurring",
    title: "Set up a recurring order",
    summary: "Orders that repeat each week for a customer.",
    who: "Sales",
    steps: [
      { text: "Open the customer and tap Recurring order next to New sales order.", href: "/customers", linkLabel: "Customers" },
      { text: "Name it, choose the days it repeats and add the products." },
      { text: "Planned orders appear under Sales orders → Recurring (planned) and move to your list a week before they ship." },
      { text: "Edit any one planned order without changing the rest, or skip it. Pause or end the whole series from the recurring order page." },
    ],
  },
  {
    id: "web-store",
    noImages: true,
    title: "Connect the web store",
    summary: "Bring website stock counts and orders into the app.",
    who: "Admin",
    steps: [
      { text: "Open Settings → Web store.", href: "/settings/web-store", linkLabel: "Web store" },
      { text: "Copy the webhook address and secret into your ordering website's settings." },
      { text: "Use Sync now to bring in current stock counts. Live webhooks keep it up to date after that." },
      { text: "Each web order becomes a Ready to pull sales order, once. The website stays the source of truth for stock numbers." },
    ],
  },
  {
    id: "messenger",
    title: "Use Messages",
    summary: "Chat with your team, start a group, react and send GIFs.",
    who: "Everyone",
    steps: [
      { text: "Open Messages. Team channels (Everyone, plus the one for your role) are on the left.", href: "/messages", linkLabel: "Messages" },
      { text: "Tap New chat → One person to message someone directly, or Group to name a group and tick who is in it (at least two others)." },
      { text: "Type and press Enter to send. Shift+Enter starts a new line." },
      { text: "Tap ☺ + under a message to react. Tap a reaction to add or remove yours." },
      { text: "Tap GIF to search GIFs. If it asks for a link, an admin hasn't added a GIPHY key yet; paste a GIF link instead." },
      { text: "A number beside a chat (and beside Messages in the menu) shows what you haven't read." },
    ],
  },
  {
    id: "users",
    noImages: true,
    title: "Add people and set their role",
    summary: "Who can do what.",
    who: "Admin",
    steps: [
      { text: "Ask the person to sign up on the login page. New people start inactive." },
      { text: "Open Settings → Users & roles.", href: "/admin/users", linkLabel: "Users & roles" },
      { text: "Choose their role and turn them active. Admin: everything. Buyer: products, vendors, purchasing, receiving. Warehouse: locations, stock, pulling. Sales: customers, orders, invoices. Orders manager: completes pulled orders, invoices." },
    ],
    tip: "The first person to sign up becomes the admin.",
  },
];

/** `images` are captions; picture n is /help/kb-<id>-<n>.jpg. */
export type Article = { id: string; category: string; title: string; body: string[]; images?: string[] };

export const ARTICLES: Article[] = [
  { id: "order-statuses", category: "Orders", title: "What each order status means", body: [
    "Draft: the sales rep is still building the order. It can be edited or deleted.",
    "Ready to pull: the order was sent to the warehouse and the pick ticket can be printed. Lines are locked.",
    "Pulled: the items were taken from stock (oldest lots first, or lots you chose). Stock counts drop at this point.",
    "Completed: the orders manager checked the returned pick ticket. Only completed orders can be invoiced.",
    "Invoiced: an invoice exists. If the invoice is voided, the order goes back to Completed.",
    "Cancelled: the order was cancelled before it was pulled. Orders with payments recorded can't be cancelled until the payments are voided.",
    "The bar at the top of every order shows where it is. The step it is on is filled in, with who does the next job underneath.",
  ], images: ["The step bar on an order that is Pulled and waiting for the orders manager."] },
  { id: "roles", category: "Orders", title: "Who can do what", body: [
    "Admin can do everything, including adding users and the web store connection.",
    "Sales can create and edit orders, set MUST CHECK, send orders to pull, invoice, take payments and manage customers.",
    "Warehouse can mark orders pulled, record returns, move and count stock, and edit the shop floor plan.",
    "Buyer manages products, vendors, purchase orders and receiving.",
    "Orders manager marks pulled orders Completed (or sends them back), creates and voids invoices, and builds delivery routes.",
    "Routing: the orders manager, warehouse and admins can change routes. Everyone else can look at them.",
    "Customer is for a buyer who orders from you. A customer login only gets the Shop page and their own display settings. See Customer logins and the shop. This is separate from the staff Buyer role.",
    "Everyone signed in and active can read orders, stock and use Messages.",
  ] },
  { id: "customer-logins", category: "Orders", title: "Customer logins, the shop and the sales catalog", body: [
    "A customer with a login can browse your items, see their own prices and add things to a cart. Their cart becomes a draft sales order that sales approves. They cannot see anything else in the system.",
    "Setting up a login takes two people. First the customer signs up on the login page. They stay switched off. Sales or an admin opens Customer logins, chooses the customer for that person and presses Set up.",
    "A different sales person or admin then presses Verify on the same row. Nobody can verify a login they set up themselves. Until it is verified the customer cannot shop. Remove takes the access away again.",
    "Prices a customer sees come from, in order: a price set just for them, otherwise the tier price (or the usual markup) less the customer's Discount %. Set the discount on the customer page. They also see the exact number available, which is stock on hand less what is already waiting on confirmed orders.",
    "The Sales catalog is the same list for staff. Pick a customer and each item shows what they would pay. Type a price under This customer only to give them a special price, or under the tier price to change it for everyone in that tier. Leave a box empty to go back to the normal price. Add items to the cart and press Create draft order.",
    "The customer's own orders arrive as drafts marked Customer cart in Sales orders. Check them, then confirm as usual. The customer sees them as Waiting for approval.",
  ], images: ["Customers who have signed up wait here until you choose which customer they belong to.", "A second person presses Verify before the customer can shop.", "On the Sales catalog, type a price for this customer only, or change the tier price.", "The customer's shop shows their price and how many are available. Press Add.", "Send order turns the cart into a draft order for sales to approve."] },
  { id: "must-check", category: "Orders", title: "MUST CHECK", body: [
    "Sales reps can flag any order MUST CHECK with a button at the top of the order, at any status.",
    "The red MUST CHECK box shows on the order and prints in the top right of the pull ticket with a line underneath for a signature.",
    "Remove it with the same button once the check is done.",
  ] },
  { id: "delivery-address", category: "Orders", title: "Delivery address vs location address", body: [
    "A customer has a location address (where the business is) and an optional delivery address.",
    "A new order copies the delivery address, or the location address if there is no delivery address. You can change it on that one order under Details → Deliver to.",
    "Invoices show both: Bill to · location, and Deliver to. They also show which shop the order ships from (set Ships from on the order if you have more than one shop).",
    "Routing uses the order's Deliver to address, so fix it on the order if a stop looks wrong.",
  ], images: ["Deliver to on a draft order. Change it here when this delivery goes somewhere else.", "An invoice with Bill to, Deliver to and Ships from."] },
  { id: "pull-ticket-guide", category: "Orders", title: "Reading and signing a pull ticket", body: [
    "Open an order that is Ready to pull and tap Print pull ticket. It is one letter-size page, black and white.",
    "The header shows the order number, customer, ship date and number of lines. A red MUST CHECK box with a signature line prints in the top right when the order has that flag.",
    "Lines are grouped by the shop section where the stock is now, A to Z inside each section. Each line names the lot to pull from. Anything short on stock is listed under Not in stock with how much is missing.",
    "Each line has a tick box and blank Pulled and Packed lines. At the bottom are Pulled by and Packed by signature lines. Fill them in and hand the ticket back to the orders manager.",
  ], images: ["The ticket header, with order, customer and ship date.", "A section of the ticket with the tick box, lot, quantity, and Pulled and Packed lines.", "The Pulled by and Packed by signature lines at the bottom."] },
  { id: "routing-day", category: "Orders", title: "Routing: build a day's delivery route", body: [
    "Open Selling → Routing. Pick the Delivery day. The list is every Completed or Invoiced order that ships that day from the chosen shop. The route starts at the shop's address and ends at the last stop; there is no trip back.",
    "Tap Closest to farthest to sort the stops by distance from the shop, or use the up and down arrows to set the order yourself. Remove takes an order off the route and it moves to Not on this route, where Add puts it back.",
    "Under each stop you can see the delivery address and the miles from the stop before it. The total shows the number of stops, miles and a driving-time estimate.",
    "Open in Google Maps opens the whole route in Google Maps with every stop in order. More than 10 stops are split into several links, each one starting where the last ended.",
    "Type the driver's name, then Save route to keep the order. Print route sheet prints a sheet with a tick box beside each stop.",
    "You can also add orders by scanning an invoice barcode. See Adding orders to a route by scanning the invoice.",
    "In the full app the first time an address is used it is looked up with Google and remembered. This needs the Google Maps key (see Setting up Google Maps for Routing). In the demo the map positions are made up.",
  ], images: ["Pick the delivery day. The orders that ship that day are listed.", "Closest to farthest sorts the stops by distance from the shop.", "Use the arrows to move a stop up or down.", "Open in Google Maps opens the whole route.", "Print route sheet prints the driver's copy."] },
  { id: "maps-setup", category: "Settings", title: "Setting up Google Maps for Routing (admin)", body: [
    "Routing needs a Google Maps key so it can find addresses and open real roads. Without it you can still order stops by hand and use the Open in Google Maps links.",
    "In Google Cloud (console.cloud.google.com) create a project and attach billing. Google asks for a card, but this use normally stays within the free monthly credit.",
    "Under APIs & Services → Library enable Geocoding API and Routes API. Under Credentials create an API key.",
    "Edit the key: under Application restrictions choose Websites and add your site's address. Under API restrictions allow only those two APIs. This stops anyone else using the key.",
    "In the app open Settings → Maps & routing (admins only). Paste the key and save. Also fill in each shop's address on that page; the route starts there.",
  ], images: ["Maps & routing settings: paste the key here.", "Each shop's address is the starting point of its routes."] },
  { id: "gif-setup", category: "Messages", title: "Setting up GIF search in Messages (admin)", body: [
    "GIF search uses GIPHY. Without a key people can still paste a GIF link into a message.",
    "Go to developers.giphy.com, sign in, choose Create an App and pick API (not SDK). Copy the key it gives you.",
    "Add it where the app is hosted as an environment variable named GIPHY_API_KEY, then redeploy. On Vercel that is Project → Settings → Environment Variables.",
    "New GIPHY keys start in a limited beta mode, which is fine for a small team. Apply for production access later if you hit the limit.",
    "Then the GIF button in a chat opens a search box.",
  ], images: ["The GIF button is next to the message box."] },
  { id: "scan-box-return", category: "Stock", title: "Returning a received box to the vendor (scan the box label)", body: [
    "Every lot you receive gets a label with a barcode (Lot labels on the purchase order, or Labels). Print one label per physical box; they all carry the same lot code.",
    "To start a return, scan the box label on the Scan page, with a handheld scanner or the Camera button on a phone. The lot page opens.",
    "Under Return to vendor you will see the vendor and their email, the purchase order, product, quantity received, cost, lot code and received date.",
    "Tap Email vendor to open a draft addressed to the vendor with all of that filled in. Add the reason and send it from your mail app. Copy details copies the same text.",
    "If the vendor has no email, add it on the vendor page first. Credits you receive from the vendor are not tracked in the app yet.",
  ], images: ["Lot labels on a received purchase order print a barcode label for each lot.", "Scan the box label (or type its code) on the Scan page.", "Return to vendor on the lot page. Email vendor opens the draft."] },
  { id: "scan-route", category: "Orders", title: "Adding orders to a route by scanning the invoice", body: [
    "Every invoice prints a barcode of its invoice number at the bottom right.",
    "On Routing, scan that barcode (scanner or Camera) to add the order to the day's route. Scanning an order number works too.",
    "Only Completed or Invoiced orders can be added. An order that ships on a different day is added and marked with its ship date.",
    "Scanning an order that is already on the route just tells you so. Tap Save route to keep the changes.",
  ], images: ["The invoice barcode, bottom right of every invoice.", "Scan the barcode into the box on Routing."] },
  { id: "pull-order", category: "Stock", title: "How stock is chosen when an order is pulled", body: [
    "Mark pulled takes stock from the oldest lots first (by received date), so older flowers go first.",
    "Mark pulled from chosen lots lets you pick exact lots or scan them. The quantities must add up to the line.",
    "If there isn't enough stock, the order is blocked and nothing is taken. The pick ticket lists what is short.",
  ] },
  { id: "lots", category: "Stock", title: "Lots, units and costs", body: [
    "Every delivery creates a lot with a code, received date, expiry date, location and cost.",
    "Products have a base unit (usually the stem) and other units such as bunch or box, each with a conversion. Stock is always counted in the base unit.",
    "Cost uses FIFO: an order's cost is the cost of the lots it was pulled from. Margin on an order is price minus that cost.",
    "Landed cost includes freight shared across the lines of a purchase order.",
  ] },
  { id: "shrink", category: "Stock", title: "Shrink, adjustments and counts", body: [
    "Shrink is stock that is lost, damaged or thrown out. Record it with a reason so reports show where losses come from.",
    "An adjustment corrects a lot's quantity after a count.",
    "Resellable returns go back into the lots they came from. Returned items marked not resellable are written off as shrink automatically.",
  ] },
  { id: "floor-plan-faq", category: "Stock", title: "Shop floor plan basics", body: [
    "Each shop has its own layout and its own sections. Sections can be any shape.",
    "Sizes are in feet, based on the floor width you enter. The grid shows foot squares.",
    "A product's home is the section where it belongs. Stock sitting somewhere else is shown so you can find and move it.",
    "The pull ticket groups lines by the section the stock is in right now.",
    "Moving a section to another shop clears its old shape and the product homes that pointed to it.",
  ] },
  { id: "labels-faq", category: "Stock", title: "Label printing", body: [
    "Choose Label printer for a roll or thermal printer, or Regular printer for plain paper, in Settings → Printing.",
    "That choice is saved on the computer you are using, so each workstation can use its own printer.",
    "If labels print with extra blank pages, check the printer's paper size is set to the label size in your print dialog.",
  ] },
  { id: "invoices-faq", category: "Money", title: "Invoices, tax and terms", body: [
    "Terms come from the customer (Net 30 by default) and set the due date.",
    "Sales tax is typed when you create the invoice. Leave 0 for resale-exempt customers; the resale certificate number is kept on the customer and printed on the invoice.",
    "Void an open invoice to correct the order; it goes back to Completed so you can invoice again. Paid invoices, or invoices with payments, can't be voided until the payments are voided.",
  ] },
  { id: "payments-faq", category: "Money", title: "Deposits, partial payments and terminals", body: [
    "Money taken before invoicing is a deposit and is applied to the invoice when it is created.",
    "Partial payments keep the invoice open and show the balance.",
    "Card payments can be sent to a payment terminal. If a payment is declined it stays on record as declined and does not count.",
    "Voiding a payment reopens a paid invoice.",
  ] },
  { id: "returns-faq", category: "Money", title: "Returns and credits", body: [
    "You can only return what was sold, and not more than what is still returnable on the line.",
    "The credit is at the price on the order plus the invoice's tax rate.",
    "A credit starts Open. Mark it Applied when it is used on a later invoice, or Refunded when money is returned.",
  ] },
  { id: "recurring-faq", category: "Orders", title: "Recurring orders", body: [
    "A recurring order creates planned draft orders on the days you choose.",
    "Planned orders stay under Recurring (planned) until a week before they ship, then join the normal list.",
    "Editing a planned order marks it as edited, and it is left alone if you later change the series.",
    "Skipping a planned order cancels just that one.",
  ] },
  { id: "web-store-faq", category: "Web store", title: "How the web store connection behaves", body: [
    "The website is the source of truth for stock numbers. Counts come in as the supply figure; what you pull in the app is subtracted from them.",
    "Each web order creates one Ready to pull order, even if the website sends it twice.",
    "A cancelled web order cancels the matching order only if it hasn't been pulled yet.",
    "Use Sync now any time, and check the log on the Web store page if a number looks wrong.",
  ] },
  { id: "messages-faq", category: "Messages", title: "Messages: channels, privacy and GIFs", body: [
    "Team channels are shared: Everyone, Sales, Warehouse and Buyers. You only see the channels for your role (admins see all).",
    "Direct chats and groups are private to the people in them. Admins can't read them.",
    "Messages are kept; there is no edit or delete yet.",
    "GIF search needs a GIPHY key (see Setting up GIF search in Messages). Without it you can paste a GIF link.",
    "Messages arrive live. If your host doesn't support live updates, the page refreshes every 5 seconds.",
    "New chat starts a direct chat or a group. A number beside a chat, and beside Messages in the menu, is what you haven't read.",
  ], images: ["New chat starts a direct chat or a group.", "GIF opens the GIF search (or asks for a link if no key is set up)."] },
  { id: "appearance", category: "Settings", title: "Appearance and printing settings", body: [
    "Settings → Appearance sets the colour palette and light, dark or follow-my-device. It is saved on that device.",
    "Font: pick any of 12 open-source typefaces for yourself, including OpenDyslexic (made to help people with dyslexia), Lexend and Atkinson Hyperlegible (both made for easier reading). Choose Palette default to go back. Each person's choice is saved on their own device.",
    "Invoices, labels and pull tickets always print in black and white whatever palette is chosen.",
    "Printing settings (label or regular printer) are saved per computer.",
  ], images: ["The Font section of Settings → Appearance. Tap a font to use it right away."] },
  { id: "help-guide", category: "Settings", title: "Using Tutorials and the Knowledge base", body: [
    "Settings → Tutorials has step-by-step guides for the main jobs. Each step has a picture with an orange box and arrow showing what to tap or fill in.",
    "Tap a name at the top of the page to jump to a guide. Links beside a step open the right page.",
    "Settings → Knowledge base explains how things work. Search by any word, or pick a category. Tap an article to open it.",
    "Tutorials show the demo's screens, so colours and fonts may differ slightly from yours.",
  ], images: ["Tutorials and Knowledge base are in the Help part of Settings.", "Every step has a picture with an arrow.", "Search the Knowledge base by any word."] },
  { id: "phone", category: "Settings", title: "Using the app on a phone", body: [
    "Tap the menu button at the top left to open the slide-in menu. Groups (Buying, Stock, Selling, Reports & data, Settings) fold open and closed, and the app remembers which are open.",
    "Floor plans, labels and pull tickets work on a phone, but print from a computer when you can.",
    "Messages opens on the chat list on a phone. Tap a chat to open it and the arrow to go back.",
  ] },
  { id: "import-export", category: "Settings", title: "Import and export data", body: [
    "Reports & data → Import data brings in products, vendors and customers from CSV files. A preview shows problems before anything is saved.",
    "Export CSV buttons on lists download what you are looking at.",
  ] },
];

export const KB_CATEGORIES = ["Orders", "Stock", "Money", "Web store", "Messages", "Settings"];
