export function makeWorkbenchApi(supabase) {
  async function uploadImages(files, userId) {
    const paths = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("papers").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (!error) paths.push(path);
      else console.error("[workbench] upload failed:", error.message);
    }
    return paths;
  }

  // Upload a single image file and return a signed URL (valid 2 hours).
  // The URL is passed directly to the AI instead of base64 — no giant payload through Vercel.
  async function uploadAndGetSignedUrl(file, userId) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${userId}/vision/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("papers").upload(path, file, { cacheControl: "7200", upsert: false });
    if (error) throw new Error("上传失败: " + error.message);
    const { data, error: signErr } = await supabase.storage.from("papers").createSignedUrl(path, 7200);
    if (signErr) throw new Error("签名失败: " + signErr.message);
    return data.signedUrl;
  }

  async function imageToDataURI(path) {
    const { data, error } = await supabase.storage.from("papers").download(path);
    if (error || !data) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(data);
    });
  }

  async function createPaper({ userId, subject = "线性代数", title, imageUrls }) {
    const { data, error } = await supabase.from("papers").insert({
      user_id: userId,
      subject,
      title: title || `卷子 ${new Date().toLocaleDateString()}`,
      image_urls: imageUrls,
      status: "extracting",
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setPaperStatus(paperId, status) {
    await supabase.from("papers").update({ status }).eq("id", paperId);
  }

  async function insertItems(items) {
    const { data, error } = await supabase.from("paper_items").insert(items).select();
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function updateItem(itemId, patch) {
    const { data, error } = await supabase.from("paper_items").update(patch).eq("id", itemId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listWrongItems(userId) {
    const { data } = await supabase.from("paper_items")
      .select("*")
      .eq("user_id", userId)
      .eq("is_correct", false)
      .order("created_at", { ascending: false });
    return data || [];
  }

  // 错题本：错的题（自动收录）或被收藏的题（用户点星）。
  async function listNotebook(userId) {
    const { data, error } = await supabase.from("paper_items")
      .select("*")
      .eq("user_id", userId)
      .or("is_correct.eq.false,starred.eq.true")
      .order("created_at", { ascending: false });
    if (!error) return data || [];
    // starred 列可能还没建（用户尚未执行 sql/paper_items_starred.sql）→ 退回只取错题，至少不空白
    console.warn("[workbench] listNotebook fallback (starred 列可能缺失):", error.message);
    const r = await supabase.from("paper_items")
      .select("*").eq("user_id", userId).eq("is_correct", false)
      .order("created_at", { ascending: false });
    return r.data || [];
  }

  async function setStar(itemId, starred) {
    const { data, error } = await supabase.from("paper_items")
      .update({ starred: !!starred }).eq("id", itemId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  // AI 解题/收藏：把一道（非批改的）题存进错题本——挂到用户的"收藏夹"卷子下，标 starred。
  async function getOrCreateFavPaper(userId) {
    const { data } = await supabase.from("papers")
      .select("id").eq("user_id", userId).eq("title", "⭐ 收藏夹").limit(1);
    if (data && data.length) return data[0].id;
    const p = await createPaper({ userId, title: "⭐ 收藏夹", imageUrls: [] });
    return p.id;
  }

  async function saveSolvedItem(userId, { number, question, solution, knowledgePoints, chapter }) {
    const paperId = await getOrCreateFavPaper(userId);
    const data = await insertItems([{
      paper_id: paperId, user_id: userId, number: number || "", question: question || "",
      student_answer: "", correct_answer: solution || "", is_correct: null,
      error_type: null, error_detail: "", knowledge_points: knowledgePoints || [],
      chapter: chapter || "", answer_confidence: "high", reviewed: true, starred: true,
    }]);
    return data?.[0] || null;
  }

  async function deleteItem(itemId) {
    await supabase.from("paper_items").delete().eq("id", itemId);
  }

  // ── 以往记录：列出用户上传过的卷子 + 取原文件下载链接 ──
  async function listPapers(userId) {
    const { data } = await supabase.from("papers")
      .select("id,title,subject,image_urls,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return data || [];
  }

  // 批量把存储路径换成带签名的下载 URL（2 小时有效）
  async function signUrls(paths) {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return [];
    const { data } = await supabase.storage.from("papers").createSignedUrls(list, 7200);
    return (data || []).map((d) => ({ path: d.path, url: d.signedUrl, name: (d.path || "").split("/").pop() }));
  }

  async function deletePaper(paperId) {
    await supabase.from("papers").delete().eq("id", paperId);
  }

  async function bumpMastery(userId, items) {
    const aggregate = {};
    for (const item of items) {
      for (const point of item.knowledge_points || []) {
        if (!aggregate[point]) aggregate[point] = { wrong: 0, total: 0, chapter: item.chapter };
        aggregate[point].total += 1;
        if (item.is_correct === false) aggregate[point].wrong += 1;
      }
    }

    for (const [point, value] of Object.entries(aggregate)) {
      const { data: current } = await supabase.from("mastery")
        .select("wrong_count,total_count")
        .eq("user_id", userId)
        .eq("knowledge_point", point)
        .maybeSingle();
      const wrong = Number(current?.wrong_count || 0) + value.wrong;
      const total = Number(current?.total_count || 0) + value.total;
      const rate = total ? wrong / total : 0;
      const level = total < 2 ? "unknown" : rate >= 0.5 ? "weak" : rate >= 0.2 ? "ok" : "strong";
      await supabase.from("mastery").upsert({
        user_id: userId,
        knowledge_point: point,
        chapter: value.chapter,
        wrong_count: wrong,
        total_count: total,
        level,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,knowledge_point" });
    }
  }

  return {
    uploadAndGetSignedUrl,
    uploadImages,
    imageToDataURI,
    createPaper,
    setPaperStatus,
    insertItems,
    updateItem,
    listWrongItems,
    listNotebook,
    setStar,
    saveSolvedItem,
    deleteItem,
    listPapers,
    signUrls,
    deletePaper,
    bumpMastery,
  };
}
