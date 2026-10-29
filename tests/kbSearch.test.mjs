import { searchKb, highlight, stem, queryTerms } from "../lib/kbSearch.ts";
import { ARTICLES, TUTORIALS } from "../lib/help.ts";
let pass = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exit(1); } pass++; console.log("ok -", m); };
const docs = [
  ...ARTICLES.map((a) => ({ id: a.id, kind: "article", title: a.title, category: a.category, text: a.body })),
  ...TUTORIALS.map((t) => ({ id: t.id, kind: "tutorial", title: t.title, category: "Tutorial", text: [t.summary, ...t.steps.map((s) => s.text)] })),
];
ok(stem("roses") === "rose" && stem("printing") === "print" && stem("labels") === "label" && stem("pulled") === "pull", "stems");
ok(queryTerms("How do I print a label?").join() === "print,label", "drops stop words");
const top = (q) => searchKb(docs, q)[0]?.doc.id;
ok(top("label printing") === "labels-faq" || searchKb(docs, "label printing").slice(0, 3).some((h) => h.doc.id === "labels-faq"), "label printing finds the label article: " + top("label printing"));
ok(searchKb(docs, "shelves").slice(0, 3).some((h) => h.doc.id === "sections-shelves"), "plural finds sections and shelves");
ok(searchKb(docs, "password hint").slice(0, 2).some((h) => h.doc.id === "passwords-printouts"), "password hint ranks the passwords article high");
ok(searchKb(docs, "signing pdf").some((h) => h.doc.id === "documents"), "signing finds documents");
ok(searchKb(docs, "pull ticket").some((h) => h.doc.kind === "tutorial"), "tutorials are searched too");
const r = searchKb(docs, "zzzz qqqq");
ok(r.length === 0, "nonsense finds nothing");
const p = searchKb(docs, "invoice zzzz");
ok(p.length > 0 && p[0].partial, "falls back to partial matches");
const h = highlight("Print labels from Settings.", ["label", "print"]);
ok(h.filter((x) => x.hit).map((x) => x.t).join("|") === "Print|labels", "highlights matching words: " + JSON.stringify(h));
console.log(`\n${pass} checks passed`);
