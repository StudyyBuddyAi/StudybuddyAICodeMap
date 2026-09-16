import { useEffect } from "react";
import { useLocation } from "react-router-dom";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: string;
  noIndex?: boolean;
  schema?: Record<string, any>;
}

const SEO = ({
  title,
  description,
  keywords,
  canonical,
  ogImage = "/og-preview.png",
  ogType = "website",
  noIndex = false,
  schema,
}: SEOProps) => {
  const location = useLocation();
  const defaultTitle = "StudyBuddy AI · AI-Powered Study Platform for Medical Students";
  const defaultDescription = "StudyBuddy AI turns your curriculum into clinical cases, smart questions, and instant explanations. Built for medical students in MENA. Free to start.";
  const baseUrl = "https://studybuddyai.com";

  useEffect(() => {
    // Set document title
    document.title = title ? `${title} | StudyBuddy AI` : defaultTitle;

    // Update or create meta description
    updateMetaTag("name", "description", description || defaultDescription);

    // Update or create meta keywords
    if (keywords) {
      updateMetaTag("name", "keywords", keywords);
    }

    // Update canonical URL
    const canonicalUrl = canonical || `${baseUrl}${location.pathname}`;
    updateMetaTag("rel", "canonical", canonicalUrl, "link");

    // Update Open Graph tags
    updateMetaTag("property", "og:title", title || "StudyBuddy AI · Study Smarter. Score Higher.");
    updateMetaTag("property", "og:description", description || defaultDescription);
    updateMetaTag("property", "og:image", ogImage);
    updateMetaTag("property", "og:url", canonicalUrl);
    updateMetaTag("property", "og:type", ogType);
    updateMetaTag("property", "og:site_name", "StudyBuddy AI");

    // Update Twitter Card tags
    updateMetaTag("name", "twitter:card", "summary_large_image");
    updateMetaTag("name", "twitter:title", title || "StudyBuddy AI · Study Smarter. Score Higher.");
    updateMetaTag("name", "twitter:description", description || defaultDescription);
    updateMetaTag("name", "twitter:image", ogImage);

    // Handle noindex
    if (noIndex) {
      updateMetaTag("name", "robots", "noindex, nofollow");
    } else {
      updateMetaTag("name", "robots", "index, follow");
    }

    // Add structured data (JSON-LD)
    if (schema) {
      addStructuredData(schema);
    }

    // Cleanup function
    return () => {
      // Note: We don't remove meta tags on unmount to avoid flickering
      // The next route will overwrite them
    };
  }, [title, description, keywords, canonical, ogImage, ogType, noIndex, schema, location.pathname]);

  return null;
};

// Helper function to update or create meta tags
function updateMetaTag(
  attribute: string,
  value: string,
  content: string,
  tagName: "meta" | "link" = "meta"
) {
  let element: HTMLMetaElement | HTMLLinkElement | null;
  
  if (tagName === "meta") {
    element = document.querySelector(`meta[${attribute}="${value}"]`) as HTMLMetaElement;
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, value);
      document.head.appendChild(element);
    }
    element.setAttribute("content", content);
  } else {
    element = document.querySelector(`link[${attribute}="${value}"]`) as HTMLLinkElement;
    if (!element) {
      element = document.createElement("link");
      element.setAttribute(attribute, value);
      document.head.appendChild(element);
    }
    element.setAttribute("href", content);
  }
}

// Helper function to add structured data
function addStructuredData(schema: Record<string, any>) {
  // Remove existing schema script with same context
  const existingScript = document.querySelector(`script[type="application/ld+json"][data-schema="${schema["@context"]}"]`);
  if (existingScript) {
    existingScript.remove();
  }

  // Create new schema script
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute("data-schema", schema["@context"]);
  script.text = JSON.stringify(schema);
  document.head.appendChild(script);
}

export default SEO;
