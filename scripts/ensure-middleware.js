const fs = require("fs");
const p = "/tmp/apebid-deploy-files.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (!j.files.some((f) => f.file === "src/middleware.ts")) {
  j.files.push({
    file: "src/middleware.ts",
    data: fs.readFileSync("/workspace/apebid/src/middleware.ts", "utf8"),
  });
}
fs.writeFileSync(p, JSON.stringify(j));
console.log(j.files.length);
j.files.forEach((f) => console.log(f.file));
