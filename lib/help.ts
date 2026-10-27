/** Help content: step-by-step tutorials and knowledge base articles. Plain data so it is easy to edit. */

export type Tutorial = {
  id: string;
  title: string;
  summary: string;
  who: string;
  steps: { text: string; href?: string; linkLabel?: string }[];
  tip?: string;
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

export type Article = { id: string; category: string; title: string; body: string[] };

export const ARTICLES: Article[] = [
  { id: "order-statuses", category: "Orders", title: "What each order status means", body: [
    "Draft: the sales rep is still building the order. It can be edited or deleted.",
    "Ready to pull: the order was sent to the warehouse and the pick ticket can be printed. Lines are locked.",
    "Pulled: the items were taken from stock (oldest lots first, or lots you chose). Stock counts drop at this point.",
    "Completed: the orders manager checked the returned pick ticket. Only completed orders can be invoiced.",
    "Invoiced: an invoice exists. If the invoice is voided, the order goes back to Completed.",
    "Cancelled: the order was cancelled before it was pulled. Orders with payments recorded can't be cancelled until the payments are voided.",
  ] },
  { id: "roles", category: "Orders", title: "Who can do what", body: [
    "Admin can do everything, including adding users and the web store connection.",
    "Sales can create and edit orders, set MUST CHECK, send orders to pull, invoice, take payments and manage customers.",
    "Warehouse can mark orders pulled, record returns, move and count stock, and edit the shop floor plan.",
    "Buyer manages products, vendors, purchase orders and receiving.",
    "Orders manager marks pulled orders Completed (or sends them back), creates and voids invoices.",
    "Everyone signed in and active can read orders, stock and use Messages.",
  ] },
  { id: "must-check", category: "Orders", title: "MUST CHECK", body: [
    "Sales reps can flag any order MUST CHECK with a button at the top of the order, at any status.",
    "The red MUST CHECK box shows on the order and prints in the top right of the pull ticket with a line underneath for a signature.",
    "Remove it with the same button once the check is done.",
  ] },
  { id: "delivery-address", category: "Orders", title: "Delivery address vs location address", body: [
    "A customer has a location address (where the business is) and an optional delivery address.",
    "A new order copies the delivery address, or the location address if there is no delivery address. You can change it on that one order under Details → Deliver to.",
    "Invoices show both: Bill to · location, and Deliver to. They also show which shop the order ships from (set Ships from on the order if you have more than one shop).",
  ] },
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
    "GIF search needs a GIPHY key (GIPHY_API_KEY in the app's settings on your host). Without it you can paste a GIF link.",
    "Messages arrive live. If your host doesn't support live updates, the page refreshes every 5 seconds.",
  ] },
  { id: "appearance", category: "Settings", title: "Appearance and printing settings", body: [
    "Settings → Appearance sets the colour palette and light, dark or follow-my-device. It is saved on that device.",
    "Invoices, labels and pull tickets always print in black and white whatever palette is chosen.",
    "Printing settings (label or regular printer) are saved per computer.",
  ] },
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
