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
    bumpMastery,
  };
}
