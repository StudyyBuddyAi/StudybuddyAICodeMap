/**
 * Ingest anatomical illustrations into Supabase Storage + anatomy_images.
 *
 *   node scripts/ingest-anatomy.js <folder> [--dry-run] [--limit N]
 *
 * --dry-run reports what would be extracted from each file and writes nothing,
 * so label and ratio extraction can be checked against a real folder before
 * spending any embedding calls.
 *
 * Reads credentials from .env the same way scripts/check_guidelines_client.js
 * does, so nothing needs exporting first.
 *
 * Embeddings go through OpenRouter with a plain fetch. @langchain/openai is a
 * Deno-only `npm:` specifier used inside the edge functions and is not a root
 * dependency — not worth adding one for a single call.
 *
 * Re-runs are safe: the storage upload upserts and the row upserts on
 * storage_path, so an interrupted batch can simply be run again.
 */
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "anatomy";
const EMBEDDING_MODEL = "text-embedding-3-small";
/** Must match anatomy_images.embedding and guideline_chunks. */
const EMBEDDING_DIMS = 1536;

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// ── pure helpers (imported by src/test/ingest-anatomy.test.ts) ───────────────

/**
 * Structure names printed inside an SVG as real text.
 *
 * Returns [] when the labels were converted to vector outlines — common in
 * published illustrations — or for raster formats. Those images still ingest;
 * the panel offers a free-text box instead of chips.
 *
 * This takes *every* text node, so titles, credits and scale bars come through
 * as labels too. Pruning them is a curation step, not something the regex can
 * judge.
 */
export function extractLabels(svg) {
  const texts = [...svg.matchAll(/<text\b[\s\S]*?<\/text>/g)]
    // Multilingual illustrations (Wikimedia's are typical) wrap every label in
    // a <switch> holding one <text systemLanguage="..."> per translation plus
    // an untagged English fallback. Without this filter a single diagram
    // yields its whole label set once per language.
    .filter((m) => {
      const lang = /systemLanguage="([^"]*)"/.exec(m[0]);
      return !lang || /(^|,)\s*en\b/i.test(lang[1]);
    })
    .map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1 && t.length <= 60);
  return [...new Set(texts)];
}

