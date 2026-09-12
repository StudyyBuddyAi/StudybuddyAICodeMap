import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

interface TopicProgress {
  topic: string;
  system: string;
  sheetsCompleted: number;
  flashcardsMastered: number;
  flashcardsTotal: number;
  qbankScore: number;
  qbankTotal: number;
  lastStudied: number | null;
  overallMastery: number;
  isWeakness: boolean;
}

interface SheetRow {
  topic: string;
  created_at: string;
}

interface CardRow {
  topic: string;
  interval_days: number;
  due_at: string;
  last_reviewed_at: string | null;
}

interface QBankSessionRow {
  system: string;
  score: number;
  total: number;
  ended_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeTopicName(topic: string): string {
  return topic.toLowerCase().trim();
}

function calculateWeakness(
  flashcardsMastered: number,
  flashcardsTotal: number,
  qbankScore: number,
  qbankTotal: number,
  lastStudied: number | null
): boolean {
  const flashcardRate = flashcardsTotal > 0 ? flashcardsMastered / flashcardsTotal : 1;
  const qbankRate = qbankTotal > 0 ? qbankScore / qbankTotal : 1;
  const daysSinceStudy = lastStudied ? (Date.now() - lastStudied) / DAY_MS : Infinity;

  return qbankRate < 0.6 || flashcardRate < 0.6 || daysSinceStudy > 7;
}

function calculateOverallMastery(
  flashcardsMastered: number,
  flashcardsTotal: number,
  qbankScore: number,
  qbankTotal: number
): number {
  if (flashcardsTotal === 0 && qbankTotal === 0) return 0;
  
  const flashcardRate = flashcardsTotal > 0 ? flashcardsMastered / flashcardsTotal : 0;
  const qbankRate = qbankTotal > 0 ? qbankScore / qbankTotal : 0;
  
  // Weight: 40% flashcards, 60% QBank
  return Math.round((flashcardRate * 0.4 + qbankRate * 0.6) * 100);
}

export function useTopicProgress(topics: { title: string; system: string }[]) {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;

  const progressQuery = useQuery({
    queryKey: ["topic-progress", userId],
    enabled: useServer && topics.length > 0,
    queryFn: async (): Promise<TopicProgress[]> => {
      // Fetch sheets data
      const { data: sheets, error: sheetsError } = await supabase
        .from("study_history")
        .select("topic, created_at")
        .eq("user_id", userId!);

      if (sheetsError) throw sheetsError;

      // Fetch flashcards data
      const { data: cards, error: cardsError } = await supabase
        .from("cards")
        .select("topic, interval_days, due_at, last_reviewed_at")
        .eq("user_id", userId!);

      if (cardsError) throw cardsError;

      // Fetch QBank sessions
      const { data: qbankSessions, error: qbankError } = await supabase
        .from("qbank_sessions")
        .select("system, score, total, ended_at")
        .eq("user_id", userId!);

      if (qbankError) throw qbankError;

      // Build topic progress map
      const progressMap = new Map<string, TopicProgress>();

      // Initialize with all topics
      topics.forEach((topic) => {
        const normalizedTopic = normalizeTopicName(topic.title);
        progressMap.set(normalizedTopic, {
          topic: topic.title,
          system: topic.system,
          sheetsCompleted: 0,
          flashcardsMastered: 0,
          flashcardsTotal: 0,
          qbankScore: 0,
          qbankTotal: 0,
          lastStudied: null,
          overallMastery: 0,
          isWeakness: false,
        });
      });

      // Process sheets
      const sheetsByTopic = new Map<string, number>();
      (sheets as SheetRow[]).forEach((sheet) => {
        const normalizedTopic = normalizeTopicName(sheet.topic);
        const current = sheetsByTopic.get(normalizedTopic) || 0;
        sheetsByTopic.set(normalizedTopic, current + 1);
      });

      // Process flashcards
      const flashcardsByTopic = new Map<string, { mastered: number; total: number; lastStudied: number }>();
      (cards as CardRow[]).forEach((card) => {
        const normalizedTopic = normalizeTopicName(card.topic);
        const current = flashcardsByTopic.get(normalizedTopic) || { mastered: 0, total: 0, lastStudied: 0 };
        
        current.total++;
        if (card.interval_days >= 21) {
          current.mastered++;
        }
        
        if (card.last_reviewed_at) {
          const lastReviewed = new Date(card.last_reviewed_at).getTime();
          if (lastReviewed > current.lastStudied) {
            current.lastStudied = lastReviewed;
          }
        }
        
        flashcardsByTopic.set(normalizedTopic, current);
      });

      // Process QBank sessions by system
      const qbankBySystem = new Map<string, { score: number; total: number; lastStudied: number }>();
      (qbankSessions as QBankSessionRow[]).forEach((session) => {
        const normalizedSystem = session.system.toLowerCase();
        const current = qbankBySystem.get(normalizedSystem) || { score: 0, total: 0, lastStudied: 0 };
        
        current.score += session.score;
        current.total += session.total;
        
        const endedAt = new Date(session.ended_at).getTime();
        if (endedAt > current.lastStudied) {
          current.lastStudied = endedAt;
        }
        
        qbankBySystem.set(normalizedSystem, current);
      });

      // Combine all data
      progressMap.forEach((progress, normalizedTopic) => {
        const normalizedSystem = progress.system.toLowerCase();
        
        // Add sheets data
        progress.sheetsCompleted = sheetsByTopic.get(normalizedTopic) || 0;
        
        // Add flashcards data
        const flashcardData = flashcardsByTopic.get(normalizedTopic);
        if (flashcardData) {
          progress.flashcardsMastered = flashcardData.mastered;
          progress.flashcardsTotal = flashcardData.total;
          progress.lastStudied = flashcardData.lastStudied;
        }
        
        // Add QBank data (by system)
        const qbankData = qbankBySystem.get(normalizedSystem);
        if (qbankData) {
          progress.qbankScore = qbankData.score;
          progress.qbankTotal = qbankData.total;
          if (qbankData.lastStudied > (progress.lastStudied || 0)) {
            progress.lastStudied = qbankData.lastStudied;
          }
        }
        
        // Calculate metrics
        progress.overallMastery = calculateOverallMastery(
          progress.flashcardsMastered,
          progress.flashcardsTotal,
          progress.qbankScore,
          progress.qbankTotal
        );
        
        progress.isWeakness = calculateWeakness(
          progress.flashcardsMastered,
          progress.flashcardsTotal,
          progress.qbankScore,
          progress.qbankTotal,
          progress.lastStudied
        );
      });

      return Array.from(progressMap.values());
    },
  });

  const progressData = useServer ? progressQuery.data || [] : [];

  // Get weak topics
  const weakTopics = progressData.filter((t) => t.isWeakness);
  
  // Get overall stats
  const overallStats = {
    totalTopics: progressData.length,
    masteredTopics: progressData.filter((t) => t.overallMastery >= 80).length,
    weakTopics: weakTopics.length,
    averageMastery: progressData.length > 0 
      ? Math.round(progressData.reduce((sum, t) => sum + t.overallMastery, 0) / progressData.length)
      : 0,
  };

  return {
    progressData,
    weakTopics,
    overallStats,
    isLoading: useServer ? progressQuery.isLoading : false,
  };
}
