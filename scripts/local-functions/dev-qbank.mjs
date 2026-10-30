// `npm run dev:qbank` — the dev server with qbank-generate running locally.
//
// The local QBank function writes real questions to the linked project (the
// session has to find them there), so it needs the service-role key. This
// fetches it from the logged-in Supabase CLI into THIS process's environment
// only: it is never written to a file and never printed. Everything else is
// `vite` as usual, plus VITE_LOCAL_QBANK=1 so the client calls the local route.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const ref = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const keys = spawnSync(npx, ["--no-install", "supabase", "projects", "api-keys", "--project-ref", ref, "-o", "json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
let serviceKey = "";
try {
  const out = keys.stdout ?? "";
  const list = JSON.parse(out.slice(out.indexOf("[")));
  serviceKey = list.find((k) => k.name === "service_role")?.api_key ?? "";
} catch {
  // reported below
}
if (!serviceKey) {
  console.error("dev:qbank — could not read the service-role key from the Supabase CLI. Is it logged in and linked?");
  process.exit(1);
}

console.log(`dev:qbank — qbank-generate runs locally against project ${ref} (service-role key in memory only)`);
const child = spawn(npx, ["--no-install", "vite"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: serviceKey, VITE_LOCAL_QBANK: "1", VITE_LOCAL_FUNCTIONS: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
