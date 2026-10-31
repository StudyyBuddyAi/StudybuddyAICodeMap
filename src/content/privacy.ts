/**
 * The privacy policy, for the website (/privacy) and the mobile apps, which
 * link here. Plain data, rendered as text: no markup reaches the page.
 *
 * Keep it true to what the product does. When a feature starts collecting,
 * sending or keeping something new, this file changes in the same pull
 * request. Placeholders in [brackets] are filled in before publication.
 */

export const PRIVACY_EFFECTIVE_DATE = "[effective date — set on publication]";
export const PRIVACY_CONTACT_EMAIL = "[contact email]";

export type PrivacyBlock = string | { list: string[] };

export interface PrivacySection {
  /** Anchor for a section linked from elsewhere (/privacy#id). */
  id?: string;
  heading: string;
  body: PrivacyBlock[];
}

export const PRIVACY_INTRO: string[] = [
  "StudyBuddy AI helps medical students study: AI-written study sheets, flashcards with spaced repetition, and USMLE-style practice questions. This policy covers the website at studyybuddyai.com and the StudyBuddy AI apps for Android and iOS, and says what we collect, why, who processes it, and how to have it deleted.",
  "In short: we keep what you create so you can study it on any device, we send the topics you study to AI providers to write your material, and we do not show ads, sell your data or track you across other sites and apps.",
];

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: "What we collect",
    body: [
      "Account. If you create an account: your email address, and a password that our authentication provider stores in hashed form (we never see it). If you sign in with Google instead, Google shares your email address and basic profile (such as your name) with us. You can choose a username, which is shown only to you.",
      "Guest use. You can use StudyBuddy without an account. We then create an anonymous session, which holds no email or name. On the website your guest work stays in your browser's storage; in the apps it stays on your device. If you create an account later, that work moves into it.",
      "What you study and create. The topics you enter; your study sheets and what you add to them (highlights, notes, edits, rewrites and deep dives); your flashcards and every review of them (the rating you gave and when); your QBank sets, answers, time per question, flags, notes, highlights and struck-out options; and your study settings, such as daily limits and target retention.",
      "Usage and plan. How many sheets, decks, question sets and reference lookups you use each day, so free daily limits can apply; whether you have Pro and until when; and which Pro access codes you redeemed.",
      "AI memory and logs. If you turn on memory for a sheet, recent questions and answers are kept so the next answer can build on them. When material is written from our reference library, we log the query and which library passages were used, to check and improve the quality of answers.",
      "On your device (apps). Guest decks and sheets, a copy of your decks so you can study offline, reviews made offline until they reach our servers, and your preferences (theme, text size, whether you have seen an introduction). These stay on the device.",
    ],
  },
  {
    heading: "What we don't collect or do",
    body: [
      {
        list: [
          "No advertising, and no advertising or tracking SDKs in the apps.",
          "We don't sell or rent your data, or share it for advertising.",
          "No crash-reporting or analytics SDKs in the apps. Crash reports that Google Play or Apple collect under their own policies, if you allow them on your device, reach us only through those stores.",
          "No location, contacts, camera, microphone or photos.",
          "Reminders are local notifications, scheduled on your device. No push token or device identifier is sent to us.",
        ],
      },
      "The website uses Vercel Web Analytics to count page views. It sets no cookies, does not follow you across sites, and reports only aggregate figures.",
    ],
  },
  {
    heading: "How we use it",
    body: [
      {
        list: [
          "To provide StudyBuddy: write your material, save it, and keep it in step across the website and the apps.",
          "To schedule your flashcards and keep your QBank progress, so you can resume on any device.",
          "To apply free daily limits and Pro access.",
          "To check and improve the quality and safety of AI answers.",
          "To keep the service secure and to prevent abuse.",
        ],
      },
    ],
  },
  {
    heading: "AI processing",
    body: [
      "To write a study sheet, flashcards or practice questions, the topic you enter and the instructions for that request are sent to our AI providers, which generate the text and send it back: Corti (an AI model built for healthcare) and, for searching our reference library and for some writing, models reached through OpenRouter. To find a citation, the topic is sent to PubMed (the US National Library of Medicine). These requests carry the study content, not your email address or name.",
      "AI-written material can be wrong. It is for study, not for clinical decisions.",
    ],
  },
  {
    heading: "Who processes your data",
    body: [
      {
        list: [
          "Supabase: our database, authentication and server functions. Your account and everything you create is stored there.",
          "Vercel: hosts the website and provides its aggregate page-view analytics.",
          "Corti, OpenRouter and the US National Library of Medicine (PubMed): as described under AI processing.",
          "Google: only if you choose to sign in with Google.",
          "Google Play and Apple: deliver the apps, under their own policies.",
        ],
      },
      "These providers process data on our behalf to run the service. Some are in other countries, including the United States.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Your account and what you create are kept while your account exists, so you can come back to them. Guest work on a device stays until you delete it, clear the app's data or the browser's storage, or uninstall the app.",
      "When an account is deleted, the account and the study data linked to it are deleted at once. Library query logs are kept without any link to you (see Deleting your account and data).",
    ],
  },
  {
    id: "delete-account",
    heading: "Deleting your account and data",
    body: [
      "In the app: open Settings, choose Delete account, and type DELETE to confirm. Your account and its data are deleted at once and you are signed out. This cannot be undone.",
      "What is deleted: your account (email, username, sign-in), your profile and plan, your study sheets and everything added to them, your decks, cards and review history, your QBank sets, answers, flags, notes and the questions written for you, your usage counts and your AI memory.",
      "What is kept, with no link to you: the text of library queries and which reference passages they used, kept to check the quality of answers; and a Pro access code you redeemed, which stays used. Neither can be traced back to you once the account is gone.",
      `If you can't use the app (for example, you no longer have it installed), email ${PRIVACY_CONTACT_EMAIL} from the address on the account, with the subject "Delete my account". We confirm the request and delete the account within 30 days.`,
      "You can also delete single sheets, decks and QBank sets in the app at any time. A guest's work is on the device: clear the app's data or uninstall it (apps), or clear the site's data in your browser (website).",
      "To ask for a copy of your data, or to correct it, write to the same address.",
    ],
  },
  {
    heading: "Security",
    body: [
      "Data travels encrypted (HTTPS). Each account can reach only its own data: this is enforced in the database, not just in the app. No system is perfectly secure; if we learn of a breach that affects you, we will tell you.",
    ],
  },
  {
    heading: "Children",
    body: [
      "StudyBuddy is made for medical students and is not directed to children under 16. If you believe a child has given us personal data, contact us and we will delete it.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "If we change this policy, we update it here and change the effective date. If a change affects how we use data you have already given us, we will tell you in the app or by email before it takes effect.",
    ],
  },
  {
    heading: "Contact",
    body: [`Questions about privacy: ${PRIVACY_CONTACT_EMAIL}.`],
  },
];
