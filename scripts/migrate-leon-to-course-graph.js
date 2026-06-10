/* eslint-disable no-console */
// 把 Leon 9th 当前 material_topics + questions 迁移到课程级概念图：
// 1) 创建/获取课程（线性代数）
// 2) material_topics -> concepts（按名称去重）
// 3) material_topics.concept_id 回填
// 4) prerequisites 文本边 -> concept_edges
// 5) questions.knowledge_points 文本数组 -> question_concepts
//
// 用法：
//   node scripts/migrate-leon-to-course-graph.js
// 可选：
//   MATERIAL_ID=<uuid> node scripts/migrate-leon-to-course-graph.js

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadDotEnv() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、“”‘’【】（）()\-_:;,.!?]/g, "")
    .trim();
}

async function main() {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");

  const supa = createClient(url, key, { auth: { persistSession: false } });

  let materialId = process.env.MATERIAL_ID || null;
  let mat = null;
  if (materialId) {
    console.log(`[target] material_id = ${materialId}`);
    const byId = await supa
      .from("materials")
      .select("id,title,course")
      .eq("id", materialId)
      .maybeSingle();
    if (byId.error || !byId.data) throw new Error(`找不到目标教材：${byId.error?.message || "unknown"}`);
    mat = byId.data;
  } else {
    const byTitle = await supa
      .from("materials")
      .select("id,title,course,created_at")
      .ilike("title", "%Linear Algebra with Applications%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byTitle.error || !byTitle.data) {
      throw new Error(`未指定 MATERIAL_ID，且按标题未找到 Leon 教材：${byTitle.error?.message || "unknown"}`);
    }
    mat = byTitle.data;
    materialId = mat.id;
    console.log(`[target] auto-detected Leon material_id = ${materialId}`);
  }
  console.log(`[material] ${mat.title} / ${mat.course}`);

  // 1) 获取或创建课程
  const courseCode = "MATH-LA-UNDERGRAD";
  let courseId = null;
  {
    const q = await supa.from("courses").select("id,code,name").eq("code", courseCode).maybeSingle();
    if (!q.error && q.data) {
      courseId = q.data.id;
      console.log(`[course] exists ${q.data.code} (${q.data.name})`);
    } else {
      const ins = await supa
        .from("courses")
        .insert({
          code: courseCode,
          name: "线性代数",
          major: "数学与应用数学",
          stage: "undergraduate",
          semester: 2,
          kind: "required",
          description: "线性代数课程级概念网络（多教材汇总）",
        })
        .select("id,code,name")
        .single();
      if (ins.error) throw new Error(`courses 插入失败：${ins.error.message}`);
      courseId = ins.data.id;
      console.log(`[course] created ${ins.data.code} (${ins.data.name})`);
    }
  }

  // 2) 拉 material_topics
  const tRes = await supa
    .from("material_topics")
    .select("id,name,summary,kind,depth,prerequisites,material_id,concept_id")
    .eq("material_id", materialId);
  if (tRes.error) throw new Error(`拉 material_topics 失败：${tRes.error.message}`);
  const topics = tRes.data || [];
  console.log(`[topics] fetched ${topics.length}`);
  if (topics.length === 0) {
    console.log("没有可迁移的 material_topics，直接结束。");
    return;
  }

  // 3) 创建/合并 concepts
  const cRes = await supa.from("concepts").select("id,name,course_id").eq("course_id", courseId);
  if (cRes.error) throw new Error(`拉 concepts 失败：${cRes.error.message}`);
  const existing = cRes.data || [];
  const conceptByNorm = new Map(existing.map((c) => [normName(c.name), c]));
  const conceptById = new Map(existing.map((c) => [c.id, c]));

  // 只看当前 material 的 topics，避免历史遗留数据把课程概念“越迁越多”
  const existingLinkedRes = await supa
    .from("concepts")
    .select("id,name,course_id")
    .eq("course_id", courseId);
  if (existingLinkedRes.error) throw new Error(`拉课程 concepts 失败：${existingLinkedRes.error.message}`);
  const allCourseConcepts = existingLinkedRes.data || [];
  const linkedConceptIdSet = new Set(
    (topics || [])
      .map((t) => t.concept_id)
      .filter(Boolean)
  );
  const linkedConcepts = allCourseConcepts.filter((c) => linkedConceptIdSet.has(c.id));
  // 如果 topics 里还没 concept_id（首次迁移），那就允许用全课程做匹配
  const seedConcepts = linkedConcepts.length > 0 ? linkedConcepts : allCourseConcepts;
  const seedByNorm = new Map(seedConcepts.map((c) => [normName(c.name), c]));

  let createdConcepts = 0;
  const topicToConcept = new Map();
  for (const t of topics) {
    const nk = normName(t.name);
    if (!nk) continue;
    let concept = seedByNorm.get(nk) || conceptByNorm.get(nk);
    if (!concept) {
      const ins = await supa
        .from("concepts")
        .insert({
          course_id: courseId,
          name: t.name,
          summary: t.summary || null,
          kind: t.kind || null,
          depth: Number.isFinite(t.depth) ? t.depth : null,
          source_material_count: 1,
        })
        .select("id,name,course_id")
        .single();
      if (ins.error) throw new Error(`插入 concept 失败(${t.name})：${ins.error.message}`);
      concept = ins.data;
      conceptByNorm.set(nk, concept);
      seedByNorm.set(nk, concept);
      conceptById.set(concept.id, concept);
      createdConcepts += 1;
    }
    topicToConcept.set(t.id, concept.id);
  }
  console.log(`[concepts] created ${createdConcepts}, total in course = ${conceptByNorm.size}`);

  // 4) 回填 material_topics.concept_id
  let linkedTopics = 0;
  for (const t of topics) {
    const cid = topicToConcept.get(t.id);
    if (!cid) continue;
    const up = await supa.from("material_topics").update({ concept_id: cid }).eq("id", t.id);
    if (up.error) throw new Error(`回填 material_topics.concept_id 失败(${t.id})：${up.error.message}`);
    linkedTopics += 1;
  }
  console.log(`[material_topics] linked concept_id for ${linkedTopics}`);

  // 5) prerequisites -> concept_edges
  const topicByNormName = new Map(topics.map((t) => [normName(t.name), t]));
  let edgeInserted = 0;
  for (const t of topics) {
    const toCid = topicToConcept.get(t.id); // t 依赖 prereq => prereq -> t
    if (!toCid) continue;
    const prereqs = Array.isArray(t.prerequisites) ? t.prerequisites : [];
    for (const pNameRaw of prereqs) {
      const pNorm = normName(pNameRaw);
      if (!pNorm) continue;
      const sourceTopic = topicByNormName.get(pNorm);
      if (!sourceTopic) continue; // 当前教材找不到对应概念，先跳过（后续跨教材补）
      const fromCid = topicToConcept.get(sourceTopic.id);
      if (!fromCid || fromCid === toCid) continue;
      const ins = await supa
        .from("concept_edges")
        .upsert(
          {
            course_id: courseId,
            from_concept_id: fromCid,
            to_concept_id: toCid,
            relation: "prerequisite",
            weight: 1.0,
            source_material_id: materialId,
          },
          { onConflict: "from_concept_id,to_concept_id,relation" }
        )
        .select("id");
      if (!ins.error && ins.data && ins.data.length > 0) edgeInserted += ins.data.length;
    }
  }
  console.log(`[concept_edges] upserted ~${edgeInserted}`);

  // 6) questions.knowledge_points -> question_concepts
  const qRes = await supa
    .from("questions")
    .select("id,question,knowledge_points,material_id")
    .eq("material_id", materialId);
  if (qRes.error) throw new Error(`拉 questions 失败：${qRes.error.message}`);
  const questions = qRes.data || [];
  console.log(`[questions] fetched ${questions.length}`);

  let taggedLinks = 0;
  for (const q of questions) {
    const kps = Array.isArray(q.knowledge_points) ? q.knowledge_points : [];
    if (kps.length === 0) continue;
    for (let i = 0; i < kps.length; i++) {
      const kpNorm = normName(kps[i]);
      if (!kpNorm) continue;
      const c = conceptByNorm.get(kpNorm);
      if (!c) continue;
      const ins = await supa
        .from("question_concepts")
        .upsert(
          {
            question_id: q.id,
            concept_id: c.id,
            role: i === 0 ? "primary" : "secondary",
            weight: i === 0 ? 1.0 : 0.6,
            confidence: 85,
            source_material_id: materialId,
          },
          { onConflict: "question_id,concept_id" }
        )
        .select("id");
      if (!ins.error && ins.data && ins.data.length > 0) taggedLinks += ins.data.length;
    }
  }
  console.log(`[question_concepts] upserted ~${taggedLinks}`);

  // 7) summary
  const sumConcepts = await supa.from("concepts").select("id", { count: "exact", head: true }).eq("course_id", courseId);
  const sumEdges = await supa.from("concept_edges").select("id", { count: "exact", head: true }).eq("course_id", courseId);
  const sumQMap = await supa
    .from("question_concepts")
    .select("id", { count: "exact", head: true })
    .eq("source_material_id", materialId);

  console.log("\n✅ 迁移完成");
  console.log(`course_id=${courseId}`);
  console.log(`concepts(in course)=${sumConcepts.count || 0}`);
  console.log(`edges(in course)=${sumEdges.count || 0}`);
  console.log(`question_concepts(for material)=${sumQMap.count || 0}`);
}

main().catch((e) => {
  console.error("❌ migrate failed:", e?.message || e);
  process.exit(1);
});
