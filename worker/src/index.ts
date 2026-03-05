interface Env {
  AI?: {
    run: (
      model: string,
      input: {
        messages: Array<{ role: 'system' | 'user'; content: string }>;
        temperature?: number;
        max_tokens?: number;
      }
    ) => Promise<unknown>;
  };
  AI_MODEL?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

type GenerateRequest = {
  resume?: unknown;
  job_description?: unknown;
  tone?: unknown;
};

type GenerateResponse = {
  cover_letter: string;
  skills: string[];
  email: string;
};

type ChatMessage = { role: 'system' | 'user'; content: string };

const MAX_TEXT_CHARS = 12000;
const MAX_TOTAL_CHARS = 20000;
const DEFAULT_TONE = 'professional';
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/generate') {
      return handleGenerate(request, env);
    }

    return jsonResponse(404, { error: 'Not found' });
  },
};

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const resume = sanitizeInput(body.resume);
  const jobDescription = sanitizeInput(body.job_description);
  const tone = sanitizeTone(body.tone);

  if (!resume || !jobDescription) {
    return jsonResponse(400, {
      error: '`resume` and `job_description` are required non-empty strings',
    });
  }

  if (resume.length > MAX_TEXT_CHARS || jobDescription.length > MAX_TEXT_CHARS) {
    return jsonResponse(400, {
      error: `Each input must be <= ${MAX_TEXT_CHARS} characters`,
    });
  }

  if (resume.length + jobDescription.length > MAX_TOTAL_CHARS) {
    return jsonResponse(400, {
      error: `Combined input must be <= ${MAX_TOTAL_CHARS} characters`,
    });
  }

  const model = env.AI_MODEL || DEFAULT_MODEL;

  try {
    const coverLetter = await runCompletion(env, model, buildCoverLetterPrompt(resume, jobDescription, tone), 700);
    const skillsRaw = await runCompletion(env, model, buildSkillsPrompt(resume, jobDescription), 300);
    const recruiterEmail = await runCompletion(env, model, buildEmailPrompt(resume, jobDescription, tone), 350);

    const response: GenerateResponse = {
      cover_letter: coverLetter,
      skills: parseSkills(skillsRaw),
      email: recruiterEmail,
    };

    return jsonResponse(200, response);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Workers AI call failed. Check CF_ACCOUNT_ID / CF_API_TOKEN configuration.';
    return jsonResponse(500, { error: message });
  }
}

async function runCompletion(env: Env, model: string, userPrompt: string, maxTokens: number): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a precise job application writing assistant. Follow instructions exactly and do not invent resume facts.',
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];

  const text = env.AI
    ? await runWithAIBinding(env, model, messages, maxTokens)
    : await runWithWorkersAiRest(env, model, messages, maxTokens);

  if (!text) {
    throw new Error('Empty model response');
  }

  return text;
}

async function runWithAIBinding(
  env: Env,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  if (!env.AI) {
    return '';
  }

  const result = await env.AI.run(model, {
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  return extractText(result).trim();
}

async function runWithWorkersAiRest(
  env: Env,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const accountId = (env.CF_ACCOUNT_ID || '').trim();
  const apiToken = (env.CF_API_TOKEN || '').trim();

  if (!accountId || !apiToken) {
    throw new Error('Missing AI config. Set CF_ACCOUNT_ID and CF_API_TOKEN in worker env.');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  });

  const json = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: unknown;
  };

  if (!response.ok || json.success === false) {
    const apiError = json?.errors?.[0]?.message || `Workers AI REST error (${response.status})`;
    throw new Error(apiError);
  }

  return extractText(json?.result).trim();
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractText(item))
      .filter(Boolean);
    return parts.join('\n').trim();
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const obj = value as Record<string, unknown>;

  const directKeys = ['response', 'text', 'output_text', 'content'];
  for (const key of directKeys) {
    const text = extractText(obj[key]);
    if (text) {
      return text;
    }
  }

  const nestedKeys = ['result', 'output', 'message', 'messages', 'choices', 'candidate', 'candidates'];
  for (const key of nestedKeys) {
    const text = extractText(obj[key]);
    if (text) {
      return text;
    }
  }

  return '';
}

