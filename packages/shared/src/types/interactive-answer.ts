export type InteractiveAnswer =
  | { type: 'budget'; title: string; currency: string; quantity: number; items: { label: string; unitPrice: number }[] }
  | { type: 'checklist'; title: string; items: string[] }
  | { type: 'comparison'; title: string; before: string; after: string }
  | { type: 'choices'; title: string; options: { label: string; description: string; prompt: string }[] };

export function parseInteractiveAnswer(source: string): InteractiveAnswer | null {
  if (source.length > 16000) return null;
  try {
    const data = JSON.parse(source);
    const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (!data || !text(data.title)) return null;
    if (data.type === 'choices' && Array.isArray(data.options) && data.options.length >= 2 && data.options.length <= 3
      && data.options.every((option: { label?: unknown; description?: unknown; prompt?: unknown }) => option && text(option.label, 80) && text(option.description, 300) && text(option.prompt, 2000))
      && new Set(data.options.map((option: { label: string }) => option.label.trim().toLowerCase())).size === data.options.length) return data;
    if (data.type === 'budget' && text(data.currency, 8) && Number.isInteger(data.quantity) && data.quantity >= 1 && data.quantity <= 100000
      && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 30
      && data.items.every((item: { label?: unknown; unitPrice?: unknown }) => item && text(item.label) && typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice >= 0 && item.unitPrice <= 1e9)) return data;
    if (data.type === 'checklist' && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50 && data.items.every((item: unknown) => text(item, 500))) return data;
    if (data.type === 'comparison' && typeof data.before === 'string' && typeof data.after === 'string' && data.before.length <= 7000 && data.after.length <= 7000 && (data.before || data.after)) return data;
  } catch { /* Partial streaming JSON stays readable as code until complete. */ }
  return null;
}

export const INTERACTIVE_ANSWER_INSTRUCTIONS = [
  'Desktop answer presentation: when useful, you may include one fenced code block with language deskmate and strict JSON matching one of these examples:',
  '{"type":"budget","title":"Picnic estimate","currency":"EUR","quantity":20,"items":[{"label":"Food per person","unitPrice":7}]}',
  '{"type":"checklist","title":"Next steps","items":["Review the draft","Confirm the venue"]}',
  '{"type":"comparison","title":"Writing revision","before":"Original text","after":"Revised text"}',
  '{"type":"choices","title":"How detailed should the result be?","options":[{"label":"Quick overview","description":"A short summary of the main findings.","prompt":"Please give me a quick overview of the main findings."},{"label":"Detailed comparison","description":"Compare the options with supporting detail.","prompt":"Please provide a detailed comparison of the options."}]}',
  'Use choices only when user guidance is needed. Provide 2–3 distinct choices, each with a short label, an honest description of its effect, and the exact follow-up prompt. Choices fill the prompt composer for review; they do not execute work until the user sends. A free-text alternative is provided automatically. Ask the question and list the options in plain text too, for other clients. Then finish the turn and wait for the user. Do not use a choice widget as a substitute for required permission tools. Do not invent estimates for cost or duration.',
  'Budgets multiply each unit price by the shared quantity; use only that model when appropriate. Explain assumptions in prose. Checklists are user planning controls, not proof of agent execution. Comparisons must use actual supplied/original content; never invent a before state. These widgets run locally without sending prompts or changing files. Keep JSON under 16000 characters, labels short, at most 30 budget rows or 50 checklist items, and each comparison side under 7000 characters. Include a concise plain-language result for exports and clients without widgets. Do not use widgets for trivial answers or when the user requests another format.',
].join('\n');
