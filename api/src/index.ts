interface Env {
  OPENAI_API_KEY: string;
  RATE_LIMIT: KVNamespace;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-License-Key",
};

const MONTHLY_QUOTA = 500;
const LICENSE_CACHE_TTL = 3600; // 1 hour
const QUOTA_TTL = 35 * 24 * 3600; // 35 days

const SYSTEM_ENHANCE =
  "You are a prompt engineer for AI image/video generation. Enhance this rough description into a detailed, vivid prompt. Return only the enhanced prompt, nothing else.";

const SYSTEM_REWRITE_PREFIX =
  "The following prompt was rejected for policy violation. Rewrite it to avoid the violation while keeping the creative intent.";

const SYSTEM_VARIANTS_PREFIX =
  "Generate creative variations of this prompt for AI image/video generation. Return each variation on a new line, numbered 1. 2. 3. etc.";

// ---------- helpers ----------

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function corsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- license validation ----------

async function validateLicense(env: Env, licenseKey: string): Promise<boolean> {
  // Check cache first
  const cacheKey = `license:${licenseKey}`;
  const cached = await env.RATE_LIMIT.get(cacheKey);
  if (cached !== null) return cached === "valid";

  try {
    const res = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: licenseKey }),
    });

    const data = (await res.json()) as { valid?: boolean };
    const valid = data.valid === true;

    // Cache result for 1 hour
    await env.RATE_LIMIT.put(cacheKey, valid ? "valid" : "invalid", {
      expirationTtl: LICENSE_CACHE_TTL,
    });

    return valid;
  } catch {
    // On network error, deny access
    return false;
  }
}

// ---------- rate limiting ----------

async function getRemainingQuota(env: Env, licenseKey: string): Promise<number> {
  const key = `quota:${licenseKey}:${monthKey()}`;
  const val = await env.RATE_LIMIT.get(key);
  if (val === null) return MONTHLY_QUOTA;
  return parseInt(val, 10);
}

async function decrementQuota(env: Env, licenseKey: string, remaining: number): Promise<void> {
  const key = `quota:${licenseKey}:${monthKey()}`;
  await env.RATE_LIMIT.put(key, String(remaining - 1), {
    expirationTtl: QUOTA_TTL,
  });
}

// ---------- OpenAI calls ----------

async function chatCompletion(
  env: Env,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from OpenAI");
  return content;
}

// ---------- handlers ----------

async function handleEnhance(
  request: Request,
  env: Env,
  remaining: number,
  licenseKey: string,
): Promise<Response> {
  const { prompt } = (await request.json()) as { prompt: string };
  if (!prompt) return json({ error: "Missing prompt" }, 400);

  const result = await chatCompletion(env, SYSTEM_ENHANCE, prompt);
  await decrementQuota(env, licenseKey, remaining);

  return json({ result }, 200, {
    "X-AI-Quota-Remaining": String(remaining - 1),
  });
}

async function handleRewrite(
  request: Request,
  env: Env,
  remaining: number,
  licenseKey: string,
): Promise<Response> {
  const { prompt, error } = (await request.json()) as {
    prompt: string;
    error: string;
  };
  if (!prompt) return json({ error: "Missing prompt" }, 400);

  const system = `${SYSTEM_REWRITE_PREFIX} Error: ${error}. Return only the rewritten prompt.`;
  const result = await chatCompletion(env, system, prompt);
  await decrementQuota(env, licenseKey, remaining);

  return json({ result }, 200, {
    "X-AI-Quota-Remaining": String(remaining - 1),
  });
}

async function handleVariants(
  request: Request,
  env: Env,
  remaining: number,
  licenseKey: string,
): Promise<Response> {
  const { prompt, count = 3 } = (await request.json()) as {
    prompt: string;
    count?: number;
  };
  if (!prompt) return json({ error: "Missing prompt" }, 400);

  const system = SYSTEM_VARIANTS_PREFIX.replace(
    "Generate creative",
    `Generate ${count} creative`,
  );
  const raw = await chatCompletion(env, system, prompt);

  const result = raw
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, count);

  await decrementQuota(env, licenseKey, remaining);

  return json({ result }, 200, {
    "X-AI-Quota-Remaining": String(remaining - 1),
  });
}

// ---------- entry ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return corsResponse();

    const url = new URL(request.url);

    // License key validation
    const licenseKey = request.headers.get("X-License-Key");
    if (!licenseKey) return json({ error: "Missing license key" }, 401);

    const valid = await validateLicense(env, licenseKey);
    if (!valid) return json({ error: "Invalid license key" }, 403);

    // Rate limiting
    const remaining = await getRemainingQuota(env, licenseKey);
    if (remaining <= 0) return json({ error: "Monthly quota exceeded" }, 429);

    // Route
    try {
      if (url.pathname === "/api/ai/enhance" && request.method === "POST") {
        return await handleEnhance(request, env, remaining, licenseKey);
      }
      if (url.pathname === "/api/ai/rewrite" && request.method === "POST") {
        return await handleRewrite(request, env, remaining, licenseKey);
      }
      if (url.pathname === "/api/ai/variants" && request.method === "POST") {
        return await handleVariants(request, env, remaining, licenseKey);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return json({ error: message }, 502);
    }

    return json({ error: "Not found" }, 404);
  },
};