function buildCoverLetterPrompt(resume: string, jobDescription: string, tone: string): string {
  return [
    'You are an expert career coach and professional writer specializing in job applications.',
    '',
    'Task: Write a tailored cover letter for the candidate based on their resume and the job description below.',
    '',
    'Requirements:',
    '- Length: 200-250 words across exactly 3 paragraphs.',
    `- Tone: ${tone}. Match this tone throughout — do not drift.`,
    '- Paragraph 1 (Hook): Open with a specific, compelling reason why THIS candidate wants THIS role at THIS company. Reference the company name and role title. Never start with "I am writing to express my interest."',
    '- Paragraph 2 (Evidence): Highlight 2-3 concrete achievements or experiences from the resume that directly map to requirements in the job description. Be specific — use real titles, real technologies, real outcomes from the resume. Do NOT invent metrics, employers, projects, or tools not present in the resume.',
    '- Paragraph 3 (Close): Reinforce fit in one sentence. End with a confident, forward-looking call to action — no generic "I look forward to hearing from you."',
    '- Naturally weave in keywords from the job description without keyword-stuffing.',
    '- Write in first person as the candidate.',
    '- Return plain text only. No markdown, no headers, no bullet points.',
    '',
    '--- RESUME ---',
    resume,
    '',
    '--- JOB DESCRIPTION ---',
    jobDescription,
  ].join('\n');
}

function buildSkillsPrompt(resume: string, jobDescription: string): string {
  return [
    'You are an expert technical recruiter and resume optimizer.',
    '',
    'Task: Rewrite the Skills section of the resume so it better matches the Job Description (JD).',
    '',
    'Rules:',
    '- Reorder skills within each category to front-load the ones most relevant to the JD.',
    '- Add skills that are explicitly mentioned in the JD but missing from the resume, placing each in the most appropriate existing category.',
    '- Only add a skill if it is a real, specific technology or competency — do not add vague buzzwords.',
    '- Remove skills that are clearly irrelevant to this specific role.',
    '- Ensure every skill keyword from the resume body (experience, projects) is represented in the skills section.',
    '- Do NOT change the category headings or overall format.',
    '- Do NOT duplicate any skill across categories.',
    '- Keep each skill concise (1-4 words max).',
    '- Return ONLY the updated skills section — no explanation, no prose, no markdown fences.',
    '',
    'Current Skills Section:',
    'Languages: C, C++, Python, Go, TypeScript, Haskell',
    'Systems & Low-Level: Linux, Multithreading, Concurrency, Memory Management, LLVM, GCC, gdb, Distributed Systems',
    'Data & ML: PyTorch, TensorFlow, Scikit-learn, RAG, Embeddings, Model Evaluation, Ranking & Retrieval Systems',
    'Backend & Infrastructure: React, REST APIs, PostgreSQL, Docker, Kubernetes, AWS, CI/CD (GitHub Actions), Git',
    '',
    '--- RESUME ---',
    resume,
    '',
    '--- JOB DESCRIPTION ---',
    jobDescription,
  ].join('\n');
}

function buildEmailPrompt(resume: string, jobDescription: string, tone: string): string {
  return [
    'You are an expert career coach writing on behalf of a job candidate.',
    '',
    'Task: Write a concise, compelling outreach email to a recruiter or hiring manager for the role described below.',
    '',
    'Requirements:',
    '- Length: 4-6 sentences. Every sentence must earn its place — no filler.',
    `- Tone: ${tone}.`,
    '- Structure:',
    '  • Sentence 1: Hook — who you are and why you are reaching out. Reference the specific role and company. Do not start with "I saw your job posting."',
    '  • Sentences 2-3: Two to three strongest matches between the candidate\'s background and the JD requirements. Use real titles and technologies from the resume. Do NOT invent anything.',
    '  • Sentence 4: Brief signal of genuine interest in the company or team specifically.',
    '  • Sentence 5-6: Clear, confident call to action.',
    '- Include a subject line on the first line, formatted as: Subject: <subject line>',
    '- After the subject line, leave one blank line, then write the email body.',
    '- Do not include a salutation (no "Dear Hiring Manager") — start directly with the hook.',
    '- Return plain text only. No markdown.',
    '',
    '--- RESUME ---',
    resume,
    '',
    '--- JOB DESCRIPTION ---',
    jobDescription,
  ].join('\n');
}

function parseSkills(raw: string): string[] {
  const cleaned = raw.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return normalizeSkills(parsed);
    }
  } catch {
    // Fall through to line-based parsing.
  }

  const lines = cleaned
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean);

  return normalizeSkills(lines);
}

function normalizeSkills(items: unknown[]): string[] {
  const deduped = new Set<string>();

  for (const item of items) {
    if (typeof item !== 'string') {
      continue;
    }

    const value = item.trim();
    if (!value) {
      continue;
    }

    deduped.add(value);
    if (deduped.size >= 10) {
      break;
    }
  }

  return Array.from(deduped);
}

function sanitizeInput(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function sanitizeTone(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_TONE;
  }

  const cleaned = value.trim();
  return cleaned || DEFAULT_TONE;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}