/** Intrinsic width/height, so the panel reserves the right box per image. */
export function aspectFromViewBox(svg) {
  const vb = svg.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/);
  if (vb) {
    const ratio = Number(vb[1]) / Number(vb[2]);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
  }
  // Some SVGs size themselves with width/height and declare no viewBox.
  const w = svg.match(/\bwidth=["']([\d.]+)/);
  const h = svg.match(/\bheight=["']([\d.]+)/);
  if (w && h) {
    const ratio = Number(w[1]) / Number(h[1]);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
  }
  return null;
}

/**
 * Organ keyword -> curriculum_topics.system.
 *
 * The 13 system names are curriculum_topics' own vocabulary, spelled exactly:
 * anatomy-match resolves a sheet topic to one of these and filters on it, so a
 * typo here silently means "no diagram for that whole system".
 */
const ORGAN_TO_SYSTEM = {
  heart: "Cardiovascular",
  cardiac: "Cardiovascular",
  circulatory: "Cardiovascular",
  vascular: "Cardiovascular",
  respiratory: "Respiratory",
  lung: "Respiratory",
  pulmonary: "Respiratory",
  airway: "Respiratory",
  digestive: "Gastrointestinal",
  gastrointestinal: "Gastrointestinal",
  alimentary: "Gastrointestinal",
  liver: "Gastrointestinal",
  stomach: "Gastrointestinal",
  intestine: "Gastrointestinal",
  endocrine: "Endocrinology",
  thyroid: "Endocrinology",
  pancreas: "Endocrinology",
  nephron: "Renal & Urinary",
  kidney: "Renal & Urinary",
  renal: "Renal & Urinary",
  urinary: "Renal & Urinary",
  bladder: "Renal & Urinary",
  brain: "Neurology & Neurological Surgery",
  neuron: "Neurology & Neurological Surgery",
  neural: "Neurology & Neurological Surgery",
  nervous: "Neurology & Neurological Surgery",
  spinal: "Neurology & Neurological Surgery",
  skin: "Musculoskeletal, Skin & Subcutaneous Tissue",
  muscle: "Musculoskeletal, Skin & Subcutaneous Tissue",
  muscular: "Musculoskeletal, Skin & Subcutaneous Tissue",
  bone: "Musculoskeletal, Skin & Subcutaneous Tissue",
  skeletal: "Musculoskeletal, Skin & Subcutaneous Tissue",
  blood: "Blood, Lymphoreticular & Immune System",
  immune: "Blood, Lymphoreticular & Immune System",
  lymphatic: "Blood, Lymphoreticular & Immune System",
  reproductive: "Reproductive & Obstetrics/Gynecology",
  uterus: "Reproductive & Obstetrics/Gynecology",
  ovary: "Reproductive & Obstetrics/Gynecology",
};

/**
 * Which organ system an image belongs to, or null when nothing matches.
 *
 * Checks the parsed organ first, then any word of the title — real filenames
 * often lead with something else ("Human_heart_outside" parses organ "Human"),
 * and a null here removes the image from system-filtered matching entirely.
 */
export function systemFor(title, organ) {
  const direct = ORGAN_TO_SYSTEM[String(organ ?? "").toLowerCase()];
  if (direct) return direct;
  for (const word of String(title ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (ORGAN_TO_SYSTEM[word]) return ORGAN_TO_SYSTEM[word];
  }
  return null;
}

/** heart_anterior_chambers.svg -> organ "heart", view "anterior", title "heart anterior chambers" */
export function parseName(file) {
  const stem = basename(file, extname(file));
  // Underscore is the only separator: the convention puts hyphens *inside* a
  // segment (nephron_cross-section_tubules), so splitting on them as well
  // would read "cross" as the view and strand "section".
  const [organ, view, ...rest] = stem.split("_").filter(Boolean);
  return {
    organ: organ ?? "unknown",
    view: view ?? null,
    title: [organ, view, ...rest].filter(Boolean).join(" "),
  };
}

async function embed(text, apiKey) {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embedding ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const vector = (await res.json())?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("embedding response had no vector");
  // Guards the one mistake that fails silently: a vector of the wrong width
  // writes fine and then never matches anything.
  if (vector.length !== EMBEDDING_DIMS) {
    throw new Error(`embedding was ${vector.length} dims, expected ${EMBEDDING_DIMS}`);
  }
  return vector;
}

function readEnv() {
  const out = {};
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall back to the process environment */
  }
  return { ...out, ...process.env };
}

// ── run ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

  if (!dir) {
    console.error("usage: node scripts/ingest-anatomy.js <folder> [--dry-run] [--limit N]");
    process.exit(1);
  }

  const env = readEnv();
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const openRouterKey = env.OPENROUTER_API_KEY;

  if (!dryRun) {
    const missing = [
      !supabaseUrl && "SUPABASE_URL (or VITE_SUPABASE_URL)",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
      !openRouterKey && "OPENROUTER_API_KEY",
    ].filter(Boolean);
    if (missing.length) {
      console.error(`Missing in .env: ${missing.join(", ")}`);
      console.error("Run with --dry-run to check extraction without credentials.");
      process.exit(1);
    }
  }

  const db = dryRun ? null : createClient(supabaseUrl, serviceKey);

  const files = (await readdir(dir))
    .filter((f) => MIME[extname(f).toLowerCase()])
    .slice(0, limit);

  console.log(`${files.length} image${files.length === 1 ? "" : "s"} in ${dir}`);
  if (dryRun) console.log("DRY RUN — nothing is uploaded, embedded or written\n");

  let ok = 0;
  let failed = 0;
  let noLabels = 0;
  let noRatio = 0;
  let noSystem = 0;

  for (const file of files) {
    try {
      const ext = extname(file).toLowerCase();
      const buf = await readFile(join(dir, file));
      const svg = ext === ".svg" ? buf.toString("utf8") : null;

      const { organ, view, title } = parseName(file);
      const labels = svg ? extractLabels(svg) : [];
      const aspectRatio = svg ? aspectFromViewBox(svg) : null;
      const storagePath = `${organ}/${file}`;

      const bodySystem = systemFor(title, organ);
      if (!labels.length) noLabels++;
      if (aspectRatio === null) noRatio++;
      if (!bodySystem) noSystem++;

      if (dryRun) {
        const shape = aspectRatio === null ? "ratio ?" : aspectRatio < 1 ? "tall" : "wide";
        console.log(
          `· ${file}\n    title "${title}" | system ${bodySystem ?? "UNMAPPED"} | view ${view ?? "-"} | ` +
            `${shape}${aspectRatio ? ` ${aspectRatio.toFixed(3)}` : ""} | ${labels.length} labels` +
            (labels.length ? `\n    ${labels.join(" · ")}` : "")
        );
        ok++;
        continue;
      }

      const upload = await db.storage
        .from(BUCKET)
        .upload(storagePath, buf, { contentType: MIME[ext], upsert: true });
      if (upload.error) throw upload.error;

      const { error } = await db.from("anatomy_images").upsert(
        {
          title,
          organ,
          view,
          body_system: bodySystem,
          labels,
          aspect_ratio: aspectRatio,
          storage_path: storagePath,
          embedding: await embed(`${title}. Structures: ${labels.join(", ")}`, openRouterKey),
        },
        { onConflict: "storage_path" }
      );
      if (error) throw error;

      ok++;
      console.log(`ok  ${file} — ${labels.length} labels`);
    } catch (e) {
      failed++;
      console.error(`ERR ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `\ndone: ${ok} ok, ${failed} failed` +
      `\n      ${noLabels} without labels (free-text box instead of chips)` +
      `\n      ${noRatio} without a readable ratio (falls back to 4:3)` +
      `\n      ${noSystem} with no organ system (excluded from topic matching)`
  );
  if (!dryRun && ok > 0) {
    console.log("\nOnce the corpus is loaded, build the vector index:");
    console.log("  create index idx_anatomy_images_embedding on public.anatomy_images");
    console.log("    using ivfflat (embedding vector_cosine_ops) with (lists = 100);");
    console.log("  analyze public.anatomy_images;");
  }
}

// Guarded so the helpers above can be imported by tests without the script
// reading argv, walking a directory, or calling process.exit.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
