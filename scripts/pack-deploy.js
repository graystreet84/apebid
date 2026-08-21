const fs = require("fs");
const path = require("path");
const root = "/workspace/apebid";
const skip = new Set(["node_modules", ".next", "promo", "data", "scripts", ".vercel", ".git"]);
const files = [];
function walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name) || name.startsWith(".")) continue;
    if (name === "package-lock.json" || name === "next.config.mjs") continue;
    const abs = path.join(dir, name);
    const r = rel ? rel + "/" + name : name;
    if (fs.statSync(abs).isDirectory()) walk(abs, r);
    else if (/\.(ts|tsx|js|mjs|css|json)$/.test(name) || name === "next-env.d.ts") {
      files.push({ file: r, data: fs.readFileSync(abs, "utf8") });
    }
  }
}
walk(root, "");
files.push({
  file: ".env.production",
  data:
    "NEXT_PUBLIC_TREASURY_ADDRESS=Csx6qmKTzcrSQAVjRRygMQ8RqRJcAPiDNJD5ZnbZyQmt\n" +
    "DEV_FAKE_TX=false\n" +
    "NEXT_PUBLIC_DEV_FAKE_TX=false\n",
});
fs.writeFileSync("/tmp/apebid-deploy-files.json", JSON.stringify({ files }));
console.log(files.length);
files.forEach((f) => console.log(f.file, f.data.length));
