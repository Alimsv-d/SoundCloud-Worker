// Scan tracked files for secrets before commit.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "AWS key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Generic secret", re: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
  { name: "Bot token", re: /\d{8,}:[A-Za-z0-9_-]{30,}/ },
  { name: "Private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Bearer long", re: /Bearer\s+[A-Za-z0-9_\-]{24,}/ },
  { name: "Slack hook", re: /https:\/\/hooks\.slack\.com\/services\// },
  { name: "GH token", re: /gh[psour]_[A-Za-z0-9]{30,}/ },
];

let files;
try {
  files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  files = [];
}
let bad = 0;
for (const f of files) {
  if (/(\.example$|secret-scan|README|SETUP)/.test(f)) continue;
  let content;
  try { content = readFileSync(f, "utf8"); } catch { continue; }
  for (const { name, re } of PATTERNS) {
    if (re.test(content)) {
      console.error(`✗ possible ${name} in ${f}`);
      bad++;
    }
  }
}
if (bad) { console.error(`\n${bad} potential secret(s) found.`); process.exit(1); }
console.log("secret-scan: clean");
