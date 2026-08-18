import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars = {};
envContent.split(/\r?\n/).forEach(line => {
  const parts = line.split("=");
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join("=").trim();
    envVars[key] = val;
  }
});

const supabaseUrl = envVars["VITE_SUPABASE_URL"];
const supabaseKey = envVars["VITE_SUPABASE_PUBLISHABLE_KEY"];

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from("guideline_chunks")
    .select("guideline_id, guideline_name, section_title, content, embedding")
    .limit(3);
    
  if (error) {
    console.error("Error:", error.message);
    return;
  }
  
  data.forEach((row, idx) => {
    // Check embedding dimension
    // Row.embedding can be a string like "[1,2,3]" or an array
    const embeddingArray = row.embedding;
    const dim = typeof embeddingArray === "string" 
      ? embeddingArray.replace("[", "").replace("]", "").split(",").length 
      : Array.isArray(embeddingArray) ? embeddingArray.length : "unknown";
      
    console.log(`\n--- Row ${idx + 1} ---`);
    console.log("Guideline ID:", row.guideline_id);
    console.log("Guideline Name:", row.guideline_name);
    console.log("Section Title:", row.section_title);
    console.log("Embedding Dimension:", dim);
    console.log("Content Preview:", row.content.substring(0, 300) + "...");
  });
}

main().catch(console.error);
