import { useState } from "react";
import { Search, Sparkles, BookOpen, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw, Copy, Check, SlidersHorizontal, Eye, EyeOff, BookOpenCheck, ArrowRight } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useRagQuery } from "@/hooks/use-rag-query";
import { RagGenerateResponse, RagSource } from "@/lib/callRagGenerate";
import { useToast } from "@/hooks/use-toast";
import { renderMarkdown } from "@/lib/render-markdown";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/hooks/use-auth";

const SAMPLE_QUERIES = [
  "First-line treatment for Community-Acquired Pneumonia",
  "Diagnostic criteria and initial management of Diabetic Ketoacidosis",
  "Diagnostic approach to Acute Pancreatitis",
  "Target blood pressure goals in Hypertension guidelines",
];

const RagSearch = () => {
  const { toast } = useToast();
  const { isAnonymous } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState(0.65);
  const [feature, setFeature] = useState("general");
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const ragMutation = useRagQuery();

  const handleSearch = (searchQuery?: string) => {
    const q = searchQuery ?? query;
    if (!q.trim()) {
      toast({ title: "Query required", description: "Please enter a search question or medical topic.", variant: "destructive" });
      return;
    }
    setExpandedSources({});
    ragMutation.mutate({
      query: q.trim(),
      topK,
      threshold,
      feature,
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSourceExpand = (id: string) => {
    setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const data: RagGenerateResponse | undefined = ragMutation.data;

  return (
    <>
      <DashboardLayout wide>
        <div className="space-y-8 animate-fade-in">
        {/* Header Section */}
        <div style={{ position: "relative" }}>
          {/* Subtle Background Glow */}
          <div
            style={{
              position: "absolute",
              top: "-50px",
              left: "10%",
              width: "300px",
              height: "150px",
              background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 70%)",
              filter: "blur(40px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                    background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                    padding: "4px 12px",
                    borderRadius: 20,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
                  }}
                >
                  <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                  Clinical RAG Intelligence
                </span>
              </div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(30px, 4.5vw, 44px)",
                  fontWeight: 700,
                  lineHeight: 1.05,
                  letterSpacing: "-0.02em",
                  color: "var(--fg)",
                  margin: 0,
                }}
              >
                Grounded Reference{" "}
                <span style={{ fontStyle: "italic", background: "linear-gradient(120deg, var(--accent), #10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Search Engine
                </span>
              </h1>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 16,
                  color: "var(--fg-muted)",
                  marginTop: 10,
                  lineHeight: 1.6,
                  maxWidth: "680px",
                }}
              >
                Query medical literature and practice guidelines. The system automatically retrieves relevant references, computes clinical similarity, and synthesizes grounded answers.
              </p>
            </div>
          </div>
        </div>

        {/* Input Terminal Card */}
        <div
          style={{
            background: "color-mix(in srgb, var(--card) 95%, #000)",
            border: "1px solid var(--border)",
            borderRadius: 20,
            padding: "28px",
            boxShadow: "0 20px 40px -15px rgba(0,0,0,0.25)",
            backdropFilter: "blur(20px)",
            position: "relative",
          }}
          className="group transition-all duration-300 hover:border-accent-strong/40"
        >
          {/* Subtle outline glow on hover */}
          <div
            style={{
              position: "absolute",
              inset: -1,
              borderRadius: 20,
              background: "linear-gradient(135deg, var(--accent) 0%, transparent 60%)",
              opacity: 0,
              zIndex: -1,
              transition: "opacity 0.3s ease",
              pointerEvents: "none",
            }}
            className="group-hover:opacity-10"
          />

          <div className="space-y-5">
            <div className="relative">
              <textarea
                id="rag-query-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Enter a clinical scenario or question (e.g. 'What is the diagnostic threshold for diagnosing COPD according to guidelines?')..."
                rows={3}
                style={{
                  width: "100%",
                  background: "color-mix(in srgb, var(--background) 70%, transparent)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "16px 20px",
                  color: "var(--fg)",
                  fontSize: 15,
                  fontFamily: "var(--font-sans)",
                  outline: "none",
                  resize: "none",
                  lineHeight: 1.6,
                  transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
                className="focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
              <span 
                style={{
                  position: "absolute",
                  bottom: 12,
                  right: 16,
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--fg-muted)",
                  opacity: 0.6,
                  pointerEvents: "none"
                }}
                className="hidden sm:inline"
              >
                Ctrl + Enter to search
              </span>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              {/* Sample Queries */}
              <div className="flex flex-wrap items-center gap-2 max-w-full sm:max-w-[70%]">
                <span className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Examples:</span>
                {SAMPLE_QUERIES.map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setQuery(sq);
                      handleSearch(sq);
                    }}
                    style={{
                      fontSize: 12,
                      padding: "5px 12px",
                      borderRadius: 16,
                      background: "color-mix(in srgb, var(--accent) 6%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
                      color: "var(--fg)",
                      cursor: "pointer",
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                    className="hover:bg-accent/12 hover:border-accent/40 active:scale-95 text-xs truncate max-w-[200px] md:max-w-[280px]"
                  >
                    {sq}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowSettings(!showSettings)}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "10px 16px",
                    borderRadius: 12,
                    background: showSettings ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
                    color: showSettings ? "var(--accent)" : "var(--fg-muted)",
                    border: showSettings ? "1px solid var(--accent)" : "1px solid var(--border)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s ease",
                  }}
                  className="hover:bg-muted"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  Parameters
                </button>

                <button
                  id="rag-search-submit"
                  type="button"
                  disabled={ragMutation.isPending || !query.trim()}
                  onClick={() => handleSearch()}
                  style={{
                    background: "var(--accent)",
                    color: "var(--background)",
                    border: "none",
                    borderRadius: 12,
                    padding: "10px 24px",
                    fontSize: 14,
                    fontWeight: 650,
                    cursor: ragMutation.isPending || !query.trim() ? "not-allowed" : "pointer",
                    opacity: ragMutation.isPending || !query.trim() ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 4px 14px rgba(13, 110, 110, 0.2)",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  className="hover:opacity-90 active:scale-[0.98]"
                >
                  {ragMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Synthesizing...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Retrieve & Answer
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Advanced Parameters Panel */}
            {showSettings && (
              <div
                style={{
                  background: "color-mix(in srgb, var(--background) 95%, #000)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: 20,
                  marginTop: 14,
                }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm"
              >
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">
                      Retrieve Count (Top K)
                    </label>
                    <span className="text-xs font-mono font-semibold text-accent">{topK} chunks</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    className="w-full accent-accent"
                    style={{ height: 6, borderRadius: 3 }}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Number of matching snippets retrieved from the database.</p>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">
                      Cutoff Similarity
                    </label>
                    <span className="text-xs font-mono font-semibold text-accent">{(threshold * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="0.9"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full accent-accent"
                    style={{ height: 6, borderRadius: 3 }}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Minimum matching similarity required to use grounding info.</p>
                </div>

                <div>
                  <label className="block text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Persona Feature Scope
                  </label>
                  <select
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    style={{
                      width: "100%",
                      background: "color-mix(in srgb, var(--card) 95%, #000)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "var(--fg)",
                      outline: "none",
                    }}
                    className="focus:border-accent"
                  >
                    <option value="general">General Medical Educator</option>
                    <option value="clinical">Actionable Bedside Clinician</option>
                    <option value="exam">High-Yield Board Prep / USMLE</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">Changes response register and synthesis style.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error State */}
        {ragMutation.isError && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: 14,
              padding: 18,
              color: "#ef4444",
              display: "flex",
              alignItems: "start",
              gap: 14,
            }}
            className="animate-shake"
          >
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Retrieval Diagnostics</p>
              <p className="text-xs opacity-90 mt-1 leading-relaxed">{ragMutation.error.message}</p>
              {isAnonymous && (ragMutation.error as Error & { code?: string }).code === "QUOTA_EXCEEDED" && (
                <div className="mt-3 text-xs">
                  <p className="opacity-90">
                    You've hit the daily anonymous search limit. Create a free account for more searches.
                  </p>
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Sign in free
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results Presentation */}
        {data && (
          <div className="space-y-6 animate-slide-up">
            {/* Grounding Status Hub */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "start",
                justifyContent: "space-between",
                background: data.grounded
                  ? "linear-gradient(90deg, rgba(16, 185, 129, 0.06) 0%, transparent 100%)"
                  : "linear-gradient(90deg, rgba(245, 158, 11, 0.06) 0%, transparent 100%)",
                border: `1px solid ${
                  data.grounded ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"
                }`,
                borderRadius: 16,
                padding: "16px 20px",
                gap: 16,
              }}
              className="flex-col sm:flex-row"
            >
              <div className="flex items-start sm:items-center gap-4">
                <div 
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: data.grounded ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)",
                    border: `1px solid ${data.grounded ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)"}`,
                  }}
                >
                  {data.grounded ? (
                    <BookOpenCheck className="w-5 h-5 text-success animate-pulse" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-warning" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: data.grounded ? "#10b981" : "#f59e0b",
                      }}
                    >
                      {data.grounded ? "VERIFIED SOURCE COMPLIANT" : "UNGROUNDED RESPONSE WARNING"}
                    </span>
                    <span 
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: data.grounded ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: data.grounded ? "#10b981" : "#f59e0b",
                        fontWeight: "bold"
                      }}
                    >
                      {data.grounded ? "GROUNDED" : "BASELINE KNOWLEDGE"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {data.grounded
                      ? `Successfully matched ${data.sources.length} guideline source chunk(s) exceeding similarity target.`
                      : `No chunks met the similarity cut-off (${(threshold * 100).toFixed(0)}%). Synthesis based on AI baseline.`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                <button
                  type="button"
                  onClick={() => handleCopy(data.answer)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--fg)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s ease",
                  }}
                  className="hover:bg-muted"
                >
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  {copied ? "Copied!" : "Copy Output"}
                </button>
              </div>
            </div>

            {/* Answer Display */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 20,
                boxShadow: "0 10px 25px -10px rgba(0,0,0,0.15)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Colored top stripe indicator */}
              <div 
                style={{
                  height: 4,
                  background: data.grounded 
                    ? "linear-gradient(90deg, var(--accent) 0%, #10b981 100%)" 
                    : "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)"
                }}
              />

              <div className="p-8">
                <h2 className="text-base font-bold uppercase tracking-wider text-muted-foreground mb-5 flex items-center gap-2">
                  <BookOpen className="w-4.5 h-4.5 text-accent" />
                  Synthesized Answer Output
                </h2>
                <div
                  className="prose prose-invert max-w-none text-foreground text-[15px] leading-relaxed space-y-4"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(data.answer) }}
                />
              </div>
            </div>

            {/* Source Guideline Chunks Grid */}
            {data.sources && data.sources.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    Guidelines Explored ({data.sources.length})
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {data.sources.map((source: RagSource, idx: number) => {
                    const isExpanded = !!expandedSources[source.id];
                    return (
                      <div
                        key={source.id || idx}
                        style={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 16,
                          overflow: "hidden",
                          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                        className="hover:border-accent/40 shadow-sm"
                      >
                        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-2 flex-grow">
                            <div className="flex flex-wrap items-center gap-2">
                              <span 
                                style={{
                                  fontSize: 10,
                                  fontFamily: "var(--font-mono)",
                                  fontWeight: 700,
                                  color: "var(--accent)",
                                  background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                                  padding: "3px 8px",
                                  borderRadius: 4
                                }}
                              >
                                Source {idx + 1}
                              </span>
                              <span className="font-semibold text-sm text-foreground">
                                {source.sourceName || source.guidelineName}
                              </span>
                              {source.sectionTitle && (
                                <span className="text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                                  Section: {source.sectionTitle}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 flex-shrink-0">
                            {/* Similarity Score Pillar */}
                            <div className="text-right">
                              <div className="text-[10px] uppercase font-mono font-bold text-muted-foreground tracking-wider mb-0.5">Similarity</div>
                              <div className="text-sm font-mono font-bold text-success">
                                {(source.similarity * 100).toFixed(1)}%
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 border-l border-border/80 pl-4">
                              <button
                                type="button"
                                onClick={() => toggleSourceExpand(source.id)}
                                style={{
                                  padding: "8px 14px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  background: isExpanded ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                                  color: isExpanded ? "var(--accent)" : "var(--fg)",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  transition: "all 0.15s ease",
                                }}
                                className="hover:bg-muted"
                              >
                                {isExpanded ? (
                                  <>
                                    <EyeOff className="w-3.5 h-3.5" />
                                    Hide Snippet
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3.5 h-3.5 text-accent" />
                                    View Snippet
                                  </>
                                )}
                              </button>

                              {source.sourceUrl && (
                                <a
                                  href={source.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    fontSize: 12,
                                    color: "var(--fg-muted)",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                  className="hover:bg-muted hover:text-foreground"
                                  title="Open original guideline document"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Collapsible snippet preview */}
                        {isExpanded && (
                          <div 
                            style={{
                              background: "color-mix(in srgb, var(--background) 70%, transparent)",
                              borderTop: "1px solid var(--border)",
                              padding: "20px 24px",
                            }}
                            className="animate-slide-down"
                          >
                            <h4 className="text-[10px] uppercase font-mono font-bold tracking-widest text-accent mb-2">Retrieved Guideline Snippet Content</h4>
                            <p 
                              style={{ 
                                fontFamily: "var(--font-sans)", 
                                fontSize: 13, 
                                color: "var(--fg-muted)", 
                                lineHeight: 1.65, 
                                margin: 0,
                                whiteSpace: "pre-wrap"
                              }}
                            >
                              {source.content}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </DashboardLayout>
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    </>
  );
};

export default RagSearch;
