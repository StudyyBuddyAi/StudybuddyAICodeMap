import { supabase } from "./lib/supabase.js";

async function main() {
  const { data: countData, error: countError } = await supabase
    .from("guideline_chunks")
    .select("id", { count: "exact", head: true });

  if (countError) {
    console.error("Error querying guideline_chunks count:", countError.message);
    return;
  }

  console.log("Total rows in guideline_chunks:", countData);

  const { data: sample, error: sampleError } = await supabase
    .from("guideline_chunks")
    .select("id, guideline_id, guideline_name, section_title, content, embedding")
    .limit(1);

  if (sampleError) {
    console.error("Error getting sample row:", sampleError.message);
    return;
  }

  if (sample && sample.length > 0) {
    const row = sample[0];
    const embeddingArray = (row.embedding as any);
    const dimension = typeof embeddingArray === "string" 
      ? embeddingArray.split(",").length 
      : Array.isArray(embeddingArray) ? embeddingArray.length : "unknown";
      
    console.log("Sample Guideline Chunk:");
    console.log("ID:", row.id);
    console.log("Guideline ID:", row.guideline_id);
    console.log("Guideline Name:", row.guideline_name);
    console.log("Section:", row.section_title);
    console.log("Embedding Dimension:", dimension);
    console.log("Content Preview:", row.content.substring(0, 150) + "...");
  } else {
    console.log("No guideline chunks found in the table.");
  }
}

main().catch(console.error);
