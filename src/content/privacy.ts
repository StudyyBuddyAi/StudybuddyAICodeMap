/**
 * The privacy policy, for the website (/privacy) and the mobile apps, which
 * link here. Plain data, rendered as text: no markup reaches the page.
 *
 * Keep it true to what the product does. When a feature starts collecting,
 * sending or keeping something new, this file changes in the same pull
 * request, and PRIVACY_LAST_UPDATED moves with it.
 */

export const PRIVACY_EFFECTIVE_DATE = "1 November 2026";
export const PRIVACY_LAST_UPDATED = "1 November 2026";
export const PRIVACY_CONTACT_EMAIL = "support@studyybuddyai.com";
export const PRIVACY_SITE = "studyybuddyai.com";

/** A list item, optionally led by a bold term ("Account details. …"). */
export type PrivacyListItem = string | { term: string; text: string };

export type PrivacyBlock =
  | string
  | { subheading: string }
  | { list: PrivacyListItem[] }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string };

export interface PrivacySection {
  /** Anchor, so any section can be linked (/privacy#id). */
  id: string;
  heading: string;
  body: PrivacyBlock[];
}

export const PRIVACY_INTRO: string[] = [
  `This Privacy Policy explains how StudyBuddy AI ("StudyBuddy", "we", "us") collects, uses, shares and protects personal information when you use our website at ${PRIVACY_SITE} and the StudyBuddy AI apps for Android and iOS (together, the "Service").`,
  "StudyBuddy is a study platform for medical students: AI-generated study sheets, flashcards with spaced repetition, and USMLE-style practice questions (QBank). By using the Service you acknowledge that you have read this policy.",
];

