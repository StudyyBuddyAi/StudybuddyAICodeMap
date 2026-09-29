// Schema.org structured data helpers for SEO

export const createWebSiteSchema = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "StudyBuddy AI",
  "url": "https://studybuddyai.com",
  "description": "AI-powered study platform for medical students. Generates exam-ready study sheets, flashcards, and QBank sessions.",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://studybuddyai.com/search?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
});

export const createOrganizationSchema = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "StudyBuddy AI",
  "url": "https://studybuddyai.com",
  "logo": "https://studybuddyai.com/favicon.svg",
  "description": "AI-powered study platform for medical students in MENA region",
  "sameAs": [
    "https://twitter.com/studybuddyai",
    "https://linkedin.com/company/studybuddyai"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "email": "support@studybuddyai.com"
  }
});

export const createArticleSchema = (title: string, description: string, url: string, datePublished: string, author?: string) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": title,
  "description": description,
  "url": url,
  "datePublished": datePublished,
  "dateModified": datePublished,
  "author": author ? {
    "@type": "Person",
    "name": author
  } : {
    "@type": "Organization",
    "name": "StudyBuddy AI"
  },
  "publisher": {
    "@type": "Organization",
    "name": "StudyBuddy AI",
    "logo": {
      "@type": "ImageObject",
      "url": "https://studybuddyai.com/favicon.svg"
    }
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": url
  }
});

export const createMedicalScholarlyArticleSchema = (title: string, description: string, url: string, datePublished: string, author?: string) => ({
  "@context": "https://schema.org",
  "@type": "MedicalScholarlyArticle",
  "headline": title,
  "description": description,
  "url": url,
  "datePublished": datePublished,
  "dateModified": datePublished,
  "author": author ? {
    "@type": "Person",
    "name": author
  } : {
    "@type": "Organization",
    "name": "StudyBuddy AI"
  },
  "publisher": {
    "@type": "Organization",
    "name": "StudyBuddy AI",
    "logo": {
      "@type": "ImageObject",
      "url": "https://studybuddyai.com/favicon.svg"
    }
  },
  "medicalAudience": "Medical Student",
  "about": {
    "@type": "MedicalEntity",
    "name": "Medical Education"
  }
});

export const createFAQPageSchema = (faqs: Array<{ question: string; answer: string }>) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": faqs.map(faq => ({
    "@type": "Question",
    "name": faq.question,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": faq.answer
    }
  }))
});

export const createBreadcrumbSchema = (items: Array<{ name: string; url: string }>) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": items.map((item, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "name": item.name,
    "item": item.url
  }))
});

export const createProductSchema = (name: string, description: string, url: string, price?: string) => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": name,
  "description": description,
  "url": url,
  "applicationCategory": "EducationalApplication",
  "operatingSystem": "Web",
  "offers": price ? {
    "@type": "Offer",
    "price": price,
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  } : {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "150"
  }
});

export const createHowToSchema = (name: string, description: string, steps: Array<{ name: string; text: string }>) => ({
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": name,
  "description": description,
  "step": steps.map((step, index) => ({
    "@type": "HowToStep",
    "position": index + 1,
    "name": step.name,
    "text": step.text
  }))
});
