// 题库数据层：前端直连 Supabase。
// 状态和收藏统一走 attempts 表；表不可用时降级到 localStorage，避免白屏。

const BOOKMARK_KEY = "mc_quiz_bookmarks";

function safeParseJSON(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeQuestion(row) {
  return {
    ...row,
    subQuestions: row.sub_questions || row.subQuestions || [],
    chapterTitle: row.chapter_title || row.chapterTitle || "",
    answerStatus: row.answer_status || row.answerStatus || "pending",
  };
}

function localBookmarks() {
  if (typeof localStorage === "undefined") return new Set();
  return new Set(safeParseJSON(localStorage.getItem(BOOKMARK_KEY) || "[]", []));
}

function saveLocalBookmarks(set) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
}

export function makeQuestionsApi(supabase) {
  async function loadUserMeta(userId) {
    const meta = { result: {}, starred: {} };
    const local = localBookmarks();

    if (!userId) {
      for (const id of local) meta.starred[id] = true;
      return meta;
    }

    const { data, error } = await supabase
      .from("attempts")
      .select("question_id, result, is_starred")
      .eq("user_id", userId);

    if (error) {
      console.warn("[questionsApi] attempts unavailable, fallback to localStorage:", error.message);
      for (const id of local) meta.starred[id] = true;
      return meta;
    }

    for (const row of data || []) {
      if (row.result) meta.result[row.question_id] = row.result;
      if (row.is_starred) meta.starred[row.question_id] = true;
    }
    return meta;
  }

  async function listQuestions(filters = {}, userId = null) {
    let query = supabase.from("questions").select("*");

    if (filters.source) query = query.eq("source", filters.source);
    if (filters.owner) query = query.eq("owner", filters.owner);
    if (filters.chapter) query = query.eq("chapter", filters.chapter);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);
    if (filters.search) query = query.ilike("question", `%${filters.search}%`);

    query = query.order("chapter", { ascending: true }).limit(3000);

    const { data, error } = await query;
    if (error) {
      console.error("[questionsApi] listQuestions error:", error.message);
      return [];
    }

    const meta = await loadUserMeta(userId);
    return (data || []).map((row) => {
      const q = normalizeQuestion(row);
      return {
        ...q,
        status: meta.result[q.id] === "correct" ? "做对" : meta.result[q.id] === "wrong" ? "做错" : "未做",
        starred: !!meta.starred[q.id],
      };
    });
  }

  async function toggleStar(questionId, userId, nextStarred) {
    const local = localBookmarks();
    nextStarred ? local.add(questionId) : local.delete(questionId);
    saveLocalBookmarks(local);

    if (!userId) return { ok: true, local: true };

    const { data: existing, error: readError } = await supabase
      .from("attempts")
      .select("id, result")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .maybeSingle();

    if (readError) {
      console.warn("[questionsApi] toggleStar read fallback:", readError.message);
      return { ok: true, local: true, error: readError.message };
    }

    const payload = {
      user_id: userId,
      question_id: questionId,
      is_starred: nextStarred,
      ...(existing?.result ? { result: existing.result } : {}),
    };

    const { error } = await supabase
      .from("attempts")
      .upsert(payload, { onConflict: "user_id,question_id" });

    if (error) {
      console.warn("[questionsApi] toggleStar fallback:", error.message);
      return { ok: true, local: true, error: error.message };
    }
    return { ok: true };
  }

  async function recordAttempt(questionId, userId, result) {
    if (!userId) return { ok: false, reason: "not-logged-in" };
    const { error } = await supabase
      .from("attempts")
      .upsert(
        { user_id: userId, question_id: questionId, result },
        { onConflict: "user_id,question_id" }
      );
    if (error) {
      console.warn("[questionsApi] recordAttempt failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async function insertQuestions(rows) {
    const candidates = rows.map((row) => ({
      ...row,
      options: row.options && row.options.length ? row.options : null,
      answer_status: row.answer_status || row.answerStatus || (row.answer ? "generated" : "pending"),
    }));

    const stripSets = [
      [],
      ["sub_questions", "number", "source_page", "theorems", "confidence"],
      ["source", "owner", "answer_status", "sub_questions", "number", "source_page", "theorems", "confidence"],
      ["source", "owner", "answer_status", "chapter_title", "sub_questions", "number", "source_page", "theorems", "confidence"],
    ];

    let lastError = null;
    for (const strip of stripSets) {
      const payload = candidates.map((row) => {
        const next = { ...row };
        strip.forEach((key) => delete next[key]);
        return next;
      });
      const { data, error } = await supabase.from("questions").insert(payload).select();
      if (!error) return { ok: true, data: data || [] };
      lastError = error;
    }

    return { ok: false, error: lastError?.message || "insert failed", data: [] };
  }

  async function countBySource(source, owner = "public") {
    const { count, error } = await supabase
      .from("questions")
      .select("*", { count: "exact", head: true })
      .eq("source", source)
      .eq("owner", owner);
    if (error) return 0;
    return count || 0;
  }

  async function listChapters(source) {
    const { data, error } = await supabase.from("questions").select("chapter").eq("source", source);
    if (error) return [];
    return [...new Set((data || []).map((row) => row.chapter).filter(Boolean))].sort();
  }

  return {
    listQuestions,
    loadUserMeta,
    toggleStar,
    recordAttempt,
    insertQuestions,
    countBySource,
    listChapters,
  };
}