/** The short version, shown above the full policy. Each line must stay true to a section below. */
export const PRIVACY_SUMMARY: string[] = [
  "We collect what is needed to run your account and save your study material — nothing more.",
  "Study topics and the text you ask the AI to work on are sent to AI providers to generate your material. Your name and email are not sent with them.",
  "We do not sell your data, show ads, or use advertising or cross-site tracking tools.",
  "You can delete your account and its data at any time, directly in the app.",
];

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "who-we-are",
    heading: "Who we are",
    body: [
      `StudyBuddy AI is an independent project based in Gaza, Palestine. StudyBuddy AI is responsible for the personal information described in this policy (the "data controller"). You can reach us about any privacy matter at ${PRIVACY_CONTACT_EMAIL}.`,
      "This policy applies to the Service only. Websites and services we link to — such as PubMed sources, WhatsApp, Instagram, LinkedIn and Telegram — have their own privacy policies.",
    ],
  },
  {
    id: "information-we-collect",
    heading: "Information we collect",
    body: [
      { subheading: "Information you give us" },
      {
        list: [
          {
            term: "Account details.",
            text: "When you create an account: your email address and a password. Passwords are stored in hashed form by our authentication provider; we never see them. If you sign in with Google, Google shares your email address and basic profile information (such as your name) with us. Your username is set from your email address and can be changed; it is shown only to you.",
          },
          {
            term: "Study content.",
            text: "The topics you enter; the study sheets, flashcards and question sets generated for you; and what you add to them — highlights, notes, edits, rewrites, deep dives, flags and struck-out answer options.",
          },
          {
            term: "Question reports.",
            text: "If you report a problem with a practice question, the reason you choose and any note you add (up to 500 characters).",
          },
          {
            term: "Messages to us.",
            text: "If you contact us — by email, or on WhatsApp to buy Pro — we receive what you send, including your email address or phone number and display name.",
          },
        ],
      },
      { subheading: "Information created as you use the Service" },
      {
        list: [
          {
            term: "Study activity.",
            text: "Each flashcard review (the rating you gave and when), your practice-question answers, time per question and scores, and your study settings such as daily limits and target retention. This is used to schedule reviews, show your progress and calculate your study streak.",
          },
          {
            term: "Usage and plan.",
            text: "How many sheets, decks, question sets and reference lookups you use each day, so free daily limits can apply; whether you have Pro and until when; and any Pro access codes you redeem.",
          },
          {
            term: "AI memory.",
            text: "If you turn on AI memory, your recent questions and the answers to them (up to ten exchanges) are kept so follow-up answers can build on them.",
          },
          {
            term: "Reference-library logs.",
            text: "When material is written from our reference library, we log the query and which library passages were used, to check and improve answer quality.",
          },
          {
            term: "Technical data.",
            text: "Like most online services, our hosting and database providers automatically record technical information with each request — such as IP address, browser or device type, and the time of the request — in security and operations logs.",
          },
        ],
      },
      { subheading: "Guest use" },
      "You can use StudyBuddy without an account. We then create an anonymous session that contains no email address or name, and is used to apply free daily limits. Guest sheets and flashcards are stored in your browser or on your device, not on our servers. If you later create an account, that work is moved into it.",
      { subheading: "Information we do not collect" },
      {
        list: [
          "We do not collect your location, contacts, photos, camera or microphone.",
          "We do not process card or bank details. Pro is arranged directly with us (see Pro purchases below); we record only your Pro status and its end date.",
          "We do not ask for, and you should not enter, information that identifies a patient. StudyBuddy is a study tool, not a clinical record system.",
        ],
      },
    ],
  },
  {
    id: "how-we-use-information",
    heading: "How we use information",
    body: [
      "We use personal information only for the purposes below. Where the law requires a legal basis (for example, under the EU and UK GDPR), it is shown alongside each purpose.",
      {
        table: {
          head: ["Purpose", "Legal basis"],
          rows: [
            ["Provide the Service: create your account, generate and save your material, and keep it in sync across the website and apps", "Performance of our contract with you"],
            ["Schedule your flashcard reviews, keep your QBank progress and show your statistics", "Performance of our contract with you"],
            ["Apply free daily limits and Pro access", "Performance of our contract with you"],
            ["Send account emails, such as sign-in codes and password resets", "Performance of our contract with you"],
            ["Check and improve the accuracy and safety of AI-generated material, including through question reports", "Our legitimate interest in a reliable study tool"],
            ["Keep the Service secure, prevent abuse and fix errors", "Our legitimate interest in a secure service"],
            ["Count website page views in aggregate", "Our legitimate interest in understanding how the website is used"],
            ["Respond to your requests and meet legal obligations", "Legal obligation, or our legitimate interest in responding to you"],
          ],
        },
      },
      "We do not use your information for advertising, we do not build advertising profiles, and we do not make decisions about you that have legal or similarly significant effects based solely on automated processing.",
    ],
  },
  {
    id: "ai-processing",
    heading: "AI processing",
    body: [
      "To generate a study sheet, flashcards or practice questions — or to rewrite, explain or turn a passage into a card — we send the topic you entered, the text you selected or wrote, any instruction you gave, and (if memory is on) your recent exchanges to an AI provider, which returns the generated text:",
      {
        list: [
          { term: "Corti", text: "— an AI model built for healthcare, used for study sheets and flashcards." },
          { term: "OpenRouter", text: "— a service that routes requests to AI model providers, used for practice questions, searching our reference library and some writing." },
          { term: "PubMed", text: "(US National Library of Medicine) — receives the topic to find published sources to cite." },
        ],
      },
      "These requests contain study content only. We do not send your name, email address or account identifier with them.",
      {
        note: "AI-generated material can be inaccurate or incomplete. It is intended for study and exam preparation, not for diagnosis, treatment or any clinical decision.",
      },
    ],
  },
  {
    id: "sharing",
    heading: "How we share information",
    body: [
      "We do not sell, rent or trade personal information, and we do not share it for advertising. We share it only with the service providers that run the Service for us, under their terms and only for the purposes in this policy:",
      {
        table: {
          head: ["Provider", "What they do", "Information involved"],
          rows: [
            ["Supabase", "Database, authentication, file storage and server functions", "Your account and everything stored in it; technical data"],
            ["Vercel", "Website hosting, aggregate page-view analytics, and the server that tunes your flashcard schedule", "Technical data; your review history when you run schedule tuning"],
            ["Corti, OpenRouter", "Generate study material", "Study content, as described in AI processing"],
            ["US National Library of Medicine (PubMed)", "Find published sources", "Study topics"],
            ["Google", "Sign-in, only if you choose Sign in with Google", "Sign-in data"],
            ["Google Play, Apple App Store", "Distribute the apps", "As described in their own policies"],
            ["WhatsApp (Meta)", "Messaging, only if you contact us there to buy Pro", "Your messages and phone number"],
          ],
        },
      },
      "We may also disclose information if required by law, to protect the rights, safety or security of our users or the public, or as part of a merger, acquisition or transfer of the Service — in which case this policy will continue to apply to your information.",
    ],
  },
  {
    id: "pro-purchases",
    heading: "Pro purchases",
    body: [
      "Pro is not sold through the website or the apps. To buy it, you message us on WhatsApp, and we activate Pro on your account or send you an access code to redeem. We use that conversation only to arrange and confirm your purchase and to support you. We record your Pro status, its end date and any code you redeemed; payment details are not stored in StudyBuddy.",
    ],
  },
  {
    id: "cookies",
    heading: "Cookies and local storage",
    body: [
      "The website does not use advertising or tracking cookies. It uses your browser's local storage for things the Service needs to work:",
      {
        list: [
          "keeping you signed in;",
          "guest sheets and flashcards, and a QBank session in progress;",
          "preferences such as theme and text size, and whether you have already seen an introduction or tip.",
        ],
      },
      "Website page views are counted with Vercel Web Analytics, which sets no cookies, does not track you across sites, and reports only aggregate figures.",
      "In the apps, the same kind of data is stored on your device, along with a copy of your decks for offline study and reviews made offline until they sync. Study reminders are notifications scheduled on your device; no push token or device identifier is sent to us. The apps contain no advertising, analytics or crash-reporting SDKs. Google Play and Apple may collect crash reports under their own policies if you allow it on your device.",
      "You can clear local storage at any time in your browser or device settings. Doing so signs you out and removes guest work that has not been saved to an account.",
    ],
  },
  {
    id: "international-transfers",
    heading: "International transfers",
    body: [
      "Our service providers operate in several countries, including the United States and the European Union, so your information may be processed outside the country where you live. Where data protection law requires it, we rely on appropriate safeguards for these transfers, such as the providers' standard contractual clauses.",
    ],
  },
  {
    id: "retention",
    heading: "How long we keep information",
    body: [
      {
        table: {
          head: ["Information", "How long"],
          rows: [
            ["Account details, study content, study activity, settings and AI memory", "Until you delete them or delete your account"],
            ["Study history (reviews and answers) after you delete a deck or question set", "Kept, so your statistics and streak stay correct, until you delete your account"],
            ["Question reports", "Until you delete your account"],
            ["Reference-library logs", "Kept to measure answer quality; the link to you is removed when your account is deleted"],
            ["Technical logs", "For a limited period set by our hosting and database providers"],
            ["Guest work on your device", "Until you clear your browser or app data, or uninstall the app"],
          ],
        },
      },
    ],
  },
  {
    id: "your-rights",
    heading: "Your rights and choices",
    body: [
      "Depending on where you live, you may have the right to:",
      {
        list: [
          "access the personal information we hold about you and receive a copy of it;",
          "correct information that is inaccurate;",
          "delete your information;",
          "object to, or ask us to restrict, how we use it;",
          "receive your data in a portable format;",
          "withdraw consent, where we rely on it, at any time.",
        ],
      },
      `Many of these you can do yourself: edit or delete sheets, decks and question sets; turn AI memory off; change your username on your account page; or delete your account. For anything else, write to ${PRIVACY_CONTACT_EMAIL} from the email address on your account. We reply within 30 days and may ask you to confirm your identity. You also have the right to complain to your local data protection authority.`,
    ],
  },
  {
    id: "delete-account",
    heading: "Deleting your account",
    body: [
      "In the app: open Settings, choose Delete account, and type DELETE to confirm. Your account and its data are deleted immediately and you are signed out. This cannot be undone.",
      {
        list: [
          {
            term: "Deleted:",
            text: "your account (email, username and sign-in), profile and plan; your study sheets and everything added to them; your decks, cards and review history; your QBank sets, answers, flags, notes and the questions generated for you; your question reports, usage counts and AI memory.",
          },
          {
            term: "Kept, with no link to you:",
            text: "the text of reference-library queries and which passages they used, to measure answer quality; and any Pro access code you redeemed, which stays marked as used.",
          },
        ],
      },
      `If you cannot use the app, email ${PRIVACY_CONTACT_EMAIL} from the address on your account with the subject "Delete my account". We confirm the request and delete the account within 30 days.`,
      "Guest work is stored only on your device: clear the site's data in your browser, or clear the app's data or uninstall it.",
    ],
  },
  {
    id: "security",
    heading: "Security",
    body: [
      "All data is encrypted in transit (HTTPS). Access controls in our database ensure each account can read and change only its own data — enforced on the server, not only in the app. Administrative access is limited to what is needed to run the Service.",
      "No method of transmission or storage is completely secure. If we become aware of a breach that affects your personal information, we will notify you and the relevant authorities as the law requires.",
    ],
  },
  {
    id: "children",
    heading: "Children",
    body: [
      `StudyBuddy is intended for medical students and is not directed to children under 16. We do not knowingly collect personal information from children under 16. If you believe a child has provided us with personal information, contact ${PRIVACY_CONTACT_EMAIL} and we will delete it.`,
    ],
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: [
      'We may update this policy as the Service changes. We will post the new version on this page and update the "Last updated" date. If a change materially affects how we use information you have already given us, we will tell you in the app or by email before it takes effect.',
    ],
  },
  {
    id: "contact",
    heading: "Contact us",
    body: [`For questions, requests or complaints about this policy or your personal information, email ${PRIVACY_CONTACT_EMAIL}.`],
  },
];
