-- An example project to try the interview locally: pnpm db:seed, then open /example/demo.
-- The brief below is a working template. Copy its shape for your own projects.

INSERT INTO projects (id, slug, name, organisation, brief_md, topics, max_turns, created_at)
VALUES (
  'prj_example',
  'example',
  'Automation workshop',
  'Example Co',
  'You are interviewing someone at Example Co about the work they want to automate in the workshop next month.

WHAT YOU NEED TO KNOW BY THE END
- What should the automation do, in one sentence.
- Which process does it replace or speed up? Who does that now, and how much time does it cost per week?
- What input and data does it need, and where do those live? Name the system or the folder.
- What output do they expect? Ask for one example of good and one of wrong.
- Which integrations are needed, and who manages access to those systems?
- What must the automation never do?

HOW YOU FOLLOW UP
- If an answer stays vague ("we want to work faster"), ask for the last concrete case. What did they do by hand last week?
- If you hear a number, check it briefly. Four hours a week, is that one person or the whole team?
- If someone names a tool, ask whether an integration or API already exists.
- Do not ask about a point that has already been answered. Infer what you can infer.',
  '[
    {"key": "goal", "label": "What the automation should do"},
    {"key": "process", "label": "Process it replaces, who does it now, time per week"},
    {"key": "data", "label": "Input and data, and where they live"},
    {"key": "output", "label": "Expected output, with a good and a wrong example"},
    {"key": "integrations", "label": "Integrations and who manages access"},
    {"key": "limits", "label": "What the automation must never do"}
  ]',
  8,
  strftime('%s', 'now') * 1000
);

INSERT INTO participants (id, project_id, code, name, status)
VALUES ('par_example', 'prj_example', 'demo', NULL, 'open');
