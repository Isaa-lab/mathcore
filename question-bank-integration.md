# 题库三入口接入说明

本次新增的是正式 React 组件，不是静态演示页。架构保持当前项目方式：

- 前端通过 `@supabase/supabase-js` 直连 Supabase。
- AI 生成和解题走现有 `/api/generate`。
- 样式为组件内手写 CSS 注入，不新增前端依赖。
- 公式渲染使用项目已有 `katex`。

## 新增文件

```text
src/lib/questionsApi.js
src/lib/aiClient.js
src/components/TextbookBank.jsx
src/components/AiGenerate.jsx
src/components/UploadSolve.jsx
scripts/import_to_supabase.py
sql/attempts_nullable_result_for_starred.sql
```

已有静态演示页仍保留：

```text
question-bank-demo.html
```

## 必跑 SQL

先确认已执行：

```text
sql/question_bank_sources_v1.sql
```

然后再执行：

```text
sql/attempts_nullable_result_for_starred.sql
```

原因：收藏题目时用户可能还没作答，`attempts.result` 必须允许 `null`，否则只写 `is_starred=true` 会被 `not null` 拦住。

## 导入 questions.json

本地 PowerShell：

```powershell
$env:SUPABASE_URL='https://xxxx.supabase.co'
$env:SUPABASE_SERVICE_KEY='你的 service_role key'
.\.venv\Scripts\python.exe scripts\import_to_supabase.py
```

`service_role key` 只给本地脚本用，不要放进前端或提交。

## 组件挂载示例

```jsx
import TextbookBank from "./components/TextbookBank";
import AiGenerate from "./components/AiGenerate";
import UploadSolve from "./components/UploadSolve";

function QuestionBankPage({ supabase, user }) {
  const [tab, setTab] = useState("textbook");

  return (
    <div>
      <button onClick={() => setTab("textbook")}>课本习题</button>
      <button onClick={() => setTab("ai")}>AI 出题</button>
      <button onClick={() => setTab("upload")}>上传求解</button>

      {tab === "textbook" && (
        <TextbookBank
          supabase={supabase}
          userId={user?.id}
          onPractice={(ids) => {
            // 接到现有练习页
            console.log(ids);
          }}
        />
      )}

      {tab === "ai" && (
        <AiGenerate
          supabase={supabase}
          userId={user?.id}
          onSaved={(n) => console.log("新增 AI 题", n)}
        />
      )}

      {tab === "upload" && (
        <UploadSolve supabase={supabase} userId={user?.id} />
      )}
    </div>
  );
}
```

## 数据说明

`questionsApi.js` 会从 `questions` 表读取题目，并合并 `attempts` 表中的用户状态：

- `result = correct` -> `做对`
- `result = wrong` -> `做错`
- 无记录或 `result = null` -> `未做`
- `is_starred = true` -> 已收藏

如果 `attempts` 表没建或 RLS 不通，组件不会崩；收藏会降级到 `localStorage` 的 `mc_quiz_bookmarks`。

## 验证

已执行：

```text
python -m py_compile scripts/import_to_supabase.py scripts/generate_answers.py scripts/judge_difficulty.py scripts/extract-leon-questions.py
npm run build
```

结果：React 生产构建通过。
